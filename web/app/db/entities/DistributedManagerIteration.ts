import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "distributed_manager_iteration" })
export class DistributedManagerIteration {
  @PrimaryKey()
  id!: number;

  @Property({ length: 128 })
  userId!: string;

  @Property({ length: 128, nullable: true })
  runId?: string;

  @Property({ type: "int" })
  iteration!: number;

  @Property({ length: 128 })
  policyName!: string;

  @Property({ length: 128 })
  nodeName!: string;

  @Property({ length: 128 })
  targetHost!: string;

  @Property({ type: "int" })
  targetPort!: number;

  @Property({ type: "boolean", default: true })
  success!: boolean;

  @Property({ type: "int" })
  latencyMs!: number;

  @Property({ length: 128, nullable: true })
  learnerArm?: string;

  @Property({ type: "int", nullable: true })
  sampleCount?: number;

  @Property({ type: "float", nullable: true })
  hValue?: number;

  @Property({ type: "float", nullable: true })
  qValue?: number;

  @Property({ type: "json", default: {} })
  metadata: Record<string, unknown> = {};

  @Property({ type: "Date", defaultRaw: "now()" })
  createdAt: Date = new Date();
}
