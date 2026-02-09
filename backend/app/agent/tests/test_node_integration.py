import sys
import time
import socket
import subprocess
import pytest

from state_types import NodeSnapshot, JobRequest
from node.node_client import NodeClient


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    host, port = s.getsockname()
    s.close()
    return port


def _wait_http(host, port, timeout=8.0):
    import requests
    deadline = time.time() + timeout
    url = f"http://{host}:{port}/metrics"
    while time.time() < deadline:
        try:
            r = requests.get(url, timeout=0.5)
            if r.status_code == 200:
                return True
        except Exception:
            time.sleep(0.1)
    return False


@pytest.fixture(scope="module")
def node_server():
    """
    Starts node_worker.py via uvicorn as a real server.
    Prints startup info + helpful debug if startup fails.
    """
    port = _free_port()

    print("\n=== NODE SERVER FIXTURE ===")
    print(f"Starting node_worker on 127.0.0.1:{port}")

    # assumes repo root execution so module path works
    cmd = [
        sys.executable, "-m", "uvicorn",
        "node.node_worker:app",
        "--host", "127.0.0.1",
        "--port", str(port),
        "--log-level", "warning",
    ]

    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    ok = _wait_http("127.0.0.1", port, timeout=8.0)
    if not ok:
        print("\n Node server failed to start. Dumping logs...")
        try:
            out, err = p.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            p.kill()
            out, err = ("<timeout reading stdout>", "<timeout reading stderr>")
        p.kill()
        raise RuntimeError(f"Node server failed to start.\nSTDOUT:\n{out}\nSTDERR:\n{err}")

    print(" Node server is up and responding to /metrics")
    yield port

    print("\nStopping node server...")
    p.terminate()
    try:
        p.wait(timeout=3)
        print(" Node server stopped cleanly.")
    except subprocess.TimeoutExpired:
        p.kill()
        print(" Node server had to be killed.")


def test_node_metrics_and_submit_flow(node_server):
    """
    Integration test:
      - GET /metrics
      - POST /submit
      - GET /metrics again
      - GET /recent_jobs
    """
    import requests

    port = node_server
    node = NodeSnapshot(name="localnode", host="127.0.0.1", port=port)
    client = NodeClient(timeout_s=2.0)

    print("\n=== TEST: node metrics + submit + recent_jobs ===")
    print(f"Node under test: {node.name} @ {node.host}:{node.port}")

    # 1) metrics before
    m1 = client.get_metrics(node)
    print("\n[1] Metrics BEFORE submit:")
    print(f"  queue_len  = {m1.queue_len}")
    print(f"  in_flight  = {m1.in_flight}")
    print(f"  cpu_pct    = {m1.cpu_pct}")
    print(f"  mem_pct    = {m1.mem_pct}")
    assert m1.queue_len is not None
    assert m1.in_flight is not None

    # 2) submit a job
    job = JobRequest(job_id="job1", user_id="u1", service_time_ms=300, metadata={})
    print("\n[2] Submitting job:")
    print(f"  job_id={job.job_id}, user_id={job.user_id}, service_time_ms={job.service_time_ms}")

    resp = client.submit_job(node, job)
    print("  submit response:", resp)
    assert resp.get("accepted") is True

    # 3) metrics shortly after submit
    time.sleep(0.15)
    m2 = client.get_metrics(node)
    print("\n[3] Metrics AFTER submit (shortly):")
    print(f"  queue_len  = {m2.queue_len} (was {m1.queue_len})")
    print(f"  in_flight  = {m2.in_flight} (was {m1.in_flight})")

    # should usually increase either queue or in-flight
    assert (m2.queue_len >= m1.queue_len) or (m2.in_flight >= m1.in_flight)

    # 4) wait for job to finish
    print("\n[4] Waiting for job to finish...")
    time.sleep(0.55)

    # 5) recent jobs should show it
    url = f"http://127.0.0.1:{port}/recent_jobs?limit=10"
    print("\n[5] Fetching recent jobs:", url)

    r = requests.get(url, timeout=2.0)
    r.raise_for_status()
    jobs = r.json()

    print("Recent jobs returned:")
    for j in jobs:
        # keep prints small but informative
        print(f"  - job_id={j.get('job_id')} latency_ms={j.get('latency_ms')} ok={j.get('ok')}")

    assert any(j.get("job_id") == "job1" for j in jobs), "job1 not found in recent_jobs"
