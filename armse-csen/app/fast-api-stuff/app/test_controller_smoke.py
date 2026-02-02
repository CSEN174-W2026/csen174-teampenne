# test_controller_smoke.py
import time
from virtualbox import discover_nodes
from node_client import NodeClient
from state_types import JobRequest

def pick_least_loaded(snaps):
    # simplest possible: lowest cpu%, tie-breaker lowest mem%
    return min(snaps, key=lambda s: (s.cpu_pct or 0, s.mem_pct or 0))

def main():
    client = NodeClient(timeout_s=2.0)

    nodes = discover_nodes()
    if not nodes:
        raise SystemExit("No nodes discovered.")

    # poll all nodes once
    snaps = []
    for n in nodes:
        snaps.append(client.get_metrics(n))

    target = pick_least_loaded(snaps)
    print("Picked target:", target.name, target.host)

    # submit one job to the chosen node
    resp = client.submit_job(
        target,
        JobRequest(job_id="controller-smoke-1", user_id="u1", service_time_ms=2000, metadata={})
    )
    print("submit:", resp)

    time.sleep(0.2)
    print("metrics after:", client.get_metrics(target))

if __name__ == "__main__":
    main()
