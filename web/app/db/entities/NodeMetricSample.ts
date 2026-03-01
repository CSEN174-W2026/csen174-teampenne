import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "node_metric_sample" })
export class NodeMetricSample {
  @PrimaryKey()
  id!: number;

  @Property({ length: 128, fieldName: "node_name" })
  nodeName!: string;

  @Property({ length: 128 })
  host!: string;

  @Property({ type: "int" })
  port!: number;

  @Property({ type: "int", nullable: true })
  cpus?: number;

  @Property({ type: "int", nullable: true, fieldName: "memory_mb" })
  memoryMb?: number;

  @Property({ type: "float", nullable: true, fieldName: "cpu_pct" })
  cpuPct?: number;

  @Property({ type: "float", nullable: true, fieldName: "mem_pct" })
  memPct?: number;

  @Property({ type: "int", nullable: true, fieldName: "queue_len" })
  queueLen?: number;

  @Property({ type: "int", nullable: true, fieldName: "in_flight" })
  inFlight?: number;

  @Property({ type: "float", nullable: true, fieldName: "ewma_latency_ms" })
  ewmaLatencyMs?: number;

  @Property({ type: "float", nullable: true, fieldName: "p95_latency_ms" })
  p95LatencyMs?: number;

  @Property({ type: "int", nullable: true, fieldName: "completed_last60s" })
  completedLast60s?: number;

  @Property({ type: "float", nullable: true, fieldName: "node_speed" })
  nodeSpeed?: number;

  @Property({ type: "bigint", fieldName: "captured_at_ms" })
  capturedAtMs!: string;

  @Property({ length: 64, default: "backend_nodes_poll" })
  source!: string;

  @Property({ type: "json" })
  metadata: Record<string, unknown> = {};

  @Property({ type: "Date", defaultRaw: "now()", fieldName: "created_at" })
  createdAt: Date = new Date();
}
