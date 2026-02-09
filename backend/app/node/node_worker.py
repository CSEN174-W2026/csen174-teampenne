# node/node_agent.py
from __future__ import annotations

from contextlib import asynccontextmanager

import time
import asyncio
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, Optional, List

import psutil
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


# -----------------------------
# Models (API payloads)
# -----------------------------
class SubmitJobRequest(BaseModel):
    job_id: str
    user_id: str
    service_time_ms: int = Field(ge=1, description="Simulated job duration")
    metadata: dict = {}


class SubmitJobResponse(BaseModel):
    accepted: bool
    queued_at_ms: int


class MetricsResponse(BaseModel):
    node_time_ms: int
    cpu_pct: float
    mem_pct: float
    queue_len: int
    in_flight: int

    # performance / history
    ewma_latency_ms: Optional[float] = None
    p95_latency_ms: Optional[float] = None
    completed_last_60s: int
    node_speed: Optional[float] = None  # derived from recent completions


class JobRecord(BaseModel):
    job_id: str
    user_id: str
    queued_at_ms: int
    started_at_ms: int
    finished_at_ms: int
    observed_latency_ms: int
    service_time_ms: int


# -----------------------------
# Internal state
# -----------------------------
@dataclass
class _InternalJob:
    job_id: str
    user_id: str
    service_time_ms: int
    metadata: dict
    queued_at_ms: int

_job_queue: asyncio.Queue[_InternalJob] = asyncio.Queue() # Async job queue waiting to be processed
_in_flight = 0 # Count of jobs currently being processed

# Keep recent job records for stats/explanations - Keep last 500 job records
_recent_jobs: Deque[JobRecord] = deque(maxlen=500)

# EWMA latency tracking
_ewma_latency_ms: Optional[float] = None
_EWMA_ALPHA = 0.2  # tune

# For throughput/speed estimation: completion timestamps (ms)
_completion_times_ms: Deque[int] = deque(maxlen=2000)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _compute_p95(latencies: List[int]) -> Optional[float]:
    if not latencies:
        return None
    latencies_sorted = sorted(latencies)
    idx = int(0.95 * (len(latencies_sorted) - 1))
    return float(latencies_sorted[idx])


def _compute_completed_last_60s(now_ms: int) -> int:
    cutoff = now_ms - 60_000
    # prune old
    while _completion_times_ms and _completion_times_ms[0] < cutoff:
        _completion_times_ms.popleft()
    return len(_completion_times_ms)


def _estimate_node_speed(now_ms: int) -> Optional[float]:
    """
    Rough speed estimate from recent jobs:
    speed = total_work_ms_completed_last_60s / 60s
    (higher means faster)
    """
    cutoff = now_ms - 60_000
    work_ms = 0
    for jr in _recent_jobs:
        if jr.finished_at_ms >= cutoff:
            work_ms += jr.service_time_ms
    return (work_ms / 60.0) if work_ms > 0 else None

# Runs forever in background, processing jobs from the queue - Uses globals because state is stored at module level
async def _worker_loop():
    global _in_flight, _ewma_latency_ms

    while True:
        job = await _job_queue.get() # Wait for next job
        _in_flight += 1 # Increment count of jobs currently being processed
        started_at = _now_ms() # Record start time

        # Simulate doing work. Later you can replace this with real job execution.
        await asyncio.sleep(job.service_time_ms / 1000.0)

        finished_at = _now_ms()
        observed_latency = finished_at - job.queued_at_ms

        record = JobRecord(
            job_id=job.job_id,
            user_id=job.user_id,
            queued_at_ms=job.queued_at_ms,
            started_at_ms=started_at,
            finished_at_ms=finished_at,
            observed_latency_ms=observed_latency,
            service_time_ms=job.service_time_ms,
        )
        _recent_jobs.append(record)
        _completion_times_ms.append(finished_at)

        # Update EWMA latency
        if _ewma_latency_ms is None:
            _ewma_latency_ms = float(observed_latency)
        else:
            _ewma_latency_ms = _EWMA_ALPHA * float(observed_latency) + (1 - _EWMA_ALPHA) * _ewma_latency_ms

        _in_flight -= 1
        _job_queue.task_done()


# Defines startup/shutdown behavior for FastAPI app
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background worker when server starts
    worker_task = asyncio.create_task(_worker_loop())
    try:
        yield
    finally:
        # Cancel worker when server shuts down
        worker_task.cancel()



app = FastAPI(title="CSEN174 Node Agent", lifespan=lifespan)

# Defines an endpoint at: GET http://node-ip:port/metrics
@app.get("/metrics", response_model=MetricsResponse)
def get_metrics():
    now = _now_ms()

    cpu = psutil.cpu_percent(interval=0.1)
    mem = psutil.virtual_memory().percent

    # rolling p95 latency from last N jobs
    latencies = [jr.observed_latency_ms for jr in _recent_jobs]
    p95 = _compute_p95(latencies)

    completed_60s = _compute_completed_last_60s(now)
    speed = _estimate_node_speed(now)

    return MetricsResponse(
        node_time_ms=now,
        cpu_pct=float(cpu),
        mem_pct=float(mem),
        queue_len=_job_queue.qsize(),
        in_flight=_in_flight,
        ewma_latency_ms=_ewma_latency_ms,
        p95_latency_ms=p95,
        completed_last_60s=completed_60s,
        node_speed=speed,
    )


@app.post("/submit", response_model=SubmitJobResponse)
async def submit_job(req: SubmitJobRequest):
    job = _InternalJob(
        job_id=req.job_id,
        user_id=req.user_id,
        service_time_ms=req.service_time_ms,
        metadata=req.metadata,
        queued_at_ms=_now_ms(),
    )
    await _job_queue.put(job)
    return SubmitJobResponse(accepted=True, queued_at_ms=job.queued_at_ms)


@app.get("/recent_jobs", response_model=List[JobRecord])
def recent_jobs(limit: int = 50):
    limit = max(1, min(limit, 200))
    return list(_recent_jobs)[-limit:]
