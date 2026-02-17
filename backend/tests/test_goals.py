# backend/tests/test_goals.py
import pytest
from app.agent import goals as G


def make_outcome(success: bool, latency_ms: float):
    return G.Outcome(
        job_id="j1",
        success=success,
        latency_ms=latency_ms,
        policy_name="p1",
        node_name="n1",
        user_id="u1",
        extra_info={},
    )


def test_make_goal_creates_goal():
    g = G.make_goal("min_mean_latency")
    assert g is not None


def test_min_mean_latency_reward_is_numeric():
    g = G.make_goal("min_mean_latency")
    r = g.reward(make_outcome(True, 100))
    assert isinstance(r, (int, float))


def test_failure_penalized_more_than_success():
    g = G.make_goal("min_mean_latency")
    r_ok = g.reward(make_outcome(True, 100))
    r_fail = g.reward(make_outcome(False, 100))
    assert r_fail < r_ok


def test_higher_latency_worse_reward():
    g = G.make_goal("min_mean_latency")
    r_fast = g.reward(make_outcome(True, 50))
    r_slow = g.reward(make_outcome(True, 200))
    assert r_slow < r_fast


def test_latency_zero_or_small_handled():
    g = G.make_goal("min_mean_latency")
    r = g.reward(make_outcome(True, 0))
    assert isinstance(r, (int, float))
