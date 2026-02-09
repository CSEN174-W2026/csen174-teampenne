# app/state_types.py
"""
Defines data models for job requests and node snapshots in the agentic controller system.

- Used by: node_worker.py, node_client.py, agentic_controller.py
- Ensures everyone uses the same fields, same names, and same meaning
- Prevents "stringly-typed" data passing
"""

from __future__ import annotations
from dataclasses import dataclass 
from typing import Optional, Dict, Any, List


# Python decorator that automatically writes the class code based on the field we declare

# JobRequest: represents a request to run a job on a node
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
