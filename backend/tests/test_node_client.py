import pytest
from types import SimpleNamespace

from app.node.node_client import NodeClient
from app.state_types import NodeSnapshot, JobRequest


class DummyResp:
    def __init__(self, json_data, status_ok=True):
        self._json = json_data
        self._status_ok = status_ok

    def raise_for_status(self):
        if not self._status_ok:
            raise RuntimeError("HTTP error")

    def json(self):
        return self._json


@pytest.fixture
def node():
    return NodeSnapshot(name="n1", host="127.0.0.1", port=5001, cpus=2, memory_mb=2048)


@pytest.fixture
def job():
    return JobRequest(job_id="j1", user_id="u1", service_time_ms=123, metadata={"x": 1})


def test_get_metrics_builds_correct_url(monkeypatch, node):
    calls = {}

    def fake_get(url, timeout):
        calls["url"] = url
        calls["timeout"] = timeout
        return DummyResp({"cpu_pct": 1.0, "mem_pct": 2.0})

    monkeypatch.setattr("requests.get", fake_get)

    c = NodeClient(timeout_s=9.9)
    _ = c.get_metrics(node)

    assert calls["url"] == "http://127.0.0.1:5001/metrics"
    assert calls["timeout"] == 9.9


def test_get_metrics_returns_updated_nodesnapshot(monkeypatch, node):
    def fake_get(url, timeout):
        return DummyResp(
            {
                "cpu_pct": 11.1,
                "mem_pct": 22.2,
                "queue_len": 3,
                "in_flight": 1,
                "ewma_latency_ms": 50,
                "p95_latency_ms": 99,
                "completed_last_60s": 10,
                "node_speed": 1.25,
            }
        )

    monkeypatch.setattr("requests.get", fake_get)

    c = NodeClient()
    updated = c.get_metrics(node)

    assert updated.name == node.name
    assert updated.host == node.host
    assert updated.port == node.port
    assert updated.cpu_pct == 11.1
    assert updated.mem_pct == 22.2
    assert updated.queue_len == 3
    assert updated.node_speed == 1.25


def test_get_metrics_raises_on_http_error(monkeypatch, node):
    def fake_get(url, timeout):
        return DummyResp({}, status_ok=False)

    monkeypatch.setattr("requests.get", fake_get)

    c = NodeClient()
    with pytest.raises(RuntimeError):
        _ = c.get_metrics(node)


def test_submit_job_sends_correct_payload(monkeypatch, node, job):
    calls = {}

    def fake_post(url, json, timeout):
        calls["url"] = url
        calls["json"] = json
        calls["timeout"] = timeout
        return DummyResp({"ok": True})

    monkeypatch.setattr("requests.post", fake_post)

    c = NodeClient(timeout_s=2.5)
    resp = c.submit_job(node, job)

    assert calls["url"] == "http://127.0.0.1:5001/submit"
    assert calls["timeout"] == 2.5
    assert calls["json"]["job_id"] == "j1"
    assert calls["json"]["user_id"] == "u1"
    assert calls["json"]["service_time_ms"] == 123
    assert calls["json"]["metadata"] == {"x": 1}
    assert resp["ok"] is True


def test_submit_job_defaults_metadata_to_empty_dict(monkeypatch, node):
    calls = {}

    def fake_post(url, json, timeout):
        calls["json"] = json
        return DummyResp({"ok": True})

    monkeypatch.setattr("requests.post", fake_post)

    job = JobRequest(job_id="j2", user_id="u2", service_time_ms=10, metadata=None)
    c = NodeClient()
    _ = c.submit_job(node, job)

    assert calls["json"]["metadata"] == {}
