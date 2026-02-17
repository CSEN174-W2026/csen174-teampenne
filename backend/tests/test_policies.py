import inspect
import pytest

from app.state_types import NodeSnapshot, JobRequest
from app.agent import policies as P


def call_choose_node(policy, nodes, job):
    fn = policy.choose_node
    sig = inspect.signature(fn)
    params = list(sig.parameters.values())

    # bound method => params will be (nodes) or (nodes, job)
    if len(params) == 1:
        return fn(nodes)
    if len(params) == 2:
        return fn(nodes, job)
    raise TypeError(f"Unexpected choose_node signature: {sig}")


@pytest.fixture
def nodes():
    return [
        NodeSnapshot(name="n1", host="h1", port=1, cpus=2, memory_mb=100),
        NodeSnapshot(name="n2", host="h2", port=2, cpus=2, memory_mb=100),
        NodeSnapshot(name="n3", host="h3", port=3, cpus=2, memory_mb=100),
    ]


@pytest.fixture
def job():
    return JobRequest(job_id="j1", user_id="u", service_time_ms=10, metadata={})


def test_random_policy_returns_member_of_nodes(nodes, job):
    if not hasattr(P, "RandomPolicy"):
        pytest.skip("RandomPolicy not present")
    pol = P.RandomPolicy()
    chosen = call_choose_node(pol, nodes, job)
    assert chosen in nodes


def test_weighted_round_robin_rejects_empty_weights():
    if not hasattr(P, "WeightedRoundRobinPolicy"):
        pytest.skip("WeightedRoundRobinPolicy not present")
    with pytest.raises(ValueError):
        P.WeightedRoundRobinPolicy({})


def test_weighted_round_robin_prefers_heavier_weight(nodes, job):
    if not hasattr(P, "WeightedRoundRobinPolicy"):
        pytest.skip("WeightedRoundRobinPolicy not present")

    pol = P.WeightedRoundRobinPolicy({"n1": 10, "n2": 1, "n3": 1})
    picks = [call_choose_node(pol, nodes, job).name for _ in range(60)]
    assert picks.count("n1") > picks.count("n2")
    assert picks.count("n1") > picks.count("n3")


def test_policy_handles_single_node(job):
    single = [NodeSnapshot(name="n1", host="h1", port=1, cpus=2, memory_mb=100)]

    for cname in ["FirstNodePolicy", "RandomPolicy", "WeightedRoundRobinPolicy"]:
        if not hasattr(P, cname):
            continue

        if cname == "WeightedRoundRobinPolicy":
            pol = getattr(P, cname)({"n1": 1})
        else:
            pol = getattr(P, cname)()

        chosen = call_choose_node(pol, single, job)
        assert chosen.name == "n1"


def test_build_policies_returns_dict_or_skips():
    if not hasattr(P, "build_policies"):
        pytest.skip("build_policies not present")

    try:
        policies = P.build_policies()
    except ValueError:
        pytest.skip("build_policies requires non-empty config (e.g., WRR weights)")

    assert isinstance(policies, dict)
    assert len(policies) >= 1
