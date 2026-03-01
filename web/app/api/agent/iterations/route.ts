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
  const iteration = Number(v.iteration);
  const targetPort = Number(v.targetPort);
  const latencyMs = Number(v.latencyMs);

  if (!Number.isInteger(iteration)) return null;
  if (!Number.isInteger(targetPort)) return null;
  if (!Number.isFinite(latencyMs)) return null;
  if (typeof v.policyName !== "string" || typeof v.nodeName !== "string" || typeof v.targetHost !== "string") {
    return null;
  }

  return {
    iteration,
    policyName: v.policyName,
    nodeName: v.nodeName,
    targetHost: v.targetHost,
    targetPort,
    success: typeof v.success === "boolean" ? v.success : true,
    latencyMs: Math.round(latencyMs),
    learnerArm: typeof v.learnerArm === "string" ? v.learnerArm : null,
    sampleCount: Number.isInteger(v.sampleCount) ? (v.sampleCount as number) : null,
    hValue: typeof v.hValue === "number" && Number.isFinite(v.hValue) ? v.hValue : null,
    qValue: typeof v.qValue === "number" && Number.isFinite(v.qValue) ? v.qValue : null,
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
