import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";

@Entity({ tableName: "user_node_group_selection" })
@Unique({ properties: ["userId"] })
export class UserNodeGroupSelection {
  @PrimaryKey()
  id!: number;

  @Property({ fieldName: "user_id", length: 128 })
  userId!: string;

  @Property({ fieldName: "user_email", length: 255, nullable: true })
  userEmail?: string;

  @Property({ type: "json", fieldName: "group_ids" })
  groupIds: number[] = [];

  @Property({ type: "Date", defaultRaw: "now()", fieldName: "updated_at" })
  updatedAt: Date = new Date();
}
