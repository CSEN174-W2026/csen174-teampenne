import { Migration } from "@mikro-orm/migrations";

export class Migration20260226040500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "node_metric_sample" (
        "id" serial primary key,
        "node_name" varchar(128) not null,
        "host" varchar(128) not null,
        "port" integer not null,
        "cpus" integer null,
        "memory_mb" integer null,
        "cpu_pct" double precision null,
        "mem_pct" double precision null,
        "queue_len" integer null,
        "in_flight" integer null,
        "ewma_latency_ms" double precision null,
        "p95_latency_ms" double precision null,
        "completed_last60s" integer null,
        "node_speed" double precision null,
        "captured_at_ms" bigint not null,
        "source" varchar(64) not null default 'backend_nodes_poll',
        "metadata" jsonb not null default '{}'::jsonb,
        "created_at" timestamptz not null default now()
      );
    `);

    this.addSql(`
      create index if not exists "idx_node_metric_sample_node_time"
      on "node_metric_sample" ("node_name", "captured_at_ms");
    `);
    this.addSql(`
      create index if not exists "idx_node_metric_sample_source_time"
      on "node_metric_sample" ("source", "captured_at_ms");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "node_metric_sample";`);
  }
}
