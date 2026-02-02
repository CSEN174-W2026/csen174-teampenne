# test_nodes_e2e.py
import time
from virtualbox import discover_nodes
from node_client import NodeClient
from state_types import JobRequest

def main():
    client = NodeClient(timeout_s=2.0)
    nodes = discover_nodes()
    if not nodes:
        raise SystemExit("No nodes discovered.")

    print(f"Testing {len(nodes)} nodes...\n")

    for node in nodes:
        print(f"== {node.name} ({node.host}:{node.port}) ==")

        # 1) metrics
        m1 = client.get_metrics(node)
        print("metrics:", m1)

        # 2) submit a small job
        job = JobRequest(
            job_id=f"test-{node.name}",
            user_id="u-test",
            service_time_ms=1200,
            metadata={}
        )
        resp = client.submit_job(node, job)
        print("submit:", resp)

        # 3) metrics right after submit (may show in_flight or queue_len)
        time.sleep(0.2)
        m2 = client.get_metrics(node)
        print("after submit:", m2)

        # 4) wait for completion and re-check
        time.sleep(1.3)
        m3 = client.get_metrics(node)
        print("after done:", m3)
        print()

if __name__ == "__main__":
    main()
