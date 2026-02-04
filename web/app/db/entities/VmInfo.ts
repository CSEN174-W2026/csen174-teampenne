import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "vm_info" })
export class VmInfo {
  @PrimaryKey()
  id!: number;

  @Property({ length: 128 })
  name!: string;

  @Property({ type: "float", default: 0 })
  cpuUsage!: number;

  @Property({ type: "int", default: 0 })
  cpuCores!: number;

  @Property({ type: "int", default: 0 })
  memoryMb!: number;

  @Property({ type: "int", default: 0 })
  diskGb!: number;

  @Property({ defaultRaw: "current_timestamp" })
  createdAt: Date = new Date();

  @Property({ defaultRaw: "current_timestamp", onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
