import { Migration } from "@mikro-orm/migrations";

export class Migration20260306100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "user_node_group" (
        "id" serial primary key,
        "user_id" varchar(128) not null,
        "user_email" varchar(255) null,
        "name" varchar(128) not null,
        "color" varchar(32) not null default '#22d3ee',
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now()
      );
    `);
    this.addSql(`
      create unique index if not exists "user_node_group_user_id_name_unique_idx"
      on "user_node_group" ("user_id", "name");
    `);
    this.addSql(`
      create index if not exists "user_node_group_user_id_idx"
      on "user_node_group" ("user_id");
    `);

    this.addSql(`
      create table if not exists "user_node_group_node" (
        "id" serial primary key,
        "group_id" int not null,
        "node_key" varchar(255) not null,
        "node_name" varchar(128) not null,
        "host" varchar(128) not null,
        "port" int not null,
        "created_at" timestamptz not null default now(),
        constraint "user_node_group_node_group_id_fk"
          foreign key ("group_id")
          references "user_node_group" ("id")
          on update cascade
          on delete cascade
      );
    `);
    this.addSql(`
      create index if not exists "user_node_group_node_group_id_idx"
      on "user_node_group_node" ("group_id");
    `);
    this.addSql(`
      create unique index if not exists "user_node_group_node_group_id_node_key_unique_idx"
      on "user_node_group_node" ("group_id", "node_key");
    `);

    this.addSql(`
      create table if not exists "user_node_group_selection" (
        "id" serial primary key,
        "user_id" varchar(128) not null,
        "user_email" varchar(255) null,
        "group_ids" jsonb not null default '[]',
        "updated_at" timestamptz not null default now()
      );
    `);
    this.addSql(`
      create unique index if not exists "user_node_group_selection_user_id_unique_idx"
      on "user_node_group_selection" ("user_id");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "user_node_group_selection" cascade;`);
    this.addSql(`drop table if exists "user_node_group_node" cascade;`);
    this.addSql(`drop table if exists "user_node_group" cascade;`);
  }
}
