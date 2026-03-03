# Combine everything together in main.py
from __future__ import annotations
import json
import os
import threading
import time
import uuid
from dataclasses import asdict, is_dataclass
from typing import Any, Dict, List, Optional, Set, Tuple

import requests
from fastapi import Body, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app.agent.manager_agent import ManagerAgent
from app.state_types import JobRequest, NodeSnapshot
from app.node.node_client import NodeClient
from app.node.virtualbox import discover_nodes
from app.api_models import RunConfig, RunStartResponse, RunStatusResponse
from app.run_engine import RunEngine, RunState
from app.auth_models import (
    ApiMessage,
    CreateUserRequest,
    LoginRequest,
    LoginResponse,
    UpdateUserRequest,
    UserListResponse,
    UserPublic,
)
from app.firebase_auth import (
    AuthError,
    UnauthorizedError,
    create_user,
    current_user_from_token,
    deactivate_user,
    ensure_bootstrap_admin,
    init_firebase_app,
    list_users,
    login_with_email_password,
    update_user,
)


app = FastAPI(title="CSEN 174 Manager API")
client = NodeClient(timeout_s=2) # Creates a reusable HTTP client wrapper for talking to nodes


from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5500", "http://127.0.0.1:5500", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


POLL_S = 2.0 # How often to poll nodes for metrics
METRICS_SINK_URL = os.getenv("METRICS_SINK_URL", "http://127.0.0.1:3000/api/metrics/node-samples")
METRICS_SINK_TIMEOUT_S = float(os.getenv("METRICS_SINK_TIMEOUT_S", "0.8"))
OBSERVE_DEUP: Set[str] = set() # To track which nodes we've already observed during discovery
OBSERVE_LOCK = threading.Lock() # To synchronize access to OBSERVE_DEUP -> protect against race conditions

# Cache ManagerAgent instances so learning persists per (learner, goal, kwargs, etc...)
"""
(
    learner_kind,
    goal_kind,
    learner_kwargs,
    goal_kwargs,
    seed,
)

Because our APIs allow different users to submit different configs --> If we didn't cache agents, 
then each new job submission would create a new ManagerAgent with a fresh policy, 
which would prevent learning across jobs. 
By caching them in AGENTS, we can ensure that the same (learner, goal, config) combination
reuses the same ManagerAgent instance, allowing it to learn and improve over time as it processes more jobs.

"""
AGENTS: Dict[Tuple[str, str, str, str, Optional[int]], ManagerAgent] = {}
AGENTS_LOCK = threading.Lock()
RUNS: Dict[str, RunState] = {}
RUNS_LOCK = threading.Lock()
RUN_ENGINE = RunEngine()





"""
UTILITY FUNCTIONS

"""

# Returns current epoch time in ms
def now_ms() -> int:
    return int(time.time() * 1000)



def _stable_json(x: Optional[Dict[str, Any]]) -> str:
    return json.dumps(x or {}, sort_keys=True)


def get_agent(
    *,
    learner_kind: str,
    goal_kind: str,
    seed: Optional[int],
    learner_kwargs: Optional[Dict[str, Any]],
    goal_kwargs: Optional[Dict[str, Any]],
) -> ManagerAgent:
    """
    Returns a persistent ManagerAgent for this exact config.
    """
    key = (
        learner_kind.strip().lower(),
        goal_kind.strip().lower(),
        _stable_json(learner_kwargs),
        _stable_json(goal_kwargs),
        seed,
    )
    with AGENTS_LOCK:
        if key not in AGENTS:
            AGENTS[key] = ManagerAgent(
                learner_kind=learner_kind,
                goal_kind=goal_kind,
                seed=seed,
                learner_kwargs=learner_kwargs or {},
                goal_kwargs=goal_kwargs or {},
            )
        return AGENTS[key]


def live_snapshots() -> List[NodeSnapshot]:
    """
    VBox discover + pull /metrics from each node.
    """
    base = discover_nodes() # Discover nodes using VirtualBox API -> returns list of NodeSnapshot with static info (name, host, port, cpus, memory_mb)
    snaps: List[NodeSnapshot] = []
    for n in base:
        try:
            snaps.append(client.get_metrics(n))
        except Exception as e:
            print(f"[WARN] metrics failed for {n.name}: {e}")
    return snaps


def persist_node_samples(snaps: List[NodeSnapshot], captured_at_ms: int) -> None:
    """
    Best-effort persistence of live node metrics into Postgres via web API.
    """
    if not METRICS_SINK_URL or not snaps:
        return

    payload = {
        "samples": [
            {
                "nodeName": s.name,
                "host": s.host,
                "port": s.port,
                "cpus": s.cpus,
                "memoryMb": s.memory_mb,
                "cpuPct": s.cpu_pct,
                "memPct": s.mem_pct,
                "queueLen": s.queue_len,
                "inFlight": s.in_flight,
                "ewmaLatencyMs": s.ewma_latency_ms,
                "p95LatencyMs": s.p95_latency_ms,
                "completedLast60s": s.completed_last_60s,
                "nodeSpeed": s.node_speed,
                "capturedAtMs": captured_at_ms,
                "source": "backend_nodes_poll",
                "metadata": {},
            }
            for s in snaps
        ]
    }

    try:
        r = requests.post(METRICS_SINK_URL, json=payload, timeout=METRICS_SINK_TIMEOUT_S)
        if r.status_code >= 400:
            print(f"[WARN] metrics sink returned {r.status_code}: {r.text[:200]}")
    except Exception as e:
        # Keep /nodes fast and resilient even if metrics sink is unavailable.
        print(f"[WARN] metrics sink unreachable: {e}")

# Universal object -> dictionary converter
# Standardizes everything into JSON-serializable dictionary
def to_dict(x: Any) -> Dict[str, Any]:
    if is_dataclass(x): # If x is a dataclass instance, convert it to a dict using asdict()
        return asdict(x)
    if hasattr(x, "dict"): # If x has a .dict() method (like Pydantic models), use it to convert to dict
        return x.dict()
    if hasattr(x, "__dict__"): # If x has a __dict__ attribute, use it to convert to dict
        return dict(x.__dict__)
    return dict(x)


"""
Request Models (User chooses config here)
"""
class AgentConfig(BaseModel):
    learner_kind: str = Field(..., description="e.g. ucb1, ema, sample_average, thompson_gaussian, contextual_linear, sliding_window")
    goal_kind: str = Field(..., description="e.g. min_mean_latency, min_latency_with_sla, min_latency_plus_tail")
    seed: Optional[int] = Field(default=None)

    learner_kwargs: Optional[Dict[str, Any]] = Field(default=None)
    goal_kwargs: Optional[Dict[str, Any]] = Field(default=None)

class SubmitJobRequest(BaseModel):
    config: AgentConfig
    job: JobRequest

class SubmitJobResult(BaseModel):
    decision: Dict[str, Any]
    node_response: Dict[str, Any]
    agent_key: Dict[str, Any]

"""
Background Observer (Poll/recent_jobs -> call observe on all agents with current state + recent job outcomes)
"""

# Repeatedly checks all nodes to see which jobs finished -> then tells the correct learning agent how long that job took
def poll_recent_jobs_and_observe():
    while True:
        time.sleep(POLL_S)

        with AGENTS_LOCK:
            agents = list(AGENTS.values()) # Get a snapshot of current agents to observe
            if not agents:
                continue # If no agents exist yet, skip this poll cycle

            # Nodes to poll
            nodes = discover_nodes() # Discover nodes using VirtualBox API -> returns list of NodeSnapshot with static info (name, host, port, cpus, memory_mb)
            if not nodes:
                continue # If no nodes found, skip this poll cycle

            for node in nodes:
                try:
                    url = f"http://{node.host}:{node.port}/recent_jobs?limit=200"
                    r = requests.get(url, timeout=2.0)
                    r.raise_for_status()
                    records = r.json() # Expecting list of recent job records with fields like job_id, user_id, service_time_ms, metadata
                except Exception:
                    continue

                for record in records:
                    job_id = record.get("job_id")
                    lat = record.get("observed_latency_ms")
                    if not job_id or lat is None:
                        continue # Skip malformed records

                    with OBSERVE_LOCK:
                        if job_id in OBSERVE_DEUP:
                            continue # Skip already observed job outcomes
                    
                    observed = False
                    for agent in agents:
                        if job_id not in set(agent.pending_job_ids()):
                            continue # This agent didn't submit this job, so skip

                        try:
                            agent.observe(job_id, success=True, latency_ms=float(lat),extra={"node": node.name}) # Tell the agent about this completed job and its latency
                            observed = True
                            break
                        except Exception:
                            pass
                    
                    if observed:
                        with OBSERVE_LOCK:
                            OBSERVE_DEUP.add(job_id) # Mark this job_id as observed to avoid duplicate processing


# Launches a background worker that keeps checking for completed jobs and runs forever in the background, allowing the manager to learn from job outcomes over time without blocking the main API thread.
@app.on_event("startup")
def startup():
    try:
        init_firebase_app()
        boot = ensure_bootstrap_admin()
        if boot is not None:
            print(f"Auth bootstrap admin ready: {boot['email']}")
    except Exception as exc:
        print(f"[WARN] firebase auth bootstrap skipped: {exc}")
    print("Starting background observer thread...")
    t = threading.Thread(target=poll_recent_jobs_and_observe, daemon=True)
    t.start()

"""
API ENDPOINTS
"""

# Check if the manager is alive and responding
@app.get("/health")
def health():
    return {"ok": True, "time_ms": now_ms()}


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    return parts[1].strip()


def require_user(authorization: Optional[str] = Header(default=None)) -> Dict[str, Any]:
    try:
        token = _extract_bearer_token(authorization)
        return current_user_from_token(token)
    except UnauthorizedError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def require_admin(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    if not bool(user.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


@app.post("/auth/login", response_model=LoginResponse)
def auth_login(payload: LoginRequest):
    try:
        return LoginResponse(**login_with_email_password(payload.email, payload.password))
    except UnauthorizedError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/auth/me", response_model=UserPublic)
def auth_me(user: Dict[str, Any] = Depends(require_user)):
    return UserPublic(**user)


@app.post("/auth/logout", response_model=ApiMessage)
def auth_logout(_: Dict[str, Any] = Depends(require_user)):
    return ApiMessage(ok=True, message="Logged out")


@app.get("/users", response_model=UserListResponse)
def users_list(_: Dict[str, Any] = Depends(require_admin)):
    return UserListResponse(rows=[UserPublic(**row) for row in list_users()])


@app.post("/users", response_model=UserPublic)
def users_create(payload: CreateUserRequest, _: Dict[str, Any] = Depends(require_admin)):
    try:
        return UserPublic(
            **create_user(
                email=payload.email,
                password=payload.password,
                full_name=payload.full_name,
                is_admin=payload.is_admin,
                is_active=payload.is_active,
            )
        )
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/users/{user_id}", response_model=UserPublic)
def users_update(user_id: str, payload: UpdateUserRequest, admin: Dict[str, Any] = Depends(require_admin)):
    if user_id == admin["id"] and payload.is_active is False:
        raise HTTPException(status_code=400, detail="Admin cannot deactivate self")
    if user_id == admin["id"] and payload.is_admin is False:
        raise HTTPException(status_code=400, detail="Admin cannot remove own admin role")
    try:
        return UserPublic(
            **update_user(
                user_id=user_id,
                email=payload.email,
                password=payload.password,
                full_name=payload.full_name,
                is_admin=payload.is_admin,
                is_active=payload.is_active,
            )
        )
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/users/{user_id}", response_model=UserPublic)
def users_delete(user_id: str, admin: Dict[str, Any] = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Admin cannot deactivate self")
    try:
        return UserPublic(**deactivate_user(user_id))
    except AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

# Finds all running VMs, Asks each VM for its metrics, and returns as JSON
@app.get("/nodes")
def nodes():
    snaps = live_snapshots()
    t_ms = now_ms()
    persist_node_samples(snaps, t_ms)
    return {"count": len(snaps), "nodes": [to_dict(s) for s in snaps], "time_ms": t_ms}


@app.post("/jobs/submit", response_model=SubmitJobResult)
def submit_job(request: SubmitJobRequest):
    """
    User provides config (learner/goal) + job.
    Manager:
      1) gets the right agent for that config (persistent)
      2) discovers nodes
      3) routes job
      4) forwards job to node /submit
      5) completion is observed by background polling
    """
    cfg = request.config
    job = request.job

    agent = get_agent(
        learner_kind=cfg.learner_kind,
        goal_kind=cfg.goal_kind,
        seed=cfg.seed,
        learner_kwargs=cfg.learner_kwargs,
        goal_kwargs=cfg.goal_kwargs,
    )

    snaps = live_snapshots()
    if not snaps:
        raise HTTPException(status_code=503, detail="No nodes available")
    
    decision = agent.route(job,snaps)

    # Forward to node
    try: 
        node_stub = NodeSnapshot(
            name=decision.node_name,
            host=decision.host,
            port=decision.port,
            cpus=0,
            memory_mb=0,
        )
        node_resp = client.submit_job(node_stub, job)
    except Exception as e:
        # Punish if dispatch failed (e.g. node offline)
        try:
            agent.observe(job.job_id, success=False, latency_ms=agent.latency_clip_ms, extra={"dispatch_error": str(e)})
        except Exception:
            pass
        raise HTTPException(status_code=503, detail=f"Failed to dispatch job to node: {e}")

    return SubmitJobResult(
        decision=to_dict(decision),
        node_response=node_resp,
        agent_key={
            "learner_kind": cfg.learner_kind,
            "goal_kind": cfg.goal_kind,
            "seed": cfg.seed,
            "learner_kwargs": cfg.learner_kwargs,
            "goal_kwargs": cfg.goal_kwargs,
        },
    )

@app.post("/agents/learner_stats")
def agent_learner_stats(cfg: AgentConfig):
    agent = get_agent(
        learner_kind=cfg.learner_kind,
        goal_kind=cfg.goal_kind,
        seed=cfg.seed,
        learner_kwargs=cfg.learner_kwargs,
        goal_kwargs=cfg.goal_kwargs,
    )
    return agent.learner_stats()

@app.post("/agents/latency_stats")
def agent_latency_stats(cfg: AgentConfig):
    agent = get_agent(
        learner_kind=cfg.learner_kind,
        goal_kind=cfg.goal_kind,
        seed=cfg.seed,
        learner_kwargs=cfg.learner_kwargs,
        goal_kwargs=cfg.goal_kwargs,
    )
    return agent.latency_stats()


@app.post("/agents/summary")
def agent_summary(cfg: AgentConfig):
    agent = get_agent(
        learner_kind=cfg.learner_kind,
        goal_kind=cfg.goal_kind,
        seed=cfg.seed,
        learner_kwargs=cfg.learner_kwargs,
        goal_kwargs=cfg.goal_kwargs,
    )
    return agent.summary()


@app.post("/agents/stats")
def agent_stats(cfg: AgentConfig):
    """
    One call for frontend: learner stats + latency stats + summary + pending
    """
    agent = get_agent(
        learner_kind=cfg.learner_kind,
        goal_kind=cfg.goal_kind,
        seed=cfg.seed,
        learner_kwargs=cfg.learner_kwargs,
        goal_kwargs=cfg.goal_kwargs,
    )
    return {
        "learner": agent.learner_stats(),
        "latency": agent.latency_stats(),
        "summary": agent.summary(),
        "pending_job_ids": agent.pending_job_ids(),
        "time_ms": now_ms(),
    }


@app.post("/agents/pending")
def agent_pending(cfg: AgentConfig):
    agent = get_agent(
        learner_kind=cfg.learner_kind,
        goal_kind=cfg.goal_kind,
        seed=cfg.seed,
        learner_kwargs=cfg.learner_kwargs,
        goal_kwargs=cfg.goal_kwargs,
    )
    return {"pending_job_ids": agent.pending_job_ids()}


@app.get("/agents")
def list_agents():
    """
    Quick debug: see what configs currently exist.
    """
    with AGENTS_LOCK:
        keys = list(AGENTS.keys())
    return {
        "count": len(keys),
        "agents": [
            {
                "learner_kind": k[0],
                "goal_kind": k[1],
                "learner_kwargs": json.loads(k[2]),
                "goal_kwargs": json.loads(k[3]),
                "seed": k[4],
            }
            for k in keys
        ],
    }



@app.post("/reset")
def reset_all():
    global OBSERVE_DEUP
    with AGENTS_LOCK:
        AGENTS.clear()
    with OBSERVE_LOCK:
        OBSERVE_DEUP.clear()
    return {"ok": True, "time_ms": now_ms()}



@app.post("/agents/explanations/recent")
def agent_explanations_recent(cfg: AgentConfig, limit: int = 50):
    agent = get_agent(
        learner_kind=cfg.learner_kind,
        goal_kind=cfg.goal_kind,
        seed=cfg.seed,
        learner_kwargs=cfg.learner_kwargs,
        goal_kwargs=cfg.goal_kwargs,
    )
    # requires you added agent.explainer
    return {"events": agent.explainer.recent_events(limit=limit), "time_ms": now_ms()}


@app.post("/agents/explanations/summary")
def agent_explanations_summary(cfg: AgentConfig):
    agent = get_agent(
        learner_kind=cfg.learner_kind,
        goal_kind=cfg.goal_kind,
        seed=cfg.seed,
        learner_kwargs=cfg.learner_kwargs,
        goal_kwargs=cfg.goal_kwargs,
    )
    return {"summary": agent.explainer.summary(), "time_ms": now_ms()}


@app.post("/agents/explanations/timeseries")
def agent_explanations_timeseries(cfg: AgentConfig):
    agent = get_agent(
        learner_kind=cfg.learner_kind,
        goal_kind=cfg.goal_kind,
        seed=cfg.seed,
        learner_kwargs=cfg.learner_kwargs,
        goal_kwargs=cfg.goal_kwargs,
    )
    return {"series": agent.explainer.timeseries(), "time_ms": now_ms()}


@app.post("/runs/start", response_model=RunStartResponse)
def start_run(cfg: RunConfig):
    run_id = str(uuid.uuid4())
    state = RunState.new(run_id, cfg)
    with RUNS_LOCK:
        RUNS[run_id] = state

    t = threading.Thread(target=RUN_ENGINE.execute_run, args=(run_id, cfg, RUNS), daemon=True)
    t.start()
    return RunStartResponse(run_id=run_id, status="running")


@app.get("/runs/{run_id}", response_model=RunStatusResponse)
def get_run_status(run_id: str):
    with RUNS_LOCK:
        st = RUNS.get(run_id)
    if st is None:
        raise HTTPException(status_code=404, detail="run not found")
    return st.to_response()