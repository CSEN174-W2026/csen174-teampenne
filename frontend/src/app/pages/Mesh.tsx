import { useEffect, useMemo, useRef, useState } from "react";
import { Move, Network, Server } from "lucide-react";
import { getNodes, type NodeSnapshot } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

type Point = { x: number; y: number };

export function Mesh() {
  const { user } = useAuth();
  const [nodes, setNodes] = useState<NodeSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await getNodes();
        if (!active) return;
        setNodes(res.nodes ?? []);
        setError(null);
      } catch (e: unknown) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load nodes");
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const mapped = useMemo(
    () =>
      nodes.map((n, i) => ({
        id: `${n.host}:${n.port}:${n.name ?? i}`,
        name: n.name ?? `node-${i + 1}`,
        addr: `${n.host}:${n.port}`,
        cpu: Number(n.cpu_pct ?? 0),
        mem: Number(n.mem_pct ?? 0),
        host: n.host ?? "",
      })),
    [nodes]
  );

  const groupedEdges = useMemo(() => {
    const bySubnet: Record<string, string[]> = {};
    for (const n of mapped) {
      const parts = n.host.split(".");
      const subnet = parts.length >= 3 ? `${parts[0]}.${parts[1]}.${parts[2]}` : "other";
      if (!bySubnet[subnet]) bySubnet[subnet] = [];
      bySubnet[subnet].push(n.id);
    }
    const edges: Array<{ a: string; b: string }> = [];
    Object.values(bySubnet).forEach((ids) => {
      for (let i = 0; i < ids.length - 1; i++) {
        edges.push({ a: ids[i], b: ids[i + 1] });
      }
      if (ids.length > 2) edges.push({ a: ids[0], b: ids[ids.length - 1] });
    });
    return edges;
  }, [mapped]);

  useEffect(() => {
    const w = 980;
    const h = 520;
    setPositions((prev) => {
      const next = { ...prev };
      mapped.forEach((n, i) => {
        if (!next[n.id]) {
          const angle = (i / Math.max(1, mapped.length)) * Math.PI * 2;
          const radius = 180 + (i % 3) * 40;
          next[n.id] = {
            x: w / 2 + Math.cos(angle) * radius,
            y: h / 2 + Math.sin(angle) * radius,
          };
        }
      });
      Object.keys(next).forEach((k) => {
        if (!mapped.some((m) => m.id === k)) delete next[k];
      });
      return next;
    });
  }, [mapped]);

  useEffect(() => {
    if (!draggingId) return;
    const onMove = (ev: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(60, Math.min(rect.width - 60, ev.clientX - rect.left));
      const y = Math.max(50, Math.min(rect.height - 50, ev.clientY - rect.top));
      setPositions((p) => ({ ...p, [draggingId]: { x, y } }));
    };
    const onUp = () => setDraggingId(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Mesh</h1>
        <p className="text-neutral-400 mt-1">
          Node mesh view for <span className="text-neutral-200">{user?.email ?? "current user"}</span>.
        </p>
        {error ? <p className="text-sm text-rose-400 mt-2">{error}</p> : null}
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Network className="w-5 h-5 text-cyan-300" />
          <h2 className="font-semibold">Live Node Topology</h2>
        </div>

        {mapped.length === 0 ? (
          <div className="text-sm text-neutral-500">No nodes discovered yet.</div>
        ) : (
          <div
            ref={canvasRef}
            className="relative w-full h-[520px] rounded-xl bg-neutral-900 overflow-hidden"
          >
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {groupedEdges.map((e) => {
                const a = positions[e.a];
                const b = positions[e.b];
                if (!a || !b) return null;
                return (
                  <line
                    key={`${e.a}-${e.b}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="rgba(34, 211, 238, 0.7)"
                    strokeWidth="2"
                  />
                );
              })}
            </svg>

            {mapped.map((n) => {
              const pos = positions[n.id] ?? { x: 120, y: 120 };
              return (
                <div
                  key={n.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2 w-56 rounded-xl border border-cyan-300/80 bg-neutral-900 p-3 cursor-grab active:cursor-grabbing select-none shadow-[0_0_14px_rgba(34,211,238,0.55)]"
                  style={{ left: pos.x, top: pos.y }}
                  onMouseDown={() => setDraggingId(n.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-cyan-300" />
                      <span className="font-medium text-sm">{n.name}</span>
                    </div>
                    <Move className="w-3 h-3 text-cyan-300/70" />
                  </div>
                  <p className="text-[11px] text-neutral-500">{n.addr}</p>
                  <p className="text-[11px] text-neutral-300 mt-1">CPU: {n.cpu.toFixed(1)}%</p>
                  <p className="text-[11px] text-neutral-300">Memory: {n.mem.toFixed(1)}%</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
