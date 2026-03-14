from __future__ import annotations

import asyncio
import contextlib
import os
import sys
import time
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Deque, Dict, List, Optional, Set

import psutil
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

# -----------------------------
# Models (API payloads)
# -----------------------------
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


class SubmitJobResponse(BaseModel):
    accepted: bool
    queued_at_ms: int
    status: str

class CancelJobsRequest(BaseModel):
    user_id: Optional[str] = None
    job_ids: List[str] = Field(default_factory=list)
    include_running: bool = True


class MetricsResponse(BaseModel):
    node_time_ms: int
    cpu_pct: float
    mem_pct: float
    queue_len: int
    in_flight: int
    ewma_latency_ms: Optional[float] = None
    p95_latency_ms: Optional[float] = None
    completed_last_60s: int
    node_speed: Optional[float] = None


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


_job_queue: asyncio.Queue[_InternalJob] = asyncio.Queue()
_in_flight = 0
_cancel_requested: Set[str] = set()
_running_procs: Dict[str, asyncio.subprocess.Process] = {}

_recent_jobs: Deque[JobRecord] = deque(maxlen=500)
_completion_times_ms: Deque[int] = deque(maxlen=2000)
_job_status: Dict[str, JobRecord] = {}

_ewma_latency_ms: Optional[float] = None
_EWMA_ALPHA = 0.2
_DEFAULT_CONCURRENCY = max(2, min(8, os.cpu_count() or 2))
WORKER_CONCURRENCY = max(1, int(os.getenv("NODE_WORKER_CONCURRENCY", str(_DEFAULT_CONCURRENCY))))
_PROC = psutil.Process(os.getpid())

JOB_RUNS_DIR = Path("./job_runs")
JOB_RUNS_DIR.mkdir(parents=True, exist_ok=True)



# -----------------------------
# Helpers
# -----------------------------
def _now_ms() -> int:
    return int(time.time() * 1000)


def _set_job_status(job_id: str, **updates) -> None:
    current = _job_status.get(job_id)
    if current is None:
        return

    data = current.model_dump()
    data.update(updates)
    _job_status[job_id] = JobRecord(**data)


def _compute_p95(latencies: List[int]) -> Optional[float]:
    if not latencies:
        return None
    latencies_sorted = sorted(latencies)
    idx = int(0.95 * (len(latencies_sorted) - 1))
    return float(latencies_sorted[idx])


def _compute_completed_last_60s(now_ms: int) -> int:
    cutoff = now_ms - 60_000
    while _completion_times_ms and _completion_times_ms[0] < cutoff:
        _completion_times_ms.popleft()
    return len(_completion_times_ms)


def _estimate_node_speed(now_ms: int) -> Optional[float]:
    """
    Rough speed estimate from recent jobs:
    speed = total_work_ms_completed_last_60s / 60s
    """
    cutoff = now_ms - 60_000
    work_ms = 0

    for jr in _recent_jobs:
        if jr.finished_at_ms is not None and jr.finished_at_ms >= cutoff:
            work_ms += jr.service_time_ms or 0

    return (work_ms / 60.0) if work_ms > 0 else None


def _measure_node_cpu_pct() -> float:
    """
    Prefer process+children CPU utilization for this node worker, with
    system CPU as fallback floor.
    """
    system_cpu = psutil.cpu_percent(interval=None)
    proc_cpu = 0.0
    child_cpu = 0.0

    with contextlib.suppress(Exception):
        proc_cpu = float(_PROC.cpu_percent(interval=None))

    with contextlib.suppress(Exception):
        for child in _PROC.children(recursive=True):
            with contextlib.suppress(Exception):
                child_cpu += float(child.cpu_percent(interval=None))

    node_cpu = proc_cpu + child_cpu
    return max(0.0, min(100.0, max(system_cpu, node_cpu)))


# -----------------------------
# Job execution
# -----------------------------
async def _run_simulated_job(job: _InternalJob, started_at: int) -> JobRecord:
    duration_ms = job.service_time_ms or 1000
    remaining = duration_ms / 1000.0
    while remaining > 0:
        if job.job_id in _cancel_requested:
            finished_at = _now_ms()
            observed_latency = finished_at - job.queued_at_ms
            return JobRecord(
                job_id=job.job_id,
                user_id=job.user_id,
                job_type="simulated",
                script_name=None,
                status="cancelled",
                queued_at_ms=job.queued_at_ms,
                started_at_ms=started_at,
                finished_at_ms=finished_at,
                observed_latency_ms=observed_latency,
                service_time_ms=job.service_time_ms,
                exit_code=None,
                stdout="",
                stderr="Cancelled by simulation stop",
                metadata=job.metadata or {},
            )
        step = min(0.1, remaining)
        await asyncio.sleep(step)
        remaining -= step

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
        service_time_ms=duration_ms,
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
        exec_env = os.environ.copy()
        run_dir_abs = str(run_dir.resolve())
        # Allow uploaded scripts to import project modules (e.g. node.virtualbox)
        # while keeping the per-job run dir importable.
        extra_paths = [run_dir_abs, "/opt/csen174/backend/app", "/opt/csen174/backend", "/opt/csen174"]
        existing_pp = exec_env.get("PYTHONPATH", "")
        exec_env["PYTHONPATH"] = os.pathsep.join(extra_paths + ([existing_pp] if existing_pp else []))
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            safe_name,
            *(job.args or []),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=run_dir_abs,
            env=exec_env,
        )
        _running_procs[job.job_id] = proc

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
            status=(
                "cancelled"
                if job.job_id in _cancel_requested
                else ("completed" if exit_code == 0 else "failed")
            ),
            queued_at_ms=job.queued_at_ms,
            started_at_ms=started_at,
            finished_at_ms=finished_at,
            observed_latency_ms=observed_latency,
            service_time_ms=None,
            exit_code=exit_code,
            stdout=stdout_b.decode("utf-8", errors="replace"),
            stderr=(
                "Cancelled by simulation stop"
                if job.job_id in _cancel_requested
                else stderr_b.decode("utf-8", errors="replace")
            ),
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
    finally:
        _running_procs.pop(job.job_id, None)


async def _worker_loop() -> None:
    global _in_flight, _ewma_latency_ms

    while True:
        job = await _job_queue.get()
        if job.job_id in _cancel_requested:
            finished_at = _now_ms()
            cancelled = JobRecord(
                job_id=job.job_id,
                user_id=job.user_id,
                job_type=job.job_type,
                script_name=job.script_name,
                status="cancelled",
                queued_at_ms=job.queued_at_ms,
                started_at_ms=None,
                finished_at_ms=finished_at,
                observed_latency_ms=finished_at - job.queued_at_ms,
                service_time_ms=job.service_time_ms,
                exit_code=None,
                stdout="",
                stderr="Cancelled by simulation stop",
                metadata=job.metadata or {},
            )
            _job_status[job.job_id] = cancelled
            _recent_jobs.append(cancelled)
            _completion_times_ms.append(finished_at)
            _job_queue.task_done()
            continue
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
            elif job.job_type in {"python", "python_script", "ml_script"}:
                record = await _run_python_job(job, started_at)
            else:
                finished_at = _now_ms()
                record = JobRecord(
                    job_id=job.job_id,
                    user_id=job.user_id,
                    job_type=job.job_type,
                    script_name=job.script_name,
                    status="failed",
                    queued_at_ms=job.queued_at_ms,
                    started_at_ms=started_at,
                    finished_at_ms=finished_at,
                    observed_latency_ms=finished_at - job.queued_at_ms,
                    service_time_ms=job.service_time_ms,
                    exit_code=None,
                    stdout="",
                    stderr=f"Unsupported job_type: {job.job_type}",
                    metadata=job.metadata or {},
                )

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


# -----------------------------
# FastAPI app
# -----------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Prime psutil CPU counters so first metrics sample is meaningful.
    with contextlib.suppress(Exception):
        psutil.cpu_percent(interval=None)
        _PROC.cpu_percent(interval=None)
        for child in _PROC.children(recursive=True):
            with contextlib.suppress(Exception):
                child.cpu_percent(interval=None)

    worker_tasks = [asyncio.create_task(_worker_loop()) for _ in range(WORKER_CONCURRENCY)]
    try:
        yield
    finally:
        for task in worker_tasks:
            task.cancel()
        for task in worker_tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="CSEN174 Node Agent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # or your frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/metrics", response_model=MetricsResponse)
def get_metrics():
    now = _now_ms()

    cpu = _measure_node_cpu_pct()
    mem = psutil.virtual_memory().percent

    latencies = [
        jr.observed_latency_ms
        for jr in _recent_jobs
        if jr.observed_latency_ms is not None
    ]
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
    queued_at = _now_ms()

    print("NODE RECEIVED JOB TYPE:", req.job_type)
    print("NODE RECEIVED SCRIPT NAME:", req.script_name)
    print("NODE RECEIVED HAS CONTENT:", bool(req.script_content))

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


@app.post("/jobs/cancel")
async def cancel_jobs(req: CancelJobsRequest):
    now = _now_ms()
    requested_ids = {str(j).strip() for j in (req.job_ids or []) if str(j).strip()}
    cancelled_queued = 0
    cancelled_running = 0

    for job_id, rec in list(_job_status.items()):
        by_user = bool(req.user_id) and rec.user_id == req.user_id
        by_id = job_id in requested_ids
        if not (by_user or by_id):
            continue

        if rec.status == "queued":
            _cancel_requested.add(job_id)
            _set_job_status(
                job_id,
                status="cancelled",
                finished_at_ms=now,
                observed_latency_ms=max(0, now - (rec.queued_at_ms or now)),
                stderr="Cancelled by simulation stop",
                exit_code=None,
            )
            cancelled_queued += 1
        elif req.include_running and rec.status == "running":
            _cancel_requested.add(job_id)
            proc = _running_procs.get(job_id)
            if proc is not None:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
            cancelled_running += 1

    return {
        "ok": True,
        "cancelled_queued": cancelled_queued,
        "cancelled_running": cancelled_running,
        "time_ms": now,
    }


@app.get("/recent_jobs", response_model=List[JobRecord])
def recent_jobs(limit: int = 50):
    limit = max(1, min(limit, 200))
    return list(_recent_jobs)[-limit:]


@app.get("/jobs", response_model=List[JobRecord])
def list_jobs(limit: int = 50):
    limit = max(1, min(limit, 200))
    return list(_job_status.values())[-limit:]


@app.get("/jobs/{job_id}", response_model=JobRecord)
def get_job(job_id: str):
    record = _job_status.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return record
