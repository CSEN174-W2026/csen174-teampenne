import { NextRequest, NextResponse } from "next/server";
import { getOrm } from "../../../db/orm";

type NodeConfig = {
  name: string;
  host: string;
  port: number;
  cpus?: number | null;
  memory_mb?: number | null;
};

type RunStartedEvent = {
  kind: "run_started";
  runId: string;
  config: {
    goal_kind: string;
    learner_kind: string;
    policy_pool?: string[];
    learner_kwargs?: Record<string, unknown>;
    goal_kwargs?: Record<string, unknown>;
    workload?: { kind?: string };
  };
  nodes: NodeConfig[];
};

type IterationEvent = {                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      
  kind: "iteration";
  runId: string;
  idx: number;
  job: {
    job_id: string;
    user_id: string;
    service_time_ms: number;
    metadata?: Record<string, unknown>;
  };
  outcome: {
    policy_name: string;
    node_name: string;
    success: boolean;
  };
  target: {
    host: string;
    port: number;
  };
  latency_ms: number;
  reward: number;
  sla_threshold_ms?: number | null;
  sla_violation: boolean;
  learner_stats?: Record<string, { n?: number; Q?: number; h?: number | null }>;
  live_nodes?: Array<{
    name: string;
    cpu_pct?: number | null;
    mem_pct?: number | null;
    queue_len?: number | null;
    in_flight?: number | null;
    ewma_latency_ms?: number | null;
    p95_latency_ms?: number | null;
    completed_last_60s?: number | null;
    node_speed?: number | null;
  }>;
  captured_at_ms?: number;
};

type RunFinishedEvent = {
  kind: "run_finished";
  runId: string;
  status: string;
  summary?: Record<string, unknown>;
};

type RunEventPayload = RunStartedEvent | IterationEvent | RunFinishedEvent;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as unknown;
    if (!isObject(body) || typeof body.kind !== "string" || typeof body.runId !== "string") {
      return NextResponse.json({ error: "Invalid run event payload" }, { status: 400 });
    }

    const event = body as RunEventPayload;
    const orm = await getOrm();
    const em = orm.em.fork();
    const conn = em.getConnection();

    if (event.kind === "run_started") {
      const nodes = Array.isArray(event.nodes) ? event.nodes : [];
      for (const n of nodes) {
        await conn.execute(
          `
          insert into "vm_info" ("name","host","port","cpu_cores","memory_mb","is_active","last_seen_at","created_at","updated_at")
          values (?, ?, ?, ?, ?, true, now(), now(), now())
          on conflict ("name") do update set
            "host" = excluded."host",
            "port" = excluded."port",
            "cpu_cores" = excluded."cpu_cores",
            "memory_mb" = excluded."memory_mb",
            "is_active" = true,
            "last_seen_at" = now(),
            "updated_at" = now()
          `,
          [n.name, n.host, n.port, n.cpus ?? 0, n.memory_mb ?? 0]
        );
      }

      await conn.execute(
        `
        insert into "agent_run" (
          "id","status","goal_kind","learner_kind","workload_kind",
          "policy_pool","goal_kwargs","learner_kwargs","started_at","summary"
        )
        values (?, 'running', ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, now(), '{}'::jsonb)
        on conflict ("id") do nothing
        `,
        [
          event.runId,
          event.config.goal_kind,
          event.config.learner_kind,
          event.config.workload?.kind ?? "heavy_tail",
          JSON.stringify(event.config.policy_pool ?? []),
          JSON.stringify(event.config.goal_kwargs ?? {}),
          JSON.stringify(event.config.learner_kwargs ?? {}),
        ]
      );

      for (const n of nodes) {
        await conn.execute(
          `
          insert into "agent_run_node" ("run_id","vm_id","node_name","host","port","cpus","memory_mb")
          values (
            ?,
            (select "id" from "vm_info" where "name" = ? limit 1),
            ?, ?, ?, ?, ?
          )
          `,
          [event.runId, n.name, n.name, n.host, n.port, n.cpus ?? null, n.memory_mb ?? null]
        );
      }

      return NextResponse.json({ ok: true });
    }

    if (event.kind === "iteration") {
      await conn.execute(
        `
        insert into "job_result" (
          "run_id","job_id","user_id","job_class","service_time_ms",
          "policy_name","node_name","observed_latency_ms","sla_threshold_ms",
          "sla_violation","reward","success","metadata"
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
        on conflict ("run_id","job_id") do nothing
        `,
        [
          event.runId,
          event.job.job_id,
          event.job.user_id,
          typeof event.job.metadata?.class === "string" ? event.job.metadata.class : null,
          event.job.service_time_ms,
          event.outcome.policy_name,
          event.outcome.node_name,
          event.latency_ms,
          event.sla_threshold_ms ?? null,
          event.sla_violation,
          event.reward,
          event.outcome.success,
          JSON.stringify(event.job.metadata ?? {}),
        ]
      );

      const capturedAtMs = Math.round(event.captured_at_ms ?? Date.now());
      const liveNodes = Array.isArray(event.live_nodes) ? event.live_nodes : [];
      for (const n of liveNodes) {
        await conn.execute(
          `
          insert into "node_metric" (
            "run_id","node_name","captured_at_ms","cpu_pct","mem_pct","queue_len","in_flight",
            "ewma_latency_ms","p95_latency_ms","completed_last_60s","node_speed"
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            event.runId,
            n.name,
            capturedAtMs,
            n.cpu_pct ?? null,
            n.mem_pct ?? null,
            n.queue_len ?? null,
            n.in_flight ?? null,
            n.ewma_latency_ms ?? null,
            n.p95_latency_ms ?? null,
            n.completed_last_60s ?? null,
            n.node_speed ?? null,
          ]
        );
      }

      const learner = event.learner_stats ?? {};
      for (const [policyName, s] of Object.entries(learner)) {
        await conn.execute(
          `
          insert into "policy_arm_stat" ("run_id","captured_at_ms","policy_name","pull_count","q_value","extra")
          values (?, ?, ?, ?, ?, ?::jsonb)
          `,
          [
            event.runId,
            capturedAtMs,
            policyName,
            Number(s?.n ?? 0),
            Number(s?.Q ?? 0),
            JSON.stringify({ h: s?.h ?? null, idx: event.idx }),
          ]
        );
      }

      return NextResponse.json({ ok: true });
    }

    if (event.kind === "run_finished") {
      await conn.execute(
        `
        update "agent_run"
        set "status" = ?, "finished_at" = now(), "summary" = ?::jsonb
        where "id" = ?
        `,
        [event.status, JSON.stringify(event.summary ?? {}), event.runId]
      );
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unsupported event kind" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
