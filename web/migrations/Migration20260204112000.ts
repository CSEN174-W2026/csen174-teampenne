import { Migration } from "@mikro-orm/migrations";

export class Migration20260204112000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "vm_info" (' +
        '"id" serial primary key, ' +
        '"name" varchar(128) not null, ' +
        '"cpu_usage" double precision not null default 0, ' +
        '"cpu_cores" integer not null default 0, ' +
        '"memory_mb" integer not null default 0, ' +
        '"disk_gb" integer not null default 0, ' +
        '"created_at" timestamp not null default now(), ' +
        '"updated_at" timestamp not null default now()' +
      ");"
    );
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "vm_info";');
  }
}
