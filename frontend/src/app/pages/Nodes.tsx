import { useEffect, useMemo, useState } from "react";
import { Server, Search, Filter, HardDrive, Cpu, Wifi, Plus, Square, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import {
  getNodes,
  type NodeSnapshot,
  createDockerNode,
  stopDockerNode,
  deleteDockerNode,
} from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

type StatusFilter = "all" | "online" | "offline";

function pct(x: any, fallback = 0) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function getTokenFromSomewhere(authCtx: any): string | null {
  // Prefer whatever AuthContext provides
  const t1 = authCtx?.token;
  if (typeof t1 === "string" && t1.trim()) return t1.trim();

  // Common localStorage keys (fallback)
  const candidates = ["token", "access_token", "idToken", "id_token", "firebase_token"];
  for (const k of candidates) {
    const v = localStorage.getItem(k);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

export function Nodes() {
  const auth = useAuth() as any;

  const [nodes, setNodes] = useState<NodeSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // ---- NEW: create node UI state ----
  const [createPort, setCreatePort] = useState<number>(8002);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [busyCreate, setBusyCreate] = useState<boolean>(false);
  const token = useMemo(() => getTokenFromSomewhere(auth), [auth]);

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

      // Online/offline heuristic
      const online = !(n as any).error && (n.cpu_pct != null || n.mem_pct != null);

      const region = (n as any).region ?? "—";

      return {
        id: `${host}:${port}:${name}`,
        name,
        dockerName: name, // docker endpoints use this as {name}
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

  // ---- NEW: docker actions ----
  const requireTokenOrThrow = () => {
    if (!token) throw new Error("Missing auth token. Please log in again.");
    return token;
  };

  const onCreate = async () => {
    try {
      setBusyCreate(true);
      const t = requireTokenOrThrow();
      const p = Math.max(1, Math.floor(Number(createPort) || 0));
      await createDockerNode(t, p); // POST /docker/nodes/create
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to create docker node");
    } finally {
      setBusyCreate(false);
    }
  };

  const onStop = async (dockerName: string) => {
    try {
      setBusyName(dockerName);
      const t = requireTokenOrThrow();
      await stopDockerNode(t, dockerName); // POST /docker/nodes/{name}/stop
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to stop docker node");
    } finally {
      setBusyName(null);
    }
  };

  const onDelete = async (dockerName: string) => {
    try {
      setBusyName(dockerName);
      const t = requireTokenOrThrow();
      await deleteDockerNode(t, dockerName); // DELETE /docker/nodes/{name}
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete docker node");
    } finally {
      setBusyName(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Nodes</h1>
          <p className="text-neutral-400 mt-1">
            Monitor and manage individual docker nodes in your cluster.
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

      {/* ---- NEW: Create Docker Node ---- */}
      <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4 md:p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" />
              <h2 className="font-semibold text-neutral-200">Create Node</h2>
            </div>
            {/* <p className="text-xs text-neutral-500 mt-1">
              Creates a container named <span className="font-mono">csen-node-&lt;port&gt;</span> mapping{" "}
              <span className="font-mono">&lt;port&gt;:8001</span>.
            </p> */}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={createPort}
              onChange={(e) => setCreatePort(Math.max(1, Number(e.target.value) || 1))}
              className="w-32 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200"
              placeholder="8002"
              title="Host port to expose (maps to container 8001)"
            />
            <button
              disabled={busyCreate}
              onClick={onCreate}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              title={token ? "Create docker node" : "Log in first to create nodes"}
            >
              {busyCreate ? "Creating..." : "Create"}
            </button>
          </div>
        </div>

        {!token ? (
          <p className="text-xs text-amber-400 mt-3">
            You’re not authenticated (no token found). Creating/stopping/deleting nodes requires login.
          </p>
        ) : null}
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

            {/* Footer + Actions */}
            <div className="mt-6 pt-6 border-t border-neutral-800 flex justify-between items-center gap-2">
              <span className="text-xs text-neutral-500 italic">Last seen: {node.lastSeen}</span>

              <div className="flex items-center gap-2">
                <button
                  disabled={!token || busyName === node.dockerName}
                  onClick={() => onStop(node.dockerName)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-400 hover:text-amber-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={token ? "Stop this docker node" : "Log in first"}
                >
                  <Square className="w-3.5 h-3.5" />
                  Stop
                </button>

                <button
                  disabled={!token || busyName === node.dockerName}
                  onClick={() => onDelete(node.dockerName)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-400 hover:text-rose-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={token ? "Delete this docker node" : "Log in first"}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
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