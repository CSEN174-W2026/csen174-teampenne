import { Collection, Entity, OneToMany, PrimaryKey, Property, Unique } from "@mikro-orm/core";

@Entity({ tableName: "user_node_group" })
@Unique({ properties: ["userId", "name"] })
export class UserNodeGroup {
  @PrimaryKey()
  id!: number;

  @Property({ fieldName: "user_id", length: 128 })
  userId!: string;

  @Property({ fieldName: "user_email", length: 255, nullable: true })
  userEmail?: string;

  @Property({ length: 128 })
  name!: string;

  @Property({ length: 32, default: "#22d3ee" })
  color: string = "#22d3ee";

  @Property({ type: "Date", defaultRaw: "now()", fieldName: "created_at" })
  createdAt: Date = new Date();

  @Property({ type: "Date", defaultRaw: "now()", fieldName: "updated_at" })
  updatedAt: Date = new Date();

  @OneToMany("UserNodeGroupNode", (node: any) => node.group, { orphanRemoval: true })
  nodes = new Collection<any>(this);
}
