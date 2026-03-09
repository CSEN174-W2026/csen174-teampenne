import { NextRequest, NextResponse } from "next/server";
import { getOrm } from "../../db/orm";
import { UserNodeGroup } from "../../db/entities/UserNodeGroup";
import { UserNodeGroupNode } from "../../db/entities/UserNodeGroupNode";

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

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId")?.trim();
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const orm = await getOrm();
    const em = orm.em.fork();
    const groups = await em.find(
      UserNodeGroup,
      { userId },
      { orderBy: { updatedAt: "desc" }, populate: ["nodes"] }
    );

    return NextResponse.json({
      rows: groups.map((g) => ({
        id: g.id,
        userId: g.userId,
        userEmail: g.userEmail ?? null,
        name: g.name,
        color: g.color,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        nodes: g.nodes.getItems().map((n) => ({
          id: n.id,
          nodeKey: n.nodeKey,
          nodeName: n.nodeName,
          host: n.host,
          port: n.port,
        })),
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const userEmail = typeof body.userEmail === "string" ? body.userEmail.trim() : undefined;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const color =
      typeof body.color === "string" && body.color.trim().length > 0 ? body.color.trim() : "#22d3ee";
    const nodes = sanitizeNodes(body.nodes);

    if (!userId || !name) {
      return NextResponse.json({ error: "userId and name are required" }, { status: 400 });
    }
    if (nodes.length === 0) {
      return NextResponse.json({ error: "At least one node is required" }, { status: 400 });
    }

    const orm = await getOrm();
    const em = orm.em.fork();

    const group = em.create(UserNodeGroup, {
      userId,
      userEmail,
      name,
      color,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    nodes.forEach((n) => {
      const child = em.create(UserNodeGroupNode, {
        group,
        nodeKey: n.nodeKey,
        nodeName: n.nodeName,
        host: n.host,
        port: n.port,
        createdAt: new Date(),
      });
      group.nodes.add(child);
    });

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
    const isDuplicate =
      message.toLowerCase().includes("unique") ||
      message.toLowerCase().includes("duplicate") ||
      message.includes("23505");
    if (isDuplicate) {
      return NextResponse.json(
        { error: "You already have a group with this name. Please choose a different name." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
