import sqlite3

from app.run_store import RunStore


def test_run_store_persists_run_and_events(tmp_path):
    db_path = tmp_path / "manager_runs.db"
    store = RunStore(str(db_path))

    store.create_run(
        run_id="r1",
        source="test",
        status="running",
        goal_kind="min_mean_latency",
        learner_kind="sample_average",
        config={"k": "v"},
        total_jobs=2,
    )
    store.append_job_event(
        run_id="r1",
        idx=0,
        job_id="j1",
        user_id="u1",
        policy_name="single_node",
        node_name="n1",
        target_host="127.0.0.1",
        target_port=5001,
        success=True,
        latency_ms=4.0,
        reward=-4.0,
        sla_violation=False,
        metadata={"iter": 1},
        decision_context={"avg_load": 0.0},
        learner_stats={"single_node": {"n": 1, "Q": -4.0}},
    )
    store.update_run_progress("r1", 1)
    store.finalize_run(
        run_id="r1",
        status="completed",
        processed_jobs=1,
        summary={"mean_latency_ms": 4.0},
    )

    conn = sqlite3.connect(str(db_path))
    run = conn.execute(
        "SELECT status, processed_jobs FROM manager_runs WHERE run_id = ?",
        ("r1",),
    ).fetchone()
    event = conn.execute(
        "SELECT job_id, policy_name, latency_ms, success FROM manager_job_events WHERE run_id = ?",
        ("r1",),
    ).fetchone()
    conn.close()

    assert run == ("completed", 1)
    assert event == ("j1", "single_node", 4.0, 1)


def test_run_store_reads_structured_payloads(tmp_path):
    db_path = tmp_path / "manager_runs.db"
    store = RunStore(str(db_path))
    store.create_run(run_id="r2", source="test", config={"a": 1}, total_jobs=1)
    store.append_job_event(
        run_id="r2",
        idx=0,
        job_id="j1",
        user_id="u1",
        policy_name="single_node",
        node_name="n1",
        target_host="127.0.0.1",
        target_port=5001,
        success=False,
        latency_ms=10.0,
        reward=-10.0,
        sla_violation=True,
        metadata={"iter": 1},
        decision_context={"avg_load": 0.1},
        learner_stats={"single_node": {"n": 1}},
    )

    run = store.get_run("r2")
    events = store.get_run_events("r2", limit=10)

    assert run is not None
    assert run["config"] == {"a": 1}
    assert len(events) == 1
    assert events[0]["metadata"] == {"iter": 1}
    assert events[0]["decision_context"] == {"avg_load": 0.1}
    assert events[0]["learner_stats"] == {"single_node": {"n": 1}}
