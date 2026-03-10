# app/node_client.py
# The manager-side helper that talks to a node over HTTP
from __future__ import annotations

from dataclasses import asdict
from typing import Optional, Dict, Any

import requests

from app.state_types import NodeSnapshot, JobRequest


class NodeClient:
    def __init__(self, timeout_s: float = 1.5):
        self.timeout_s = timeout_s

    # Takes a node (containing host/port/etc) and returns a NodeSnapshot with updated metrics
    def get_metrics(self, node: NodeSnapshot) -> NodeSnapshot:
        url = f"http://{node.host}:{node.port}/metrics" # Build metrics endpoint URL
        r = requests.get(url, timeout=self.timeout_s) # Sends HTTP GET to the node
        r.raise_for_status()
        m = r.json() # Parse JSON response into a dict r

        # Creates a new NodeSnapshot
        return NodeSnapshot(
            name=node.name,
            host=node.host,
            port=node.port,
            instance_id=node.instance_id,
            region=node.region,
            cpus=node.cpus,
            memory_mb=node.memory_mb,
            cpu_pct=m.get("cpu_pct"),
            mem_pct=m.get("mem_pct"),
            queue_len=m.get("queue_len"),
            in_flight=m.get("in_flight"),
            ewma_latency_ms=m.get("ewma_latency_ms"),
            p95_latency_ms=m.get("p95_latency_ms"),
            completed_last_60s=m.get("completed_last_60s"),
            node_speed=m.get("node_speed"),
        )

    # Sends a job to a node, returns whatever JSON the node sent back
    def submit_job(self, node: NodeSnapshot, job: JobRequest) -> Dict[str, Any]:
        url = f"http://{node.host}:{node.port}/submit"

        # Compatibility: some node-worker versions require service_time_ms as
        # a positive int even for non-simulated jobs.
        raw_service_ms = getattr(job, "service_time_ms", None)
        try:
            service_ms = int(raw_service_ms) if raw_service_ms is not None else 1000
        except Exception:
            service_ms = 1000
        if service_ms <= 0:
            service_ms = 1000

        payload = {
            "job_id": job.job_id,
            "user_id": job.user_id,
            "service_time_ms": service_ms,
            "job_type": getattr(job, "job_type", "simulated"),
            "script_name": getattr(job, "script_name", None),
            "script_content": getattr(job, "script_content", None),
            "args": getattr(job, "args", []) or [],
            "timeout_s": getattr(job, "timeout_s", 60),
            "metadata": job.metadata or {},
        }

        # Attempt 1: full payload for modern node_worker.
        r = requests.post(url, json=payload, timeout=max(self.timeout_s, 10))
        if 200 <= r.status_code < 300:
            return r.json()

        if r.status_code == 422:
            # Attempt 2: drop args/timeout_s for slightly stricter schemas.
            compat_payload = {
                "job_id": job.job_id,
                "user_id": job.user_id,
                "service_time_ms": service_ms,
                "job_type": getattr(job, "job_type", "simulated"),
                "script_name": getattr(job, "script_name", None),
                "script_content": getattr(job, "script_content", None),
                "metadata": job.metadata or {},
            }
            r2 = requests.post(url, json=compat_payload, timeout=max(self.timeout_s, 10))
            if 200 <= r2.status_code < 300:
                return r2.json()

            # Attempt 3: legacy schema — exactly {job_id, user_id, service_time_ms, metadata}.
            # This matches the original vm-info branch node_worker that only had these 4 fields.
            if r2.status_code == 422:
                legacy_payload = {
                    "job_id": job.job_id,
                    "user_id": job.user_id,
                    "service_time_ms": service_ms,
                    "metadata": job.metadata or {},
                }
                r3 = requests.post(url, json=legacy_payload, timeout=max(self.timeout_s, 10))
                if 200 <= r3.status_code < 300:
                    return r3.json()
                detail = (r3.text or r2.text or r.text or "").strip()
                raise RuntimeError(
                    f"Node submit rejected (422) even with legacy payload. url={url} detail={detail}"
                )

            detail = (r2.text or r.text or "").strip()
            raise RuntimeError(
                f"Node submit rejected (422). url={url} detail={detail}"
            )

        # Non-422 errors: include node response body for diagnostics.
        detail = (r.text or "").strip()
        raise RuntimeError(
            f"Node submit failed status={r.status_code}. url={url} detail={detail}"
        )