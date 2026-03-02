import { NextRequest, NextResponse } from "next/server";
import { getOrm } from "../../../db/orm";
import { NodeMetricSample } from "../../../db/entities/NodeMetricSample";

type NodeSampleInput = {
  nodeName: string;
  host: string;
  port: number;
  cpus?: number | null;
  memoryMb?: number | null;
  cpuPct?: number | null;
  memPct?: number | null;
  queueLen?: number | null;
  inFlight?: number | null;
  ewmaLatencyMs?: number | null;
  p95LatencyMs?: number | null;
  completedLast60s?: number | null;
  nodeSpeed?: number | null;
  capturedAtMs: number;
  source?: string;
  metadata?: Record<string, unknown>;
};

function coerceSample(value: unknown): NodeSampleInput | null {
  if (!value || typeof value !== "object") return null;

  const v = value as Record<string, unknown>;
  if (typeof v.nodeName !== "string" || typeof v.host !== "string") return null;

  const port = Number(v.port);
  const capturedAtMs = Number(v.capturedAtMs);
  if (!Number.isInteger(port) || !Number.isFinite(capturedAtMs)) return null;

  const n = (k: string): number | null => {
    const raw = v[k];
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    return raw;
  };

  return {
    nodeName: v.nodeName,
    host: v.host,
    port,
    cpus: n("cpus"),
    memoryMb: n("memoryMb"),
    cpuPct: n("cpuPct"),
    memPct: n("memPct"),
    queueLen: n("queueLen"),
    inFlight: n("inFlight"),
    ewmaLatencyMs: n("ewmaLatencyMs"),
    p95LatencyMs: n("p95LatencyMs"),
    completedLast60s: n("completedLast60s"),
    nodeSpeed: n("nodeSpeed"),
    capturedAtMs,
    source: typeof v.source === "string" ? v.source : "backend_nodes_poll",
    metadata: typeof v.metadata === "object" && v.metadata !== null ? (v.metadata as Record<string, unknown>) : {},
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const rawSamples = Array.isArray(body.samples) ? body.samples : [];
    const samples = rawSamples.map(coerceSample).filter((s): s is NodeSampleInput => s !== null);

    if (samples.length === 0) {
      return NextResponse.json({ error: "No valid samples provided" }, { status: 400 });
    }

    const orm = await getOrm();
    const em = orm.em.fork();

    const rows = samples.map((s) =>
      em.create(NodeMetricSample, {
        nodeName: s.nodeName,
        host: s.host,
        port: s.port,
        cpus: s.cpus ?? undefined,
        memoryMb: s.memoryMb ?? undefined,
        cpuPct: s.cpuPct ?? undefined,
        memPct: s.memPct ?? undefined,
        queueLen: s.queueLen ?? undefined,
        inFlight: s.inFlight ?? undefined,
        ewmaLatencyMs: s.ewmaLatencyMs ?? undefined,
        p95LatencyMs: s.p95LatencyMs ?? undefined,
        completedLast60s: s.completedLast60s ?? undefined,
        nodeSpeed: s.nodeSpeed ?? undefined,
        capturedAtMs: String(Math.round(s.capturedAtMs)),
        source: s.source ?? "backend_nodes_poll",
        metadata: s.metadata ?? {},
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
    const limit = Math.max(1, Math.min(500, Number(req.nextUrl.searchParams.get("limit") ?? 100)));
    const orm = await getOrm();
    const em = orm.em.fork();

    const rows = await em.find(
      NodeMetricSample,
      {},
      { orderBy: { id: "desc" }, limit }
    );

    return NextResponse.json({ rows });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
