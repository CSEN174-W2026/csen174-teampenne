// src/pages/Profile.tsx
import { useEffect, useMemo, useState } from "react";
import { Bot, History, RefreshCw, User as UserIcon } from "lucide-react";

import {
  getMyLastAgentConfig,
  getMyAgentHistory,
  getRecentExplanations,
  me,
  type AgentConfig,
  type AuthUser,
} from "../../lib/api";

import { useAuth } from "../auth/AuthContext";

function fmtTime(ts: number) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function cfgLabel(c: AgentConfig) {
  return `${c.learner_kind} → ${c.goal_kind}`;
}

function cfgKey(c: AgentConfig) {
  // stable-ish equality for selection
  return JSON.stringify({
    learner_kind: c.learner_kind,
    goal_kind: c.goal_kind,
    seed: c.seed ?? null,
    learner_kwargs: c.learner_kwargs ?? null,
    goal_kwargs: c.goal_kwargs ?? null,
  });
}

function compactJson(v: unknown) {
  if (v == null) return "—";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function Profile() {
  const { token } = useAuth() as { token: string | null };

  const [user, setUser] = useState<AuthUser | null>(null);

  // last used config
  const [cfg, setCfg] = useState<AgentConfig | null>(null);

  // agent config history
  const [history, setHistory] = useState<{ time_ms: number; config: AgentConfig }[]>([]);
  const [selectedCfg, setSelectedCfg] = useState<AgentConfig | null>(null);

  // explanation events for selected config
  const [agentEvents, setAgentEvents] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const learnerLabel = useMemo(() => {
    if (!cfg) return "No learner used yet";
    return cfgLabel(cfg);
  }, [cfg]);

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
      // keep UI quiet; refresh() handles main error display
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

      // 1) user info
      const u = await me(token);
      setUser(u);

      // 2) history list
      const histRes = await getMyAgentHistory(token);
      const hist = histRes.history ?? [];
      setHistory(hist);

      // 3) last used config
      const lastRes = await getMyLastAgentConfig(token);
      const lastCfg = lastRes?.config ?? null;
      setCfg(lastCfg);

      // 4) choose selection (prefer last, else most recent history item)
      const initial = lastCfg ?? hist[0]?.config ?? null;

      // only update selection if it truly changed (prevents flicker)
      setSelectedCfg((prev) => {
        if (!initial && !prev) return prev;
        if (!initial || !prev) return initial;
        return cfgKey(initial) === cfgKey(prev) ? prev : initial;
      });

      // 5) load events for initial selection
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

  // When user clicks a history item, load events for that selection
  useEffect(() => {
    // Avoid double-fetch during initial refresh() which already loaded events
    // If you want absolute simplicity, remove this guard and it will still work.
    if (!selectedCfg) return;
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    loadEvents(selectedCfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCfg && cfgKey(selectedCfg)]);

  const selectedKey = selectedCfg ? cfgKey(selectedCfg) : null;
  const trainedAgentsCount = useMemo(
    () => new Set(history.map((h) => cfgKey(h.config))).size,
    [history]
  );
  const totalProcessed = agentEvents.length;
  const avgLatencyMs = useMemo(() => {
    const vals = agentEvents
      .map((ev) =>
        Number(
          ev?.latency_ms ??
            ev?.observed_latency_ms ??
            ev?.detail?.latency_ms ??
            ev?.detail?.observed_latency_ms ??
            NaN
        )
      )
      .filter((x) => Number.isFinite(x) && x > 0);
    if (!vals.length) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [agentEvents]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Dashboard</p>
          <h1 className="text-4xl font-bold tracking-tight">User Profile</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Your trained agents and performance analysis in one place.
          </p>
          {err ? <p className="text-sm text-rose-400 mt-2">{err}</p> : null}
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300">
            Active
          </span>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-700 bg-neutral-900/70 px-3 py-2 text-sm hover:bg-neutral-800/70 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-fuchsia-500/40 bg-gradient-to-br from-fuchsia-600/10 to-transparent p-5 shadow-[0_0_24px_rgba(217,70,239,0.15)]">
          <div className="mb-4 flex items-center justify-between">
            <div className="rounded-lg bg-fuchsia-400/10 p-2">
              <Bot className="h-4 w-4 text-fuchsia-300" />
            </div>
            <span className="text-[11px] text-fuchsia-300/80">•</span>
          </div>
          <div className="text-3xl font-bold">{trainedAgentsCount}</div>
          <p className="mt-1 text-sm text-neutral-200">Trained Agents</p>
          <p className="text-xs text-neutral-500">Last used: {cfg?.learner_kind ?? "—"} model family</p>
        </div>

        <div className="rounded-2xl border border-cyan-500/40 bg-gradient-to-br from-cyan-500/10 to-transparent p-5 shadow-[0_0_24px_rgba(6,182,212,0.15)]">
          <div className="mb-4 flex items-center justify-between">
            <div className="rounded-lg bg-cyan-400/10 p-2">
              <History className="h-4 w-4 text-cyan-300" />
            </div>
            <span className="text-[11px] text-cyan-300/80">•</span>
          </div>
          <div className="text-3xl font-bold">{totalProcessed}</div>
          <p className="mt-1 text-sm text-neutral-200">Tasks Processed</p>
          <p className="text-xs text-neutral-500">Counted from selected agent activity feed</p>
        </div>

        <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-transparent p-5 shadow-[0_0_24px_rgba(245,158,11,0.15)]">
          <div className="mb-4 flex items-center justify-between">
            <div className="rounded-lg bg-amber-400/10 p-2">
              <UserIcon className="h-4 w-4 text-amber-300" />
            </div>
            <span className="text-[11px] text-amber-300/80">•</span>
          </div>
          <div className="text-3xl font-bold">{avgLatencyMs > 0 ? Math.round(avgLatencyMs) : 0}</div>
          <p className="mt-1 text-sm text-neutral-200">Avg Agent Latency (ms)</p>
          <p className="text-xs text-neutral-500">Mean observed from recent activity data</p>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 md:p-5">
        <div className="mb-4 flex items-center gap-2">
          <Bot className="w-4 h-4 text-neutral-300" />
          <h2 className="text-lg font-semibold">Trained Agents</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-3">
            {loading ? (
              <p className="text-sm text-neutral-500">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-neutral-500">No trained agents yet.</p>
            ) : (
              <div className="space-y-2">
                {history.map((h, i) => {
                  const c = h.config;
                  const active = selectedKey && cfgKey(c) === selectedKey;
                  return (
                    <button
                      key={`${h.time_ms}-${i}`}
                      onClick={() => setSelectedCfg(c)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                        active
                          ? "border-fuchsia-500/40 bg-fuchsia-500/15"
                          : "border-neutral-800 bg-neutral-900/40 hover:bg-neutral-800/60"
                      }`}
                    >
                      <p className="truncate text-sm font-semibold">{cfgLabel(c)}</p>
                      <p className="mt-1 text-[11px] text-neutral-500">{fmtTime(h.time_ms)}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
                <p className="text-[11px] uppercase tracking-wider text-neutral-500">Learner Kind</p>
                <p className="mt-1 text-sm font-semibold">{selectedCfg?.learner_kind ?? "—"}</p>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
                <p className="text-[11px] uppercase tracking-wider text-neutral-500">Goal Kind</p>
                <p className="mt-1 text-sm font-semibold">{selectedCfg?.goal_kind ?? "—"}</p>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
                <p className="text-[11px] uppercase tracking-wider text-neutral-500">Seed</p>
                <p className="mt-1 text-sm font-semibold">{selectedCfg?.seed ?? "—"}</p>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
                <p className="text-[11px] uppercase tracking-wider text-neutral-500">User</p>
                <p className="mt-1 text-sm font-semibold">{user?.full_name ?? user?.email ?? "—"}</p>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
              <p className="text-[11px] uppercase tracking-wider text-neutral-500">Learner kwargs</p>
              <pre className="mt-1 max-h-36 overflow-auto text-xs text-neutral-300">
                {compactJson(selectedCfg?.learner_kwargs)}
              </pre>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 md:p-5">
        <div className="mb-4 flex items-center gap-2">
          <History className="w-4 h-4 text-cyan-300" />
          <h2 className="text-lg font-semibold">Recent Learner Activity</h2>
        </div>

        {loading || eventsLoading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : !selectedCfg ? (
          <p className="text-sm text-neutral-500">Pick an agent config to view activity.</p>
        ) : agentEvents.length === 0 ? (
          <p className="text-sm text-neutral-500">No agent events yet for this config.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-neutral-800">
            <div className="grid grid-cols-[1fr_auto] border-b border-neutral-800 bg-neutral-900/70 px-4 py-2 text-[11px] uppercase tracking-wider text-neutral-500">
              <div>Event</div>
              <div>Policy / Node</div>
            </div>
            <div className="divide-y divide-neutral-800">
              {agentEvents.map((ev, i) => (
                <div key={ev?.id ?? i} className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {ev?.type ?? "event"}
                      <span className="ml-2 text-neutral-500 font-normal">
                        {ev?.message ? `— ${ev.message}` : ""}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {fmtTime(ev?.ts_ms ?? ev?.time_ms ?? Date.now())}
                    </p>
                  </div>
                  <div className="max-w-[44ch] text-right text-xs font-mono text-neutral-400">
                    {ev?.policy ? `policy=${ev.policy}` : "policy=unknown"}
                    {ev?.chosen_node ? `  node=${ev.chosen_node}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}