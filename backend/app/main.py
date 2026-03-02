# Combine everything together in main.py
from __future__ import annotations

import json
import threading
import time
import shutil
import statistics
from dataclasses import asdict, is_dataclass, dataclass
from typing import Any, Dict, List, Optional, Set, Tuple

import requests
from fastapi import FastAPI, HTTPException
from fastapi import Body, Query
from pydantic import BaseModel, Field

from app.agent.manager_agent import ManagerAgent
from app.state_types import JobRequest, NodeSnapshot
from app.node.node_client import NodeClient
from app.node.virtualbox import discover_nodes

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

POLL_S = 2.0
OBSERVE_DEUP: Set[str] = set()
OBSERVE_LOCK = threading.Lock()

# Cache ManagerAgent instances so learning persists per config
AGENTS: Dict[Tuple[str, str, str, str, Optional[int]], ManagerAgent] = {}
AGENTS_LOCK = threading.Lock()


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
    base = discover_nodes()
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
            nodes = discover_nodes()
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

        nodes = discover_nodes()
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


@app.get("/nodes")
def nodes():
    snaps = live_snapshots()
    return {"count": len(snaps), "nodes": [to_dict(s) for s in snaps], "time_ms": now_ms()}


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

    nodes = discover_nodes()
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

    agent = get_agent(
        learner_kind=cfg.learner_kind,
        goal_kind=cfg.goal_kind,
        seed=cfg.seed,
        learner_kwargs=cfg.learner_kwargs,
        goal_kwargs=cfg.goal_kwargs,
    )

    snaps = live_snapshots()
    if not snaps:
        append_log("error", "jobs", "No nodes available", {"job_id": job.job_id})
        raise HTTPException(status_code=503, detail="No nodes available")

    decision = agent.route(job, snaps)

    append_log("info", "jobs", "Job routed", {
    "job_id": job.job_id,
    "user_id": job.user_id,
    "node": getattr(decision, "node_name", None),
    })

    # LOG: job routed
    append_log(
        "info",
        "jobs",
        "Job routed",
        {
            "job_id": job.job_id,
            "user_id": job.user_id,
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
        node_resp = client.submit_job(node_stub, job)
        append_log("info", "jobs", "Job dispatched", {
            "job_id": job.job_id,
            "node": getattr(decision, "node_name", None),
        })

        # LOG: dispatched
        append_log(
            "info",
            "jobs",
            "Job dispatched",
            {"job_id": job.job_id, "node": getattr(decision, "node_name", None)},
        )
    except Exception as e:
        append_log("error", "jobs", "Dispatch failed", {"job_id": job.job_id, "error": str(e)})
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