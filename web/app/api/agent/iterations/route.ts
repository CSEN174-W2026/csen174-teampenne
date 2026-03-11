import { NextRequest, NextResponse } from "next/server";
import { getOrm } from "../../../db/orm";
import { DistributedManagerIteration } from "../../../db/entities/DistributedManagerIteration";

type IterationRecordInput = {
  iteration: number;
  policyName: string;
  nodeName: string;
  targetHost: string;
  targetPort: number;
  success: boolean;
  latencyMs: number;
  learnerArm?: string | null;
  sampleCount?: number | null;
  hValue?: number | null;
  qValue?: number | null;
  metadata?: Record<string, unknown>;
};

function pickString(v: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const x = v[k];
    if (typeof x === "string" && x.trim()) return x.trim();
  }
  return null;
}

function pickNumber(v: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const x = Number(v[k]);
    if (Number.isFinite(x)) return x;
  }
  return null;
}

function pickBoolean(v: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const k of keys) {
    const x = v[k];
    if (typeof x === "boolean") return x;
    if (typeof x === "string") {
      const s = x.trim().toLowerCase();
      if (s === "true") return true;
      if (s === "false") return false;
    }
    if (typeof x === "number") return x !== 0;
  }
  return null;
}

function parseOptionalNumber(value: string): number | null {
  if (value.toLowerCase() === "none") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseRawLog(rawLog: string): IterationRecordInput[] {
  const records: IterationRecordInput[] = [];
  const blockRegex = /---\s*iter\s+(\d+)\s*---([\s\S]*?)(?=(?:---\s*iter\s+\d+\s*---)|Done\.?$)/g;

  for (const match of rawLog.matchAll(blockRegex)) {
    const iteration = Number(match[1]);
    const block = match[2] ?? "";

    const decision = block.match(/decision:\s*policy=([^\s]+)\s+node=([^\s]+)\s+target=([^\s:]+):(\d+)/);
    const submit = block.match(/submit:\s*success=(True|False)\s+latency_ms=(\d+)/);
    const learner = block.match(/([a-zA-Z0-9_-]+):\s*n=(\d+)\s+h=([^\s]+)\s+Q=([^\s]+)/);

    if (!decision || !submit) continue;

    records.push({
      iteration,
      policyName: decision[1],
      nodeName: decision[2],
      targetHost: decision[3],
      targetPort: Number(decision[4]),
      success: submit[1] === "True",
      latencyMs: Number(submit[2]),
      learnerArm: learner?.[1] ?? null,
      sampleCount: learner ? Number(learner[2]) : null,
      hValue: learner ? parseOptionalNumber(learner[3]) : null,
      qValue: learner ? parseOptionalNumber(learner[4]) : null,
      metadata: {},
    });
  }

  return records;
}

function toRecordInput(value: unknown): IterationRecordInput | null {
  if (!value || typeof value !== "object") return null;

  const v = value as Record<string, unknown>;
  const iteration = pickNumber(v, "iteration");
  const targetPort = pickNumber(v, "targetPort", "target_port");
  const latencyMs = pickNumber(v, "latencyMs", "latency_ms");
  const policyName = pickString(v, "policyName", "policy_name");
  const nodeName = pickString(v, "nodeName", "node_name");
  const targetHost = pickString(v, "targetHost", "target_host");
  const success = pickBoolean(v, "success");
  const learnerArm = pickString(v, "learnerArm", "learner_arm");
  const sampleCount = pickNumber(v, "sampleCount", "sample_count");
  const hValue = pickNumber(v, "hValue", "h_value");
  const qValue = pickNumber(v, "qValue", "q_value");

  if (iteration == null || !Number.isInteger(iteration)) return null;
  if (targetPort == null || !Number.isInteger(targetPort)) return null;
  if (latencyMs == null || !Number.isFinite(latencyMs)) return null;
  if (!policyName || !nodeName || !targetHost) {
    return null;
  }

  return {
    iteration,
    policyName,
    nodeName,
    targetHost,
    targetPort,
    success: success ?? true,
    latencyMs: Math.round(latencyMs),
    learnerArm,
    sampleCount: sampleCount != null && Number.isInteger(sampleCount) ? sampleCount : null,
    hValue,
    qValue,
    metadata: typeof v.metadata === "object" && v.metadata !== null ? (v.metadata as Record<string, unknown>) : {},
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const runId = typeof body.runId === "string" ? body.runId.trim() : undefined;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    let records: IterationRecordInput[] = [];

    if (Array.isArray(body.records)) {
      records = body.records.map(toRecordInput).filter((v): v is IterationRecordInput => v !== null);
    } else if (typeof body.rawLog === "string") {
      records = parseRawLog(body.rawLog);
    } else {
      return NextResponse.json({ error: "Provide either records[] or rawLog" }, { status: 400 });
    }

    if (records.length === 0) {
      return NextResponse.json({ error: "No valid iteration records found" }, { status: 400 });
    }

    const orm = await getOrm();
    const em = orm.em.fork();

    const rows = records.map((record) =>
      em.create(DistributedManagerIteration, {
        userId,
        runId,
        iteration: record.iteration,
        policyName: record.policyName,
        nodeName: record.nodeName,
        targetHost: record.targetHost,
        targetPort: record.targetPort,
        success: record.success,
        latencyMs: record.latencyMs,
        learnerArm: record.learnerArm ?? undefined,
        sampleCount: record.sampleCount ?? undefined,
        hValue: record.hValue ?? undefined,
        qValue: record.qValue ?? undefined,
        metadata: record.metadata ?? {},
        createdAt: new Date(),
      })
    );

    await em.persistAndFlush(rows);

    return NextResponse.json({ inserted: rows.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = (req.nextUrl.searchParams.get("userId") ?? "").trim();
    const runId = (req.nextUrl.searchParams.get("runId") ?? "").trim();
    const limit = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 200), 2000));

    const orm = await getOrm();
    const em = orm.em.fork();
    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (runId) where.runId = runId;

    const rows = await em.find(
      DistributedManagerIteration,
      where,
      {
        orderBy: { createdAt: "desc" },
        limit,
      }
    );
    return NextResponse.json({ rows, count: rows.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
