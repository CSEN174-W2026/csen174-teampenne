from __future__ import annotations
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict
import uuid

from api_models import RunConfig, RunStartResponse, RunStatusResponse
from run_engine import RunEngine, RunState
from run_store import RunStore

app = FastAPI(title="Agentic Distributed Systems Manager")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_RUNS: Dict[str, RunState] = {}
_STORE = RunStore()
_ENGINE = RunEngine(store=_STORE)

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/runs/start", response_model=RunStartResponse)
def start_run(cfg: RunConfig, bt: BackgroundTasks):
    run_id = str(uuid.uuid4())
    _RUNS[run_id] = RunState.new(run_id, cfg)
    bt.add_task(_ENGINE.execute_run, run_id, cfg, _RUNS)
    return RunStartResponse(run_id=run_id, status="running")

@app.get("/runs/{run_id}", response_model=RunStatusResponse)
def get_run(run_id: str):
    st = _RUNS.get(run_id)
    if not st:
        raise HTTPException(status_code=404, detail="run not found")
    return st.to_response()

@app.get("/runs/{run_id}/events")
def get_events(run_id: str, limit: int = 200):
    st = _RUNS.get(run_id)
    if not st:
        raise HTTPException(status_code=404, detail="run not found")
    return {"run_id": run_id, "events": st.events[-max(1, min(limit, 5000)):]}


@app.get("/runs/{run_id}/db")
def get_persisted_run(run_id: str):
    run = _STORE.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found in database")
    return run


@app.get("/runs/{run_id}/db/events")
def get_persisted_events(run_id: str, limit: int = 200):
    run = _STORE.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found in database")
    return {"run_id": run_id, "events": _STORE.get_run_events(run_id, limit=limit)}

@app.get("/nodes/discover")
def discover_nodes_endpoint():
    # optional: expose your current virtualbox discover_nodes()
    from node.virtualbox import discover_nodes
    nodes = discover_nodes()
    return {"count": len(nodes), "nodes": [n.__dict__ for n in nodes]}