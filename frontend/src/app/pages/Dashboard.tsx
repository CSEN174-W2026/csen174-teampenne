// Dashboard.tsx
import { useEffect, useMemo, useState } from "react";
import {
  Server,
  Activity,
  Database,
  Cpu,
  Zap,
  ShieldCheck,
  Globe,
  Clock,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";

import { MetricCard } from "../components/MetricCard";
import { ResourceChart } from "../components/ResourceChart";
import { motion } from "motion/react";

import { getNodes, type NodeSnapshot } from "../../lib/api";

type SeriesPoint = { t: number; cpu: number; mem: number };

export function Dashboard() {
  const [nodes, setNodes] = useState<NodeSnapshot[]>([]);
  const [nodesTimeMs, setNodesTimeMs] = useState<number>(Date.now());
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ---- Poll /nodes
  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const data = await getNodes();
        if (!alive) return;

        setNodes(data.nodes ?? []);
        setNodesTimeMs(data.time_ms ?? Date.now());
        setError(null);

        // Build aggregated CPU/Mem for chart (avg across nodes)
        const cpuAvg =
          (data.nodes ?? []).reduce((acc, n) => acc + (Number(n.cpu_pct) || 0), 0) /
          Math.max((data.nodes ?? []).length, 1);

        const memAvg =
          (data.nodes ?? []).reduce((acc, n) => acc + (Number(n.mem_pct) || 0), 0) /
          Math.max((data.nodes ?? []).length, 1);

        setSeries((prev) => {
          const next = [...prev, { t: data.time_ms ?? Date.now(), cpu: cpuAvg, mem: memAvg }];
          // keep last 120 points (~4 minutes at 2s poll) – adjust for your UI
          return next.slice(-120);
        });
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load nodes");
      }
    }

    tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // ---- Metric cards (real ones you can compute from /nodes)
  const totalNodes = nodes.length;

  const avgLatencyMs = useMemo(() => {
    // You don't have global latency from /nodes right now.
    // If your NodeSnapshot includes something like latency_ms, use it here.
    const vals = nodes.map((n) => Number(n.latency_ms)).filter((x) => Number.isFinite(x));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [nodes]);

  // Convert real nodes into your table format
  const nodeRows = useMemo(() => {
    return nodes.map((n) => {
      const cpu = Number(n.cpu_pct) || 0;
      const mem = Number(n.mem_pct) || 0;
      const load = Math.round(Math.max(cpu, mem)); // simple “current load”
      const status = load >= 85 ? "warning" : "healthy";

      return {
        name: n.name ?? `${n.host}:${n.port}`,
        region: n.host ?? "—", // you don't have region in NodeSnapshot; show host or map it later
        load,
        status,
        uptime: "—", // not provided by API currently
      };
    });
  }, [nodes]);

  const recentEvents = useMemo(() => {
    // You don't have an /activity endpoint; keep this placeholder OR
    // create a new endpoint later that returns recent job completions, errors, autoscaling, etc.
    return [
      { id: 1, title: `Polled /nodes (${totalNodes} found)`, time: new Date(nodesTimeMs).toLocaleTimeString(), status: "info" },
      ...(error
        ? [{ id: 2, title: `API error: ${error}`, time: "just now", status: "warning" }]
        : []),
    ];
  }, [totalNodes, nodesTimeMs, error]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Overview</h1>
          <p className="text-neutral-400 mt-1">
            Real-time performance metrics across your distributed infrastructure.
          </p>
          {error ? <p className="text-sm text-rose-400 mt-2">{error}</p> : null}
        </div>

        <div className="flex items-center gap-2 bg-neutral-900 border border-neutral-800 p-1 rounded-lg">
          <button className="px-3 py-1.5 text-sm font-medium rounded-md bg-neutral-800 text-white shadow-sm">
            24 Hours
          </button>
          <button className="px-3 py-1.5 text-sm font-medium rounded-md text-neutral-400 hover:text-white transition-colors">
            7 Days
          </button>
          <button className="px-3 py-1.5 text-sm font-medium rounded-md text-neutral-400 hover:text-white transition-colors">
            30 Days
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard label="Total Nodes" value={String(totalNodes)} trend={0} icon={Server} color="indigo" />
        <MetricCard
          label="Avg. Latency"
          value={avgLatencyMs == null ? "—" : `${Math.round(avgLatencyMs)}ms`}
          trend={0}
          icon={Zap}
          color="emerald"
        />
        {/* These two are NOT in your API yet: keep placeholders or add endpoints later */}
        <MetricCard label="Throughput" value="—" trend={0} icon={Activity} color="indigo" />
        <MetricCard label="Disk Usage" value="—" trend={0} icon={Database} color="amber" />
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

          {/* Pass real time-series into chart */}
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

          <div className="mt-6 pt-6 border-t border-neutral-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-neutral-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Security Status
              </div>
              <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">SECURE</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-neutral-400">
                <Globe className="w-4 h-4 text-indigo-400" />
                Edge Availability
              </div>
              <span className="text-xs font-bold text-indigo-400 bg-indigo-400/10 px-2 py-1 rounded">99.99%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Node Groups Table */}
      <div className="bg-neutral-900/40 backdrop-blur-sm border border-neutral-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Node Groups</h2>
            <p className="text-sm text-neutral-500">Live health and load status of primary clusters</p>
          </div>
          <button className="bg-white text-black px-4 py-2 rounded-lg text-sm font-bold hover:bg-neutral-200 transition-colors">
            Manage Nodes
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-neutral-800/30 text-neutral-400 text-xs uppercase tracking-wider font-bold">
                <th className="px-6 py-4">Node Name</th>
                <th className="px-6 py-4">Host</th>
                <th className="px-6 py-4">Current Load</th>
                <th className="px-6 py-4">Health Status</th>
                <th className="px-6 py-4">Uptime</th>
                <th className="px-6 py-4 text-right">Actions</th>
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
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-neutral-800 rounded-full max-w-[100px] overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${node.load}%` }}
                          transition={{ duration: 0.6, ease: "easeOut" }}
                          className={`h-full ${node.load > 85 ? "bg-rose-500" : "bg-indigo-500"}`}
                        />
                      </div>
                      <span className="text-xs font-medium text-neutral-300">{node.load}%</span>
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                        node.status === "healthy"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                      }`}
                    >
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          node.status === "healthy" ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                        }`}
                      />
                      {node.status.toUpperCase()}
                    </span>
                  </td>

                  <td className="px-6 py-4 text-sm text-neutral-400">{node.uptime}</td>

                  <td className="px-6 py-4 text-right">
                    <button className="text-neutral-500 hover:text-white transition-colors">
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
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