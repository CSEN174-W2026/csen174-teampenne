import React, { useEffect, useMemo, useState } from "react";
import { Server, Search, Filter, HardDrive, Cpu, Wifi, Link2, Unlink, Save, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import {
  cancelScopedJobs,
  createNodeGroup,
  deleteNodeGroup,
  getNodeGroupSelection,
  getNodes,
  listNodeGroups,
  saveNodeGroupSelection,
  type NodeGroup,
  type NodeSnapshot,
} from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

type StatusFilter = "all" | "online" | "offline";

function pct(x: any, fallback = 0) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

export function Nodes() {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;

  const [nodes, setNodes] = useState<NodeSnapshot[]>([]);
  const [groups, setGroups] = useState<NodeGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groupColor, setGroupColor] = useState("#22d3ee");
  const [savingGroup, setSavingGroup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const connectedStorageKey = useMemo(
    () => `nodes.connected.${auth.user?.id ?? "anonymous"}`,
    [auth.user?.id]
  );

  useEffect(() => {
    let alive = true;
    const tick = async () => {
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
    };
    void tick();
    const id = setInterval(() => void tick(), 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setGroups([]);
      setSelectedGroupIds([]);
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const [g, sel] = await Promise.all([listNodeGroups(userId), getNodeGroupSelection(userId)]);
        if (!active) return;
        setGroups(g.rows ?? []);
        setSelectedGroupIds(Array.isArray(sel.row?.groupIds) ? sel.row!.groupIds : []);
      } catch (e: any) {
        if (!active) return;
        setError(e?.message ?? "Failed to load node groups");
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(connectedStorageKey);
      if (!raw) {
        setConnectedIds([]);
        return;
      }
      const parsed = JSON.parse(raw);
      setConnectedIds(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
    } catch {
      setConnectedIds([]);
    }
  }, [connectedStorageKey]);

  const uiNodes = useMemo(
    () =>
      (nodes ?? []).map((n, i) => {
        const name = n.name ?? `node-${i + 1}`;
        const host = n.host ?? "unknown-host";
        const port = n.port ?? 0;
        const cpu = pct(n.cpu_pct);
        const mem = pct(n.mem_pct);
        const storageRaw = (n as any).disk_pct ?? (n as any).storage_pct ?? null;
        const storage = storageRaw == null ? null : pct(storageRaw);
        const online = !(n as any).error && (n.cpu_pct != null || n.mem_pct != null);
        const region = (n as any).region ?? "—";
        return {
          id: `${host}:${port}:${name}`,
          name,
          instanceId: (n as any).instance_id ?? name,
          host,
          port,
          ip: `${host}:${port}`,
          status: online ? "online" : "offline",
          cpu,
          mem,
          storage,
          region,
          lastSeen: n.time_ms ? new Date(n.time_ms).toLocaleString() : "—",
        };
      }),
    [nodes]
  );

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

  const toggleConnect = async (instanceId: string) => {
    const wasConnected = connectedIds.includes(instanceId);
    const next = wasConnected
      ? connectedIds.filter((id) => id !== instanceId)
      : [...connectedIds, instanceId];
    setConnectedIds(next);
    localStorage.setItem(connectedStorageKey, JSON.stringify(next));

    if (wasConnected && userId) {
      try {
        await cancelScopedJobs({
          user_id: userId,
          allowed_node_keys: [instanceId],
          include_running: true,
        });
      } catch (e: any) {
        setError(e?.message ?? "Failed to cancel jobs on disconnected node");
      }
    }
  };

  const connectedCount = connectedIds.length;
  const onlineCount = uiNodes.filter((n) => n.status === "online").length;
  const isConnected = (instanceId: string) => connectedIds.includes(instanceId);

  const connectedNodeRefs = useMemo(() => {
    const byId = new Map(uiNodes.map((n) => [n.instanceId, n]));
    return connectedIds
      .map((id) => byId.get(id))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((n) => ({
        nodeKey: n.instanceId,
        nodeName: n.name,
        host: n.host,
        port: n.port,
      }));
  }, [uiNodes, connectedIds]);

  const selectedGroups = useMemo(
    () => groups.filter((g) => selectedGroupIds.includes(g.id)),
    [groups, selectedGroupIds]
  );

  const selectedGroupNodeKeys = useMemo(() => {
    const s = new Set<string>();
    selectedGroups.forEach((g) => g.nodes.forEach((n) => s.add(n.nodeKey)));
    return s;
  }, [selectedGroups]);

  const persistSelection = async (groupIds: number[]) => {
    if (!userId) return;
    await saveNodeGroupSelection({
      userId,
      userEmail: auth.user?.email,
      groupIds,
    });
  };

  const toggleSelectedGroup = async (groupId: number) => {
    const next = selectedGroupIds.includes(groupId)
      ? selectedGroupIds.filter((id) => id !== groupId)
      : [...selectedGroupIds, groupId];
    setSelectedGroupIds(next);
    try {
      await persistSelection(next);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save selected groups");
    }
  };

  const onSaveGroup = async () => {
    if (!userId) {
      setError("Please log in to save groups.");
      return;
    }
    if (!groupName.trim()) {
      setError("Group name is required.");
      return;
    }
    if (connectedNodeRefs.length === 0) {
      setError("Connect at least one node before saving a group.");
      return;
    }
    try {
      setSavingGroup(true);
      const created = await createNodeGroup({
        userId,
        userEmail: auth.user?.email,
        name: groupName.trim(),
        color: groupColor,
        nodes: connectedNodeRefs,
      });
      setGroups((prev) => [created.row, ...prev]);
      setGroupName("");
      setError(null);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("already have a group with this name") || msg.includes("409")) {
        setError("Group name already exists for your account. Please pick a different name.");
      } else {
        setError(e?.message ?? "Failed to save node group");
      }
    } finally {
      setSavingGroup(false);
    }
  };

  const connectSelectedGroups = () => {
    const next = Array.from(new Set([...connectedIds, ...Array.from(selectedGroupNodeKeys)]));
    setConnectedIds(next);
    localStorage.setItem(connectedStorageKey, JSON.stringify(next));
  };

  const disconnectSelectedGroups = async () => {
    const removed = connectedIds.filter((id) => selectedGroupNodeKeys.has(id));
    const next = connectedIds.filter((id) => !selectedGroupNodeKeys.has(id));
    setConnectedIds(next);
    localStorage.setItem(connectedStorageKey, JSON.stringify(next));

    if (removed.length > 0 && userId) {
      try {
        await cancelScopedJobs({
          user_id: userId,
          allowed_node_keys: removed,
          include_running: true,
        });
      } catch (e: any) {
        setError(e?.message ?? "Failed to cancel jobs for disconnected group nodes");
      }
    }
  };

  const onDeleteGroup = async (groupId: number) => {
    try {
      await deleteNodeGroup(groupId);
      const next = selectedGroupIds.filter((id) => id !== groupId);
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      setSelectedGroupIds(next);
      await persistSelection(next);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete group");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Nodes</h1>
          <p className="text-neutral-400 mt-1">Discover nodes, connect, and save them into reusable groups.</p>
          {error ? <p className="text-sm text-rose-400 mt-2">{error}</p> : null}
        </div>
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

      <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="px-2.5 py-1 rounded-full bg-neutral-800 text-neutral-300">Discovered: {uiNodes.length}</span>
          <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400">Online: {onlineCount}</span>
          <span className="px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400">Connected: {connectedCount}</span>
          <span className="px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-300">Saved groups: {groups.length}</span>
          <span className="px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-300">
            Selected groups: {selectedGroupIds.length}
          </span>
        </div>
      </div>

      <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4 md:p-5 space-y-3">
        <h2 className="font-semibold text-neutral-100">Group Builder</h2>
        <p className="text-xs text-neutral-500">
          Connected nodes become the members of a saved group. Groups are persisted per user in the database.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200"
            placeholder="Group name"
          />
          <input
            value={groupColor}
            onChange={(e) => setGroupColor(e.target.value)}
            className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200"
            placeholder="#22d3ee"
          />
          <div className="text-xs text-neutral-400 border border-neutral-800 rounded-lg px-3 py-2 flex items-center">
            Nodes in group: {connectedNodeRefs.length}
          </div>
          <button
            onClick={onSaveGroup}
            disabled={savingGroup || connectedNodeRefs.length === 0}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            {savingGroup ? "Saving..." : "Save Group"}
          </button>
        </div>
      </div>

      {groups.length > 0 ? (
        <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4 md:p-5 space-y-3">
          <h2 className="font-semibold text-neutral-100">Saved Groups</h2>
          <div className="space-y-2">
            {groups.map((g) => (
              <div key={g.id} className="border border-neutral-800 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(g.id)}
                    onChange={() => void toggleSelectedGroup(g.id)}
                  />
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: g.color }} />
                  <div>
                    <div className="text-sm font-medium text-neutral-100">{g.name}</div>
                    <div className="text-xs text-neutral-500">{g.nodes.length} node(s)</div>
                  </div>
                </div>
                <button
                  onClick={() => void onDeleteGroup(g.id)}
                  className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {selectedGroups.length > 0 ? (
        <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4 md:p-5 space-y-3">
          <h2 className="font-semibold text-neutral-100">Connect Selected Groups</h2>
          <p className="text-xs text-neutral-500">
            Apply connect/disconnect to all nodes in currently selected groups.
          </p>
          <div className="text-xs text-neutral-400">
            Selected groups: {selectedGroups.map((g) => g.name).join(", ")}
          </div>
          <div className="text-xs text-neutral-400">Selected group nodes: {selectedGroupNodeKeys.size}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={connectSelectedGroups}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 text-xs font-medium"
            >
              Connect Selected Groups
            </button>
            <button
              onClick={() => void disconnectSelectedGroups()}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-xs font-medium"
            >
              Disconnect Selected Groups
            </button>
          </div>
        </div>
      ) : null}

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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filtered.map((node) => (
          <motion.div
            key={node.id}
            whileHover={{ y: -4 }}
            className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-6 relative overflow-hidden group"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg ${
                    node.status === "online" ? "bg-indigo-500/20 text-indigo-400" : "bg-neutral-800 text-neutral-500"
                  }`}
                >
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white group-hover:text-indigo-400 transition-colors">{node.name}</h3>
                  <p className="text-xs text-neutral-500">
                    {node.ip} • {node.region}
                  </p>
                </div>
              </div>
              <div
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider ${
                  node.status === "online" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
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

            <div className="space-y-4">
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

            <div className="mt-6 pt-6 border-t border-neutral-800 flex justify-between items-center gap-2">
              <span className="text-xs text-neutral-500 italic">Last seen: {node.lastSeen}</span>
              <button
                disabled={node.status !== "online"}
                onClick={() => void toggleConnect(node.instanceId)}
                className={`inline-flex items-center gap-1.5 text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed ${
                  isConnected(node.instanceId) ? "text-rose-400 hover:text-rose-300" : "text-sky-400 hover:text-sky-300"
                }`}
              >
                {isConnected(node.instanceId) ? (
                  <>
                    <Unlink className="w-3.5 h-3.5" />
                    Disconnect
                  </>
                ) : (
                  <>
                    <Link2 className="w-3.5 h-3.5" />
                    Connect
                  </>
                )}
              </button>
            </div>
          </motion.div>
        ))}

        {!filtered.length ? <div className="text-sm text-neutral-500">No nodes matched your search/filter.</div> : null}
      </div>
    </div>
  );
}