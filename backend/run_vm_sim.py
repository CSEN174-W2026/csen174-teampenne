# backend/run_vm_sim.py
import time
import random
from dataclasses import dataclass
from typing import List, Dict, Any

from app.node.node_client import NodeClient
from app.state_types import NodeSnapshot, JobRequest

# NOTE: your file path in the screenshot shows manager_agent.py, but you were importing ManagerAgent before.
# Use whichever actually exists in YOUR repo:
# - if you have app.agent.manager_agent import ManagerAgent, use that
# - otherwise keep app.agent.agent import ManagerAgent
from app.agent.manager_agent import ManagerAgent  # change to: from app.agent.agent import ManagerAgent if needed


# A minimal policy that works with ManagerAgent calling choose_node(nodes, job)
@dataclass
class SingleNodePolicy:
    name: str = "single_node"

    def choose_node(self, nodes: List[NodeSnapshot], job: JobRequest) -> NodeSnapshot:
        # With one VM, always pick the only node.
        return nodes[0]


def main():
    # -----------------------------
    # 1) Configure your ONE VM here
    # -----------------------------
    nodes: List[NodeSnapshot] = [
        NodeSnapshot(
            name="n1",
            host="192.168.1.61", 
            port=5001,
            cpus=2,
            memory_mb=2048,
        )
    ]

    # -----------------------------
    # 2) Agent + policy setup
    # -----------------------------
    policies: Dict[str, Any] = {
        "single_node": SingleNodePolicy()
    }

    agent = ManagerAgent(
        learner_kind="sample_average",
        goal_kind="min_mean_latency",
        policies=policies,
    )

    client = NodeClient(timeout_s=3.0)

    # -----------------------------
    # 3) Simulation loop
    # -----------------------------
    N = 30
    for t in range(1, N + 1):
        # (Optional) refresh node metrics so route() has up-to-date info
        try:
            nodes = [client.get_metrics(nodes[0])]
        except Exception as e:
            print(f"[warn] metrics fetch failed: {e}")

        job = JobRequest(
            job_id=f"job-{t}",
            user_id="u1",
            service_time_ms=random.randint(50, 250),
            metadata={"iter": t},
        )

        # Decide
        d = agent.route(job, nodes)
        chosen = nodes[0]  # only one VM

        # Dispatch + measure real latency
        start = time.perf_counter()
        success = True
        try:
            _resp = client.submit_job(chosen, job)
        except Exception as e:
            success = False
            _resp = {"error": str(e)}
        latency_ms = int((time.perf_counter() - start) * 1000)

        # Learn
        agent.observe(job.job_id, success=success, latency_ms=latency_ms)

        # Print iteration details
        print(f"\n--- iter {t:02d} ---")
        print(f"decision: policy={d.policy_name} node={d.node_name} target={chosen.host}:{chosen.port}")
        print(f"submit:   success={success} latency_ms={latency_ms}")
        if not success:
            print(f"error:    {_resp}")

        stats = agent.learner_stats()
        print("learner_stats:")
        for p, s in stats.items():
            print(f"  {p}: n={s.get('n')} h={s.get('h')} Q={s.get('Q')}")

    print("\nDone.")


if __name__ == "__main__":
    main()
