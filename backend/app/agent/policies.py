"""
Routing Policies -- How to pick a node to send a request to?

"""

from __future__ import annotations # For forward references in type hints
from dataclasses import dataclass # For simple data structures
from typing import List, Optional, Dict, Protocol # For defining interfaces
import random
import math
from state_types import NodeSnapshot, JobRequest



# Define a common interface for routing policies - any policy should implement a "route" method that takes a list of NodeSnapshots and a JobRequest, and returns the chosen NodeSnapshot
class RoutingPolicy(Protocol):
    """Interface every routing policy implements."""
    name: str

    def choose_node(self, nodes: List[NodeSnapshot], job: JobRequest) -> NodeSnapshot:
        ...


def _require_nodes(nodes: List[NodeSnapshot]) -> None:
    if not nodes:
        raise ValueError("No nodes available")


def _safe_int(x: Optional[int], default: int = 0) -> int:
    return x if isinstance(x, int) else default


def _safe_float(x: Optional[float], default: float = 0.0) -> float:
    return float(x) if isinstance(x, (int, float)) else float(default)


def _node_load(ns: NodeSnapshot) -> int:
    """Load number used by Tier-1 policies."""
    return _safe_int(getattr(ns, "queue_len", None), 0) + _safe_int(getattr(ns, "in_flight", None), 0)


def _job_size(job: JobRequest) -> int:
    """Job size estimate; spec says use service_time_ms for now."""
    return _safe_int(getattr(job, "service_time_ms", None), 0)


"""---------Tier-0: no VM Stats Required ------------"""

class RandomPolicy:
    """A simple routing policy that randomly selects a node from the list of available nodes."""
    name = "random"

    def __init__(self,seed: Optional[int] = None):
        self.random = random.Random(seed) # Use a random seed for reproducibility
    
    def choose_node(self, nodes: List[NodeSnapshot]) -> NodeSnapshot:
        _require_nodes(nodes) # Ensure there are nodes to choose from
        return self.random.choice(nodes) # Randomly select and return a node

class RoundRobinPolicy:
    """A routing policy that selects nodes in a round-robin fashion."""
    name = "round_robin"

    def __init__(self):
        self._index = 0 # Keep track of the last index used for round-robin
    
    def choose_node(self, nodes: List[NodeSnapshot]) -> NodeSnapshot:
        _require_nodes(nodes) # Ensure there are nodes to choose from
        node = nodes[self._index % len(nodes)] # Select the next node in round-robin order
        self._index += 1 # Move to the next index for the next call
        return node
    
class WeightedRoundRobinPolicy:
    """
    Weighted Round Robin (Static Weights):

    Example weights: {"vm-1": 2, "vm-2": 1, "vm-3": 1} => schedule: vm-1, vm-1, vm-2, vm-3, ...
    VM data needed: none (weights are config)
    """
    name = "weighted_round_robin"

    def __init__(self, weights: Dict[str, int]):
        if not weights:
            raise ValueError("Weights dictionary cannot be empty")
        
        self.weights = {k: max(int(v),0) for k, v in weights.items()} # Ensure weights are non-negative integers

        if all(v == 0 for v in self.weights.values()):
            raise ValueError("At least one weight must be positive")
        
        self._seq : List[str] = [] # Sequence of node IDs based on weights

        for node_name, weight in self.weights.items():
            self._seq.extend([node_name] * weight) # Add node_name to the sequence according to its weight
        self._index = 0 # Keep track of the last index used for round-robin

    def choose_node(self, nodes: List[NodeSnapshot]) -> NodeSnapshot:
        _require_nodes(nodes) # Ensure there are nodes to choose from
        by_name = {n.name: n for n in nodes} # Create a mapping of node names to NodeSnapshot objects

        # Advance until we find a node present in current list
        for _ in range(len(self._seq)):
            pick_name = self._seq[self._index % len(self._seq)] # Get the next node name in the weighted round-robin sequence
            self._index = (self._index + 1) % len(self._seq) # Move to the next index for the next call
            if pick_name in by_name:
                return by_name[pick_name] # Return the NodeSnapshot corresponding to the picked node name
            
        return nodes[0] # Fallback
    

"""---------Tier 1: Needs per-node load number ------------"""
class LeastLoadedPolicy:
    """
    Least Loaded:

    Pick the node with the smallest load number, where load is defined as queue_len + in_flight.
    VM data needed: queue_len, in_flight
    """
    name = "least_loaded"

    def choose_node(self, nodes: List[NodeSnapshot], job: JobRequest) -> NodeSnapshot:
        _require_nodes(nodes) # Ensure there are nodes to choose from
        return min(nodes, key=_node_load) # Return the node with the smallest load number

class PowerOfTwoChoicesPolicy:
    """
    Pick 2 random nodes and choose the less loaded.
    Great low-overhead approximation to least-loaded.
    """
    name = "power_of_two"

    def __init__(self, seed: Optional[int] = None):
        self.rng = random.Random(seed)

    def choose_node(self, nodes: List[NodeSnapshot], job: JobRequest) -> NodeSnapshot:
        _require_nodes(nodes)
        if len(nodes) == 1:
            return nodes[0]
        a, b = self.rng.sample(nodes, 2)
        return a if _node_load(a) <= _node_load(b) else b


class LoadThresholdPolicy:
    """
    JSQ with cap:
      - sort by load
      - pick best node whose load <= threshold
      - else pick the best anyway
    """
    name = "load_threshold"

    def __init__(self, threshold: int = 10):
        self.threshold = int(threshold)

    def choose_node(self, nodes: List[NodeSnapshot], job: JobRequest) -> NodeSnapshot:
        _require_nodes(nodes)
        ordered = sorted(nodes, key=_node_load)
        for n in ordered:
            if _node_load(n) <= self.threshold:
                return n
        return ordered[0]
    


"""---------Tier 2: Job Size or Node Speed ------------"""
class FastestNodeBiasPolicy:
    """
    Prefer faster nodes. If node_speed exists, weight by node_speed.
    Otherwise falls back to Weighted RR behavior if weights provided.
    """
    name = "fastest_node_bias"

    def __init__(self, seed: Optional[int] = None, fallback_weights: Optional[Dict[str, int]] = None):
        self.rng = random.Random(seed)
        self.fallback_wrr = WeightedRoundRobinPolicy(fallback_weights) if fallback_weights else None

    def choose_node(self, nodes: List[NodeSnapshot], job: JobRequest) -> NodeSnapshot:
        _require_nodes(nodes)

        if any(getattr(n, "node_speed", None) is not None for n in nodes):
            # pick max node_speed (higher=faster)
            return max(nodes, key=lambda n: _safe_float(getattr(n, "node_speed", None), 0.0))

        # fallback
        if self.fallback_wrr:
            return self.fallback_wrr.choose_node(nodes, job)

        return nodes[0]


class SizeAwareRoutingPolicy:
    """
    SJF-style idea:
      - small jobs: choose least-loaded
      - big jobs: avoid congested nodes more aggressively (use threshold cap)
    """
    name = "size_aware"

    def __init__(self, small_ms: int = 200, big_threshold: int = 6):
        self.small_ms = int(small_ms)
        self.big_threshold = int(big_threshold)
        self._least = LeastLoadedPolicy()
        self._cap = LoadThresholdPolicy(threshold=big_threshold)

    def choose_node(self, nodes: List[NodeSnapshot], job: JobRequest) -> NodeSnapshot:
        _require_nodes(nodes)
        size = _job_size(job)
        if size <= self.small_ms:
            return self._least.choose_node(nodes, job)
        return self._cap.choose_node(nodes, job)


class MECTPolicy:
    """
    Min Estimated Completion Time:
      completion_time = current_wait + job_size / node_speed

    Approximations:
      - current_wait ~ (queue_len + in_flight) * avg_service_ms (if no avg, treat as 1 unit)
      - node_speed: higher means faster. If missing, assume 1.0
      - job_size uses service_time_ms
    """
    name = "mect"

    def __init__(self, avg_service_ms: float = 100.0):
        self.avg_service_ms = float(avg_service_ms)

    def choose_node(self, nodes: List[NodeSnapshot], job: JobRequest) -> NodeSnapshot:
        _require_nodes(nodes)
        size = max(_job_size(job), 1)
        avg = max(self.avg_service_ms, 1.0)

        def est(ns: NodeSnapshot) -> float:
            load = _node_load(ns)
            wait_ms = load * avg
            speed = _safe_float(getattr(ns, "node_speed", None), 1.0)
            # service time adjusted by speed (faster => smaller)
            service_ms = size / max(speed, 1e-6)
            return wait_ms + service_ms

        return min(nodes, key=est)




"""---------Tier 3: history/learning/class-aware ------------"""

class LatencyAwareEWMAPolicy:
    """
    Prefer nodes with lower recent latency.
    Uses NodeSnapshot.ewma_latency_ms if present, else falls back to least-loaded.
    """
    name = "latency_aware_ewma"

    def choose_node(self, nodes: List[NodeSnapshot], job: JobRequest) -> NodeSnapshot:
        _require_nodes(nodes)

        if any(getattr(n, "ewma_latency_ms", None) is not None for n in nodes):
            return min(nodes, key=lambda n: _safe_float(getattr(n, "ewma_latency_ms", None), 1e9))

        return LeastLoadedPolicy().choose_node(nodes, job)


class TailGuardPolicy:
    """
    Straggler-aware / tail-guard:
      - penalize nodes with high p95_latency_ms or recent SLA misses (if represented in snapshot)
    Uses NodeSnapshot.p95_latency_ms if present.
    """
    name = "tail_guard"

    def __init__(self, p95_cutoff_ms: Optional[float] = None):
        self.p95_cutoff_ms = p95_cutoff_ms  # if None, compute median cutoff dynamically

    def choose_node(self, nodes: List[NodeSnapshot], job: JobRequest) -> NodeSnapshot:
        _require_nodes(nodes)

        p95s = [getattr(n, "p95_latency_ms", None) for n in nodes]
        clean = sorted([_safe_float(x, math.nan) for x in p95s if x is not None])
        if len(clean) >= 2:
            cutoff = self.p95_cutoff_ms
            if cutoff is None:
                cutoff = clean[len(clean) // 2]  # median
            good = [n for n in nodes if getattr(n, "p95_latency_ms", None) is not None and n.p95_latency_ms <= cutoff]
            if good:
                return LeastLoadedPolicy().choose_node(good, job)

        return LeastLoadedPolicy().choose_node(nodes, job)


class FairnessAwarePolicy:
    """
    Fairness-aware scheduler (simple):
      - keep per-user "debt" (how much service they've consumed recently)
      - route job to node that minimizes (node_load + alpha * user_debt)

    Needs: job.user_id
    Maintains agent-side history (not VM stats).
    """
    name = "fairness_aware"

    def __init__(self, alpha: float = 0.02, decay: float = 0.995):
        self.alpha = float(alpha)
        self.decay = float(decay)
        self._debt: Dict[str, float] = {}  # user_id -> debt

    def choose_node(self, nodes: List[NodeSnapshot], job: JobRequest) -> NodeSnapshot:
        _require_nodes(nodes)

        # decay all debts a bit (keeps it "recent")
        for u in list(self._debt.keys()):
            self._debt[u] *= self.decay
            if self._debt[u] < 1e-6:
                del self._debt[u]

        user = getattr(job, "user_id", "unknown")
        debt = self._debt.get(user, 0.0)

        def score(ns: NodeSnapshot) -> float:
            return float(_node_load(ns)) + self.alpha * debt

        return min(nodes, key=score)

    def on_job_completed(self, job: JobRequest, observed_service_ms: Optional[float] = None) -> None:
        """Call this when you have completion info to update fairness debt."""
        user = getattr(job, "user_id", "unknown")
        s = observed_service_ms if observed_service_ms is not None else float(_job_size(job))
        self._debt[user] = self._debt.get(user, 0.0) + max(float(s), 0.0)






"""---------Build Policies------------"""

def build_policies(
    seed: Optional[int] = None,
    wrr_weights: Optional[Dict[str, int]] = None,
) -> Dict[str, RoutingPolicy]:
    """
    Returns a dict policy_name -> policy_instance
    """
    return {
        RandomPolicy(seed=seed).name: RandomPolicy(seed=seed),
        RoundRobinPolicy().name: RoundRobinPolicy(),
        WeightedRoundRobinPolicy(wrr_weights or {}).name: WeightedRoundRobinPolicy(wrr_weights or {"vm-1": 1}),
        LeastLoadedPolicy().name: LeastLoadedPolicy(),
        PowerOfTwoChoicesPolicy(seed=seed).name: PowerOfTwoChoicesPolicy(seed=seed),
        LoadThresholdPolicy(threshold=8).name: LoadThresholdPolicy(threshold=8),
        FastestNodeBiasPolicy(seed=seed, fallback_weights=wrr_weights).name: FastestNodeBiasPolicy(seed=seed, fallback_weights=wrr_weights),
        SizeAwareRoutingPolicy(small_ms=200, big_threshold=6).name: SizeAwareRoutingPolicy(small_ms=200, big_threshold=6),
        MECTPolicy(avg_service_ms=120.0).name: MECTPolicy(avg_service_ms=120.0),
        LatencyAwareEWMAPolicy().name: LatencyAwareEWMAPolicy(),
        TailGuardPolicy().name: TailGuardPolicy(),
        FairnessAwarePolicy(alpha=0.02).name: FairnessAwarePolicy(alpha=0.02),
    }
