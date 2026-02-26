import { useEffect, useMemo, useState } from "react";
import { Server, Search, Filter, HardDrive, Cpu, Wifi } from "lucide-react";
import { motion } from "motion/react";
import { getNodes, type NodeSnapshot } from "../../lib/api";

type StatusFilter = "all" | "online" | "offline";

function pct(x: any, fallback = 0) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

export function Nodes() {
  const [nodes, setNodes] = useState<NodeSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Poll /nodes
  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const data = await getNodes();
        if (!alive) return;
        setNodes(data.nodes ?? []);
        setError(null);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load nodes");
        setNodes([]);
      }
    }

    tick();
    const id = setInterval(tick, 2000);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Convert backend node snapshots -> UI model
  const uiNodes = useMemo(() => {
    return (nodes ?? []).map((n, i) => {
      const name = n.name ?? `node-${i + 1}`;
      const host = n.host ?? "unknown-host";
      const port = n.port ?? 0;

      const cpu = pct(n.cpu_pct);
      const mem = pct(n.mem_pct);

      // Optional storage (only if your node reports it)
      const storageRaw = (n as any).disk_pct ?? (n as any).storage_pct ?? null;
      const storage = storageRaw == null ? null : pct(storageRaw);

      // Online/offline heuristic:
      // If you later add { error: "..."} in backend, this will mark it offline.
      const online = !(n as any).error && (n.cpu_pct != null || n.mem_pct != null);

      const region = (n as any).region ?? "—";

      return {
        id: `${host}:${port}:${name}`,
        name,
        ip: port ? `${host}:${port}` : host,
        status: online ? "online" : "offline",
        cpu,
        mem,
        storage, // number | null
        region,
        lastSeen: n.time_ms ? new Date(n.time_ms).toLocaleString() : "—",
      };
    });
  }, [nodes]);

  // Search + filter
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return uiNodes.filter((n) => {
      const matchesQuery =
        !q ||
        n.name.toLowerCase().includes(q) ||
        n.ip.toLowerCase().includes(q) ||
        (n.region ?? "").toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "online" && n.status === "online") ||
        (statusFilter === "offline" && n.status === "offline");

      return matchesQuery && matchesStatus;
    });
  }, [uiNodes, query, statusFilter]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Nodes</h1>
          <p className="text-neutral-400 mt-1">
            Monitor and manage individual servers in your cluster.
          </p>
          {error ? <p className="text-sm text-rose-400 mt-2">{error}</p> : null}
        </div>

        <div>
          <button
            className="flex items-center gap-2 px-4 py-2 border border-neutral-800 rounded-lg text-sm font-medium hover:bg-neutral-900 transition-colors"
            onClick={() =>
              setStatusFilter((s) => (s === "all" ? "online" : s === "online" ? "offline" : "all"))
            }
            title="Toggle status filter"
          >
            <Filter className="w-4 h-4" />
            Filter: {statusFilter}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 bg-neutral-900/40 border border-neutral-800 rounded-2xl px-4 py-3">
        <Search className="w-4 h-4 text-neutral-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes by name, host, port, region..."
          className="w-full bg-transparent outline-none text-sm text-neutral-200 placeholder:text-neutral-600"
        />
        <span className="text-xs text-neutral-500">
          {filtered.length}/{uiNodes.length}
        </span>
      </div>

      {/* Node Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filtered.map((node) => (
          <motion.div
            key={node.id}
            whileHover={{ y: -4 }}
            className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-6 relative overflow-hidden group"
          >
            {/* Top row */}
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg ${
                    node.status === "online"
                      ? "bg-indigo-500/20 text-indigo-400"
                      : "bg-neutral-800 text-neutral-500"
                  }`}
                >
                  <Server className="w-5 h-5" />
                </div>

                <div>
                  <h3 className="font-bold text-white group-hover:text-indigo-400 transition-colors">
                    {node.name}
                  </h3>
                  <p className="text-xs text-neutral-500">
                    {node.ip} • {node.region}
                  </p>
                </div>
              </div>

              <div
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider ${
                  node.status === "online"
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-rose-500/10 text-rose-400"
                }`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    node.status === "online" ? "bg-emerald-400" : "bg-rose-400"
                  }`}
                />
                {node.status.toUpperCase()}
              </div>
            </div>

            {/* Metrics */}
            <div className="space-y-4">
              {/* CPU */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span className="flex items-center gap-1">
                    <Cpu className="w-3 h-3" /> CPU
                  </span>
                  <span>{node.cpu}%</span>
                </div>
                <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${node.cpu > 70 ? "bg-rose-500" : "bg-indigo-500"}`}
                    style={{ width: `${node.cpu}%` }}
                  />
                </div>
              </div>

              {/* Memory */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span className="flex items-center gap-1">
                    <Wifi className="w-3 h-3" /> Memory
                  </span>
                  <span>{node.mem}%</span>
                </div>
                <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${node.mem}%` }} />
                </div>
              </div>

              {/* Storage */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span className="flex items-center gap-1">
                    <HardDrive className="w-3 h-3" /> Storage
                  </span>
                  <span>{node.storage == null ? "—" : `${node.storage}%`}</span>
                </div>
                <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500" style={{ width: `${node.storage ?? 0}%` }} />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-6 pt-6 border-t border-neutral-800 flex justify-between items-center">
              <span className="text-xs text-neutral-500 italic">Last seen: {node.lastSeen}</span>
              <button className="text-xs font-bold text-indigo-400 hover:text-indigo-300">
                SSH Terminal
              </button>
            </div>
          </motion.div>
        ))}

        {!filtered.length ? (
          <div className="text-sm text-neutral-500">
            No nodes matched your search/filter.
          </div>
        ) : null}
      </div>
    </div>
  );
}