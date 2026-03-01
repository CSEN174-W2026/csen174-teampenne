from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional, Literal, Dict, Any, List

GoalKind = Literal[
    "min_mean_latency",
    "min_latency_with_sla",
    "min_latency_plus_tail",
    "min_sla_violation",
    "min_tail_p95",
    "max_throughput",
    "fairness_users",   
]

LearnerKind = Literal[
   "sample_average",
   "ema",
   "ucb1",
   "thompson_gaussian",
    "contextual",
    "sliding_window",
]

WorkloadKind = Literal["tiny", "medium", "large", "heavy_tail", "sla_mix", "priority_mix"]

class NodeConfig(BaseModel):
    name: str
    host: str
    port: int = 8001
    cpus: Optional[int] = None
    memory_mb: Optional[int] = None


class WorkloadConfig(BaseModel):
    kind: WorkloadKind = "heavy_tail"
    jobs: int = Field(default=200, ge=1, le=10000)
    seed: int = 42
    users: List[str] = Field(default_factory=lambda: ["u1", "u2", "u3"]) # default users for fairness-aware policy
    sla_threshold_ms: Optional[int] = 100
    
class RunConfig(BaseModel):
    goal_kind: GoalKind = "min_mean_latency"
    learner_kind: LearnerKind = "ema"
    policy_pool: List[str] = Field(default_factory=lambda: ["random", "round_robin", "least_loaded"])
    learner_kwargs: Dict[str, Any] = Field(default_factory=dict)
    goal_kwargs: Dict[str, Any] = Field(default_factory=dict)
    workload: WorkloadConfig = WorkloadConfig()
    nodes: Optional[List[NodeConfig]] = None
    poll_interval_ms: int = 50
    job_timeout_ms: int = 15000

class RunStartResponse(BaseModel):
    run_id: str
    status: str

class RunEvent(BaseModel):
    idx: int
    job_id: str
    user_id: str
    policy_name: str
    node_name: str
    latency_ms: float
    reward: float
    sla_violation: bool
    metadata: Dict[str, Any] = Field(default_factory=dict)

class RunStatusResponse(BaseModel):
    run_id: str
    status: str
    processed_jobs: int
    total_jobs: int
    summary: Dict[str, Any] = Field(default_factory=dict)
    events: List[RunEvent] = Field(default_factory=list)