// src/pages/Profile.tsx
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Brain,
  Cpu,
  Gauge,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import {
  getClusterStats,
  getMyAgentHistory,
  getMyLastAgentConfig,
  getRecentExplanations,
  me,
  type AgentConfig,
  type AuthUser,
  type ClusterStatsResponse,
} from "../../lib/api";

import { useAuth } from "../auth/AuthContext";

function fmtTime(ts?: number | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function cfgLabel(c: AgentConfig) {
  return `${c.learner_kind} → ${c.goal_kind}`;
}

function cfgKey(c: AgentConfig) {
  return JSON.stringify({
    learner_kind: c.learner_kind,
    goal_kind: c.goal_kind,
    seed: c.seed ?? null,
    learner_kwargs: c.learner_kwargs ?? null,
    goal_kwargs: c.goal_kwargs ?? null,
  });
}

function shortNumber(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "0";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${Math.round(v)}`;
}

function formatLatency(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "---";
  return `${Math.round(v)}`;
}

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_0_0_1px_rgba(255,255,255,0.02)] ${className}`}
    >
      {children}
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  accent,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div
      className={`rounded-3xl border ${accent} p-5 md:p-6 bg-gradient-to-br from-white/[0.03] to-white/[0.01] min-h-[148px]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black/20 border border-white/10">
          {icon}
        </div>
        <div className="h-2 w-2 rounded-full bg-current opacity-70 mt-1" />
      </div>

      <div className="mt-8">
        <p className="text-3xl md:text-4xl font-bold tracking-tight text-white">
          {value}
        </p>
        <p className="mt-2 text-sm font-medium text-white/90">{title}</p>
        {subtitle ? <p className="mt-1 text-xs text-white/50">{subtitle}</p> : null}
      </div>
    </div>
  );
}

export function Profile() {
  const { token } = useAuth() as { token: string | null };

  const [user, setUser] = useState<AuthUser | null>(null);
  const [cfg, setCfg] = useState<AgentConfig | null>(null);
  const [history, setHistory] = useState<{ time_ms: number; config: AgentConfig }[]>([]);
  const [selectedCfg, setSelectedCfg] = useState<AgentConfig | null>(null);
  const [agentEvents, setAgentEvents] = useState<any[]>([]);
  const [clusterStats, setClusterStats] = useState<ClusterStatsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const uniqueConfigs = useMemo(() => {
    const map = new Map<string, AgentConfig>();
    for (const item of history) {
      map.set(cfgKey(item.config), item.config);
    }
    return Array.from(map.values());
  }, [history]);

  const trainedAgentsCount = uniqueConfigs.length;

  const totalTasksProcessed = useMemo(() => {
    if (clusterStats?.jobs_count != null) return clusterStats.jobs_count;
    return 0;
  }, [clusterStats]);

  const avgLatency = useMemo(() => {
    return clusterStats?.avg_latency_ms ?? null;
  }, [clusterStats]);

  const selectedKey = selectedCfg ? cfgKey(selectedCfg) : null;

  async function loadEvents(forCfg: AgentConfig | null) {
    if (!forCfg) {
      setAgentEvents([]);
      return;
    }

    setEventsLoading(true);
    try {
      const recent = await getRecentExplanations(forCfg, 25);
      setAgentEvents(recent.events ?? []);
    } catch {
      setAgentEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }

  async function refresh() {
    setLoading(true);
    setErr(null);

    try {
      if (!token) throw new Error("Missing auth token.");

      const [userRes, histRes, lastCfgRes, clusterRes] = await Promise.all([
        me(token),
        getMyAgentHistory(token),
        getMyLastAgentConfig(token),
        getClusterStats(60, 800).catch(() => null),
      ]);

      setUser(userRes);

      const hist = histRes.history ?? [];
      setHistory(hist);

      const lastCfg = lastCfgRes?.config ?? null;
      setCfg(lastCfg);
      setClusterStats(clusterRes);

      const initial = lastCfg ?? hist[0]?.config ?? null;

      setSelectedCfg((prev) => {
        if (!initial && !prev) return prev;
        if (!initial || !prev) return initial;
        return cfgKey(initial) === cfgKey(prev) ? prev : initial;
      });

      await loadEvents(initial);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!selectedCfg) return;
    void loadEvents(selectedCfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCfg ? cfgKey(selectedCfg) : null]);

  return (
    <div className="min-h-full bg-[#050505] text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-white/40">
              Dashboard
            </p>
            <h1 className="mt-2 text-4xl md:text-5xl font-bold tracking-tight">
              User Profile
            </h1>
            <p className="mt-3 text-white/55 max-w-2xl">
              Your trained agents and performance analytics in one place.
            </p>
            {err ? <p className="mt-3 text-sm text-rose-400">{err}</p> : null}
          </div>

          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/70">
              <Activity className="h-4 w-4 text-violet-300" />
              Active
            </div>

            <button
              onClick={refresh}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white hover:bg-white/[0.08] transition"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            title="Trained Agents"
            value={`${trainedAgentsCount}`}
            subtitle={cfg ? `Last used: ${cfgLabel(cfg)}` : "No learner used yet"}
            icon={<Brain className="h-5 w-5 text-fuchsia-300" />}
            accent="border-fuchsia-500/30 text-fuchsia-300"
          />

          <StatCard
            title="Tasks Processed"
            value={shortNumber(totalTasksProcessed)}
            subtitle="Cluster-wide completed workload"
            icon={<Sparkles className="h-5 w-5 text-emerald-300" />}
            accent="border-emerald-500/30 text-emerald-300"
          />

          <StatCard
            title="Avg Agent Latency (ms)"
            value={formatLatency(avgLatency)}
            subtitle="Mean latency from cluster stats"
            icon={<Gauge className="h-5 w-5 text-amber-300" />}
            accent="border-amber-500/30 text-amber-300"
          />
        </div>

        <div className="space-y-6">
          <GlassCard className="p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                  <Bot className="h-5 w-5 text-fuchsia-300" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Trained Agents</h2>
                  <p className="text-xs text-white/45">
                    {trainedAgentsCount} trained
                  </p>
                </div>
              </div>
            </div>

            {!cfg && history.length === 0 ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
                  <Brain className="h-8 w-8 text-white/25" />
                </div>
                <p className="mt-5 text-white/65">No agents trained yet</p>
                <p className="mt-2 text-sm text-white/40">
                  Visit Simulation to train an agent.
                </p>
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
                <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                  {history.map((h, i) => {
                    const active = selectedKey && cfgKey(h.config) === selectedKey;

                    return (
                      <button
                        key={`${h.time_ms}-${i}`}
                        onClick={() => setSelectedCfg(h.config)}
                        className={`w-full rounded-2xl border p-4 text-left transition ${
                          active
                            ? "border-fuchsia-500/30 bg-fuchsia-500/10"
                            : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                        }`}
                      >
                        <p className="font-medium text-white">{cfgLabel(h.config)}</p>
                        <p className="mt-1 text-xs text-white/45">{fmtTime(h.time_ms)}</p>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/60">
                            seed: {h.config.seed ?? "—"}
                          </span>
                          <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/60">
                            {h.config.learner_kind}
                          </span>
                          <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/60">
                            {h.config.goal_kind}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-white/40">
                        Current learner
                      </p>
                      <p className="mt-2 font-semibold text-white">
                        {cfg ? cfg.learner_kind : "—"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-white/40">Goal</p>
                      <p className="mt-2 font-semibold text-white">
                        {cfg ? cfg.goal_kind : "—"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-white/40">Seed</p>
                      <p className="mt-2 font-semibold text-white">
                        {cfg?.seed ?? "—"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-white/40">User</p>
                      <p className="mt-2 font-semibold text-white truncate">
                        {user?.full_name ?? user?.email ?? "—"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-wide text-white/40">
                      Learner kwargs
                    </p>
                    <pre className="mt-3 overflow-auto text-xs text-white/70 whitespace-pre-wrap break-words">
                      {cfg?.learner_kwargs
                        ? JSON.stringify(cfg.learner_kwargs, null, 2)
                        : "—"}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-5 md:p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                <Cpu className="h-5 w-5 text-emerald-300" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Recent Learner Activity</h2>
                <p className="text-xs text-white/45">
                  {selectedCfg ? cfgLabel(selectedCfg) : "Pick a config to inspect"}
                </p>
              </div>
            </div>

            {loading || eventsLoading ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
                Loading activity...
              </div>
            ) : !selectedCfg ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-white/45">
                Pick an agent config from the list above to view learner activity.
              </div>
            ) : agentEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-sm text-white/45">
                No agent events yet for this config.
              </div>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {agentEvents.map((ev, i) => (
                  <div
                    key={ev?.id ?? i}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-white">
                          {ev?.type ?? "event"}
                          {ev?.message ? (
                            <span className="font-normal text-white/55"> — {ev.message}</span>
                          ) : null}
                        </p>
                        <p className="mt-1 text-xs text-white/40">
                          {fmtTime(ev?.ts_ms ?? ev?.time_ms ?? Date.now())}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2 md:justify-end">
                        {ev?.policy ? (
                          <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/60">
                            policy={ev.policy}
                          </span>
                        ) : null}
                        {ev?.chosen_node ? (
                          <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-white/60">
                            node={ev.chosen_node}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {ev?.detail ? (
                      <pre className="mt-3 overflow-auto rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-white/65 whitespace-pre-wrap break-words">
                        {JSON.stringify(ev.detail, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}