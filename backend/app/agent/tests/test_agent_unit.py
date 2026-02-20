import time
import pytest

from state_types import JobRequest, NodeSnapshot
from backend.app.agent.manager_agent import ManagerAgent


# ------------------------------
# Simple deterministic policy
# ------------------------------
class FirstNodePolicy:
    name = "first_node"

    def choose_node(self, nodes, job):
        return nodes[0]


def make_nodes():
    return [
        NodeSnapshot(name="n1", host="127.0.0.1", port=8001),
        NodeSnapshot(name="n2", host="127.0.0.1", port=8002),
        NodeSnapshot(name="n3", host="127.0.0.1", port=8003),
        NodeSnapshot(name="n4", host="127.0.0.1", port=8004),
        NodeSnapshot(name="n5", host="127.0.0.1", port=8005),
    ]


def make_job(job_id="j1", user_id="u1", service_time_ms=50):
    return JobRequest(
        job_id=job_id,
        user_id=user_id,
        service_time_ms=service_time_ms,
        metadata={}
    )


# ------------------------------
# Tests
# ------------------------------
def test_agent_route_prints_decision():
    print("\n=== TEST: agent.route() ===")

    policies = {"first_node": FirstNodePolicy()}
    agent = ManagerAgent(
        learner_kind="sample_average",
        goal_kind="min_mean_latency",
        policies=policies,
    )

    nodes = make_nodes()
    job = make_job()

    d = agent.route(job, nodes)

    print("Decision returned:")
    print(f"  job_id       = {d.job_id}")
    print(f"  policy       = {d.policy_name}")
    print(f"  node         = {d.node_name}")
    print(f"  host:port    = {d.host}:{d.port}")
    print(f"  context keys = {list(d.context.keys())}")

    assert d.policy_name == "first_node"
    assert d.node_name == "n1"


def test_agent_observe_prints_reward_and_stats():
    print("\n=== TEST: agent.observe() + learner update ===")

    policies = {"first_node": FirstNodePolicy()}
    agent = ManagerAgent(
        learner_kind="sample_average",
        goal_kind="min_mean_latency",
        policies=policies,
    )

    nodes = make_nodes()
    job = make_job(job_id="j2")

    agent.route(job, nodes)

    outcome, reward = agent.observe(
        job.job_id,
        success=True,
        latency_ms=123
    )

    print("Outcome observed:")
    print(f"  job_id   = {outcome.job_id}")
    print(f"  latency = {outcome.latency_ms} ms")
    print(f"  reward  = {reward}")

    stats = agent.learner_stats()
    print("Learner stats:")
    for policy, s in stats.items():
        print(f"  {policy}: n={s['n']}, Q={s['Q']:.3f}")

    assert stats["first_node"]["n"] == 1


def test_agent_contextual_bandit_prints_flow():
    print("\n=== TEST: contextual bandit end-to-end ===")

    policies = {"first_node": FirstNodePolicy()}
    feature_keys = [
        "node_count",
        "avg_load",
        "max_load",
        "load_imbalance",
        "avg_cpu",
        "max_cpu",
        "job_size_ms",
    ]

    agent = ManagerAgent(
        learner_kind="contextual",
        goal_kind="min_mean_latency",
        policies=policies,
        learner_kwargs={
            "feature_keys": feature_keys,
            "epsilon": 0.0,
            "lr": 0.05,
        },
    )

    nodes = make_nodes()
    job = make_job(job_id="j_ctx", service_time_ms=80)

    d = agent.route(job, nodes)
    print("Chosen policy:", d.policy_name)
    print("Context vector:")
    for k, v in d.context.items():
        print(f"  {k}: {v}")

    outcome, reward = agent.observe(
        job.job_id,
        success=True,
        latency_ms=111
    )

    print("Outcome + reward:")
    print(f"  latency = {outcome.latency_ms}")
    print(f"  reward  = {reward}")

    print("Learner weights:")
    stats = agent.learner_stats()
    print(stats)

    assert outcome.latency_ms == 111
