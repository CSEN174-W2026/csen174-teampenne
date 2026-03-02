import { Migration } from '@mikro-orm/migrations';

export class Migration20260210065231 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "vm_info" (
        "id" serial primary key,
        "name" varchar(128) not null unique,
        "host" varchar(128) not null default '127.0.0.1',
        "port" integer not null default 8001,
        "cpu_cores" integer not null default 0,
        "memory_mb" integer not null default 0,
        "disk_gb" integer not null default 0,
        "is_active" boolean not null default true,
        "last_seen_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now()
      );
    `);

    this.addSql(`
      create table if not exists "agent_run" (
        "id" uuid primary key,
        "status" varchar(32) not null,
        "goal_kind" varchar(64) not null,
        "learner_kind" varchar(64) not null,
        "workload_kind" varchar(64) not null,
        "policy_pool" jsonb not null default '[]'::jsonb,
        "goal_kwargs" jsonb not null default '{}'::jsonb,
        "learner_kwargs" jsonb not null default '{}'::jsonb,
        "started_at" timestamptz not null default now(),
        "finished_at" timestamptz null,
        "summary" jsonb not null default '{}'::jsonb
      );
    `);

    this.addSql(`
      create table if not exists "agent_run_node" (
        "id" serial primary key,
        "run_id" uuid not null references "agent_run" ("id") on delete cascade,
        "vm_id" integer null references "vm_info" ("id") on delete set null,
        "node_name" varchar(128) not null,
        "host" varchar(128) not null,
        "port" integer not null,
        "cpus" integer null,
        "memory_mb" integer null
      );
    `);

    this.addSql(`
      create table if not exists "job_result" (
        "id" bigserial primary key,
        "run_id" uuid not null references "agent_run" ("id") on delete cascade,
        "job_id" varchar(128) not null,
        "user_id" varchar(128) not null,
        "job_class" varchar(64) null,
        "service_time_ms" integer not null,
        "policy_name" varchar(128) not null,
        "node_name" varchar(128) not null,
        "queued_at_ms" bigint null,
        "started_at_ms" bigint null,
        "finished_at_ms" bigint null,
        "observed_latency_ms" double precision not null,
        "sla_threshold_ms" integer null,
        "sla_violation" boolean not null default false,
        "reward" double precision not null default 0,
        "success" boolean not null default true,
        "metadata" jsonb not null default '{}'::jsonb,
        unique ("run_id", "job_id")
      );
    `);

    this.addSql(`
      create table if not exists "node_metric" (
        "id" bigserial primary key,
        "run_id" uuid not null references "agent_run" ("id") on delete cascade,
        "node_name" varchar(128) not null,
        "captured_at_ms" bigint not null,
        "cpu_pct" double precision null,
        "mem_pct" double precision null,
        "queue_len" integer null,
        "in_flight" integer null,
        "ewma_latency_ms" double precision null,
        "p95_latency_ms" double precision null,
        "completed_last_60s" integer null,
        "node_speed" double precision null
      );
    `);
    this.addSql(`
      create table if not exists "policy_arm_stat" (
        "id" bigserial primary key,
        "run_id" uuid not null references "agent_run" ("id") on delete cascade,
        "captured_at_ms" bigint not null,
        "policy_name" varchar(128) not null,
        "pull_count" integer not null default 0,
        "q_value" double precision not null default 0,
        "extra" jsonb not null default '{}'::jsonb
      );
    `);

    this.addSql(`create index if not exists "idx_job_result_run_id" on "job_result" ("run_id");`);
    this.addSql(`create index if not exists "idx_job_result_latency" on "job_result" ("run_id", "observed_latency_ms");`);
    this.addSql(`create index if not exists "idx_node_metric_run_time" on "node_metric" ("run_id", "captured_at_ms");`);
    this.addSql(`create index if not exists "idx_policy_arm_run_time" on "policy_arm_stat" ("run_id", "captured_at_ms");`);
  }

  override async down(): Promise<void> {      
    this.addSql(`drop table if exists "policy_arm_stat";`);
    this.addSql(`drop table if exists "node_metric";`);
    this.addSql(`drop table if exists "job_result";`);
    this.addSql(`drop table if exists "agent_run_node";`);
    this.addSql(`drop table if exists "agent_run";`);
    this.addSql(`drop table if exists "vm_info";`);
  }
}