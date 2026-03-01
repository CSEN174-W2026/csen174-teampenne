import { Migration } from "@mikro-orm/migrations";

export class Migration20260225183000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "distributed_manager_iteration" (
        "id" serial primary key,
        "user_id" varchar(128) not null,
        "run_id" varchar(128) null,
        "iteration" integer not null,
        "policy_name" varchar(128) not null,
        "node_name" varchar(128) not null,
        "target_host" varchar(128) not null,
        "target_port" integer not null,
        "success" boolean not null default true,
        "latency_ms" integer not null,
        "learner_arm" varchar(128) null,
        "sample_count" integer null,
        "h_value" double precision null,
        "q_value" double precision null,
        "metadata" jsonb not null default '{}'::jsonb,
        "created_at" timestamptz not null default now()
      );
    `);

    this.addSql(`
      create index if not exists "idx_dist_mgr_iter_user_created"
      on "distributed_manager_iteration" ("user_id", "created_at");
    `);
    this.addSql(`
      create index if not exists "idx_dist_mgr_iter_run_iter"
      on "distributed_manager_iteration" ("run_id", "iteration");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "distributed_manager_iteration";`);
  }
}
