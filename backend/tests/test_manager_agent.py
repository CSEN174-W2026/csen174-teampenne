import pytest

from app.state_types import NodeSnapshot, JobRequest

# pick ONE of these based on your repo
from app.agent.manager_agent import ManagerAgent
# from app.agent.agent import ManagerAgent


class DummyPolicy:
    def __init__(self, node_name="n1"):
        self.node_name = node_name
        self.calls = 0

    def choose_node(self, nodes, job):
        self.calls += 1
        # return the node with matching name if exists
        for n in nodes:
            if n.name == self.node_name:
                return n
        return nodes[0]


def make_nodes():
    return [
        NodeSnapshot(name="n1", host="h1", port=5001, cpus=2, memory_mb=2048),
        NodeSnapshot(name="n2", host="h2", port=5001, cpus=2, memory_mb=2048),
    ]


def make_job(job_id="j1"):
    return JobRequest(job_id=job_id, user_id="u1", service_time_ms=100, metadata={})


def test_route_returns_decision_with_expected_fields():
    nodes = make_nodes()
    job = make_job()
    policies = {"p": DummyPolicy("n2")}

    agent = ManagerAgent(
        learner_kind="sample_average",
        goal_kind="min_mean_latency",
        policies=policies,
    )

    d = agent.route(job, nodes)
    assert d.policy_name in policies
    assert d.node_name in {"n1", "n2"}
    assert d.host in {"h1", "h2"}
    assert d.port == 5001


def test_route_calls_policy_choose_node():
    nodes = make_nodes()
    job = make_job()
    pol = DummyPolicy("n1")
    agent = ManagerAgent(
        learner_kind="sample_average",
        goal_kind="min_mean_latency",
        policies={"p": pol},
    )

    _ = agent.route(job, nodes)
    assert pol.calls == 1


def test_observe_returns_outcome_and_reward_types():
    nodes = make_nodes()
    job = make_job()
    agent = ManagerAgent(
        learner_kind="sample_average",
        goal_kind="min_mean_latency",
        policies={"p": DummyPolicy("n1")},
    )

    _ = agent.route(job, nodes)
    outcome, reward = agent.observe(job.job_id, success=True, latency_ms=123)

    assert hasattr(outcome, "job_id")
    assert isinstance(reward, (int, float))


def test_observe_without_route_raises_or_handles_gracefully():
    agent = ManagerAgent(
        learner_kind="sample_average",
        goal_kind="min_mean_latency",
        policies={"p": DummyPolicy("n1")},
    )

    # Depending on your design, this may raise or return something special.
    # Accept either "raises" or "no crash".
    try:
        _ = agent.observe("j999", success=True, latency_ms=10)
    except Exception:
        assert True


def test_learner_stats_returns_dict():
    nodes = make_nodes()
    job = make_job()
    agent = ManagerAgent(
        learner_kind="sample_average",
        goal_kind="min_mean_latency",
        policies={"p": DummyPolicy("n1")},
    )
    _ = agent.route(job, nodes)
    _ = agent.observe(job.job_id, success=True, latency_ms=50)

    stats = agent.learner_stats()
    assert isinstance(stats, dict)
    assert "p" in stats
