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

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
          <p className="text-neutral-400 mt-1">User info + learner/agent configs you’ve used.</p>
          {err ? <p className="text-sm text-rose-400 mt-2">{err}</p> : null}
        </div>

        <button
          onClick={refresh}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-neutral-900/60 border border-neutral-800 hover:bg-neutral-800/60 transition-colors text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* User card */}
        <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-neutral-800 flex items-center justify-center">
              <UserIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-neutral-400">Signed in as</p>
              <p className="font-semibold truncate">{user?.full_name ?? "—"}</p>
            </div>
          </div>

          <div className="space-y-2 text-sm text-neutral-300">
            <div className="flex justify-between gap-3">
              <span className="text-neutral-500">Email</span>
              <span className="truncate">{user?.email ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-neutral-500">Role</span>
              <span>{user?.is_admin ? "Admin" : "User"}</span>
            </div>
          </div>
        </div>

        {/* Current learner card */}
        <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-6 lg:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-neutral-800 flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-neutral-400">Current learner</p>
              <p className="font-semibold truncate">{learnerLabel}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
              <p className="text-neutral-500">Learner kind</p>
              <p className="mt-1 font-medium">{cfg?.learner_kind ?? "—"}</p>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
              <p className="text-neutral-500">Goal kind</p>
              <p className="mt-1 font-medium">{cfg?.goal_kind ?? "—"}</p>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
              <p className="text-neutral-500">Seed</p>
              <p className="mt-1 font-medium">{cfg?.seed ?? "—"}</p>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
              <p className="text-neutral-500">Learner kwargs</p>
              <p className="mt-1 font-mono text-xs break-words">
                {cfg?.learner_kwargs ? JSON.stringify(cfg.learner_kwargs) : "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Agent history */}
      <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4" />
          <h2 className="text-xl font-bold">Agent history (configs you used)</h2>
        </div>

        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No agent history yet. Run simulation / submit at least 1 job.
          </p>
        ) : (
          <div className="divide-y divide-neutral-800">
            {history.map((h, i) => {
              const c = h.config;
              const active = selectedKey && cfgKey(c) === selectedKey;

              return (
                <button
                  key={`${h.time_ms}-${i}`}
                  onClick={() => setSelectedCfg(c)}
                  className={`w-full text-left py-3 px-2 rounded-xl transition ${
                    active
                      ? "bg-indigo-500/10 border border-indigo-500/20"
                      : "hover:bg-neutral-800/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{cfgLabel(c)}</p>
                      <p className="text-xs text-neutral-500 mt-1">{fmtTime(h.time_ms)}</p>
                    </div>

                    <div className="text-xs text-neutral-500 font-mono max-w-[55%] break-words text-right">
                      {c.seed != null ? `seed=${c.seed}` : ""}
                      {c.learner_kwargs ? ` kwargs=${JSON.stringify(c.learner_kwargs)}` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Explanations for selected agent */}
      <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4" />
          <h2 className="text-xl font-bold">
            Recent learner activity (agent explanations)
            {selectedCfg ? (
              <span className="text-sm font-normal text-neutral-500 ml-2">
                — {cfgLabel(selectedCfg)}
              </span>
            ) : null}
          </h2>
        </div>

        {loading || eventsLoading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : !selectedCfg ? (
          <p className="text-sm text-neutral-500">Pick an agent config from history to view events.</p>
        ) : agentEvents.length === 0 ? (
          <p className="text-sm text-neutral-500">No agent events yet for this config.</p>
        ) : (
          <div className="divide-y divide-neutral-800">
            {agentEvents.map((ev, i) => (
              <div key={ev?.id ?? i} className="py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {ev?.type ?? "event"}{" "}
                      <span className="text-neutral-500 font-normal">
                        {ev?.message ? `— ${ev.message}` : ""}
                      </span>
                    </p>
                    <p className="text-xs text-neutral-500 mt-1">
                      {fmtTime(ev?.ts_ms ?? ev?.time_ms ?? Date.now())}
                    </p>
                  </div>

                  <div className="text-xs text-neutral-500 font-mono text-right break-words max-w-[45%]">
                    {ev?.policy ? `policy=${ev.policy}` : ""}
                    {ev?.chosen_node ? ` node=${ev.chosen_node}` : ""}
                  </div>
                </div>

                {ev?.detail ? (
                  <pre className="mt-2 text-xs text-neutral-400 bg-neutral-950/40 border border-neutral-800 rounded-xl p-3 overflow-auto">
                    {JSON.stringify(ev.detail, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}