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

        payload = {
            "job_id": job.job_id,
            "user_id": job.user_id,
            "service_time_ms": getattr(job, "service_time_ms", None),
            "job_type": getattr(job, "job_type", "simulated"),
            "script_name": getattr(job, "script_name", None),
            "script_content": getattr(job, "script_content", None),
            "args": getattr(job, "args", []) or [],
            "timeout_s": getattr(job, "timeout_s", 60),
            "metadata": job.metadata or {},
        }

        r = requests.post(url, json=payload, timeout=max(self.timeout_s, 10))
        r.raise_for_status()
        return r.json()