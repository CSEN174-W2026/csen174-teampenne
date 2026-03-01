import { Migration } from "@mikro-orm/migrations";

export class Migration20260301001000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "vm_info" add column if not exists "host" varchar(128) not null default '127.0.0.1';`);
    this.addSql(`alter table "vm_info" add column if not exists "port" integer not null default 8001;`);
    this.addSql(`alter table "vm_info" add column if not exists "is_active" boolean not null default true;`);
    this.addSql(`alter table "vm_info" add column if not exists "last_seen_at" timestamptz null;`);

    // Required for ON CONFLICT ("name") in run event ingestion.
    this.addSql(`create unique index if not exists "vm_info_name_unique_idx" on "vm_info" ("name");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "vm_info_name_unique_idx";`);
    this.addSql(`alter table "vm_info" drop column if exists "last_seen_at";`);
    this.addSql(`alter table "vm_info" drop column if exists "is_active";`);
    this.addSql(`alter table "vm_info" drop column if exists "port";`);
    this.addSql(`alter table "vm_info" drop column if exists "host";`);
  }
}
