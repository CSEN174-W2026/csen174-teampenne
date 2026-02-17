import pytest

from app.agent import learning_method as L


def test_make_learner_creates_instance():
    learner = L.make_learner("sample_average")
    assert learner is not None


def test_sample_average_updates_counts_and_values():
    learner = L.make_learner("sample_average")

    learner.update("p1", reward=10)
    learner.update("p1", reward=0)

    s = learner.stats()
    assert "p1" in s
    assert s["p1"]["n"] == 2


def test_sample_average_mean_is_correct():
    learner = L.make_learner("sample_average")
    learner.update("p1", reward=10)
    learner.update("p1", reward=20)

    s = learner.stats()
    assert abs(s["p1"]["Q"] - 15.0) < 1e-6


def test_stats_empty_when_no_updates():
    learner = L.make_learner("sample_average")
    s = learner.stats()
    assert isinstance(s, dict)


def test_multiple_policies_tracked_separately():
    learner = L.make_learner("sample_average")
    learner.update("p1", reward=10)
    learner.update("p2", reward=1)

    s = learner.stats()
    assert s["p1"]["n"] == 1
    assert s["p2"]["n"] == 1
