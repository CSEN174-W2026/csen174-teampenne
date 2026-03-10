#!/usr/bin/env python3
from __future__ import annotations

import argparse
import time
from typing import Any, Dict, List

import requests


def service_time_ms_from_cpu(cpu_intensity: int) -> int:
    # Keep this aligned with Simulation UI semantics.
    return max(50, int(150 + cpu_intensity * 12))


def get_live_nodes(manager_base_url: str, timeout_s: float) -> List[Dict[str, Any]]:
    res = requests.get(f"{manager_base_url.rstrip('/')}/nodes", timeout=timeout_s)
    res.raise_for_status()
    payload = res.json()
    nodes = payload.get("nodes") or []
    if not isinstance(nodes, list):
        return []
    return [n for n in nodes if isinstance(n, dict) and n.get("host") and n.get("port")]


def submit_spike_jobs_to_node(
    node: Dict[str, Any],
    cpu_intensity: int,
    jobs_per_node: int,
    timeout_s: float,
) -> Dict[str, Any]:
    host = node.get("host")
    port = node.get("port")
    node_name = node.get("name") or f"{host}:{port}"
    service_ms = service_time_ms_from_cpu(cpu_intensity)
    accepted = 0
    failed = 0

    for idx in range(jobs_per_node):
        job_id = f"spike_{int(time.time() * 1000)}_{node_name}_{idx}".replace(" ", "_")
        payload = {
            "job_id": job_id,
            "user_id": "spike-test",
            "service_time_ms": service_ms,
            "job_type": "simulated",
            "metadata": {
                "cpu_intensity": cpu_intensity,
                "spike": True,
                "source": "backend/app/tests/spike_nodes.py",
            },
        }
        try:
            r = requests.post(f"http://{host}:{port}/submit", json=payload, timeout=timeout_s)
            if 200 <= r.status_code < 300:
                accepted += 1
            else:
                failed += 1
        except Exception:
            failed += 1

    return {
        "name": node_name,
        "host": host,
        "port": port,
        "accepted": accepted,
        "failed": failed,
        "service_time_ms": service_ms,
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Send spike load to currently live simulation nodes using cpu_intensity."
    )
    p.add_argument(
        "--cpu-intensity",
        type=int,
        required=True,
        help="Used as spike job count (how many jobs to send in total).",
    )
    p.add_argument(
        "--manager-url",
        type=str,
        default="http://127.0.0.1:8000",
        help="Manager API base URL (default: http://127.0.0.1:8000).",
    )
    p.add_argument(
        "--timeout-s",
        type=float,
        default=3.0,
        help="Request timeout in seconds (default: 3.0).",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    cpu = max(1, min(100, int(args.cpu_intensity)))
    jobs_total = cpu

    print(f"[spike] manager={args.manager_url} cpu_intensity={cpu} jobs_total={jobs_total}")
    nodes = get_live_nodes(args.manager_url, args.timeout_s)
    if not nodes:
        print("[spike] no live nodes found from /nodes")
        return 1

    print(f"[spike] discovered {len(nodes)} node(s)")
    total_ok = 0
    total_fail = 0
    per_node = max(1, jobs_total // len(nodes))
    remainder = max(0, jobs_total % len(nodes))
    for i, n in enumerate(nodes):
        node_jobs = per_node + (1 if i < remainder else 0)
        result = submit_spike_jobs_to_node(n, cpu, node_jobs, args.timeout_s)
        total_ok += result["accepted"]
        total_fail += result["failed"]
        print(
            f"[spike] {result['name']} ({result['host']}:{result['port']}) "
            f"accepted={result['accepted']} failed={result['failed']} jobs={node_jobs} "
            f"service_time_ms={result['service_time_ms']}"
        )

    print(f"[spike] total accepted={total_ok} failed={total_fail}")
    return 0 if total_ok > 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
