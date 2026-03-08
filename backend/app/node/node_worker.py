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

import os
import sys
import contextlib
from pathlib import Path

# -----------------------------
# Models (API payloads)
# -----------------------------
# class SubmitJobRequest(BaseModel):
#     job_id: str
#     user_id: str
#     service_time_ms: int = Field(ge=1, description="Simulated job duration")
#     metadata: dict = {}

class SubmitJobRequest(BaseModel):
    job_id: str
    user_id: str
    service_time_ms: Optional[int] = Field(default=None, ge=1)
    job_type: str = "simulated"
    script_name: Optional[str] = None
    script_content: Optional[str] = None
    args: List[str] = Field(default_factory=list)
    timeout_s: int = Field(default=60, ge=1, le=3600)
    metadata: dict = Field(default_factory=dict)


# class SubmitJobResponse(BaseModel):
#     accepted: bool
#     queued_at_ms: int

class SubmitJobResponse(BaseModel):
    accepted: bool
    queued_at_ms: int
    status: str

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


# class JobRecord(BaseModel):
#     job_id: str
#     user_id: str
#     queued_at_ms: int
#     started_at_ms: int
#     finished_at_ms: int
#     observed_latency_ms: int
#     service_time_ms: int

class JobRecord(BaseModel):
    job_id: str
    user_id: str
    job_type: str = "simulated"
    script_name: Optional[str] = None
    status: str
    queued_at_ms: int
    started_at_ms: Optional[int] = None
    finished_at_ms: Optional[int] = None
    observed_latency_ms: Optional[int] = None
    service_time_ms: Optional[int] = None
    exit_code: Optional[int] = None
    stdout: Optional[str] = None
    stderr: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


# -----------------------------
# Internal state
# -----------------------------
# @dataclass
# class _InternalJob:
#     job_id: str
#     user_id: str
#     service_time_ms: int
#     metadata: dict
#     queued_at_ms: int

@dataclass
class _InternalJob:
    job_id: str
    user_id: str
    service_time_ms: Optional[int]
    job_type: str
    script_name: Optional[str]
    script_content: Optional[str]
    args: List[str]
    timeout_s: int
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

_job_status: Dict[str, JobRecord] = {}
JOB_RUNS_DIR = Path("./job_runs")
JOB_RUNS_DIR.mkdir(parents=True, exist_ok=True)

def _set_job_status(job_id: str, **updates):
    current = _job_status.get(job_id)
    if current is None:
        return
    data = current.model_dump()
    data.update(updates)
    _job_status[job_id] = JobRecord(**data)


async def _run_simulated_job(job: _InternalJob, started_at: int) -> JobRecord:
    await asyncio.sleep((job.service_time_ms or 1000) / 1000.0)
    finished_at = _now_ms()
    observed_latency = finished_at - job.queued_at_ms

    return JobRecord(
        job_id=job.job_id,
        user_id=job.user_id,
        job_type="simulated",
        script_name=None,
        status="completed",
        queued_at_ms=job.queued_at_ms,
        started_at_ms=started_at,
        finished_at_ms=finished_at,
        observed_latency_ms=observed_latency,
        service_time_ms=job.service_time_ms,
        exit_code=0,
        stdout=None,
        stderr=None,
        metadata=job.metadata or {},
    )


async def _run_python_job(job: _InternalJob, started_at: int) -> JobRecord:
    run_dir = JOB_RUNS_DIR / job.job_id
    run_dir.mkdir(parents=True, exist_ok=True)

    safe_name = os.path.basename(job.script_name or "job.py")
    if not safe_name.endswith(".py"):
        safe_name = f"{safe_name}.py"

    script_path = run_dir / safe_name
    script_path.write_text(job.script_content or "", encoding="utf-8")

    proc = None
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            str(script_path),
            *(job.args or []),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(run_dir),
        )

        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(),
            timeout=job.timeout_s,
        )

        finished_at = _now_ms()
        observed_latency = finished_at - job.queued_at_ms
        exit_code = proc.returncode

        return JobRecord(
            job_id=job.job_id,
            user_id=job.user_id,
            job_type=job.job_type,
            script_name=safe_name,
            status="completed" if exit_code == 0 else "failed",
            queued_at_ms=job.queued_at_ms,
            started_at_ms=started_at,
            finished_at_ms=finished_at,
            observed_latency_ms=observed_latency,
            service_time_ms=None,
            exit_code=exit_code,
            stdout=stdout_b.decode("utf-8", errors="replace"),
            stderr=stderr_b.decode("utf-8", errors="replace"),
            metadata=job.metadata or {},
        )

    except asyncio.TimeoutError:
        if proc is not None:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            with contextlib.suppress(Exception):
                await proc.communicate()

        finished_at = _now_ms()
        observed_latency = finished_at - job.queued_at_ms

        return JobRecord(
            job_id=job.job_id,
            user_id=job.user_id,
            job_type=job.job_type,
            script_name=safe_name,
            status="timeout",
            queued_at_ms=job.queued_at_ms,
            started_at_ms=started_at,
            finished_at_ms=finished_at,
            observed_latency_ms=observed_latency,
            service_time_ms=None,
            exit_code=None,
            stdout="",
            stderr=f"Job timed out after {job.timeout_s} seconds",
            metadata=job.metadata or {},
        )

    except Exception as exc:
        finished_at = _now_ms()
        observed_latency = finished_at - job.queued_at_ms

        return JobRecord(
            job_id=job.job_id,
            user_id=job.user_id,
            job_type=job.job_type,
            script_name=safe_name,
            status="failed",
            queued_at_ms=job.queued_at_ms,
            started_at_ms=started_at,
            finished_at_ms=finished_at,
            observed_latency_ms=observed_latency,
            service_time_ms=None,
            exit_code=None,
            stdout="",
            stderr=str(exc),
            metadata=job.metadata or {},
        )



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
#async def _worker_loop():
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


async def _worker_loop():
    global _in_flight, _ewma_latency_ms

    while True:
        job = await _job_queue.get()
        _in_flight += 1
        started_at = _now_ms()

        _set_job_status(
            job.job_id,
            status="running",
            started_at_ms=started_at,
        )

        try:
            if job.job_type == "simulated":
                record = await _run_simulated_job(job, started_at)
            else:
                record = await _run_python_job(job, started_at)

            _job_status[job.job_id] = record
            _recent_jobs.append(record)
            if record.finished_at_ms is not None:
                _completion_times_ms.append(record.finished_at_ms)

            if record.observed_latency_ms is not None:
                if _ewma_latency_ms is None:
                    _ewma_latency_ms = float(record.observed_latency_ms)
                else:
                    _ewma_latency_ms = (
                        _EWMA_ALPHA * float(record.observed_latency_ms)
                        + (1 - _EWMA_ALPHA) * _ewma_latency_ms
                    )

        finally:
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


# @app.post("/submit", response_model=SubmitJobResponse)
# async def submit_job(req: SubmitJobRequest):
#     job = _InternalJob(
#         job_id=req.job_id,
#         user_id=req.user_id,
#         service_time_ms=req.service_time_ms,
#         metadata=req.metadata,
#         queued_at_ms=_now_ms(),
#     )
#     await _job_queue.put(job)
#     return SubmitJobResponse(accepted=True, queued_at_ms=job.queued_at_ms)


@app.post("/submit", response_model=SubmitJobResponse)
async def submit_job(req: SubmitJobRequest):
    queued_at = _now_ms()

    job = _InternalJob(
        job_id=req.job_id,
        user_id=req.user_id,
        service_time_ms=req.service_time_ms,
        job_type=req.job_type,
        script_name=req.script_name,
        script_content=req.script_content,
        args=req.args,
        timeout_s=req.timeout_s,
        metadata=req.metadata,
        queued_at_ms=queued_at,
    )

    _job_status[req.job_id] = JobRecord(
        job_id=req.job_id,
        user_id=req.user_id,
        job_type=req.job_type,
        script_name=req.script_name,
        status="queued",
        queued_at_ms=queued_at,
        started_at_ms=None,
        finished_at_ms=None,
        observed_latency_ms=None,
        service_time_ms=req.service_time_ms,
        exit_code=None,
        stdout=None,
        stderr=None,
        metadata=req.metadata or {},
    )

    await _job_queue.put(job)
    return SubmitJobResponse(
        accepted=True,
        queued_at_ms=queued_at,
        status="queued",
    )




# @app.get("/recent_jobs", response_model=List[JobRecord])
# def recent_jobs(limit: int = 50):
#     limit = max(1, min(limit, 200))
#     return list(_recent_jobs)[-limit:]


@app.get("/recent_jobs", response_model=List[JobRecord])
def recent_jobs(limit: int = 50):
    limit = max(1, min(limit, 200))
    return list(_recent_jobs)[-limit:]


@app.get("/jobs", response_model=List[JobRecord])
def list_jobs(limit: int = 50):
    limit = max(1, min(limit, 200))
    values = list(_job_status.values())[-limit:]
    return values


@app.get("/jobs/{job_id}", response_model=JobRecord)
def get_job(job_id: str):
    record = _job_status.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return record
