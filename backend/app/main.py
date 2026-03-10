# Combine everything together in main.py
from __future__ import annotations
try:
    from dotenv import load_dotenv
except Exception:
    def load_dotenv(*_args, **_kwargs):
        return False

load_dotenv()
import json
import os
import threading
import time
import shutil
import uuid
import statistics
from dataclasses import asdict, is_dataclass, dataclass
from typing import Any, Dict, List, Optional, Set, Tuple

import requests
from fastapi import FastAPI, HTTPException
from fastapi import Body, Query, Depends, Header
from pydantic import BaseModel, Field

from app.agent.manager_agent import ManagerAgent
from app.state_types import JobRequest, NodeSnapshot
from app.node.node_client import NodeClient
# from app.node.virtualbox import discover_nodes
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

from app.cloud.ec2_controller import create_vm, stop_vm, start_vm, delete_vm, get_instance_ip, get_latest_ubuntu_ami
from app.cloud.ec2_controller import list_nodes as list_ec2_nodes


from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="CSEN 174 Manager API")
client = NodeClient(timeout_s=2)  # reusable HTTP client wrapper for talking to nodes

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# POLL_S = 2.0
# OBSERVE_DEUP: Set[str] = set()
# OBSERVE_LOCK = threading.Lock()

# Cache ManagerAgent instances so learning persists per config
POLL_S = 4.0 # How often to poll nodes for metrics
METRICS_SINK_URL = os.getenv("METRICS_SINK_URL", "http://127.0.0.1:3000/api/metrics/node-samples")
METRICS_SINK_TIMEOUT_S = float(os.getenv("METRICS_SINK_TIMEOUT_S", "0.8"))
OBSERVE_DEUP: Set[str] = set() # To track which nodes we've already observed during discovery
OBSERVE_LOCK = threading.Lock() # To synchronize access to OBSERVE_DEUP -> protect against race conditions
# Track last config used per user
USER_LAST_CFG: Dict[str, Dict[str, Any]] = {}
USER_LAST_CFG_LOCK = threading.Lock()

# Track agent config history per user (most recent first)
USER_AGENT_HISTORY: Dict[str, List[Dict[str, Any]]] = {}
USER_AGENT_HISTORY_LOCK = threading.Lock()
USER_AGENT_HISTORY_MAX = 30
EC2_ADMIN_EMAIL = (os.getenv("EC2_ADMIN_EMAIL", "shypine8@gmail.com") or "").strip().lower()

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


@dataclass
class CloudNode:
    id: str                 # cloud instance id
    name: str
    host: str               # public ip or DNS
    port: int = 5001
    created_ms: int = 0
    status: str = "running" # running|stopped|terminated

NODES: Dict[str, CloudNode] = {}
NODES_LOCK = threading.Lock()



 
# -------------------------
# UTILITY FUNCTIONS
# -------------------------
def now_ms() -> int:
    return int(time.time() * 1000)


def _stable_json(x: Optional[Dict[str, Any]]) -> str:
    return json.dumps(x or {}, sort_keys=True)


def to_dict(x: Any) -> Dict[str, Any]:
    if is_dataclass(x):
        return asdict(x)
    if hasattr(x, "dict"):
        return x.dict()
    if hasattr(x, "__dict__"):
        return dict(x.__dict__)
    return dict(x)


def _safe_float(v: Any) -> Optional[float]:
    try:
        if v is None:
            return None
        return float(v)
    except Exception:
        return None


def _safe_int(v: Any) -> Optional[int]:
    try:
        if v is None:
            return None
        return int(v)
    except Exception:
        return None


def _load_default_ec2_user_data() -> Optional[str]:
    """
    Resolve default EC2 user_data from either:
      1) EC2_DEFAULT_USER_DATA (inline string), or
      2) EC2_DEFAULT_USER_DATA_FILE (absolute path to script file)
    """
    inline = (os.getenv("EC2_DEFAULT_USER_DATA", "") or "").strip()
    if inline:
        return inline

    file_path = (os.getenv("EC2_DEFAULT_USER_DATA_FILE", "") or "").strip()
    if not file_path:
        return None

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as exc:
        append_log(
            "warn",
            "nodes",
            "Failed to read EC2_DEFAULT_USER_DATA_FILE",
            {"path": file_path, "error": str(exc)},
        )
        return None


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
    #base = discover_nodes()

    # Use EC2/static discovery for cloud-friendly node management.
    base = discover_cluster_nodes()

    snaps: List[NodeSnapshot] = []
    for n in base:
        try:
            snaps.append(client.get_metrics(n))
        except Exception as e:
            append_log("warn", "nodes", "metrics failed for node", {"node": getattr(n, "name", None), "error": str(e)})
            print(f"[WARN] metrics failed for {n.name}: {e}")
    return snaps


def _fetch_recent_jobs(node: NodeSnapshot, limit: int = 500) -> List[Dict[str, Any]]:
    """
    Pull records from node /recent_jobs. Returns [] if node fails.
    Accept either list or {"jobs": [...]}
    """
    try:
        url = f"http://{node.host}:{node.port}/recent_jobs?limit={limit}"
        r = requests.get(url, timeout=2.0)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get("jobs"), list):
            return data["jobs"]
        return []
    except Exception:
        return []
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



def _cfg_key(cfg: AgentConfig) -> str:
    return json.dumps(cfg.dict(), sort_keys=True)

def record_user_agent_config(user_id: str, cfg: AgentConfig) -> None:
    if not user_id:
        return

    item = {"time_ms": now_ms(), "config": cfg.dict()}
    key = _cfg_key(cfg)

    with USER_AGENT_HISTORY_LOCK:
        hist = USER_AGENT_HISTORY.get(user_id, [])

        # remove older identical configs (dedupe)
        hist = [
            h for h in hist
            if json.dumps(h.get("config", {}), sort_keys=True) != key
        ]

        # newest first
        hist.insert(0, item)

        # cap length
        if len(hist) > USER_AGENT_HISTORY_MAX:
            hist = hist[:USER_AGENT_HISTORY_MAX]

        USER_AGENT_HISTORY[user_id] = hist

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

def _parse_static_nodes(raw: str) -> List[NodeSnapshot]:
    """
    Parse STATIC_NODE_LIST env var:
      "name:host:port,name2:host:port"
    """
    out: List[NodeSnapshot] = []
    for item in (raw or "").split(","):
        item = item.strip()
        if not item:
            continue
        parts = item.split(":")
        if len(parts) != 3:
            continue
        name, host, port_s = parts
        try:
            out.append(
                NodeSnapshot(
                    name=name.strip(),
                    host=host.strip(),
                    port=int(port_s),
                )
            )
        except Exception:
            continue
    return out


def discover_cluster_nodes() -> List[NodeSnapshot]:
    """
    Discover nodes from EC2 (tagged instances) and optional STATIC_NODE_LIST fallback.
    """
    nodes: List[NodeSnapshot] = []
    default_port = int(os.getenv("NODE_SERVICE_PORT", "5001"))

    # Optional static nodes fallback for local testing.
    nodes.extend(_parse_static_nodes(os.getenv("STATIC_NODE_LIST", "")))

    try:
        for item in list_ec2_nodes():
            if item.get("state") != "running":
                continue
            host = item.get("public_ip") or item.get("private_ip")
            if not host:
                continue
            nodes.append(
                NodeSnapshot(
                    name=item.get("name") or item["instance_id"],
                    host=host,
                    port=default_port,
                    instance_id=item["instance_id"],
                    region=item.get("region"),
                )
            )
    except Exception as exc:
        append_log("warn", "nodes", "EC2 discovery failed", {"error": str(exc)})

    return nodes


# -------------------------
# SYSTEM LOGS
# -------------------------
LOGS_MAX = 2000
LOGS_LOCK = threading.Lock()

@dataclass
class SystemLogEvent:
    ts_ms: int
    level: str   # "info" | "warn" | "error"
    topic: str   # "jobs" | "nodes" | "simulation" | "system"
    message: str
    data: Optional[Dict[str, Any]] = None

SYSTEM_LOGS: List[SystemLogEvent] = []

def append_log(level: str, topic: str, message: str, data: Optional[Dict[str, Any]] = None) -> None:
    ev = SystemLogEvent(
        ts_ms=now_ms(),
        level=(level or "info").lower().strip(),
        topic=(topic or "system").lower().strip(),
        message=message,
        data=data or None,
    )
    with LOGS_LOCK:
        SYSTEM_LOGS.append(ev)
        if len(SYSTEM_LOGS) > LOGS_MAX:
            del SYSTEM_LOGS[: len(SYSTEM_LOGS) - LOGS_MAX]

def read_logs_since(since_ms: int, limit: int = 500) -> List[Dict[str, Any]]:
    with LOGS_LOCK:
        out = [asdict(ev) for ev in SYSTEM_LOGS if ev.ts_ms > since_ms]
    if limit > 0:
        return out[-limit:]
    return out

class SystemLogIn(BaseModel):
    level: str = Field(default="info")
    topic: str = Field(default="system")
    message: str
    data: Optional[Dict[str, Any]] = None


# -------------------------
# NODE MEMBERSHIP WATCHER (logs node add/remove)
# -------------------------
NODES_LAST: Set[str] = set()
NODES_LAST_LOCK = threading.Lock()

def _node_key(n: NodeSnapshot) -> str:
    return f"{getattr(n,'name','')}|{getattr(n,'host','')}|{getattr(n,'port','')}"

def watch_nodes_membership():
    global NODES_LAST
    while True:
        time.sleep(POLL_S)
        try:
            # nodes = discover_nodes()
            nodes = discover_cluster_nodes()
            cur = set(_node_key(n) for n in nodes)
        except Exception as e:
            append_log("warn", "nodes", "discover_nodes failed", {"error": str(e)})
            continue

        with NODES_LAST_LOCK:
            added = cur - NODES_LAST
            removed = NODES_LAST - cur
            NODES_LAST = cur

        for k in sorted(added):
            append_log("info", "nodes", "Node added", {"node_key": k})
        for k in sorted(removed):
            append_log("warn", "nodes", "Node removed", {"node_key": k})


# -------------------------
# REQUEST MODELS
# -------------------------
class AgentConfig(BaseModel):
    learner_kind: str = Field(
        ...,
        description="e.g. ucb1, ema, sample_average, thompson_gaussian, contextual_linear, sliding_window",
    )
    goal_kind: str = Field(
        ...,
        description="e.g. min_mean_latency, min_latency_with_sla, min_latency_plus_tail",
    )
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


def _normalize_node_key(x: Any) -> str:
    return str(x or "").strip().lower()


def _extract_allowed_node_keys(job: JobRequest) -> Set[str]:
    meta = getattr(job, "metadata", None)
    if not isinstance(meta, dict):
        return set()
    raw = meta.get("allowed_node_keys")
    if not isinstance(raw, list):
        return set()
    out: Set[str] = set()
    for item in raw:
        k = _normalize_node_key(item)
        if k:
            out.add(k)
    return out


def _snapshot_matches_allowed_keys(snap: NodeSnapshot, allowed: Set[str]) -> bool:
    if not allowed:
        return True
    keys = {
        _normalize_node_key(f"{snap.host}:{snap.port}"),
        _normalize_node_key(getattr(snap, "name", "")),
        _normalize_node_key(getattr(snap, "instance_id", "")),
        _normalize_node_key(f"{snap.host}:{snap.port}:{getattr(snap, 'name', '')}"),
    }
    return any(k in allowed for k in keys if k)


class CreateEc2NodeRequest(BaseModel):
    image_id: Optional[str] = None
    instance_type: str = "t3.micro"
    subnet_id: Optional[str] = None
    security_group_id: Optional[str] = None
    key_name: Optional[str] = None
    iam_instance_profile: Optional[str] = None
    user_data: Optional[str] = None


# -------------------------
# BACKGROUND OBSERVER
# -------------------------
def poll_recent_jobs_and_observe():
    while True:
        time.sleep(POLL_S)

        with AGENTS_LOCK:
            agents = list(AGENTS.values())
            if not agents:
                continue

        #nodes = discover_nodes()
        nodes = discover_cluster_nodes()
        if not nodes:
            continue

        for node in nodes:
            records = _fetch_recent_jobs(node, limit=200)
            if not records:
                continue

            for record in records:
                job_id = record.get("job_id")
                lat = record.get("observed_latency_ms")
                if not job_id or lat is None:
                    continue

                with OBSERVE_LOCK:
                    if job_id in OBSERVE_DEUP:
                        continue

                observed = False
                for agent in agents:
                    if job_id not in set(agent.pending_job_ids()):
                        continue

                    try:
                        agent.observe(
                            job_id,
                            success=True,
                            latency_ms=float(lat),
                            extra={"node": node.name},
                        )
                        observed = True
                        break
                    except Exception:
                        pass

                if observed:
                    with OBSERVE_LOCK:
                        OBSERVE_DEUP.add(job_id)


@app.on_event("startup")
def startup():
    append_log("info", "system", "Manager API started")
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

    # Start node watcher too
    t2 = threading.Thread(target=watch_nodes_membership, daemon=True)
    t2.start()


# -------------------------
# API ENDPOINTS
# -------------------------
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


def require_node_admin(user: Dict[str, Any] = Depends(require_user)) -> Dict[str, Any]:
    if bool(user.get("is_admin")):
        return user
    email = str(user.get("email") or "").strip().lower()
    if EC2_ADMIN_EMAIL and email == EC2_ADMIN_EMAIL:
        return user
    raise HTTPException(status_code=403, detail="Admin node privileges required")


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


# Cluster stats endpoint (keeps your richer payload + adds legacy keys)
@app.get("/cluster/stats")
def cluster_stats(window_s: int = Query(60, ge=5, le=3600), limit: int = Query(800, ge=10, le=5000)):
    """
    Computes:
      - avg latency from observed_latency_ms in /recent_jobs
      - throughput from finished timestamps within the last window_s
      - disk usage from manager host

    ALSO returns legacy keys expected by your Dashboard:
      avg_latency_ms, throughput_rps, disk_usage_pct, window_ms, nodes_count, jobs_count
    """
    now = now_ms()
    window_ms = window_s * 1000

    # Disk usage of manager machine
    du = shutil.disk_usage("/")
    disk_used_pct = (du.used / du.total * 100.0) if du.total else None
    disk = {
        "total_gb": round(du.total / (1024**3), 2),
        "used_gb": round(du.used / (1024**3), 2),
        "free_gb": round(du.free / (1024**3), 2),
        "used_pct": round(disk_used_pct, 2) if disk_used_pct is not None else None,
    }

    #nodes = discover_nodes()
    nodes = discover_cluster_nodes()
    all_lat: List[float] = []
    completed_in_window = 0
    per_node: List[Dict[str, Any]] = []

    for node in nodes:
        records = _fetch_recent_jobs(node, limit=limit)

        node_lat: List[float] = []
        node_completed = 0

        for r in records:
            lat = _safe_float(r.get("observed_latency_ms"))
            if lat is not None:
                node_lat.append(lat)
                all_lat.append(lat)

            # Throughput: count jobs finished within last window
            fin = (
                r.get("finished_at_ms")
                or r.get("finished_ms")
                or r.get("done_at_ms")
                or r.get("completed_at_ms")
            )
            fin_i = _safe_int(fin)
            if fin_i is not None and (now - fin_i) <= window_ms:
                node_completed += 1

        completed_in_window += node_completed

        per_node.append(
            {
                "name": node.name,
                "host": node.host,
                "port": node.port,
                "jobs_seen": len(records),
                "latency_avg_ms": round(statistics.mean(node_lat), 2) if node_lat else None,
                "completed_in_window": node_completed,
                "throughput_jps": round(node_completed / window_s, 4),
            }
        )

    avg_lat = round(statistics.mean(all_lat), 2) if all_lat else None
    throughput_jps = round(completed_in_window / window_s, 4)

    # ----- Legacy keys for Dashboard compatibility -----
    # These are what your frontend originally expects.
    legacy_avg_latency_ms = avg_lat
    legacy_throughput_rps = throughput_jps
    legacy_disk_usage_pct = disk.get("used_pct")

    return {
        "time_ms": now,
        "window_ms": window_ms,
        "nodes_count": len(nodes),
        "jobs_count": completed_in_window,
        "avg_latency_ms": avg_lat,
        "throughput_rps": throughput_jps,
        "disk_usage_pct": disk.get("used_pct"),

        "window_s": window_s,
        "latency": {"avg_ms": avg_lat, "samples": len(all_lat)},
        "throughput": {"jobs_completed": completed_in_window, "jobs_per_s": throughput_jps},
        "disk": disk,
        "per_node": per_node,
    }


@app.post("/jobs/submit", response_model=SubmitJobResult)
def submit_job(request: SubmitJobRequest):
    cfg = request.config
    job = request.job

    # Validate real jobs
    job_type = getattr(job, "job_type", "simulated")
    if job_type != "simulated":
        script_content = getattr(job, "script_content", None)
        script_name = getattr(job, "script_name", None)

        if not script_content:
            raise HTTPException(
                status_code=400,
                detail="script_content is required for real jobs",
            )

        if not script_name:
            raise HTTPException(
                status_code=400,
                detail="script_name is required for real jobs",
            )

    # Store last agent config used by this user (best-effort)
    if getattr(job, "user_id", None):
        uid = job.user_id
        with USER_LAST_CFG_LOCK:
            USER_LAST_CFG[uid] = {
                "time_ms": now_ms(),
                "config": cfg.dict(),
            }
        record_user_agent_config(uid, cfg)

    agent = get_agent(
        learner_kind=cfg.learner_kind,
        goal_kind=cfg.goal_kind,
        seed=cfg.seed,
        learner_kwargs=cfg.learner_kwargs,
        goal_kwargs=cfg.goal_kwargs,
    )

    snaps = live_snapshots()
    allowed_node_keys = _extract_allowed_node_keys(job)
    if allowed_node_keys:
        snaps = [s for s in snaps if _snapshot_matches_allowed_keys(s, allowed_node_keys)]

    if not snaps:
        append_log("error", "jobs", "No nodes available", {"job_id": job.job_id})
        if allowed_node_keys:
            raise HTTPException(
                status_code=503,
                detail="No allowed connected nodes available for this simulation scope",
            )
        raise HTTPException(status_code=503, detail="No nodes available")

    decision = agent.route(job, snaps)

    append_log(
        "info",
        "jobs",
        "Job routed",
        {
            "job_id": job.job_id,
            "user_id": job.user_id,
            "job_type": getattr(job, "job_type", "simulated"),
            "node": getattr(decision, "node_name", None),
            "decision": to_dict(decision),
        },
    )

    try:
        node_stub = NodeSnapshot(
            name=decision.node_name,
            host=decision.host,
            port=decision.port,
            cpus=0,
            memory_mb=0,
        )

        print("JOB TYPE SENT TO NODE:", job.job_type)
        print("SCRIPT NAME:", job.script_name)
        print("HAS SCRIPT CONTENT:", bool(job.script_content))

        node_resp = client.submit_job(node_stub, job)

        if isinstance(node_resp, dict):
            node_resp["node_name"] = decision.node_name
            node_resp["node_host"] = decision.host
            node_resp["node_port"] = decision.port

        append_log(
            "info",
            "jobs",
            "Job dispatched",
            {
                "job_id": job.job_id,
                "job_type": getattr(job, "job_type", "simulated"),
                "node": getattr(decision, "node_name", None),
            },
        )

    except Exception as e:
        append_log(
            "error",
            "jobs",
            "Dispatch failed",
            {
                "job_id": job.job_id,
                "job_type": getattr(job, "job_type", "simulated"),
                "error": str(e),
            },
        )
        try:
            agent.observe(
                job.job_id,
                success=False,
                latency_ms=agent.latency_clip_ms,
                extra={"dispatch_error": str(e)},
            )
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
    append_log("warn", "system", "Reset requested")
    global OBSERVE_DEUP
    append_log("warn", "system", "Reset requested")

    with AGENTS_LOCK:
        AGENTS.clear()
    with OBSERVE_LOCK:
        OBSERVE_DEUP.clear()

    append_log("info", "system", "Reset completed")
    return {"ok": True, "time_ms": now_ms()}


# -------------------------
# EXPLANATION ENDPOINTS (KEEP)
# -------------------------
@app.post("/agents/explanations/recent")
def agent_explanations_recent(cfg: AgentConfig, limit: int = 50):
    agent = get_agent(
        learner_kind=cfg.learner_kind,
        goal_kind=cfg.goal_kind,
        seed=cfg.seed,
        learner_kwargs=cfg.learner_kwargs,
        goal_kwargs=cfg.goal_kwargs,
    )
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


# -------------------------
# SYSTEM LOGS ENDPOINTS
# -------------------------
@app.get("/system/logs")
def system_logs(since_ms: int = 0, limit: int = 500):
    limit = max(1, min(int(limit), 2000))
    return {
        "time_ms": now_ms(),
        "since_ms": since_ms,
        "limit": limit,
        "events": read_logs_since(since_ms, limit=limit),
    }


@app.post("/system/logs")
def system_logs_post(ev: SystemLogIn = Body(...)):
    append_log(ev.level, ev.topic, ev.message, ev.data)
    return {"ok": True, "time_ms": now_ms()}


@app.post("/system/logs/clear")
def system_logs_clear():
    with LOGS_LOCK:
        SYSTEM_LOGS.clear()
    append_log("info", "system", "System logs cleared")
    return {"ok": True, "time_ms": now_ms()}
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


@app.get("/users/me/last_agent_config")
def users_me_last_agent_config(user: Dict[str, Any] = Depends(require_user)):
    uid = user["id"]
    with USER_LAST_CFG_LOCK:
        last = USER_LAST_CFG.get(uid)
    return last or {"time_ms": now_ms(), "config": None}


@app.get("/users/me/activity")
def users_me_activity(
    limit: int = Query(200, ge=1, le=2000),
    user: Dict[str, Any] = Depends(require_user),
):
    uid = user["id"]
    # Filter logs for this user_id if present in ev.data
    with LOGS_LOCK:
        filtered = []
        for ev in SYSTEM_LOGS:
            d = ev.data or {}
            if d.get("user_id") == uid:
                filtered.append(asdict(ev))
        filtered = filtered[-limit:]
    return {"time_ms": now_ms(), "events": filtered}



@app.get("/users/me/agent_history")
def users_me_agent_history(user: Dict[str, Any] = Depends(require_user)):
    uid = user["id"]
    with USER_AGENT_HISTORY_LOCK:
        hist = USER_AGENT_HISTORY.get(uid, [])
    return {"time_ms": now_ms(), "history": hist}   



@app.get("/ec2/nodes")
def ec2_nodes(_: Dict[str, Any] = Depends(require_node_admin)):
    nodes = list_ec2_nodes()
    return {"nodes": nodes, "count": len(nodes), "time_ms": now_ms()}


@app.post("/ec2/nodes/create")
def ec2_create_node(payload: CreateEc2NodeRequest, _: Dict[str, Any] = Depends(require_node_admin)):
    try:
        desired_os = (os.getenv("EC2_ADMIN_DEFAULT_OS", "ubuntu") or "ubuntu").strip().lower()
        image_id = (payload.image_id or "").strip()
        if not image_id:
            if desired_os == "ubuntu":
                image_id = get_latest_ubuntu_ami()
            else:
                image_id = (os.getenv("EC2_DEFAULT_IMAGE_ID", "")).strip()
        subnet_id = (payload.subnet_id or os.getenv("EC2_DEFAULT_SUBNET_ID", "")).strip()
        security_group_id = (payload.security_group_id or os.getenv("EC2_DEFAULT_SECURITY_GROUP_ID", "")).strip()
        key_name = (payload.key_name or os.getenv("EC2_DEFAULT_KEY_NAME", "")).strip() or None
        iam_instance_profile = (
            payload.iam_instance_profile or os.getenv("EC2_DEFAULT_IAM_INSTANCE_PROFILE", "")
        ).strip() or None
        user_data = payload.user_data or _load_default_ec2_user_data()
        if not image_id or not subnet_id or not security_group_id:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Missing EC2 create inputs. Provide image_id/subnet_id/security_group_id in request "
                    "or set EC2_DEFAULT_IMAGE_ID, EC2_DEFAULT_SUBNET_ID, EC2_DEFAULT_SECURITY_GROUP_ID in backend env."
                ),
            )

        created = create_vm(
            image_id=image_id,
            instance_type=payload.instance_type,
            subnet_id=subnet_id,
            security_group_id=security_group_id,
            key_name=key_name,
            iam_instance_profile=iam_instance_profile,
            user_data=user_data,
        )
        return {"ok": True, "instance": created, "time_ms": now_ms()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create EC2 node: {exc}") from exc


@app.post("/ec2/nodes/{instance_id}/start")
def ec2_start_node(instance_id: str, _: Dict[str, Any] = Depends(require_node_admin)):
    try:
        result = start_vm(instance_id)
        return {"ok": True, "result": result, "time_ms": now_ms()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to start EC2 node: {exc}") from exc


@app.post("/ec2/nodes/{instance_id}/stop")
def ec2_stop_node(instance_id: str, _: Dict[str, Any] = Depends(require_node_admin)):
    try:
        result = stop_vm(instance_id)
        return {"ok": True, "result": result, "time_ms": now_ms()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to stop EC2 node: {exc}") from exc


@app.delete("/ec2/nodes/{instance_id}")
def ec2_delete_node(instance_id: str, _: Dict[str, Any] = Depends(require_node_admin)):
    try:
        result = delete_vm(instance_id)
        return {"ok": True, "result": result, "time_ms": now_ms()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to terminate EC2 node: {exc}") from exc


@app.get("/ec2/nodes/{instance_id}/ip")
def ec2_node_ip(instance_id: str, _: Dict[str, Any] = Depends(require_node_admin)):
    try:
        ip = get_instance_ip(instance_id)
        return {"instance_id": instance_id, "ip": ip, "time_ms": now_ms()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to resolve EC2 IP: {exc}") from exc