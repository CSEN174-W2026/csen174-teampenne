import { NextRequest, NextResponse } from "next/server";
import { getOrm } from "../../../db/orm";
import { UserNodeGroupSelection } from "../../../db/entities/UserNodeGroupSelection";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId")?.trim();
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const orm = await getOrm();
    const em = orm.em.fork();
    const row = await em.findOne(UserNodeGroupSelection, { userId });
    return NextResponse.json({
      row: row
        ? {
            id: row.id,
            userId: row.userId,
            userEmail: row.userEmail ?? null,
            groupIds: Array.isArray(row.groupIds) ? row.groupIds : [],
            updatedAt: row.updatedAt,
          }
        : null,
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
    const groupIds = Array.isArray(body.groupIds)
      ? body.groupIds.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0)
      : [];

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const orm = await getOrm();
    const em = orm.em.fork();
    let row = await em.findOne(UserNodeGroupSelection, { userId });
    if (!row) {
      row = em.create(UserNodeGroupSelection, {
        userId,
        userEmail,
        groupIds,
        updatedAt: new Date(),
      });
    } else {
      row.userEmail = userEmail ?? row.userEmail;
      row.groupIds = groupIds;
      row.updatedAt = new Date();
    }

    await em.persistAndFlush(row);
    return NextResponse.json({
      row: {
        id: row.id,
        userId: row.userId,
        userEmail: row.userEmail ?? null,
        groupIds: row.groupIds,
        updatedAt: row.updatedAt,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
