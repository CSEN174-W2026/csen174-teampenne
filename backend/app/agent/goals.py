from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Dict


@dataclass(frozen=True)
class Outcome:
    """
    What Happened after dispatching a job.
    This is what goals convert into a scalar reward.
    """
    job_id: str
    success: bool
    latency_ms: float
    policy_name: str
    node_name: str
    user_id: Optional[str] = None
    extra_info: Optional[Dict] = None


class Goal:
    """
    Goal -> Reward Mapping
    Higher reward is better
    """

    name: str = "BaseGoal"
    def reward(self, outcome: Outcome) -> float:
        raise NotImplementedError("Subclasses must implement reward method")
    

class MinMeanLatency(Goal):
    """
    Reward = -latency (minimizing latency --> maximizing reward)
    Penalize failed jobs with a large negative reward (e.g., -1000)
    """
    name: str = "min_mean_latency"

    def __init__(self, fail_penalty: float = 1000.0):
        self.fail_penalty = fail_penalty
    
    def reward(self, outcome: Outcome) -> float:
        r = -float(outcome.latency_ms)
        if not outcome.success:
            r -= self.fail_penalty
        return r


class MinLatencyWithSLA(Goal):
    """
    Add penalty when SLA violated.
    """
    name = "min_latency_with_sla"

    def __init__(self, sla_ms: float = 500.0, sla_penalty: float = 5_000.0, fail_penalty: float = 10_000.0):
        self.sla_ms = float(sla_ms)
        self.sla_penalty = float(sla_penalty)
        self.fail_penalty = float(fail_penalty)

    def reward(self, o: Outcome) -> float:
        lat = float(o.latency_ms)
        r = -lat
        if lat > self.sla_ms:
            r -= self.sla_penalty
        if not o.success:
            r -= self.fail_penalty
        return r


class MinLatencyPlusTail(Goal):
    """
    Uses extra["p95_ms"] if provided (optional).
    Reward = -(latency + tail_weight*p95)
    """
    name = "min_latency_plus_tail"

    def __init__(self, tail_weight: float = 0.2, fail_penalty: float = 10_000.0):
        self.tail_weight = float(tail_weight)
        self.fail_penalty = float(fail_penalty)

    def reward(self, o: Outcome) -> float:
        lat = float(o.latency_ms)
        p95 = None
        extra = o.extra_info or {}
        if isinstance(extra, dict):
            if extra.get("p95_ms") is not None:
                p95 = float(extra["p95_ms"])
            elif extra.get("p95_latency_ms") is not None:
                p95 = float(extra["p95_latency_ms"])

        r = -lat
        if p95 is not None:
            r -= self.tail_weight * p95
        if not o.success:
            r -= self.fail_penalty
        return r


def make_goal(kind: str, **kwargs) -> Goal:
    """
    Small factory so your controller can choose goal by config.
    """
    k = kind.strip().lower()
    if k in ("min_mean_latency", "mean_latency", "latency"):
        return MinMeanLatency(**kwargs)
    if k in ("min_latency_with_sla", "sla"):
        return MinLatencyWithSLA(**kwargs)
    if k in ("min_latency_plus_tail", "tail", "p95"):
        return MinLatencyPlusTail(**kwargs)
    raise ValueError(f"Unknown goal kind: {kind}")