# backend/run_vm_sim.py
import time
import random
from dataclasses import dataclass
from typing import List, Dict, Any

from app.node.node_client import NodeClient
from app.state_types import NodeSnapshot, JobRequest
from app.run_store import RunStore

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
            host="192.168.254.192",  # <-- your VM IP
            port=5001,
            cpus=3,
            memory_mb=8192,
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
    N = 30
    store = RunStore()
    run_id = f"vm-sim-{int(time.time())}"
    store.create_run(
        run_id=run_id,
        source="vm_sim",
        status="running",
        goal_kind="min_mean_latency",
        learner_kind="sample_average",
        config={
            "nodes": [n.__dict__ for n in nodes],
            "iterations": N,
            "policies": list(policies.keys()),
        },
        total_jobs=N,
    )

    client = NodeClient(timeout_s=3.0)

    # -----------------------------
    # 3) Simulation loop
    # -----------------------------
    processed = 0
    try:
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
            outcome, reward = agent.observe(job.job_id, success=success, latency_ms=latency_ms)

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

            store.append_job_event(
                run_id=run_id,
                idx=t - 1,
                job_id=job.job_id,
                user_id=job.user_id,
                policy_name=outcome.policy_name,
                node_name=outcome.node_name,
                target_host=chosen.host,
                target_port=chosen.port,
                success=success,
                latency_ms=float(latency_ms),
                reward=float(reward),
                sla_violation=None,
                metadata=job.metadata or {},
                decision_context=d.context or {},
                learner_stats=stats,
            )
            processed = t
            store.update_run_progress(run_id, processed)

        store.finalize_run(
            run_id=run_id,
            status="completed",
            processed_jobs=processed,
            summary=agent.summary(),
        )
    except Exception as ex:
        store.finalize_run(
            run_id=run_id,
            status="failed",
            processed_jobs=processed,
            summary={"error": str(ex)},
            error=str(ex),
        )
        raise
    print("\nDone.")


if __name__ == "__main__":
    main()
