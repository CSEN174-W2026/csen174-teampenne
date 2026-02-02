# controller.py
import time
from virtualbox import discover_nodes
from node_client import NodeClient

POLL_S = 2.0

def main():
    client = NodeClient(timeout_s=2.0)

    while True:
        nodes = discover_nodes()
        if not nodes:
            print("No nodes discovered.")
            time.sleep(POLL_S)
            continue

        snaps = []
        for n in nodes:
            try:
                snaps.append(client.get_metrics(n))
            except Exception as e:
                print(f"[WARN] {n.name} metrics failed: {e}")

        print("\n--- cluster snapshot ---")
        for s in snaps:
            print(f"{s.name:12} cpu={s.cpu_pct:5} mem={s.mem_pct:5} "
                  f"q={s.queue_len} inflight={s.in_flight} p95={s.p95_latency_ms}")
        time.sleep(POLL_S)

if __name__ == "__main__":
    main()
