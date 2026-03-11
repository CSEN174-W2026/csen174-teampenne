import { NextRequest, NextResponse } from "next/server";
import { getOrm } from "../../../db/orm";

type VmSyncNode = {
  name: string;
  host: string;
  port?: number;
  cpus?: number;
  memoryMb?: number;
  isActive?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { nodes?: VmSyncNode[] };
    const nodes = Array.isArray(body?.nodes) ? body.nodes : [];
    if (nodes.length === 0) return NextResponse.json({ ok: true, upserted: 0 });

    const orm = await getOrm();
    const em = orm.em.fork();
    const conn = em.getConnection();

    let upserted = 0;
    for (const n of nodes) {
      const name = String(n?.name ?? "").trim();
      const host = String(n?.host ?? "").trim();
      if (!name || !host) continue;

      await conn.execute(
        `
        insert into "vm_info" ("name","host","port","cpu_cores","memory_mb","is_active","last_seen_at","created_at","updated_at")
        values (?, ?, ?, ?, ?, ?, now(), now(), now())
        on conflict ("name") do update set
          "host" = excluded."host",
          "port" = excluded."port",
          "cpu_cores" = excluded."cpu_cores",
          "memory_mb" = excluded."memory_mb",
          "is_active" = excluded."is_active",
          "last_seen_at" = now(),
          "updated_at" = now()
        `,
        [
          name,
          host,
          Number(n?.port ?? 5001),
          Number(n?.cpus ?? 0),
          Number(n?.memoryMb ?? 0),
          n?.isActive !== false,
        ]
      );
      upserted += 1;
    }

    return NextResponse.json({ ok: true, upserted });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

