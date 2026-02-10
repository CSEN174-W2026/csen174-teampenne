from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Any, List
import time
import random

from api_models import RunConfig, RunStatusResponse
from state_types import JobRequest, NodeSnapshot
from node.node_client import NodeClient
from node.virtualbox import discover_nodes
from agent.agent import ManagerAgent

@dataclass
class RunState:
    run_id: str
    status: str
    total_jobs: int
    processed_jobs: int = 0
    summary: Dict[str, Any] = field(default_factory=dict)
    events: List[Dict[str, Any]] = field(default_factory=list)

    @classmethod
    def new(cls, run_id: str, cfg: RunConfig):
        return cls(run_id=run_id, status="running", total_jobs=cfg.workload.jobs)

    def to_response(self) -> RunStatusResponse:
        return RunStatusResponse(
            run_id=self.run_id,
            status=self.status,
            processed_jobs=self.processed_jobs,
            total_jobs=self.total_jobs,
            summary=self.summary,
            events=self.events[-200:],
        )

class RunEngine:
    def _make_nodes(self, cfg: RunConfig) -> List[NodeSnapshot]:
        if cfg.nodes:
            return [NodeSnapshot(**n.model_dump()) for n in cfg.nodes]
        return discover_nodes()

    def _sample_service_time_ms(self, rng: random.Random, kind: str) -> int:
        if kind == "tiny":
            return rng.randint(10, 80)
        if kind == "medium":
            return rng.randint(80, 300)
        if kind == "large":
            return rng.randint(500, 2000)
        # heavy_tail default
        p = rng.random()
        if p < 0.80:
            return rng.randint(10, 50)
        if p < 0.95:
            return rng.randint(50, 300)
        return rng.randint(500, 2000)

    def _wait_for_completion(self, client: NodeClient, node: NodeSnapshot, job_id: str, timeout_ms: int, poll_ms: int):
        deadline = time.time() + (timeout_ms / 1000.0)
        while time.time() < deadline:
            # node_worker already exposes /recent_jobs
            import requests
            url = f"http://{node.host}:{node.port}/recent_jobs?limit=200"
            r = requests.get(url, timeout=client.timeout_s)
            r.raise_for_status()
            jobs = r.json()
            for j in jobs:
                if j.get("job_id") == job_id:
                    return j
            time.sleep(poll_ms / 1000.0)
        return None

    def execute_run(self, run_id: str, cfg: RunConfig, runs: Dict[str, RunState]):
        st = runs[run_id]
        rng = random.Random(cfg.workload.seed)
        client = NodeClient(timeout_s=2.0)

        agent = ManagerAgent(
            learner_kind=cfg.learner_kind,
            goal_kind=cfg.goal_kind,
            learner_kwargs=cfg.learner_kwargs,
            goal_kwargs=cfg.goal_kwargs,
            policies=None,  # build_policies default
        )

        try:
            nodes_base = self._make_nodes(cfg)
            if not nodes_base:
                st.status = "failed"
                st.summary = {"error": "no nodes discovered/provided"}
                return

            for i in range(cfg.workload.jobs):
                live = []
                for n in nodes_base:
                    try:
                        live.append(client.get_metrics(n))
                    except Exception:
                        pass
                if not live:
                    st.status = "failed"
                    st.summary = {"error": "all nodes unreachable"}
                    return

                user = rng.choice(cfg.workload.users)
                svc = self._sample_service_time_ms(rng, cfg.workload.kind)

                job = JobRequest(
                    job_id=f"{run_id}-j{i}",
                    user_id=user,
                    service_time_ms=svc,
                    metadata={"class": "interactive" if svc < 100 else "batch"},
                )

                decision = agent.route(job, live)
                target = next(n for n in live if n.name == decision.node_name)
                client.submit_job(target, job)

                rec = self._wait_for_completion(
                    client, target, job.job_id, cfg.job_timeout_ms, cfg.poll_interval_ms
                )

                if rec is None:
                    outcome, reward = agent.observe(job.job_id, success=False, latency_ms=cfg.job_timeout_ms, extra={})
                    lat = cfg.job_timeout_ms
                else:
                    lat = float(rec.get("observed_latency_ms", cfg.job_timeout_ms))
                    outcome, reward = agent.observe(job.job_id, success=True, latency_ms=lat, extra=rec)

                sla = cfg.workload.sla_threshold_ms or 100
                st.events.append({
                    "idx": i,
                    "job_id": job.job_id,
                    "user_id": user,
                    "policy_name": outcome.policy_name,
                    "node_name": outcome.node_name,
                    "latency_ms": lat,
                    "reward": reward,
                    "sla_violation": lat > sla,
                    "metadata": job.metadata,
                })
                st.processed_jobs += 1

            # Final aggregate
            lats = sorted(e["latency_ms"] for e in st.events) if st.events else [0.0]
            n = len(lats)
            p95 = lats[int(0.95 * (n - 1))] if n > 1 else lats[0]
            mean = sum(lats) / max(n, 1)
            violations = sum(1 for e in st.events if e["sla_violation"])

            st.summary = {
                "mean_latency_ms": mean,
                "p95_latency_ms": p95,
                "sla_violations": violations,
                "viol_rate": violations / max(n, 1),
                "agent_summary": agent.summary(),
            }
            st.status = "completed"
        except Exception as ex:
            st.status = "failed"
            st.summary = {"error": str(ex)}