import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/core";
import type { Rel } from "@mikro-orm/core";
import type { UserNodeGroup } from "./UserNodeGroup";

@Entity({ tableName: "user_node_group_node" })
export class UserNodeGroupNode {
  @PrimaryKey()
  id!: number;

  @ManyToOne("UserNodeGroup", { fieldName: "group_id", deleteRule: "cascade" })
  group!: Rel<UserNodeGroup>;

  @Property({ fieldName: "node_key", length: 255 })
  nodeKey!: string;

  @Property({ fieldName: "node_name", length: 128 })
  nodeName!: string;

  @Property({ length: 128 })
  host!: string;

  @Property({ type: "int" })
  port!: number;

  @Property({ type: "Date", defaultRaw: "now()", fieldName: "created_at" })
  createdAt: Date = new Date();
}
