# app/state_types.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional, Dict, Any, List


@dataclass(frozen=True)
class JobRequest:
    job_id: str
    user_id: str
    # size estimate: use "service_time_ms" for now (simulated job duration)
    service_time_ms: int
    metadata: Dict[str, Any] = None


@dataclass(frozen=True)
class NodeSnapshot:
    name: str
    host: str          # IP or hostname reachable from controller
    port: int

    # capacity (static-ish)
    cpus: Optional[int] = None
    memory_mb: Optional[int] = None

    # live load (dynamic)
    cpu_pct: Optional[float] = None
    mem_pct: Optional[float] = None
    queue_len: Optional[int] = None
    in_flight: Optional[int] = None

    # performance estimates (for MECT / fastest-node bias)
    node_speed: Optional[float] = None  # higher = faster (units: "ms of work per second" or similar)

    # latency stats (for latency-aware / tail-guard)
    ewma_latency_ms: Optional[float] = None
    p95_latency_ms: Optional[float] = None
    completed_last_60s: Optional[int] = None
