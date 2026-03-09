# app/state_types.py
"""
Defines shared data models for job requests and node snapshots.

Used by:
- node_worker.py
- node_client.py
- main.py / manager
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List


@dataclass(frozen=True)
class JobRequest:
    job_id: str
    user_id: str

    # simulated jobs
    service_time_ms: Optional[int] = None

    # real jobs
    job_type: str = "simulated"          # simulated | python_script | ml_script
    script_name: Optional[str] = None
    script_content: Optional[str] = None
    args: List[str] = field(default_factory=list)
    timeout_s: int = 60

    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class NodeSnapshot:
    name: str
    host: str          # IP or hostname reachable from controller
    port: int
    instance_id: Optional[str] = None
    region: Optional[str] = None

    # capacity (static-ish)
    cpus: Optional[int] = None
    memory_mb: Optional[int] = None

    # live load (dynamic)
    cpu_pct: Optional[float] = None
    mem_pct: Optional[float] = None
    queue_len: Optional[int] = None
    in_flight: Optional[int] = None

    # performance estimates
    node_speed: Optional[float] = None

    # latency stats
    ewma_latency_ms: Optional[float] = None
    p95_latency_ms: Optional[float] = None
    completed_last_60s: Optional[int] = None