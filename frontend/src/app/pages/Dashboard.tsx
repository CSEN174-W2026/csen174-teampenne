// Dashboard.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Server,
  Activity,
  Database,
  Cpu,
  Zap,
  ShieldCheck,
  Clock,
  ChevronRight,
} from "lucide-react";

import { MetricCard } from "../components/MetricCard";
import { ResourceChart } from "../components/ResourceChart";
import { motion } from "motion/react";

import { getClusterStats, getNodes, type ClusterStatsResponse, type NodeSnapshot } from "../../lib/api";

type SeriesPoint = { t: number; cpu: number; mem: number };

function fmtPct(x: number | null | undefined) {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${Math.round(x)}%`;
}

export function Dashboard() {
  const [nodes, setNodes] = useState<NodeSnapshot[]>([]);
  const [nodesTimeMs, setNodesTimeMs] = useState<number>(Date.now());
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [cluster, setCluster] = useState<ClusterStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollNodes = useCallback(async () => {
    try {
      const data = await getNodes();
      setNodes(data.nodes ?? []);
      setNodesTimeMs(data.time_ms ?? Date.now());
      setError(null);

      const cpuAvg =
        (data.nodes ?? []).reduce((acc, n) => acc + (Number(n.cpu_pct) || 0), 0) /
        Math.max((data.nodes ?? []).length, 1);

      const memAvg =
        (data.nodes ?? []).reduce((acc, n) => acc + (Number(n.mem_pct) || 0), 0) /
        Math.max((data.nodes ?? []).length, 1);

      setSeries((prev) => {
        const next = [...prev, { t: data.time_ms ?? Date.now(), cpu: cpuAvg, mem: memAvg }];
        return next.slice(-120);
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to load nodes");
    }
  }, []);

  const pollCluster = useCallback(async () => {
    try {
      const stats = await getClusterStats(60, 200);
      setCluster(stats);
    } catch {
      setCluster(null);
    }
  }, []);

  // Keep dashboard cards/table fresh, and refresh immediately when tab regains focus.
  useEffect(() => {
    let active = true;
    const safePoll = async () => {
      if (!active) return;
      await Promise.all([pollNodes(), pollCluster()]);
    };
    void safePoll();
    const id = window.setInterval(() => void safePoll(), 1500);
    const onFocus = () => void safePoll();
    const onVisibility = () => {
      if (!document.hidden) void safePoll();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pollCluster, pollNodes]);

  const totalNodes = nodes.length;

  // Convert real nodes into your table format
  const nodeRows = useMemo(() => {
    return nodes.map((n) => {
      const online = !(n as any).error && (n.cpu_pct != null || n.mem_pct != null);
      const cpu = Number(n.cpu_pct) || 0;
      const mem = Number(n.mem_pct) || 0;
      const queueLen = Math.max(0, Number((n as any).queue_len) || 0);
      const inFlight = Math.max(0, Number((n as any).in_flight) || 0);

      // Reflect actual node work by including queue + in-flight pressure,
      // not just host resource utilization.
      const backlogPressurePct = Math.min(100, queueLen * 12 + inFlight * 22);
      const load = Math.round(Math.max(cpu, mem, backlogPressurePct));
      const status: "healthy" | "warning" | "offline" = !online
        ? "offline"
        : load >= 85
          ? "warning"
          : "healthy";

      return {
        name: n.name ?? `${n.host}:${n.port}`,
        region: n.host ?? "—",
        cpu,
        mem,
        status,
        jobs: queueLen + inFlight,
        ewmaLatencyMs: Number((n as any).ewma_latency_ms) || 0,
      };
    });
  }, [nodes]);

  const recentEvents = useMemo(() => {
    return [
      {
        id: 1,
        title: `Polled /nodes (${totalNodes} found)`,
        time: new Date(nodesTimeMs).toLocaleTimeString(),
        status: "info",
      },
      ...(cluster
        ? [
            {
              id: 2,
              title: `Cluster stats: ${cluster.jobs_count} jobs in last ${Math.round(
                cluster.window_ms / 1000
              )}s`,
              time: new Date(cluster.time_ms).toLocaleTimeString(),
              status: "info",
            },
          ]
        : []),
      ...(error ? [{ id: 3, title: `API error: ${error}`, time: "just now", status: "warning" }] : []),
    ];
  }, [totalNodes, nodesTimeMs, cluster, error]);

  const avgLatencyLabel =
    cluster?.avg_latency_ms == null ? "—" : `${Math.round(cluster.avg_latency_ms)}ms`;

  const thr = Number(cluster?.throughput_rps);
  const throughputLabel = cluster == null || !Number.isFinite(thr) ? "—" : `${thr.toFixed(2)} jobs/s`;

  const diskUsageLabel = cluster == null ? "—" : fmtPct(cluster.disk_usage_pct);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Overview</h1>
          <p className="text-neutral-400 mt-1">Real-time performance metrics across your distributed infrastructure.</p>
          {error ? <p className="text-sm text-rose-400 mt-2">{error}</p> : null}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          label="Total Nodes"
          value={String(totalNodes)}
          trend={0}
          icon={Server}
          color="indigo"
          definition="Number of worker nodes currently registered and returned by the /nodes API."
        />
        <MetricCard
          label="Avg. Latency"
          value={avgLatencyLabel}
          trend={0}
          icon={Zap}
          color="emerald"
          definition="Average end-to-end job latency over the last window (from /cluster/stats, in milliseconds)."
        />
        <MetricCard
          label="Throughput"
          value={throughputLabel}
          trend={0}
          icon={Activity}
          color="indigo"
          definition="Job completion rate over the last window (from /cluster/stats), measured as jobs per second."
        />
        <MetricCard
          label="Disk Usage"
          value={diskUsageLabel}
          trend={0}
          icon={Database}
          color="amber"
          definition="Percent of disk space used (from /cluster/stats)."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Performance Chart */}
        <div className="lg:col-span-2 bg-neutral-900/40 backdrop-blur-sm border border-neutral-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                Resource Utilization
                <Cpu className="w-4 h-4 text-indigo-400" />
              </h2>
              <p className="text-sm text-neutral-500">Aggregate CPU and Memory consumption</p>
            </div>
          </div>

          <ResourceChart data={series} />
        </div>

        {/* Recent Activity */}
        <div className="bg-neutral-900/40 backdrop-blur-sm border border-neutral-800 rounded-2xl p-6 flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              Recent Activity
              <Clock className="w-4 h-4 text-amber-400" />
            </h2>
            <button className="text-xs text-indigo-400 font-medium hover:underline">View All</button>
          </div>

          <div className="flex-1 space-y-4">
            {recentEvents.map((event) => (
              <div
                key={event.id}
                className="group flex items-start gap-3 p-3 rounded-xl hover:bg-neutral-800/50 transition-colors cursor-pointer border border-transparent hover:border-neutral-700"
              >
                <div
                  className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                    event.status === "warning" ? "bg-amber-500" : "bg-indigo-500"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-200 truncate">{event.title}</p>
                  <p className="text-xs text-neutral-500">{event.time}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-neutral-700 group-hover:text-neutral-400 transition-colors" />
              </div>
            ))}
          </div>

          {/* <div className="mt-6 pt-6 border-t border-neutral-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-neutral-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Security Status
              </div>
              <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">
                SECURE
              </span>
            </div>
          </div> */}
        </div>
      </div>

      {/* Node Groups Table */}
      <div className="bg-neutral-900/40 backdrop-blur-sm border border-neutral-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Node Groups</h2>
            <p className="text-sm text-neutral-500">Live health and load status of primary clusters</p>
          </div>
          <a
            href="/nodes"
            className="bg-white text-black px-4 py-2 rounded-lg text-sm font-bold hover:bg-neutral-200 transition-colors"
          >
            Manage Nodes
          </a>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-neutral-800/30 text-neutral-400 text-xs uppercase tracking-wider font-bold">
                <th className="px-6 py-4">Node Name</th>
                <th className="px-6 py-4">Host</th>
                <th className="px-6 py-4">CPU / Mem</th>
                <th className="px-6 py-4">Health Status</th>
                <th className="px-6 py-4">Jobs</th>
                <th className="px-6 py-4">EWMA Latency</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-800">
              {nodeRows.map((node) => (
                <tr key={node.name} className="hover:bg-neutral-800/30 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-neutral-800 flex items-center justify-center">
                        <Server className="w-4 h-4 text-neutral-400" />
                      </div>
                      <span className="font-semibold">{node.name}</span>
                    </div>
                  </td>

                  <td className="px-6 py-4 text-sm text-neutral-400">{node.region}</td>

                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3 text-xs font-mono">
                      <span className={node.cpu > 80 ? "text-rose-400" : "text-indigo-300"}>
                        {Math.round(node.cpu)}%
                      </span>
                      <span className="text-neutral-600">/</span>
                      <span className={node.mem > 80 ? "text-rose-400" : "text-emerald-300"}>
                        {Math.round(node.mem)}%
                      </span>
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                        node.status === "healthy"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : node.status === "offline"
                            ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                      }`}
                    >
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          node.status === "healthy"
                            ? "bg-emerald-400"
                            : node.status === "offline"
                              ? "bg-rose-400"
                              : "bg-amber-400 animate-pulse"
                        }`}
                      />
                      {node.status.toUpperCase()}
                    </span>
                  </td>

                  <td className="px-6 py-4 text-sm text-neutral-300">{node.jobs}</td>

                  <td className="px-6 py-4 text-sm text-neutral-400">
                    {node.ewmaLatencyMs > 0 ? `${Math.round(node.ewmaLatencyMs)} ms` : "—"}
                  </td>
                </tr>
              ))}

              {!nodeRows.length ? (
                <tr>
                  <td className="px-6 py-6 text-sm text-neutral-500" colSpan={6}>
                    No nodes returned from API. Is the manager running and are VMs discoverable?
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}