import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "vm_info" })
export class VmInfo {
  @PrimaryKey()
  id!: number;

  @Property({ length: 128 })
  name!: string;

  @Property({ length: 128, default: "127.0.0.1" })
  host!: string;

  @Property({ type: "int", default: 8001 })
  port!: number;

  @Property({ type: "float", default: 0 })
  cpuUsage!: number;

  @Property({ type: "int", default: 0 })
  cpuCores!: number;

  @Property({ type: "int", default: 0 })
  memoryMb!: number;

  @Property({ type: "int", default: 0 })
  diskGb!: number;
}