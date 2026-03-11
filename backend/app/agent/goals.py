from __future__ import annotations

import math
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


def _exp_reward(latency_ms: float, half_ms: float) -> float:
    """Exponential decay: reward = exp(-ln2 * latency / half_ms).
    At latency=0 → 1.0, at latency=half_ms → 0.5, monotonically→0."""
    return math.exp(-0.693147 * latency_ms / half_ms)


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
    Exponential decay reward in (0, 1].
    half_ms controls where reward = 0.5 (default 1500ms).
    Failed jobs → 0.0.
    """
    name: str = "min_mean_latency"

    def __init__(self, half_ms: float = 1500.0, **_kw):
        self.half_ms = max(1.0, float(half_ms))

    def reward(self, outcome: Outcome) -> float:
        if not outcome.success:
            return 0.0
        return _exp_reward(float(outcome.latency_ms), self.half_ms)


class MinLatencyWithSLA(Goal):
    """
    Exponential decay with SLA penalty that halves the reward
    when latency exceeds the SLA threshold.
    """
    name = "min_latency_with_sla"

    def __init__(self, sla_ms: float = 500.0, half_ms: float = 1500.0, **_kw):
        self.sla_ms = float(sla_ms)
        self.half_ms = max(1.0, float(half_ms))

    def reward(self, o: Outcome) -> float:
        if not o.success:
            return 0.0
        lat = float(o.latency_ms)
        r = _exp_reward(lat, self.half_ms)
        if lat > self.sla_ms:
            r *= 0.5
        return r


class MinLatencyPlusTail(Goal):
    """
    Exponential decay blending single-job latency with rolling p95.
    """
    name = "min_latency_plus_tail"

    def __init__(self, tail_weight: float = 0.2, half_ms: float = 1500.0, **_kw):
        self.tail_weight = float(tail_weight)
        self.half_ms = max(1.0, float(half_ms))

    def reward(self, o: Outcome) -> float:
        if not o.success:
            return 0.0
        lat = float(o.latency_ms)
        p95 = 0.0
        extra = o.extra_info or {}
        if isinstance(extra, dict):
            if extra.get("p95_ms") is not None:
                p95 = float(extra["p95_ms"])
            elif extra.get("p95_latency_ms") is not None:
                p95 = float(extra["p95_latency_ms"])

        blended = lat + self.tail_weight * p95
        return _exp_reward(blended, self.half_ms)


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
