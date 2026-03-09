from dataclasses import dataclass # Define simple "data container" classes
from typing import List, Dict, Optional, Any, Tuple
import time
import math

from app.agent.policies import RoutingPolicy, build_policies
from app.state_types import JobRequest, NodeSnapshot
from app.agent.learning_method import Learner, make_learner
from app.agent.goals import Goal, Outcome, make_goal
from app.agent.decision_explainer import DecisionExplainer

# from app.agent.policies import RoutingPolicy, build_policies
# from app.state_types import JobRequest, NodeSnapshot
# from app.agent.learning_method import Learner, make_learner
# from app.agent.goals import Goal, Outcome, make_goal



"""
ManagerAgent is a "manager brain" that:
1. Chooses a routing policy
2. That policy chooses a node
3. Later, when the job finishes, call observe() -> creates an outcome -> converts outcome to reward
4. Updates the learner
"""



# When you dispatch a job, we must remember what policy we used and what node you sent it to, so that when the outcome comes back, we can update the right policy in the learner.
@dataclass(frozen=True) # Object is immutable after creation
class Decision:
    """
    Records what manager decided for a job request aka at dispatch time.
    """
    job_id: str
    policy_name: str
    node_name: str
    host: str
    port: int
    dispatched_at_ms: int
    context: Optional[Dict[str,float]] = None
    user_id: Optional[str] = None

# Builds a context feature vector describing the state of the system at dispatch time.
# This context will be fed into the learner
def default_context_builder(nodes: List[NodeSnapshot], job_request: JobRequest) -> Dict[str, float]:
    """
    Turn the current system state into a numeric feature dictionary (context vector)
    Mainly used by contextual bandit learners -> can be ignored by non-contextual learners
    """
    n = max(len(nodes), 1)  # Avoid division by zero

    loads: List[float] = []
    cpus: List[float] = []
    
    # Collect load and CPU per node
    for node in nodes:
        q = getattr(node, "queue_len", None)
        f = getattr(node, "in_flight", None)

        load = (q if isinstance(q,int) else 0) + (f if isinstance(f,int) else 0)
        loads.append(float(load))

        cpu = getattr(node, "cpu_pct", None)
        cpus.append(float(cpu) if isinstance(cpu,(int,float)) else 0.0)
    
    avg_load = sum(loads) / n
    max_load = max(loads) if loads else 0.0
    min_load = min(loads) if loads else 0.0
    imbalance = max_load - min_load

    avg_cpu = sum(cpus) / n
    max_cpu = max(cpus) if cpus else 0.0
    
    job_size = getattr(job_request, "service_time_ms", None) # use "service_time_ms" as the job size estimate
    job_size = float(job_size) if isinstance(job_size,(int,float)) else 0.0 # default to 0 if not provided

    return {
        "node_count": float(len(nodes)),
        "avg_load": float(avg_load),
        "max_load": float(max_load),
        "load_imbalance": float(imbalance),
        "avg_cpu": float(avg_cpu),
        "max_cpu": float(max_cpu),
        "job_size_ms": float(job_size),
    }


class ManagerAgent:
    """
    Policy-selection agent:
    - Learner chooses a policy (arm)
    - Policy chooses a node
    - Outcome -> Goal.reward -> learner.update
    """

    def __init__(
            self,
            learner_kind: str = "ucb1",
            goal_kind: str = "min_mean_latency",
            *,  # force keyword args after this
            seed: Optional[int] = None,
            policies: Optional[Dict[str,RoutingPolicy]] = None,
            learner_kwargs: Optional[Dict[str, Any]] = None,
            goal_kwargs: Optional[Dict[str, Any]] = None,
            latency_clip_ms: float = 10_000.0,
            context_builder=default_context_builder,
            history_size: int = 300,
    ):
        self.policies: Dict[str, RoutingPolicy] = policies or build_policies(seed) # If caller passes policies, use them, otherwise build default ones
        
        policy_allowlist = None
        if learner_kwargs and isinstance(learner_kwargs.get("policy_allowlist"), list):
            policy_allowlist = set(str(x) for x in learner_kwargs["policy_allowlist"])

        if policy_allowlist:
            self.policies = {k: v for k, v in self.policies.items() if k in policy_allowlist}
            if not self.policies:
                raise ValueError("policy_allowlist removed all policies; check names")
            
        
        learner_kwargs = learner_kwargs or {}
        self.learner: Learner = make_learner(learner_kind, seed=seed, **learner_kwargs) # Initialize the learner
        self.explainer = DecisionExplainer(history=max(500, history_size))  # For explaining decisions, keeps a history of outcomes

        goal_kwargs = goal_kwargs or {}
        self.goal: Goal = make_goal(goal_kind, **goal_kwargs)

        self.latency_clip_ms = latency_clip_ms # Cap insane latencies
        self.context_builder = context_builder # Function to build context vector from system state

        self._pending: Dict[str, Decision] = {}  # job_id -> Decision
        self._outcomes: List[Outcome] = []  # most recent outcomes, for diagnostics
        self._history_size = int(history_size) # how many past outcomes to remember for diagnostics
        self._reward_sum_by_policy: Dict[str, float] = {}
        self._reward_count_by_policy: Dict[str, int] = {}

    # Return list of policy names (arms)
    def policy_names(self) -> List[str]:
        return list(self.policies.keys())
    
    def _route_with_policy_name(self, policy_name: str, job: JobRequest, nodes: List[NodeSnapshot]) -> Decision:
        if not nodes:
            raise ValueError("No nodes available")
        if policy_name not in self.policies:
            raise ValueError(f"Unknown policy '{policy_name}'")

        context = self.context_builder(nodes, job)
        policy = self.policies[policy_name]
        chosen = policy.choose_node(nodes, job)
        d = Decision(
            job_id=job.job_id,
            policy_name=policy_name,
            node_name=chosen.name,
            host=chosen.host,
            port=chosen.port,
            dispatched_at_ms=int(time.time() * 1000),
            context=context,
            user_id=getattr(job, "user_id", None),
        )
        self._pending[job.job_id] = d
        self.explainer.record_choice(
            job_id=job.job_id,
            chosen_policy=policy_name,
            chosen_node=chosen.name,
            context=context,
            learner_stats=self.learner_stats(),
            learner_name=getattr(self.learner, "name", "unknown"),
        )
        return d

    def route_with_policy(self, policy_name: str, job: JobRequest, nodes: List[NodeSnapshot]) -> Decision:
        """
        Route using a fixed policy name (manual override path).
        """
        key = (policy_name or "").strip().lower().replace("-", "_")
        return self._route_with_policy_name(key, job, nodes)


    # Decide which policy to use, and which node to route to, for this job request
    def route(self, job: JobRequest, nodes: List[NodeSnapshot]) -> Decision:
        if not nodes:
            raise ValueError("No nodes available")

        context = self.context_builder(nodes, job)
        arms = self.policy_names()

        policy_name = self.learner.choose_arm(arms, context=context) # Learner chooses which policy to use based on the arms and context
        return self._route_with_policy_name(policy_name, job, nodes)
    
    # Observe the outcome of a completed job, update learner --> when job is finished
    def observe(
        self,
        job_id: str,
        *,
        success: bool,
        latency_ms: float,
        extra: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Outcome, float]:
        """
        Call when the job completes. Updates learner with reward from goal.
        Returns (Outcome, reward_used).
        """
        if job_id not in self._pending:
            raise KeyError(f"Unknown job_id={job_id}. Did you call route() first?")

        d = self._pending.pop(job_id) # Remove from pending

        lat = float(latency_ms)
        if math.isnan(lat) or lat < 0:
            lat = self.latency_clip_ms
        lat = min(lat, self.latency_clip_ms)

        # Provide rolling p95 if caller didn't pass one so tail-sensitive goals
        # have a meaningful signal beyond single-job latency.
        extra_info: Dict[str, Any] = dict(extra or {})
        if extra_info.get("p95_ms") is None and extra_info.get("p95_latency_ms") is None:
            latencies = [float(o.latency_ms) for o in self._outcomes]
            latencies.append(float(lat))
            if latencies:
                latencies.sort()
                idx = int(0.95 * (len(latencies) - 1))
                extra_info["p95_latency_ms"] = float(latencies[idx])

        o = Outcome(
            job_id=job_id,
            success=bool(success),
            latency_ms=lat,
            policy_name=d.policy_name,
            node_name=d.node_name,
            user_id=d.user_id,
            extra_info=extra_info,
        )

        reward = float(self.goal.reward(o)) # Compute reward based on the outcome
        self.learner.update(d.policy_name, reward, context=d.context)
        self._reward_sum_by_policy[d.policy_name] = self._reward_sum_by_policy.get(d.policy_name, 0.0) + reward
        self._reward_count_by_policy[d.policy_name] = self._reward_count_by_policy.get(d.policy_name, 0) + 1

        self.explainer.record_observation(
            job_id=job_id,
            policy=d.policy_name,
            reward=reward,
            latency_ms=lat,
            success=bool(success),
            learner_stats_after=self.learner_stats(),
            learner_name=getattr(self.learner, "name", "unknown"),
        )

        self._outcomes.append(o)
        if len(self._outcomes) > self._history_size:
            self._outcomes.pop(0)

        return o, reward

    def latency_stats(self) -> Dict[str, dict]:
        acc = {}
        for o in self._outcomes:
            p = o.policy_name
            a = acc.setdefault(p, {"n": 0, "total_latency_ms": 0.0, "avg_latency_ms": 0.0})
            a["n"] += 1
            a["total_latency_ms"] += float(o.latency_ms)

        for p, a in acc.items():
            if a["n"] > 0:
                a["avg_latency_ms"] = a["total_latency_ms"] / a["n"]
        return acc

    def learner_stats(self) -> Dict[str, dict]:
        return self.learner.stats()

    def reward_stats(self) -> Dict[str, dict]:
        acc: Dict[str, dict] = {}
        for policy, total in self._reward_sum_by_policy.items():
            n = int(self._reward_count_by_policy.get(policy, 0))
            acc[policy] = {
                "n": n,
                "total_reward": float(total),
                "avg_reward": float(total / n) if n > 0 else 0.0,
            }
        return acc

    def recent_outcomes(self) -> List[Outcome]:
        return list(self._outcomes)

    def pending_job_ids(self) -> List[str]:
        return list(self._pending.keys())

    def summary(self) -> Dict[str, Any]:
        outs = self._outcomes
        if not outs:
            return {
                "goal": getattr(self.goal, "name", "unknown"),
                "learner": getattr(self.learner, "name", "unknown"),
                "policy_count": len(self.policies),
                "observations": 0,
            }

        lats = sorted(o.latency_ms for o in outs)
        n = len(lats)
        mean = sum(lats) / n
        p95 = lats[int(0.95 * (n - 1))] if n > 1 else lats[0]
        fails = sum(1 for o in outs if not o.success)

        counts: Dict[str, int] = {}
        for o in outs:
            counts[o.policy_name] = counts.get(o.policy_name, 0) + 1
        top_policy = max(counts, key=counts.get)

        return {
            "goal": getattr(self.goal, "name", "unknown"),
            "learner": getattr(self.learner, "name", "unknown"),
            "policy_count": len(self.policies),
            "observations": n,
            "mean_latency_ms": mean,
            "p95_latency_ms": p95,
            "failures": fails,
            "top_policy": top_policy,
            "top_policy_count": counts[top_policy],
            "learner_stats": self.learner_stats(),
            "reward_stats": self.reward_stats(),
            "pending": len(self._pending),
        }
