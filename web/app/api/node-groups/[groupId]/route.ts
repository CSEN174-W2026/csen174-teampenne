import { NextRequest, NextResponse } from "next/server";
import { getOrm } from "../../../db/orm";
import { UserNodeGroup } from "../../../db/entities/UserNodeGroup";
import { UserNodeGroupNode } from "../../../db/entities/UserNodeGroupNode";

type NodeIn = {
  nodeKey: string;
  nodeName: string;
  host: string;
  port: number;
};

function sanitizeNodes(input: unknown): NodeIn[] {
  if (!Array.isArray(input)) return [];
  const out: NodeIn[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (
      typeof r.nodeKey !== "string" ||
      typeof r.nodeName !== "string" ||
      typeof r.host !== "string" ||
      !Number.isInteger(Number(r.port))
    ) {
      continue;
    }
    out.push({
      nodeKey: r.nodeKey.trim(),
      nodeName: r.nodeName.trim(),
      host: r.host.trim(),
      port: Number(r.port),
    });
  }
  return out;
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ groupId: string }> }) {
  try {
    const { groupId } = await ctx.params;
    const id = Number(groupId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid groupId" }, { status: 400 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const color = typeof body.color === "string" ? body.color.trim() : "";
    const nodes = sanitizeNodes(body.nodes);

    const orm = await getOrm();
    const em = orm.em.fork();
    const group = await em.findOne(UserNodeGroup, { id }, { populate: ["nodes"] });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    if (name) group.name = name;
    if (color) group.color = color;
    if (nodes.length > 0) {
      group.nodes.removeAll();
      nodes.forEach((n) => {
        group.nodes.add(
          em.create(UserNodeGroupNode, {
            group,
            nodeKey: n.nodeKey,
            nodeName: n.nodeName,
            host: n.host,
            port: n.port,
            createdAt: new Date(),
          })
        );
      });
    }
    group.updatedAt = new Date();

    await em.persistAndFlush(group);
    await em.populate(group, ["nodes"]);
    return NextResponse.json({
      row: {
        id: group.id,
        userId: group.userId,
        userEmail: group.userEmail ?? null,
        name: group.name,
        color: group.color,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        nodes: group.nodes.getItems().map((n) => ({
          id: n.id,
          nodeKey: n.nodeKey,
          nodeName: n.nodeName,
          host: n.host,
          port: n.port,
        })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ groupId: string }> }) {
  try {
    const { groupId } = await ctx.params;
    const id = Number(groupId);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid groupId" }, { status: 400 });
    }

    const orm = await getOrm();
    const em = orm.em.fork();
    const group = await em.findOne(UserNodeGroup, { id });
    if (!group) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }
    await em.removeAndFlush(group);
    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
