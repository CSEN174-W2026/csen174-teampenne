from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


class RunStore:
    """
    Lightweight SQLite persistence for manager runs and per-job events.
    """

    def __init__(self, db_path: Optional[str] = None):
        default_path = Path(__file__).resolve().parents[1] / "data" / "manager_runs.db"
        self.db_path = db_path or os.getenv("MANAGER_DB_PATH", str(default_path))
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS manager_runs (
                    run_id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    status TEXT NOT NULL,
                    goal_kind TEXT,
                    learner_kind TEXT,
                    config_json TEXT,
                    total_jobs INTEGER,
                    processed_jobs INTEGER NOT NULL DEFAULT 0,
                    started_at_ms INTEGER NOT NULL,
                    finished_at_ms INTEGER,
                    summary_json TEXT,
                    error TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS manager_job_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    idx INTEGER,
                    job_id TEXT NOT NULL,
                    user_id TEXT,
                    policy_name TEXT,
                    node_name TEXT,
                    target_host TEXT,
                    target_port INTEGER,
                    success INTEGER,
                    latency_ms REAL,
                    reward REAL,
                    sla_violation INTEGER,
                    metadata_json TEXT,
                    decision_context_json TEXT,
                    learner_stats_json TEXT,
                    created_at_ms INTEGER NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES manager_runs(run_id)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_mgr_job_events_run_id ON manager_job_events(run_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_mgr_job_events_job_id ON manager_job_events(job_id)"
            )

    @staticmethod
    def _json(value: Optional[Dict[str, Any]]) -> Optional[str]:
        if value is None:
            return None
        return json.dumps(value, separators=(",", ":"), sort_keys=True)

    @staticmethod
    def _json_loads(value: Optional[str]) -> Optional[Dict[str, Any]]:
        if not value:
            return None
        return json.loads(value)

    @staticmethod
    def _now_ms() -> int:
        return int(time.time() * 1000)

    def create_run(
        self,
        *,
        run_id: str,
        source: str,
        status: str = "running",
        goal_kind: Optional[str] = None,
        learner_kind: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
        total_jobs: Optional[int] = None,
    ) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO manager_runs (
                    run_id, source, status, goal_kind, learner_kind, config_json,
                    total_jobs, processed_jobs, started_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    run_id,
                    source,
                    status,
                    goal_kind,
                    learner_kind,
                    self._json(config),
                    total_jobs,
                    self._now_ms(),
                ),
            )

    def update_run_progress(self, run_id: str, processed_jobs: int) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE manager_runs
                SET processed_jobs = ?
                WHERE run_id = ?
                """,
                (processed_jobs, run_id),
            )

    def append_job_event(
        self,
        *,
        run_id: str,
        idx: Optional[int],
        job_id: str,
        user_id: Optional[str],
        policy_name: Optional[str],
        node_name: Optional[str],
        target_host: Optional[str],
        target_port: Optional[int],
        success: Optional[bool],
        latency_ms: Optional[float],
        reward: Optional[float],
        sla_violation: Optional[bool],
        metadata: Optional[Dict[str, Any]] = None,
        decision_context: Optional[Dict[str, Any]] = None,
        learner_stats: Optional[Dict[str, Any]] = None,
    ) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO manager_job_events (
                    run_id, idx, job_id, user_id, policy_name, node_name, target_host,
                    target_port, success, latency_ms, reward, sla_violation,
                    metadata_json, decision_context_json, learner_stats_json, created_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    idx,
                    job_id,
                    user_id,
                    policy_name,
                    node_name,
                    target_host,
                    target_port,
                    int(success) if success is not None else None,
                    latency_ms,
                    reward,
                    int(sla_violation) if sla_violation is not None else None,
                    self._json(metadata),
                    self._json(decision_context),
                    self._json(learner_stats),
                    self._now_ms(),
                ),
            )

    def finalize_run(
        self,
        *,
        run_id: str,
        status: str,
        processed_jobs: int,
        summary: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
    ) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE manager_runs
                SET status = ?, processed_jobs = ?, finished_at_ms = ?, summary_json = ?, error = ?
                WHERE run_id = ?
                """,
                (
                    status,
                    processed_jobs,
                    self._now_ms(),
                    self._json(summary),
                    error,
                    run_id,
                ),
            )

    def get_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    run_id, source, status, goal_kind, learner_kind, config_json,
                    total_jobs, processed_jobs, started_at_ms, finished_at_ms,
                    summary_json, error
                FROM manager_runs
                WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
        if row is None:
            return None
        out = dict(row)
        out["config"] = self._json_loads(out.pop("config_json"))
        out["summary"] = self._json_loads(out.pop("summary_json"))
        return out

    def get_run_events(self, run_id: str, limit: int = 200) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 5000))
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    idx, job_id, user_id, policy_name, node_name, target_host, target_port,
                    success, latency_ms, reward, sla_violation,
                    metadata_json, decision_context_json, learner_stats_json, created_at_ms
                FROM manager_job_events
                WHERE run_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (run_id, safe_limit),
            ).fetchall()
        events: List[Dict[str, Any]] = []
        for row in reversed(rows):
            event = dict(row)
            event["success"] = None if event["success"] is None else bool(event["success"])
            event["sla_violation"] = (
                None if event["sla_violation"] is None else bool(event["sla_violation"])
            )
            event["metadata"] = self._json_loads(event.pop("metadata_json")) or {}
            event["decision_context"] = self._json_loads(event.pop("decision_context_json")) or {}
            event["learner_stats"] = self._json_loads(event.pop("learner_stats_json")) or {}
            events.append(event)
        return events
