import React, { useEffect, useMemo, useRef, useState } from "react";
import { Move, Network, Server, ZoomIn, ZoomOut } from "lucide-react";
import {
  getNodeGroupSelection,
  getNodes,
  listNodeGroups,
  type NodeGroup,
  type NodeSnapshot,
} from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

type Point = { x: number; y: number };

export function Mesh() {
  const { user } = useAuth();
  const [nodes, setNodes] = useState<NodeSnapshot[]>([]);
  const [groups, setGroups] = useState<NodeGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
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

  useEffect(() => {
    if (!user?.id) {
      setGroups([]);
      setSelectedGroupIds([]);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const [g, s] = await Promise.all([listNodeGroups(user.id), getNodeGroupSelection(user.id)]);
        if (!active) return;
        setGroups(g.rows ?? []);
        setSelectedGroupIds(Array.isArray(s.row?.groupIds) ? s.row!.groupIds : []);
      } catch (e: unknown) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load group topology");
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const liveByAddr = useMemo(() => {
    const m = new Map<string, NodeSnapshot>();
    nodes.forEach((n) => {
      m.set(`${n.host}:${n.port}`, n);
    });
    return m;
  }, [nodes]);

  const activeGroups = useMemo(
    () => groups.filter((g) => selectedGroupIds.includes(g.id) && g.nodes.length > 0),
    [groups, selectedGroupIds]
  );

  useEffect(() => {
    if (activeGroupId == null) return;
    if (!activeGroups.some((g) => g.id === activeGroupId)) setActiveGroupId(null);
  }, [activeGroupId, activeGroups]);

  const groupViewNodes = useMemo(() => {
    return activeGroups.map((g) => {
      const online = g.nodes.filter((n) => liveByAddr.has(`${n.host}:${n.port}`)).length;
      return {
        id: `group-${g.id}`,
        groupId: g.id,
        name: g.name,
        color: g.color || "#22d3ee",
        nodeCount: g.nodes.length,
        onlineCount: online,
      };
    });
  }, [activeGroups, liveByAddr]);

  const activeGroup = useMemo(
    () => activeGroups.find((g) => g.id === activeGroupId) ?? null,
    [activeGroups, activeGroupId]
  );

  const detailNodes = useMemo(() => {
    if (!activeGroup) return [];
    return activeGroup.nodes.map((n, i) => {
      const live = liveByAddr.get(`${n.host}:${n.port}`);
      return {
        id: n.nodeKey || `${n.host}:${n.port}:${n.nodeName}:${i}`,
        name: n.nodeName,
        addr: `${n.host}:${n.port}`,
        cpu: Number(live?.cpu_pct ?? 0),
        mem: Number(live?.mem_pct ?? 0),
      };
    });
  }, [activeGroup, liveByAddr]);

  const renderItems = useMemo(() => {
    if (activeGroup) {
      return detailNodes.map((n) => ({ id: n.id, title: n.name }));
    }
    return groupViewNodes.map((g) => ({ id: g.id, title: g.name }));
  }, [activeGroup, detailNodes, groupViewNodes]);

  useEffect(() => {
    const w = 980;
    const h = 520;
    setPositions((prev) => {
      const next = { ...prev };
      renderItems.forEach((n, i) => {
        if (!next[n.id]) {
          const angle = (i / Math.max(1, renderItems.length)) * Math.PI * 2;
          const radius = activeGroup ? 180 + (i % 3) * 35 : 170 + (i % 4) * 30;
          next[n.id] = {
            x: w / 2 + Math.cos(angle) * radius,
            y: h / 2 + Math.sin(angle) * radius,
          };
        }
      });
      Object.keys(next).forEach((k) => {
        if (!renderItems.some((m) => m.id === k)) delete next[k];
      });
      return next;
    });
  }, [renderItems, activeGroup]);

  const detailEdges = useMemo(() => {
    if (!activeGroup || detailNodes.length < 2) return [];
    const out: Array<{ a: string; b: string; color: string }> = [];
    for (let i = 0; i < detailNodes.length - 1; i++) {
      out.push({ a: detailNodes[i].id, b: detailNodes[i + 1].id, color: activeGroup.color || "#22d3ee" });
    }
    if (detailNodes.length > 2) {
      out.push({
        a: detailNodes[0].id,
        b: detailNodes[detailNodes.length - 1].id,
        color: activeGroup.color || "#22d3ee",
      });
    }
    return out;
  }, [activeGroup, detailNodes]);

  const detailCircle = useMemo(() => {
    if (!activeGroup || detailNodes.length === 0) return null;
    const pts = detailNodes.map((n) => positions[n.id]).filter(Boolean) as Point[];
    if (pts.length === 0) return null;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const maxD = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
    return {
      cx,
      cy,
      r: Math.max(120, maxD + 85),
      color: activeGroup.color || "#22d3ee",
      name: activeGroup.name,
    };
  }, [activeGroup, detailNodes, positions]);

  useEffect(() => {
    if (!draggingId) return;
    const onMove = (ev: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(60, Math.min(rect.width - 60, (ev.clientX - rect.left) / zoom));
      const y = Math.max(50, Math.min(rect.height - 50, (ev.clientY - rect.top) / zoom));
      setPositions((p) => ({ ...p, [draggingId]: { x, y } }));
    };
    const onUp = () => setDraggingId(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingId, zoom]);

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
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))))}
              className="p-1.5 rounded border border-neutral-700 hover:bg-neutral-800"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => setZoom((z) => Math.min(2.5, Number((z + 0.1).toFixed(2))))}
              className="p-1.5 rounded border border-neutral-700 hover:bg-neutral-800"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <span className="text-xs text-neutral-400 w-12 text-right">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
        <p className="text-xs text-neutral-500 mb-3">
          {activeGroup
            ? `Group "${activeGroup.name}" detail view. Nodes in this group are connected to each other only.`
            : `Showing ${activeGroups.length} selected group(s). Click a group to inspect its internal node connections.`}
        </p>

        {!activeGroup && activeGroups.length === 0 ? (
          <div className="text-sm text-neutral-500">No selected groups yet. Select groups from the Nodes page.</div>
        ) : (
          <div
            ref={canvasRef}
            className="relative w-full h-[520px] rounded-xl bg-neutral-900 overflow-hidden"
          >
            {activeGroup ? (
              <button
                onClick={() => setActiveGroupId(null)}
                className="absolute top-3 left-3 z-10 text-xs px-2 py-1 rounded border border-neutral-700 hover:bg-neutral-800"
              >
                Back to Groups
              </button>
            ) : null}

            <div
              className="absolute inset-0 origin-top-left"
              style={{ transform: `scale(${zoom})`, width: `${100 / zoom}%`, height: `${100 / zoom}%` }}
            >
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                {detailCircle ? (
                  <g>
                    <circle
                      cx={detailCircle.cx}
                      cy={detailCircle.cy}
                      r={detailCircle.r}
                      fill="none"
                      stroke={detailCircle.color}
                      strokeOpacity="0.45"
                      strokeWidth="3"
                      strokeDasharray="8 8"
                    />
                    <text
                      x={detailCircle.cx}
                      y={detailCircle.cy - detailCircle.r - 10}
                      textAnchor="middle"
                      fill={detailCircle.color}
                      fontSize="11"
                    >
                      {detailCircle.name}
                    </text>
                  </g>
                ) : null}

                {detailEdges.map((e) => {
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
                      stroke={e.color}
                      strokeOpacity="0.75"
                      strokeWidth="2"
                    />
                  );
                })}
              </svg>

              {activeGroup
                ? detailNodes.map((n) => {
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
                  })
                : groupViewNodes.map((g) => {
                    const pos = positions[g.id] ?? { x: 140, y: 120 };
                    return (
                      <button
                        key={g.id}
                        className="absolute -translate-x-1/2 -translate-y-1/2 w-64 rounded-xl border bg-neutral-900 p-3 text-left shadow-[0_0_14px_rgba(34,211,238,0.35)] hover:shadow-[0_0_18px_rgba(34,211,238,0.55)] transition"
                        style={{ left: pos.x, top: pos.y, borderColor: `${g.color}99` }}
                        onClick={() => setActiveGroupId(g.groupId)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <Network className="w-4 h-4" style={{ color: g.color }} />
                            <span className="font-semibold text-sm">{g.name}</span>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300">
                            OPEN
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-400">Nodes: {g.nodeCount}</p>
                        <p className="text-[11px] text-neutral-400">Online: {g.onlineCount}</p>
                      </button>
                    );
                  })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
