import { NextRequest, NextResponse } from "next/server";
import { getOrm } from "../../db/orm";
import { VmInfo } from "../../db/entities/VmInfo";

const PY_BASE = process.env.PY_AGENT_BASE_URL ?? "http://127.0.0.1:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Load VM rows from DB (or subset)
    const orm = await getOrm();
    const em = orm.em.fork();

    let vms: VmInfo[];
    if (Array.isArray(body.vmIds) && body.vmIds.length > 0) {
      vms = await em.find(VmInfo, { id: { $in: body.vmIds } as any });
    } else {
      vms = await em.find(VmInfo, {});
    }

    const nodes = vms.map((vm) => ({
      name: vm.name,
      host: vm.host,
      port: vm.port,
      cpus: vm.cpuCores,
      memory_mb: vm.memoryMb,
    }));

    const payload = {
      goal_kind: body.goalKind ?? "min_mean_latency",
      learner_kind: body.learnerKind ?? "ema",
      policy_pool: body.policyPool ?? ["random", "round_robin", "least_loaded"],
      learner_kwargs: body.learnerKwargs ?? {},
      goal_kwargs: body.goalKwargs ?? {},
      workload: body.workload ?? { kind: "heavy_tail", jobs: 200, seed: 42, sla_threshold_ms: 100 },
      nodes,
      poll_interval_ms: body.pollIntervalMs ?? 50,
      job_timeout_ms: body.jobTimeoutMs ?? 15000,
    };

    const r = await fetch(`${PY_BASE}/runs/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const data = await r.json();
    if (!r.ok) return NextResponse.json({ error: data }, { status: r.status });

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const runId = req.nextUrl.searchParams.get("runId");
    if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

    const r = await fetch(`${PY_BASE}/runs/${runId}`, { cache: "no-store" });
    const data = await r.json();
    return NextResponse.json(data, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown error" }, { status: 500 });
  }
}