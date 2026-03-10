import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  Play,
  Pause,
  RotateCcw,
  Settings2,
  Cpu,
  Zap,
  Network,
  Plus,
  Trophy,
  History,
  Activity,
  FileCode2,
} from "lucide-react";
import { motion as Motion, AnimatePresence } from "motion/react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  LineChart,
  Tooltip,
  Legend,
  Line,
} from "recharts";

import {
  explainSimulation,
  getNodes,
  listNodeGroups,
  submitJob,
  getLearnerStats,
  getPending,
  getLatencyStats,
  getStats,
  resetManager,
  getRecentExplanations,
  getNodeJobStatus,
  type AgentConfig,
  type NodeGroup,
  type JobExecutionRecord,
} from "../../lib/api";

type Json = Record<string, any>;

type Policy = "round-robin" | "least-loaded" | "resource-aware" | "random";
type ManualOverridePolicy = Policy | "none";

interface NodeUI {
  id: string;
  name: string;
  cpuCapacity: number;
  memCapacity: number;
  cpuUsed: number;
  memUsed: number;
  cpuPct: number;
  memPct: number;
  queueLen: number | null;
  inFlight: number | null;
  completedLast60s: number | null;
  nodeSpeed: number | null;
  ewmaLatencyMs: number | null;
  p95LatencyMs: number | null;
  tasks: any[];
  status: "active" | "draining" | "offline";
}

interface PolicyStatUI {
  policy: Policy;
  completedTasks: number;
  totalLatency: number;
  avgLatency: number;
  recentLatency: number[];
  reward: number;
  selectionPct: number;
}

interface AgentState {
  isActive: boolean;
  explorationRate: number;
  lastDecisionTime: number;
  status: "exploring" | "optimizing" | "monitoring";
}

type RealJobUI = JobExecutionRecord & {
  node_host?: string | null;
  node_port?: number | null;
};

type SelectOptionWithDescription = {
  value: string;
  label: string;
  description: string;
};

function HoverInfoSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOptionWithDescription[];
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<SelectOptionWithDescription | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (ev: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(ev.target as Node)) {
        setOpen(false);
        setHovered(null);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const selected = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className="space-y-2" ref={rootRef}>
      <label className="text-sm font-medium text-neutral-400">{label}</label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-700"
        >
          <span>{selected?.label ?? value}</span>
          <span className="text-neutral-500">{open ? "▴" : "▾"}</span>
        </button>

        {open ? (
          <div className="absolute left-0 right-0 top-full z-[85] mt-1 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 shadow-2xl">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onMouseEnter={() => setHovered(o)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                  setHovered(null);
                }}
                className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                  value === o.value
                    ? "bg-indigo-500/20 text-indigo-300"
                    : "text-neutral-200 hover:bg-neutral-800"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : null}

        {open && hovered ? (
          <div className="pointer-events-none absolute left-full top-0 z-[90] ml-3 w-96 rounded-xl border border-neutral-700 bg-neutral-900 p-4 shadow-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
              {label} Description
            </div>
            <div className="mt-1 text-sm font-semibold text-neutral-100">{hovered.label}</div>
            <div className="mt-2 text-sm leading-relaxed text-neutral-300">{hovered.description}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const POLICY_COLORS: Record<Policy, string> = {
  "round-robin": "#6366f1",
  "least-loaded": "#10b981",
  "resource-aware": "#a855f7",
  random: "#f59e0b",
};

function nowMs() {
  return Date.now();
}

function safePct(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function mkJobId() {
  return `job_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function buildCpuSpikeScript(durationSeconds: number, workScale: number): string {
  return `
import math
import time

end_t = time.time() + ${Math.max(1, durationSeconds)}
acc = 0.0
scale = ${Math.max(1, workScale)}

while time.time() < end_t:
    for i in range(200000 * scale):
        acc += math.sqrt((i % 1000) + 1)

print("cpu_spike_done", round(acc, 3))
`.trim();
}

function normalizeNodeKey(x: unknown): string {
  return String(x ?? "").trim().toLowerCase();
}

function normalizePolicyKey(k: string): string {
  return (k || "").toLowerCase().replace(/\s+/g, "_");
}

function backendKeyToUiPolicy(k: string): Policy | null {
  const kk = normalizePolicyKey(k);
  if (kk.includes("round") && kk.includes("robin")) return "round-robin";
  if (kk.includes("least") && (kk.includes("load") || kk.includes("loaded"))) {
    return "least-loaded";
  }
  if (kk.includes("resource") && (kk.includes("aware") || kk.includes("awareness"))) {
    return "resource-aware";
  }
  if (kk.includes("random")) return "random";
  return null;
}

function extractReward(stat: any): number {
  if (!stat || typeof stat !== "object") return 0;
  if (typeof stat.mean_reward === "number") return stat.mean_reward;
  if (typeof stat.Q === "number") return stat.Q;
  if (typeof stat.mean === "number") return stat.mean;
  if (typeof stat.mean_window === "number") return stat.mean_window;
  return 0;
}

function buildPolicyStatsFromBackend(
  learnerStats: Record<string, any>,
  latencyStats: Record<string, any>,
  rewardStats: Record<string, any>,
  prev: Record<Policy, PolicyStatUI>,
  selectedPolicies: Policy[] = []
): Record<Policy, PolicyStatUI> {
  const next: Record<Policy, PolicyStatUI> = { ...prev };

  for (const [k, v] of Object.entries(latencyStats || {})) {
    const ui = backendKeyToUiPolicy(k);
    if (!ui) continue;

    const n = typeof (v as any)?.n === "number" ? (v as any).n : 0;
    const avg = typeof (v as any)?.avg_latency_ms === "number" ? (v as any).avg_latency_ms : 0;
    const total =
      typeof (v as any)?.total_latency_ms === "number"
        ? (v as any).total_latency_ms
        : avg > 0
          ? avg * n
          : 0;

    const prevStat = next[ui];
    const recent = avg > 0 ? [...prevStat.recentLatency, avg].slice(-10) : prevStat.recentLatency;

    next[ui] = {
      ...prevStat,
      completedTasks: n,
      avgLatency: avg > 0 ? avg : prevStat.avgLatency,
      totalLatency: total > 0 ? total : prevStat.totalLatency,
      recentLatency: recent,
    };
  }

  for (const [k, v] of Object.entries(learnerStats || {})) {
    const ui = backendKeyToUiPolicy(k);
    if (!ui) continue;
    const r = extractReward(v);

    next[ui] = {
      ...next[ui],
      reward: Number.isFinite(r) ? r : next[ui].reward,
    };
  }

  // Prefer realized reward from backend goal mapping when available.
  // This keeps UI reward aligned with configured goal/weights.
  for (const [k, v] of Object.entries(rewardStats || {})) {
    const ui = backendKeyToUiPolicy(k);
    if (!ui) continue;
    const avgReward = typeof (v as any)?.avg_reward === "number" ? (v as any).avg_reward : null;
    if (avgReward == null || !Number.isFinite(avgReward)) continue;
    next[ui] = {
      ...next[ui],
      reward: avgReward,
    };
  }

  const active = (selectedPolicies?.length ? selectedPolicies : (Object.keys(next) as Policy[])) as Policy[];
  const totalCompleted = active.reduce((acc, p) => acc + (next[p]?.completedTasks || 0), 0);

  for (const p of active) {
    const n = next[p]?.completedTasks || 0;
    next[p] = {
      ...next[p],
      selectionPct: totalCompleted > 0 ? (n / totalCompleted) * 100 : 0,
    };
  }

  const all: Policy[] = ["round-robin", "least-loaded", "resource-aware", "random"];
  for (const p of all) {
    if (!active.includes(p)) next[p] = { ...next[p], selectionPct: 0 };
  }

  return next;
}

export function Simulation() {
  const [isRunning, setIsRunning] = useState(false);

  const [explainOpen, setExplainOpen] = useState(false);
  const [currentExplanation, setCurrentExplanation] = useState<any | null>(null);
  const [latestExplanation, setLatestExplanation] = useState<any | null>(null);
  const [aiExplainLoading, setAiExplainLoading] = useState(false);
  const [spikeEvents, setSpikeEvents] = useState(0);
  const lastExplainTmsRef = useRef<number>(0);
  const resumeRunningRef = useRef<boolean>(false);

  const [isAgentControlled, setIsAgentControlled] = useState(false);
  const [policy, setPolicy] = useState<ManualOverridePolicy>("none");

  type RewardPoint = {
    t: number;
    [policy: string]: number;
  };
  const [rewardHistory, setRewardHistory] = useState<RewardPoint[]>([]);
  const [seenPolicies, setSeenPolicies] = useState<Set<Policy>>(new Set());
  const rewardTickRef = useRef<number>(0);

  const [currentRouteStrategy, setCurrentRouteStrategy] = useState<Policy>("round-robin");

  const [lastChosenNodeId, setLastChosenNodeId] = useState<string | null>(null);
  const [lastChosenNodeLabel, setLastChosenNodeLabel] = useState<string>("—");

  const [simulationSpeed, setSimulationSpeed] = useState(1);

  const [nodes, setNodes] = useState<NodeUI[]>([]);
  const [rawNodes, setRawNodes] = useState<any[]>([]);

  const [incomingJobs, setIncomingJobs] = useState(0);
  const [submittedJobs, setSubmittedJobs] = useState(0);
  const simStartMsRef = useRef<number | null>(null);

  const [policyStats, setPolicyStats] = useState<Record<Policy, PolicyStatUI>>({
    "round-robin": {
      policy: "round-robin",
      completedTasks: 0,
      totalLatency: 0,
      avgLatency: 0,
      recentLatency: [],
      reward: 0,
      selectionPct: 0,
    },
    "least-loaded": {
      policy: "least-loaded",
      completedTasks: 0,
      totalLatency: 0,
      avgLatency: 0,
      recentLatency: [],
      reward: 0,
      selectionPct: 0,
    },
    "resource-aware": {
      policy: "resource-aware",
      completedTasks: 0,
      totalLatency: 0,
      avgLatency: 0,
      recentLatency: [],
      reward: 0,
      selectionPct: 0,
    },
    random: {
      policy: "random",
      completedTasks: 0,
      totalLatency: 0,
      avgLatency: 0,
      recentLatency: [],
      reward: 0,
      selectionPct: 0,
    },
  });

  const [agent, setAgent] = useState<AgentState>({
    isActive: false,
    explorationRate: 1.0,
    lastDecisionTime: Date.now(),
    status: "exploring",
  });

  const [overallAvgLatencyMs, setOverallAvgLatencyMs] = useState<number>(0);
  const [overallLatencyTrail, setOverallLatencyTrail] = useState<number[]>([]);

  const [manualTask, setManualTask] = useState({ cpu: 20, mem: 128, duration: 10 });
  const [spikeParallelJobs, setSpikeParallelJobs] = useState(20);

  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadedScript, setUploadedScript] = useState("");
  const [scriptArgs, setScriptArgs] = useState("");
  const [scriptTimeoutS, setScriptTimeoutS] = useState(60);
  const [realJobError, setRealJobError] = useState<string | null>(null);
  const [submittingRealJob, setSubmittingRealJob] = useState(false);
  const [realJobs, setRealJobs] = useState<RealJobUI[]>([]);

  const POLICY_OPTIONS: { ui: Policy; backend: string; label: string }[] = useMemo(
    () => [
      { ui: "round-robin", backend: "round_robin", label: "Round Robin" },
      { ui: "least-loaded", backend: "least_loaded", label: "Least Loaded" },
      { ui: "resource-aware", backend: "resource_aware", label: "Resource Aware" },
      { ui: "random", backend: "random", label: "Random" },
    ],
    []
  );

  const LEARNER_OPTIONS = useMemo(
    () => [
      {
        value: "ucb1",
        label: "UCB1",
        description: "Balances exploration and exploitation with confidence bounds; favors policies with high reward and uncertainty.",
      },
      {
        value: "sample_average",
        label: "Sample Average",
        description: "Uses the simple average reward of each policy over all history; stable but slower to adapt.",
      },
      {
        value: "ema",
        label: "EMA",
        description: "Weights recent rewards more than older ones; adapts faster to changing node behavior.",
      },
      {
        value: "thompson_gaussian",
        label: "Thompson (Gaussian)",
        description: "Samples from a reward distribution per policy to trade off exploration and exploitation probabilistically.",
      },
      {
        value: "sliding_window",
        label: "Sliding Window",
        description: "Learns from only the most recent rewards in a fixed window; useful when conditions shift often.",
      },
      {
        value: "contextual_linear",
        label: "Contextual Linear",
        description: "Uses workload/system features to predict policy reward for the current context rather than global averages.",
      },
    ],
    []
  );

  const GOAL_OPTIONS = useMemo(
    () => [
      {
        value: "min_mean_latency",
        label: "Min Mean Latency",
        description: "Optimizes average response time by rewarding lower latency directly.",
      },
      {
        value: "min_latency_with_sla",
        label: "Min Latency w/ SLA",
        description: "Optimizes latency but adds extra penalty when requests exceed the SLA threshold.",
      },
      {
        value: "min_latency_plus_tail",
        label: "Min Latency + Tail",
        description: "Optimizes latency while also penalizing p95 tail latency, weighted by tail weight.",
      },
    ],
    []
  );

  const [learnerKind, setLearnerKind] = useState<string>("ucb1");
  const [goalKind, setGoalKind] = useState<string>("min_mean_latency");
  const [seed, setSeed] = useState<number | null>(null);

  const [selectedPolicies, setSelectedPolicies] = useState<Policy[]>([
    "round-robin",
    "least-loaded",
    "resource-aware",
    "random",
  ]);

  const [slaMs, setSlaMs] = useState<number>(750);
  const [tailWeight, setTailWeight] = useState<number>(0.5);

  const agentConfig = useMemo<AgentConfig>(() => {
    const backendPolicies = POLICY_OPTIONS.filter((p) => selectedPolicies.includes(p.ui)).map(
      (p) => p.backend
    );

    const learner_kwargs: Json = {
      policy_allowlist: backendPolicies,
    };
    if (learnerKind === "contextual_linear") {
      learner_kwargs.feature_keys = [
        "node_count",
        "avg_load",
        "max_load",
        "load_imbalance",
        "avg_cpu",
        "max_cpu",
        "job_size_ms",
      ];
    }

    const goal_kwargs: Json = {};
    if (goalKind === "min_latency_with_sla") goal_kwargs.sla_ms = slaMs;
    if (goalKind === "min_latency_plus_tail") goal_kwargs.tail_weight = tailWeight;

    return {
      learner_kind: learnerKind,
      goal_kind: goalKind,
      seed,
      learner_kwargs,
      goal_kwargs,
    };
  }, [POLICY_OPTIONS, selectedPolicies, learnerKind, goalKind, seed, slaMs, tailWeight]);

  const { user } = useAuth() as { user?: { id?: string; email?: string } };
  const userId = user?.id ?? user?.email ?? "anon";
  const [connectedNodeKeys, setConnectedNodeKeys] = useState<string[]>([]);
  const [nodeGroups, setNodeGroups] = useState<NodeGroup[]>([]);
  const [selectedSimulationGroupId, setSelectedSimulationGroupId] = useState<number | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);

  const connectedStorageKey = useMemo(
    () => `nodes.connected.${user?.id ?? "anonymous"}`,
    [user?.id]
  );

  useEffect(() => {
    const loadConnected = () => {
      try {
        const raw = localStorage.getItem(connectedStorageKey);
        if (!raw) {
          setConnectedNodeKeys([]);
          return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setConnectedNodeKeys(parsed.filter((x) => typeof x === "string"));
        } else {
          setConnectedNodeKeys([]);
        }
      } catch {
        setConnectedNodeKeys([]);
      }
    };

    loadConnected();
    const onStorage = (e: StorageEvent) => {
      if (e.key === connectedStorageKey) loadConnected();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [connectedStorageKey]);

  useEffect(() => {
    if (!user?.id) {
      setNodeGroups([]);
      setSelectedSimulationGroupId(null);
      return;
    }
    let active = true;
    const loadGroups = async () => {
      try {
        const groupsResp = await listNodeGroups(user.id!);
        if (!active) return;
        const rows = groupsResp.rows ?? [];
        setNodeGroups(rows);
        setSelectedSimulationGroupId((prev) => {
          if (prev != null && rows.some((g) => g.id === prev)) return prev;
          return null;
        });
      } catch {
        if (!active) return;
        setNodeGroups([]);
        setSelectedSimulationGroupId(null);
      }
    };
    void loadGroups();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const selectedSimulationGroup = useMemo(
    () => nodeGroups.find((g) => g.id === selectedSimulationGroupId) ?? null,
    [nodeGroups, selectedSimulationGroupId]
  );

  const selectedSimulationGroupNodeKeys = useMemo(() => {
    if (!selectedSimulationGroup) return new Set<string>();
    return new Set<string>(selectedSimulationGroup.nodes.map((n) => normalizeNodeKey(n.nodeKey)));
  }, [selectedSimulationGroup]);

  const connectedNodeKeySet = useMemo(
    () => new Set<string>(connectedNodeKeys.map((k) => normalizeNodeKey(k))),
    [connectedNodeKeys]
  );

  const selectedGroupConnectedNodeKeys = useMemo(() => {
    if (!selectedSimulationGroup) return new Set<string>();
    const result = new Set<string>();
    selectedSimulationGroupNodeKeys.forEach((k) => {
      if (connectedNodeKeySet.has(k)) result.add(k);
    });
    return result;
  }, [selectedSimulationGroup, selectedSimulationGroupNodeKeys, connectedNodeKeySet]);

  const allowedNodeKeys = useMemo(() => {
    if (selectedSimulationGroup) return selectedGroupConnectedNodeKeys;
    if (nodeGroups.length > 0) return new Set<string>();
    return connectedNodeKeySet;
  }, [connectedNodeKeySet, nodeGroups.length, selectedSimulationGroup, selectedGroupConnectedNodeKeys]);

  const renderNodes = useMemo<NodeUI[]>(() => {
    if (nodes.length > 0) return nodes;
    if (!selectedSimulationGroup) return [];
    return selectedSimulationGroup.nodes
      .filter((n) => connectedNodeKeySet.has(normalizeNodeKey(n.nodeKey)))
      .map((n) => ({
        id: `${n.host}:${n.port}`,
        name: n.nodeName || `${n.host}:${n.port}`,
        cpuCapacity: 100,
        memCapacity: 100,
        cpuUsed: 0,
        memUsed: 0,
        cpuPct: 0,
        memPct: 0,
        queueLen: null,
        inFlight: null,
        completedLast60s: null,
        nodeSpeed: null,
        ewmaLatencyMs: null,
        p95LatencyMs: null,
        tasks: [],
        status: "offline",
      }));
  }, [nodes, selectedSimulationGroup, connectedNodeKeySet]);

  const pollNodes = useCallback(async () => {
    try {
      const nodesResp = await getNodes();
      const fetchedRawNodes = nodesResp.nodes || [];
      const connectedSet = new Set<string>(connectedNodeKeys.map((k) => normalizeNodeKey(k)));

      const filteredRaw = fetchedRawNodes.filter((n: any) => {
        const hostPort = normalizeNodeKey(`${n?.host}:${n?.port}`);
        const name = normalizeNodeKey(n?.name);
        const instanceId = normalizeNodeKey(n?.instance_id);
        const hostPortName = normalizeNodeKey(`${n?.host}:${n?.port}:${n?.name ?? ""}`);
        if (allowedNodeKeys.size === 0) return false;
        return (
          allowedNodeKeys.has(hostPort) ||
          allowedNodeKeys.has(name) ||
          allowedNodeKeys.has(instanceId) ||
          allowedNodeKeys.has(hostPortName)
        );
      });

      setRawNodes(filteredRaw);

      const mapped: NodeUI[] = filteredRaw.map((n: any) => {
        const cpuPct = safePct(n.cpu_pct);
        const memPct = safePct(n.mem_pct);
        const cpuCap = 100;
        const memCap = 100;
        const online = !(n as any).error && (n.cpu_pct != null || n.mem_pct != null);

        const hostPort = normalizeNodeKey(`${n?.host}:${n?.port}`);
        const name = normalizeNodeKey(n?.name);
        const instanceId = normalizeNodeKey(n?.instance_id);
        const hostPortName = normalizeNodeKey(`${n?.host}:${n?.port}:${n?.name ?? ""}`);
        const isUserConnected =
          connectedSet.has(hostPort) ||
          connectedSet.has(name) ||
          connectedSet.has(instanceId) ||
          connectedSet.has(hostPortName);

        return {
          id: `${n.host}:${n.port}`,
          name: (n.name ?? `${n.host}:${n.port}`).toLowerCase(),
          cpuCapacity: cpuCap,
          memCapacity: memCap,
          cpuUsed: (cpuPct / 100) * cpuCap,
          memUsed: (memPct / 100) * memCap,
          cpuPct,
          memPct,
          queueLen: Number.isFinite(Number(n?.queue_len)) ? Number(n.queue_len) : null,
          inFlight: Number.isFinite(Number(n?.in_flight)) ? Number(n.in_flight) : null,
          completedLast60s: Number.isFinite(Number(n?.completed_last_60s))
            ? Number(n.completed_last_60s)
            : null,
          nodeSpeed: Number.isFinite(Number(n?.node_speed)) ? Number(n.node_speed) : null,
          ewmaLatencyMs: Number.isFinite(Number(n?.ewma_latency_ms)) ? Number(n.ewma_latency_ms) : null,
          p95LatencyMs: Number.isFinite(Number(n?.p95_latency_ms)) ? Number(n.p95_latency_ms) : null,
          tasks: [],
          status: online && isUserConnected ? "active" : "offline",
        };
      });

      setNodes(mapped);
    } catch {
      // Keep last known good metrics on transient poll errors so UI
      // does not snap to fake zero/offline values.
    }
  }, [allowedNodeKeys, connectedNodeKeys]);

  const serviceTimeMsFromCpu = useCallback((cpu: number) => {
    return Math.max(50, Math.round(150 + cpu * 12));
  }, []);

  const submitOneJob = useCallback(
    async (metadata: Json = {}) => {
      if (nodeGroups.length > 0) {
        if (!selectedSimulationGroup) {
          setScopeError("Select a node group before submitting jobs.");
          return;
        }
        if (allowedNodeKeys.size === 0) {
          setScopeError("No connected nodes in this group. Connect group nodes first.");
          return;
        }
      }

      const manualPolicyBackend =
        policy === "none" ? null : POLICY_OPTIONS.find((p) => p.ui === policy)?.backend ?? null;

      const job = {
        job_id: mkJobId(),
        user_id: userId,
        service_time_ms: serviceTimeMsFromCpu(manualTask.cpu),
        metadata: {
          cpu_intensity: manualTask.cpu,
          mem_hint: manualTask.mem,
          duration_hint: manualTask.duration,
          selected_group_id: selectedSimulationGroup?.id ?? null,
          selected_group_name: selectedSimulationGroup?.name ?? null,
          allowed_node_keys: Array.from(allowedNodeKeys),
          manual_policy: isAgentControlled ? null : manualPolicyBackend,
          ...metadata,
        },
      };

      try {
        const resp: any = await submitJob({ config: agentConfig, job });
        setSubmittedJobs((p) => p + 1);

        const host = resp?.decision?.node?.host ?? resp?.decision?.host ?? null;
        const port = resp?.decision?.node?.port ?? resp?.decision?.port ?? null;
        const nodeName = resp?.decision?.node?.name ?? resp?.decision?.node_name ?? null;

        if (host && port != null) {
          const id = `${host}:${port}`;
          setLastChosenNodeId(id);
          setLastChosenNodeLabel(nodeName ? `${nodeName} (${id})` : id);
        } else if (nodeName) {
          setLastChosenNodeId(nodeName);
          setLastChosenNodeLabel(nodeName);
        } else {
          setLastChosenNodeId(null);
          setLastChosenNodeLabel("—");
        }

        if (isAgentControlled) {
          const chosen =
            resp?.decision?.policy ??
            resp?.decision?.policy_name ??
            resp?.decision?.policy_kind ??
            null;

          const ui = typeof chosen === "string" ? backendKeyToUiPolicy(chosen) : null;
          if (ui) setCurrentRouteStrategy(ui);
        } else {
          setCurrentRouteStrategy(policy as Policy);
        }
      } catch (e) {
        console.error("submitJob failed:", e);
      }
    },
    [
      agentConfig,
      manualTask.cpu,
      manualTask.mem,
      manualTask.duration,
      isAgentControlled,
      policy,
      POLICY_OPTIONS,
      nodeGroups.length,
      selectedSimulationGroup,
      selectedSimulationGroup?.id,
      selectedSimulationGroup?.name,
      allowedNodeKeys,
      userId,
      serviceTimeMsFromCpu,
    ]
  );

  const onPythonFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".py")) {
        setRealJobError("Please upload a .py file");
        return;
      }

      try {
        const text = await file.text();
        setUploadedFileName(file.name);
        setUploadedScript(text);
        setRealJobError(null);
      } catch (err) {
        console.error("Failed to read uploaded file:", err);
        setRealJobError("Failed to read the uploaded file");
      }
    },
    []
  );

  const submitRealJob = useCallback(async () => {
    if (!uploadedScript.trim()) {
      setRealJobError("Upload a Python script first.");
      return;
    }

    if (nodeGroups.length > 0) {
      if (!selectedSimulationGroup) {
        setRealJobError("Select a node group before submitting real jobs.");
        return;
      }
      if (allowedNodeKeys.size === 0) {
        setRealJobError("No connected nodes in this group. Connect group nodes first.");
        return;
      }
    }

    const manualPolicyBackend =
      POLICY_OPTIONS.find((p) => p.ui === policy)?.backend ?? "round_robin";

    const jobId = mkJobId();

    const job = {
      job_id: jobId,
      user_id: userId,
      job_type: "python" as const,
      script_name: uploadedFileName || "job.py",
      script_content: uploadedScript,
      args: scriptArgs
        .split(" ")
        .map((x) => x.trim())
        .filter(Boolean),
      timeout_s: scriptTimeoutS,
      metadata: {
        selected_group_id: selectedSimulationGroup?.id ?? null,
        selected_group_name: selectedSimulationGroup?.name ?? null,
        allowed_node_keys: Array.from(allowedNodeKeys),
        manual_policy: isAgentControlled ? null : manualPolicyBackend,
      },
    };

    try {
      setSubmittingRealJob(true);
      setRealJobError(null);

      const resp: any = await submitJob({ config: agentConfig, job });

      const host =
        resp?.node_response?.node_host ??
        resp?.decision?.node?.host ??
        resp?.decision?.host ??
        null;

      const port =
        resp?.node_response?.node_port ??
        resp?.decision?.node?.port ??
        resp?.decision?.port ??
        null;

      const nodeName =
        resp?.node_response?.node_name ??
        resp?.decision?.node?.name ??
        resp?.decision?.node_name ??
        null;

      setRealJobs((prev) => [
        {
          job_id: jobId,
          user_id: userId,
          job_type: "python",
          script_name: uploadedFileName || "job.py",
          status: "queued",
          queued_at_ms: Date.now(),
          started_at_ms: null,
          finished_at_ms: null,
          observed_latency_ms: null,
          service_time_ms: null,
          exit_code: null,
          stdout: null,
          stderr: null,
          node_name: nodeName ?? null,
          node_host: host ?? null,
          node_port: port ?? null,
        },
        ...prev,
      ]);
    } catch (err: any) {
      console.error("submitRealJob failed:", err);
      setRealJobError(err?.message ?? "Failed to submit real job");
    } finally {
      setSubmittingRealJob(false);
    }
  }, [
    uploadedScript,
    uploadedFileName,
    scriptArgs,
    scriptTimeoutS,
    nodeGroups.length,
    selectedSimulationGroup,
    selectedSimulationGroup?.id,
    selectedSimulationGroup?.name,
    allowedNodeKeys,
    policy,
    isAgentControlled,
    agentConfig,
    userId,
    POLICY_OPTIONS,
  ]);

  const spikeLoad = useCallback(async () => {
    setSpikeEvents((v) => v + 1);
    // Constrain spike routing to nodes currently running in this simulation scope.
    const jobsToSend = Math.max(1, Math.floor(Number(spikeParallelJobs) || 1));
    const activeNodeKeys = nodes
      .filter((n) => n.status === "active")
      .map((n) => normalizeNodeKey(n.id));

    if (activeNodeKeys.length === 0) {
      setScopeError("No active simulation nodes available for spike load.");
      return;
    }

    const manualPolicyBackend =
      policy === "none" ? null : POLICY_OPTIONS.find((p) => p.ui === policy)?.backend ?? null;
    const spikeDurationS = Math.max(2, Math.min(30, Math.floor(Number(manualTask.duration) || 6)));
    const workScale = Math.max(1, Math.min(4, Math.floor((Number(manualTask.mem) || 128) / 128)));
    const spikeScript = buildCpuSpikeScript(spikeDurationS, workScale);

    const burst = Array.from({ length: jobsToSend }, async (_, i) => {
      const job = {
        job_id: mkJobId(),
        user_id: userId,
        job_type: "python" as const,
        script_name: `cpu_spike_${i + 1}.py`,
        script_content: spikeScript,
        args: [],
        timeout_s: Math.max(15, spikeDurationS + 10),
        metadata: {
          spike: true,
          idx: i,
          cpu_intensity: manualTask.cpu,
          selected_group_id: selectedSimulationGroup?.id ?? null,
          selected_group_name: selectedSimulationGroup?.name ?? null,
          allowed_node_keys: activeNodeKeys,
          manual_policy: isAgentControlled ? null : manualPolicyBackend,
          spike_jobs_requested: jobsToSend,
          spike_mode: "cpu_bound_python",
        },
      };

      try {
        const resp: any = await submitJob({ config: agentConfig, job });
        setSubmittedJobs((p) => p + 1);
        const host = resp?.decision?.node?.host ?? resp?.decision?.host ?? null;
        const port = resp?.decision?.node?.port ?? resp?.decision?.port ?? null;
        const nodeName = resp?.decision?.node?.name ?? resp?.decision?.node_name ?? null;

        if (host && port != null) {
          const id = `${host}:${port}`;
          setLastChosenNodeId(id);
          setLastChosenNodeLabel(nodeName ? `${nodeName} (${id})` : id);
        } else if (nodeName) {
          setLastChosenNodeId(nodeName);
          setLastChosenNodeLabel(nodeName);
        }

        if (isAgentControlled) {
          const chosen =
            resp?.decision?.policy ??
            resp?.decision?.policy_name ??
            resp?.decision?.policy_kind ??
            null;
          const ui = typeof chosen === "string" ? backendKeyToUiPolicy(chosen) : null;
          if (ui) setCurrentRouteStrategy(ui);
        } else if (policy !== "none") {
          setCurrentRouteStrategy(policy);
        }
      } catch (e) {
        console.error("spike submit failed:", e);
      }
    });

    await Promise.allSettled(burst);
    // Pull fresh metrics right after burst dispatch.
    await pollNodes();
  }, [
    spikeParallelJobs,
    manualTask.duration,
    manualTask.mem,
    nodes,
    pollNodes,
    policy,
    POLICY_OPTIONS,
    isAgentControlled,
    userId,
    selectedSimulationGroup?.id,
    selectedSimulationGroup?.name,
    agentConfig,
  ]);

  const fetchLatestExplanation = useCallback(async () => {
    try {
      const data = await getRecentExplanations(agentConfig, 25);
      const events: any[] = data?.events ?? [];

      const last =
        [...events]
          .sort((a, b) => (a.t_ms ?? 0) - (b.t_ms ?? 0))
          .reverse()
          .find((e) => {
            const hasText = typeof e?.text === "string" && e.text.trim().length > 0;
            const isSwitch = e?.kind === "switch" || e?.meta?.switched === true;
            return hasText && isSwitch;
          }) ?? null;

      return last;
    } catch (err) {
      console.error("getRecentExplanations failed:", err);
      return null;
    }
  }, [agentConfig]);

  const maybePauseForExplanation = useCallback(async () => {
    if (!isRunning) return;
    if (!isAgentControlled) return;
    if (explainOpen) return;

    const ev = await fetchLatestExplanation();
    const t = Number(ev?.t_ms ?? 0);
    if (!ev || !t) return;
    if (t <= lastExplainTmsRef.current) return;

    lastExplainTmsRef.current = t;
    resumeRunningRef.current = isRunning;

    setLatestExplanation(ev);
    setCurrentExplanation(ev);
    setExplainOpen(true);
    setIsRunning(false);
  }, [explainOpen, fetchLatestExplanation, isAgentControlled, isRunning]);

  const continueAfterExplanation = useCallback(() => {
    setExplainOpen(false);
    setCurrentExplanation(null);
    if (resumeRunningRef.current) setIsRunning(true);
    resumeRunningRef.current = false;
  }, []);

  const pollManager = useCallback(async () => {
    try {
      let pendingIds: string[] = [];
      let learnerStats: Record<string, any> = {};
      let latencyStats: Record<string, any> = {};
      let rewardStats: Record<string, any> = {};
      let summary: any = {};

      try {
        const stats = await getStats(agentConfig);
        pendingIds = stats?.pending_job_ids ?? [];
        learnerStats = stats?.learner ?? {};
        latencyStats = stats?.latency ?? {};
        rewardStats = stats?.reward ?? stats?.summary?.reward_stats ?? {};
        summary = stats?.summary ?? {};
      } catch {
        const p = await getPending(agentConfig);
        pendingIds = p.pending_job_ids ?? [];

        learnerStats = await getLearnerStats(agentConfig);
        latencyStats = await getLatencyStats(agentConfig);
      }

      setIncomingJobs(pendingIds.length);

      setPolicyStats((prev) => {
        const next = buildPolicyStatsFromBackend(
          learnerStats,
          latencyStats,
          rewardStats,
          prev,
          selectedPolicies
        );

        const keys =
          selectedPolicies.length > 0 ? selectedPolicies : (Object.keys(next) as Policy[]);

        // Keep chart series stable/visible even before first completion.
        setSeenPolicies(new Set(keys));

        setRewardHistory((h) => {
          const point: RewardPoint = { t: rewardTickRef.current++ };
          keys.forEach((p) => {
            point[p] = next[p]?.reward ?? 0;
          });
          return [...h, point].slice(-200);
        });

        return next;
      });

      const backendOverall =
        typeof summary?.mean_latency_ms === "number" ? summary.mean_latency_ms : 0;
      setOverallAvgLatencyMs(backendOverall);
      if (backendOverall > 0) {
        setOverallLatencyTrail((prev) => [...prev, backendOverall].slice(-25));
      }

      setAgent((prev) => {
        const nextExploration = isAgentControlled
          ? Math.max(0.05, prev.explorationRate * 0.985)
          : prev.explorationRate;
        return {
          ...prev,
          isActive: isAgentControlled,
          explorationRate: nextExploration,
          status: isAgentControlled
            ? nextExploration > 0.2
              ? "exploring"
              : "optimizing"
            : "monitoring",
          lastDecisionTime: nowMs(),
        };
      });

      await maybePauseForExplanation();
    } catch {
      setIncomingJobs(0);
    }
  }, [agentConfig, isAgentControlled, selectedPolicies, maybePauseForExplanation]);

  useEffect(() => {
    void pollNodes();
    const id = window.setInterval(() => void pollNodes(), 2000);
    return () => window.clearInterval(id);
  }, [pollNodes]);

  useEffect(() => {
    if (realJobs.length === 0) return;

    const id = window.setInterval(async () => {
      const next = await Promise.all(
        realJobs.map(async (job) => {
          if (!job) return job;
          if (job.status !== "queued" && job.status !== "running") return job;

          let host = job.node_host;
          let port = job.node_port;

          if ((!host || !port) && job.node_name) {
            const fallback = rawNodes.find(
              (n: any) =>
                String(n?.name ?? "").toLowerCase() === String(job.node_name ?? "").toLowerCase()
            );
            if (fallback) {
              host = fallback.host;
              port = fallback.port;
            }
          }

          if (!host || !port) return job;

          try {
            const fresh = await getNodeJobStatus(host, port, job.job_id);
            return {
              ...job,
              ...fresh,
              node_host: host,
              node_port: port,
            };
          } catch {
            return job;
          }
        })
      );

      setRealJobs(next);
    }, 2000);

    return () => window.clearInterval(id);
  }, [realJobs, rawNodes]);

  const submitIntervalRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isRunning) {
      if (submitIntervalRef.current) window.clearInterval(submitIntervalRef.current);
      if (pollIntervalRef.current) window.clearInterval(pollIntervalRef.current);
      submitIntervalRef.current = null;
      pollIntervalRef.current = null;
      return;
    }

    if (simStartMsRef.current == null) simStartMsRef.current = nowMs();

    void pollManager();
    pollIntervalRef.current = window.setInterval(() => void pollManager(), 1500);

    const jobsPerSec = Math.max(0, Number(simulationSpeed) || 0);
    if (jobsPerSec > 0) {
      const intervalMs = Math.max(50, Math.floor(1000 / jobsPerSec));
      submitIntervalRef.current = window.setInterval(() => void submitOneJob(), intervalMs);
    }

    return () => {
      if (submitIntervalRef.current) window.clearInterval(submitIntervalRef.current);
      if (pollIntervalRef.current) window.clearInterval(pollIntervalRef.current);
      submitIntervalRef.current = null;
      pollIntervalRef.current = null;
    };
  }, [isRunning, pollManager, submitOneJob, simulationSpeed]);

  const resetSimulation = () => {
    setIsRunning(false);
    setIsAgentControlled(false);
    setIncomingJobs(0);
    setSubmittedJobs(0);
    setOverallAvgLatencyMs(0);
    setOverallLatencyTrail([]);
    simStartMsRef.current = null;
    setRewardHistory([]);
    rewardTickRef.current = 0;
    setSeenPolicies(new Set());
    setPolicy("none");
    setCurrentRouteStrategy("round-robin");
    setLastChosenNodeId(null);
    setLastChosenNodeLabel("—");
    setScopeError(null);

    setUploadedFileName("");
    setUploadedScript("");
    setScriptArgs("");
    setScriptTimeoutS(60);
    setRealJobError(null);
    setSubmittingRealJob(false);
    setRealJobs([]);

    setPolicyStats({
      "round-robin": {
        policy: "round-robin",
        completedTasks: 0,
        totalLatency: 0,
        avgLatency: 0,
        recentLatency: [],
        reward: 0,
        selectionPct: 0,
      },
      "least-loaded": {
        policy: "least-loaded",
        completedTasks: 0,
        totalLatency: 0,
        avgLatency: 0,
        recentLatency: [],
        reward: 0,
        selectionPct: 0,
      },
      "resource-aware": {
        policy: "resource-aware",
        completedTasks: 0,
        totalLatency: 0,
        avgLatency: 0,
        recentLatency: [],
        reward: 0,
        selectionPct: 0,
      },
      random: {
        policy: "random",
        completedTasks: 0,
        totalLatency: 0,
        avgLatency: 0,
        recentLatency: [],
        reward: 0,
        selectionPct: 0,
      },
    });

    setAgent({
      isActive: false,
      explorationRate: 1.0,
      lastDecisionTime: Date.now(),
      status: "exploring",
    });

    setNodes([]);
    setRawNodes([]);

    resetManager()
      .then(() => pollManager())
      .catch((e) => console.error("Backend reset failed:", e));
  };

  const chartData = useMemo(() => {
    return nodes.map((n) => ({
      name: n.name,
      cpu: Math.round((n.cpuUsed / Math.max(1, n.cpuCapacity)) * 100),
    }));
  }, [nodes]);

  const leaderboard = useMemo(() => {
    const arr = Object.values(policyStats).filter((s) => selectedPolicies.includes(s.policy));
    return [...arr].sort((a, b) => {
      const aHas = a.avgLatency > 0;
      const bHas = b.avgLatency > 0;
      if (aHas && bHas) return a.avgLatency - b.avgLatency;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return b.completedTasks - a.completedTasks;
    });
  }, [policyStats, selectedPolicies]);

  const throughput = useMemo(() => {
    const start = simStartMsRef.current;
    if (!start) return 0;
    const elapsedS = (nowMs() - start) / 1000;
    if (elapsedS <= 0) return 0;
    return submittedJobs / elapsedS;
  }, [submittedJobs]);

  const bestByReward = useMemo(() => {
    const active = selectedPolicies.length ? selectedPolicies : (Object.keys(policyStats) as Policy[]);
    return active.reduce(
      (best, p) => (policyStats[p].reward >= policyStats[best].reward ? p : best),
      active[0] || "round-robin"
    );
  }, [policyStats, selectedPolicies]);

  const requestAiExplanation = useCallback(async () => {
    try {
      setAiExplainLoading(true);
      const res = await explainSimulation({
        config: agentConfig,
        context: {
          is_running: isRunning,
          is_agent_controlled: isAgentControlled,
          current_manual_policy: policy,
          current_route_strategy: currentRouteStrategy,
          learner_kind: learnerKind,
          goal_kind: goalKind,
          goal_kwargs: agentConfig.goal_kwargs ?? {},
          selected_policies: selectedPolicies,
          best_policy_by_reward: bestByReward,
          throughput_jps: Number(throughput.toFixed(2)),
          avg_latency_ms: Number(overallAvgLatencyMs.toFixed(2)),
          optimization_trend:
            overallLatencyTrail.length >= 2
              ? overallLatencyTrail[overallLatencyTrail.length - 1] <
                overallLatencyTrail[overallLatencyTrail.length - 2]
                ? "improving"
                : "worsening"
              : "unknown",
          spike_events: spikeEvents,
          node_scope: {
            selected_group_id: selectedSimulationGroup?.id ?? null,
            selected_group_name: selectedSimulationGroup?.name ?? null,
            allowed_node_keys_count: allowedNodeKeys.size,
            connected_visible_nodes: nodes.length,
          },
          policies: Object.values(policyStats).map((s) => ({
            policy: s.policy,
            completed_tasks: s.completedTasks,
            avg_latency_ms: Number(s.avgLatency.toFixed(3)),
            reward: Number(s.reward.toFixed(6)),
            selection_pct: Number(s.selectionPct.toFixed(2)),
            recent_latency_ms: s.recentLatency.slice(-6),
          })),
          diagnostics: {
            incoming_jobs: incomingJobs,
            submitted_jobs: submittedJobs,
            overall_latency_trail: overallLatencyTrail.slice(-10),
            last_chosen_node: lastChosenNodeLabel,
          },
        },
      });
      setLatestExplanation({
        kind: "ai",
        policy: currentRouteStrategy,
        text: res.explanation || "No explanation returned.",
        t_ms: res.time_ms ?? Date.now(),
        meta: {
          source: res.provider || "unknown",
          reason: res.reason || "",
          switched: false,
        },
      });
    } catch (e: any) {
      setLatestExplanation({
        kind: "ai",
        policy: currentRouteStrategy,
        text: `Failed to generate Gemini explanation: ${e?.message ?? "unknown error"}`,
        t_ms: Date.now(),
        meta: {
          source: "error",
          reason: e?.message ?? "unknown error",
          switched: false,
        },
      });
    } finally {
      setAiExplainLoading(false);
    }
  }, [
    agentConfig,
    allowedNodeKeys.size,
    bestByReward,
    currentRouteStrategy,
    incomingJobs,
    isAgentControlled,
    isRunning,
    lastChosenNodeLabel,
    learnerKind,
    nodes.length,
    overallAvgLatencyMs,
    overallLatencyTrail,
    policy,
    policyStats,
    selectedPolicies,
    selectedSimulationGroup?.id,
    selectedSimulationGroup?.name,
    spikeEvents,
    submittedJobs,
    throughput,
    goalKind,
  ]);

  return (
    <div className="space-y-8 pb-12">
      <AnimatePresence>
        {explainOpen && currentExplanation ? (
          <Motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Motion.div
              className="w-full max-w-2xl rounded-2xl border border-white/10 bg-neutral-950 shadow-2xl"
              initial={{ scale: 0.96, y: 10, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.98, y: 10, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
            >
              <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <div className="text-sm font-semibold">Decision explanation</div>
                </div>
                <div className="text-xs text-neutral-400">
                  {currentExplanation?.kind ? String(currentExplanation.kind).toUpperCase() : "EVENT"} •{" "}
                  {currentExplanation?.policy ? String(currentExplanation.policy) : "policy"}
                </div>
              </div>

              <div className="px-5 py-4 space-y-3">
                <div className="text-sm leading-relaxed whitespace-pre-wrap">
                  {currentExplanation?.text ?? "(no explanation text)"}
                </div>

                <div className="grid grid-cols-1 gap-3 text-xs text-neutral-300 md:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-neutral-400">Job</div>
                    <div className="mt-1 break-all font-mono">{currentExplanation?.job_id ?? "—"}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-neutral-400">Node</div>
                    <div className="mt-1 break-all font-mono">{currentExplanation?.node ?? "—"}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-neutral-400">Reward / Latency</div>
                    <div className="mt-1 font-mono">
                      {typeof currentExplanation?.reward === "number"
                        ? currentExplanation.reward.toFixed(3)
                        : "—"}{" "}
                      /{" "}
                      {typeof currentExplanation?.latency_ms === "number"
                        ? Math.round(currentExplanation.latency_ms)
                        : "—"}
                      ms
                    </div>
                  </div>
                </div>

                <details className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <summary className="cursor-pointer select-none text-xs text-neutral-300">
                    Raw metadata (for debugging)
                  </summary>
                  <pre className="mt-2 max-h-56 overflow-auto text-[11px] leading-snug text-neutral-400">
                    {JSON.stringify(
                      {
                        meta: currentExplanation?.meta,
                        context: currentExplanation?.context,
                        learner: currentExplanation?.learner_snapshot,
                      },
                      null,
                      2
                    )}
                  </pre>
                </details>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
                <button
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
                  onClick={continueAfterExplanation}
                >
                  Continue
                </button>
              </div>
            </Motion.div>
          </Motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agentic Resource Simulator</h1>
          <p className="mt-1 text-neutral-400">
            A manager agent that learns the optimal routing policy to minimize latency.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {selectedSimulationGroup
              ? `Group: ${selectedSimulationGroup.name} • connected+visible nodes: ${nodes.length}`
              : `Connected nodes visible to this user: ${nodes.length}`}
          </p>
          {scopeError ? <p className="mt-1 text-xs text-rose-400">{scopeError}</p> : null}
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-2">
          <button
            onClick={() => {
              setIsAgentControlled(!isAgentControlled);
              if (!isRunning) setIsRunning(true);

              if (isAgentControlled) {
                if (policy !== "none") {
                  setCurrentRouteStrategy(policy);
                }
              }
            }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-all ${
              isAgentControlled
                ? "bg-purple-500 text-white shadow-lg shadow-purple-500/20"
                : "bg-neutral-800 text-neutral-400 hover:text-white"
            }`}
          >
            <Cpu className="h-4 w-4" />
            {isAgentControlled ? "Agent Running" : "Enable Manager Agent"}
          </button>

          <div className="mx-1 h-6 w-px bg-neutral-800" />

          <button
            onClick={() => {
              if (!isRunning) {
                if (nodeGroups.length > 0 && !selectedSimulationGroup) {
                  setScopeError("Select a node group before starting the simulation.");
                  return;
                }
                if (selectedSimulationGroup && selectedSimulationGroupNodeKeys.size === 0) {
                  setScopeError("Selected group has no nodes.");
                  return;
                }
                if (selectedSimulationGroup && selectedGroupConnectedNodeKeys.size === 0) {
                  setScopeError("No connected nodes in this group. Connect group nodes first.");
                  return;
                }
                setScopeError(null);
                setIsRunning(true);
                return;
              }
              setIsRunning(false);
            }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-all ${
              isRunning
                ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                : "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-700"
            }`}
          >
            {isRunning ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
            {isRunning ? "Pause" : "Start Sim"}
          </button>

          <button
            onClick={resetSimulation}
            className="rounded-lg p-2 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="space-y-6 lg:col-span-1">
          <AnimatePresence>
            {isAgentControlled && (
              <Motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="group relative overflow-hidden rounded-2xl border border-purple-500/30 bg-purple-950/20 p-6"
              >
                <div className="absolute right-0 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
                  <Cpu className="h-12 w-12 text-purple-400" />
                </div>

                <div className="mb-4 flex items-center gap-2">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-purple-400" />
                  <h3 className="font-semibold text-purple-300">Agent Intelligence</h3>
                </div>

                <div className="relative z-10 space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold uppercase tracking-tighter text-purple-400">Status</span>
                    <span className="rounded border border-purple-400/30 bg-purple-500/40 px-2 py-0.5 capitalize text-white">
                      {agent.status}
                    </span>
                  </div>

                  <div className="space-y-3 pt-2">
                    <div className="flex justify-between text-[10px] text-purple-300">
                      <span>Exploration Rate</span>
                      <span className="font-mono">{(agent.explorationRate * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-purple-900/50">
                      <Motion.div
                        animate={{ width: `${agent.explorationRate * 100}%` }}
                        className="h-full bg-purple-400"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-purple-500/20 pt-2">
                    <p className="mb-2 text-[10px] font-bold uppercase text-purple-400">
                      Policy Reward + Selection
                    </p>

                    {(selectedPolicies as Policy[]).map((p) => {
                      const s = policyStats[p];
                      const pct = s?.selectionPct ?? 0;
                      const reward = s?.reward ?? 0;

                      return (
                        <div key={p} className="space-y-1">
                          <div className="flex justify-between text-[10px]">
                            <span
                              className={`capitalize ${
                                policy === p ? "text-white" : "text-purple-400/60"
                              }`}
                            >
                              {p.replace("-", " ")}
                            </span>
                            <span className="font-mono text-white">
                              {pct > 0 ? `${pct.toFixed(0)}%` : "0%"} · r={reward.toFixed(3)}
                            </span>
                          </div>
                          <div className="h-1 overflow-hidden rounded-full bg-purple-900/30">
                            <Motion.div
                              animate={{
                                width: `${Math.min(100, Math.max(0, pct))}%`,
                                backgroundColor: policy === p ? "#a855f7" : "#581c87",
                              }}
                              className="h-full"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Motion.div>
            )}
          </AnimatePresence>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <div className="mb-6 flex items-center gap-2">
              <Network className="h-5 w-5 text-purple-400" />
              <h3 className="font-semibold">Agent Config</h3>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-400">Simulation Group</label>
                <select
                  value={selectedSimulationGroupId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedSimulationGroupId(v === "" ? null : Number(v));
                    setScopeError(null);
                  }}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200"
                >
                  <option value="">
                    {nodeGroups.length > 0
                      ? "Select a saved group"
                      : "No saved groups (fallback: connected nodes)"}
                  </option>
                  {nodeGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.nodes.length})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] leading-snug text-neutral-500">
                  Simulation uses only nodes in the selected group that you are currently connected to.
                </p>
              </div>

              <HoverInfoSelect
                label="Learner"
                value={learnerKind}
                onChange={setLearnerKind}
                options={LEARNER_OPTIONS}
              />

              <HoverInfoSelect
                label="Goal"
                value={goalKind}
                onChange={setGoalKind}
                options={GOAL_OPTIONS}
              />

              {goalKind === "min_latency_with_sla" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-400">SLA (ms)</label>
                  <input
                    type="number"
                    min={1}
                    value={slaMs}
                    onChange={(e) => setSlaMs(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200"
                  />
                </div>
              )}

              {goalKind === "min_latency_plus_tail" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-400">Tail Weight</label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.05}
                    value={tailWeight}
                    onChange={(e) => setTailWeight(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200"
                  />
                </div>
              )}

              <div className="space-y-3 pt-1">
                <label className="text-sm font-medium text-neutral-400">Learnable Policies</label>
                <div className="grid grid-cols-1 gap-2">
                  {POLICY_OPTIONS.map((p) => {
                    const checked = selectedPolicies.includes(p.ui);
                    return (
                      <button
                        key={p.backend}
                        onClick={() => {
                          setSelectedPolicies((prev) => {
                            const has = prev.includes(p.ui);
                            const next = has ? prev.filter((x) => x !== p.ui) : [...prev, p.ui];
                            return next.length === 0 ? prev : next;
                          });
                        }}
                        className={`rounded-lg border px-3 py-2 text-left text-sm transition-all ${
                          checked
                            ? "border-purple-500/30 bg-purple-500/10 text-purple-300"
                            : "border-transparent text-neutral-500 hover:bg-neutral-800"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] leading-snug text-neutral-500">
                  Sent to backend via <span className="font-mono">learner_kwargs.policy_allowlist</span>.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-400">Seed (optional)</label>
                <input
                  type="number"
                  value={seed ?? ""}
                  onChange={(e) => setSeed(e.target.value === "" ? null : Number(e.target.value))}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200"
                  placeholder="null"
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <div className="mb-6 flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-indigo-400" />
              <h3 className="font-semibold">Manual Overrides</h3>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium text-neutral-400">Fixed Policy</label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  key="none"
                  disabled={isAgentControlled}
                  onClick={() => {
                    setPolicy("none");
                  }}
                  className={`text-left px-3 py-2 rounded-lg text-sm capitalize transition-all border ${
                    policy === "none" && !isAgentControlled
                      ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/30"
                      : "border-transparent text-neutral-500 hover:bg-neutral-800"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  none (do not override)
                </button>
                {(selectedPolicies as Policy[]).map((p) => (
                  <button
                    key={p}
                    disabled={isAgentControlled}
                    onClick={() => {
                      setPolicy(p);
                      if (!isAgentControlled) setCurrentRouteStrategy(p);
                    }}
                    className={`rounded-lg border px-3 py-2 text-left text-sm capitalize transition-all ${
                      policy === p && !isAgentControlled
                        ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-400"
                        : "border-transparent text-neutral-500 hover:bg-neutral-800"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {p.replace("-", " ")}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <div className="mb-4 flex items-center gap-2">
              <Plus className="h-5 w-5 text-emerald-400" />
              <h3 className="font-semibold">Test Workload</h3>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-neutral-500">
                  <span>CPU Intensity</span>
                  <span>{manualTask.cpu}</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="80"
                  step="5"
                  value={manualTask.cpu}
                  onChange={(e) =>
                    setManualTask((prev) => ({ ...prev, cpu: parseInt(e.target.value, 10) }))
                  }
                  className="h-1 w-full appearance-none rounded-lg bg-neutral-800 accent-emerald-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs text-neutral-500">
                  <span>Spike Parallel Jobs</span>
                  <span>{spikeParallelJobs}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="120"
                  step="1"
                  value={spikeParallelJobs}
                  onChange={(e) => setSpikeParallelJobs(Math.max(1, Number(e.target.value) || 1))}
                  className="h-1 w-full appearance-none rounded-lg bg-neutral-800 accent-rose-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs text-neutral-500">
                  <span>Simulation Speed</span>
                  <span>{simulationSpeed} jobs/s</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={simulationSpeed}
                  onChange={(e) => setSimulationSpeed(Math.max(1, Number(e.target.value) || 1))}
                  className="h-1 w-full appearance-none rounded-lg bg-neutral-800 accent-indigo-500"
                />
              </div>

              <button
                onClick={spikeLoad}
                className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2 text-sm font-medium text-emerald-500 transition-colors hover:bg-emerald-500/20"
              >
                Spike Load ({spikeParallelJobs} parallel)
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-6">
            <div className="mb-4 flex items-center gap-2">
              <FileCode2 className="h-5 w-5 text-cyan-400" />
              <h3 className="font-semibold">Real Job Submission</h3>
            </div>

            <div className="space-y-4">
              <input
                type="file"
                accept=".py"
                onChange={onPythonFileSelected}
                className="block w-full text-sm text-zinc-300"
              />

              <input
                type="text"
                value={scriptArgs}
                onChange={(e) => setScriptArgs(e.target.value)}
                placeholder="Arguments, e.g. --epochs 5 --lr 0.01"
                className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-white"
              />

              <input
                type="number"
                min={1}
                max={3600}
                value={scriptTimeoutS}
                onChange={(e) => setScriptTimeoutS(Number(e.target.value) || 60)}
                placeholder="Timeout (seconds)"
                className="w-full rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-white"
              />

              <div className="rounded-xl border border-white/10 bg-zinc-950/50 p-3">
                <div className="text-sm text-zinc-400">Uploaded file</div>
                <div className="mt-1 text-sm text-white">{uploadedFileName || "None"}</div>
                <div className="mt-3 text-xs text-zinc-500">
                  This submits a real executable Python job instead of a fake timed workload.
                </div>
              </div>

              <button
                onClick={submitRealJob}
                disabled={submittingRealJob}
                className="w-full rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {submittingRealJob ? "Submitting..." : "Submit Python Job"}
              </button>

              {realJobError && <div className="text-sm text-red-400">{realJobError}</div>}
            </div>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-3">
          <div className="relative flex min-h-[420px] flex-col items-center overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 p-8">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black,transparent)]" />

            <div className="absolute left-6 top-6 flex items-center gap-3">
              <div className="rounded-lg border border-neutral-700 bg-neutral-800 p-2">
                <History className="h-4 w-4 text-neutral-400" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase text-neutral-500">Incoming Jobs</p>
                <p className="font-mono text-xl font-bold">{incomingJobs}</p>
              </div>
            </div>

            {nodeGroups.length > 0 && selectedSimulationGroup ? (
              <button
                onClick={() => {
                  setSelectedSimulationGroupId(null);
                  setScopeError(null);
                  setIsRunning(false);
                }}
                className="absolute right-6 top-6 z-20 rounded-lg border border-neutral-700 bg-neutral-900/80 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Back to Groups
              </button>
            ) : null}

            <div className="z-10 mb-16 flex flex-col items-center gap-4">
              <Motion.div
                animate={{
                  scale: [1, 1.05, 1],
                  borderColor: isAgentControlled
                    ? "rgba(168, 85, 247, 0.5)"
                    : "rgba(99, 102, 241, 0.5)",
                }}
                transition={{ duration: 2, repeat: Infinity }}
                className="relative flex flex-col items-center gap-3 rounded-2xl border bg-neutral-950 p-5"
              >
                {isAgentControlled && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-purple-500 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white shadow-lg shadow-purple-500/30">
                    Agent Controlled
                  </div>
                )}
                <div
                  className={`flex h-14 w-14 items-center justify-center rounded-xl shadow-lg transition-colors ${
                    isAgentControlled
                      ? "bg-purple-600 shadow-purple-500/30"
                      : "bg-indigo-600 shadow-indigo-500/30"
                  }`}
                >
                  <Network className="h-8 w-8 text-white" />
                </div>
                <div className="text-center">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-widest ${
                      isAgentControlled ? "text-purple-400" : "text-indigo-400"
                    }`}
                  >
                    Current Route Strategy
                  </span>

                  <h4 className="text-lg font-bold capitalize">
                    {currentRouteStrategy.replace("-", " ")}
                  </h4>

                  <p className="mt-1 text-[11px] text-neutral-400">
                    Last routed to: <span className="font-mono text-white">{lastChosenNodeLabel}</span>
                  </p>
                </div>
              </Motion.div>
            </div>

            <div className="pointer-events-none absolute inset-x-0 top-[160px] h-[100px]">
              <AnimatePresence>
                {Array.from({ length: Math.min(12, incomingJobs) }).map((_, i) => (
                  <Motion.div
                    key={`pending_${i}`}
                    initial={{ y: -80, opacity: 0, scale: 0 }}
                    animate={{ y: 0, opacity: 1, scale: 1, x: (i % 3 - 1) * 60 }}
                    exit={{ y: 200, opacity: 0, scale: 0.5 }}
                    transition={{ type: "spring", stiffness: 100 }}
                    className="absolute left-1/2 -ml-4"
                  >
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm ${
                        isAgentControlled
                          ? "border-purple-500/30 bg-purple-900/50"
                          : "border-neutral-700 bg-neutral-800"
                      }`}
                    >
                      <Zap
                        className={`h-4 w-4 ${isAgentControlled ? "text-purple-400" : "text-indigo-400"}`}
                      />
                    </div>
                  </Motion.div>
                ))}
              </AnimatePresence>
            </div>

            {nodeGroups.length > 0 && !selectedSimulationGroup ? (
              <div className="z-10 mt-auto w-full">
                <div className="mb-3 text-xs text-neutral-400">Pick a group to view its nodes</div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {nodeGroups.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => {
                        setSelectedSimulationGroupId(g.id);
                        setScopeError(null);
                      }}
                      className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4 text-left transition-colors hover:border-indigo-500/40 hover:bg-neutral-900"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-neutral-100">{g.name}</div>
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: g.color }} />
                      </div>
                      <div className="mt-1 text-xs text-neutral-400">
                        {g.nodes.length} node(s) •{" "}
                        {
                          g.nodes.filter((n) => connectedNodeKeySet.has(normalizeNodeKey(n.nodeKey)))
                            .length
                        }{" "}
                        connected
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="z-10 mt-auto grid w-full grid-cols-2 gap-6 md:grid-cols-4">
                {renderNodes.map((node) => (
                  <div
                    key={node.id}
                    className={`rounded-xl border p-4 transition-all ${
                      lastChosenNodeId && node.id === lastChosenNodeId
                        ? "border-emerald-400 ring-2 ring-emerald-500/20 shadow-lg shadow-emerald-500/20"
                        : "border-neutral-800 hover:border-neutral-700"
                    } bg-neutral-900/80 backdrop-blur-sm`}
                  >
                    <div className="mb-4 flex items-start justify-between">
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-tight text-neutral-500">
                          {node.name}
                        </h4>
                        <p className="font-mono text-sm font-bold text-neutral-300">
                          {node.status === "offline" ? "Offline" : "Active"}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {lastChosenNodeId && node.id === lastChosenNodeId && (
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                            CHOSEN
                          </span>
                        )}
                        <div className="rounded-lg border border-neutral-700/50 bg-neutral-800/50 p-1.5">
                          <Cpu className="h-3 w-3 text-neutral-500" />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="mb-1 flex justify-between text-[10px]">
                        <span className="text-neutral-500">Saturation</span>
                        <span className="font-mono text-neutral-300">
                          {Math.round((node.cpuUsed / Math.max(1, node.cpuCapacity)) * 100)}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full border border-neutral-800/50 bg-neutral-950">
                        <Motion.div
                          animate={{
                            width: `${Math.min(100, (node.cpuUsed / Math.max(1, node.cpuCapacity)) * 100)}%`,
                            backgroundColor:
                              node.status === "offline"
                                ? "#262626"
                                : isAgentControlled
                                  ? "#a855f7"
                                  : "#6366f1",
                          }}
                          className="h-full"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 text-[10px]">
                        <div className="flex justify-between">
                          <span className="text-neutral-500">CPU</span>
                          <span className="font-mono text-neutral-300">
                            {node.status === "offline" ? "--" : `${node.cpuPct.toFixed(0)}%`}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">MEM</span>
                          <span className="font-mono text-neutral-300">
                            {node.status === "offline" ? "--" : `${node.memPct.toFixed(0)}%`}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Queue</span>
                          <span className="font-mono text-neutral-300">
                            {node.status === "offline" ? "--" : (node.queueLen ?? 0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">In-flight</span>
                          <span className="font-mono text-neutral-300">
                            {node.status === "offline" ? "--" : (node.inFlight ?? 0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Jobs/60s</span>
                          <span className="font-mono text-neutral-300">
                            {node.status === "offline" ? "--" : (node.completedLast60s ?? 0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">Speed</span>
                          <span className="font-mono text-neutral-300">
                            {node.status === "offline" || node.nodeSpeed == null
                              ? "--"
                              : `${node.nodeSpeed.toFixed(1)}`}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">EWMA</span>
                          <span className="font-mono text-neutral-300">
                            {node.status === "offline" || node.ewmaLatencyMs == null
                              ? "--"
                              : `${Math.round(node.ewmaLatencyMs)}ms`}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-500">P95</span>
                          <span className="font-mono text-neutral-300">
                            {node.status === "offline" || node.p95LatencyMs == null
                              ? "--"
                              : `${Math.round(node.p95LatencyMs)}ms`}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {renderNodes.length === 0 && (
                  <div className="col-span-2 rounded-xl border border-neutral-800 bg-neutral-900/80 p-4 text-sm text-neutral-400 md:col-span-4">
                    No connected nodes are selected for this user. Connect nodes in the Nodes page,
                    then return here.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Live Real Job Monitor</h3>
              <span className="text-xs text-zinc-400">
                Upload a Python script and watch its execution status
              </span>
            </div>

            {realJobs.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-400">
                No real jobs submitted yet.
              </div>
            ) : (
              <div className="space-y-3">
                {realJobs.map((job) => (
                  <div
                    key={job.job_id}
                    className="rounded-xl border border-white/10 bg-zinc-950/40 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-white">
                          {job.script_name || job.job_id}
                        </div>
                        <div className="text-xs text-zinc-500">{job.job_id}</div>
                      </div>
                      <div className="text-xs text-zinc-300">
                        {job.node_name ? `Node: ${job.node_name}` : "Node pending"}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 text-xs text-zinc-300 md:grid-cols-4">
                      <div>Status: {job.status}</div>
                      <div>Exit code: {job.exit_code ?? "-"}</div>
                      <div>Latency: {job.observed_latency_ms ?? "-"} ms</div>
                      <div>Type: {job.job_type}</div>
                    </div>

                    {(job.stdout || job.stderr) && (
                      <details className="mt-3 rounded-lg bg-black/30 p-3">
                        <summary className="cursor-pointer text-sm text-zinc-200">Logs</summary>
                        <pre className="mt-2 whitespace-pre-wrap text-xs text-zinc-300">
{`STDOUT:
${job.stdout ?? ""}

STDERR:
${job.stderr ?? ""}`}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 md:col-span-2">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-amber-500" />
                  <h3 className="font-semibold">Policy Performance Log</h3>
                </div>
                <div className="rounded-full border border-neutral-700 bg-neutral-800 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                  RL Enabled
                </div>
              </div>

              <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
                <div className="mb-4 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-purple-400" />
                  <h3 className="font-semibold">Policy Reward Over Time</h3>
                </div>

                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rewardHistory}>
                      <XAxis dataKey="t" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      {Array.from(seenPolicies).map((p) => (
                        <Line
                          key={p}
                          type="monotone"
                          dataKey={p}
                          name={p.replace("-", " ")}
                          stroke={POLICY_COLORS[p]}
                          dot={false}
                          strokeWidth={2}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-500">
                      <th className="pb-3 font-medium">Rank</th>
                      <th className="pb-3 font-medium">Policy</th>
                      <th className="pb-3 text-right font-medium">Tasks</th>
                      <th className="pb-3 text-right font-medium">Avg Latency</th>
                      <th className="pb-3 text-right font-medium">Reward</th>
                      <th className="pb-3 text-right font-medium">Optimization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/50">
                    {leaderboard.map((stat, index) => (
                      <tr key={stat.policy} className={policy === stat.policy ? "bg-indigo-500/5" : ""}>
                        <td className="py-3">
                          <div
                            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                              index === 0
                                ? "border border-amber-500/30 bg-amber-500/20 text-amber-500"
                                : "bg-neutral-800 text-neutral-500"
                            }`}
                          >
                            {index + 1}
                          </div>
                        </td>

                        <td className="py-3">
                          <span
                            className={`text-sm font-medium capitalize ${
                              policy === stat.policy
                                ? "font-bold text-indigo-400"
                                : "text-neutral-400"
                            }`}
                          >
                            {stat.policy.replace("-", " ")}
                          </span>
                          <div className="text-[10px] text-neutral-600">
                            selected {stat.selectionPct.toFixed(0)}%
                          </div>
                        </td>

                        <td className="py-3 text-right text-xs font-mono text-neutral-500">
                          {stat.completedTasks}
                        </td>

                        <td className="py-3 text-right text-xs font-mono">
                          <span className={stat.avgLatency > 0 ? "text-neutral-200" : "text-neutral-500"}>
                            {stat.avgLatency > 0 ? `${stat.avgLatency.toFixed(0)}ms` : "---"}
                          </span>
                        </td>

                        <td className="py-3 text-right text-xs font-mono">
                          <span className={Number.isFinite(stat.reward) ? "text-neutral-200" : "text-neutral-500"}>
                            {Number.isFinite(stat.reward) ? stat.reward.toFixed(3) : "---"}
                          </span>
                        </td>

                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-1">
                            {stat.recentLatency.slice(-6).map((l, i, arr) => {
                              const prev = i === 0 ? null : arr[i - 1];
                              const improved = prev == null ? null : l < prev;
                              return (
                                <div
                                  key={i}
                                  className={`h-3 w-1 rounded-full ${
                                    improved == null
                                      ? "bg-neutral-700/60"
                                      : improved
                                        ? "bg-emerald-500/40"
                                        : "bg-rose-500/40"
                                  }`}
                                />
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
              <div className="mb-6 flex items-center gap-2">
                <Activity className="h-5 w-5 text-indigo-400" />
                <h3 className="text-sm font-semibold">System Diagnostics</h3>
              </div>

              <div className="flex-1 space-y-6">
                <div className="rounded-xl border border-neutral-700/30 bg-neutral-800/30 p-4">
                  <p className="mb-3 text-[10px] font-bold uppercase text-neutral-500">
                    Live Saturation Flow
                  </p>
                  <div className="h-[120px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <XAxis dataKey="name" hide />
                        <YAxis hide domain={[0, 100]} />
                        <Bar dataKey="cpu" radius={[2, 2, 0, 0]}>
                          {chartData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={
                                entry.cpu > 80
                                  ? "#f43f5e"
                                  : isAgentControlled
                                    ? "#a855f7"
                                    : "#6366f1"
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <History className="h-4 w-4 text-neutral-300" />
                      <div className="text-sm font-semibold">Latest Explanation</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void requestAiExplanation()}
                        disabled={aiExplainLoading}
                        className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50"
                      >
                        {aiExplainLoading ? "Analyzing..." : "Explain with Gemini"}
                      </button>
                      <div className="text-xs text-neutral-400">
                        {latestExplanation?.policy ? String(latestExplanation.policy) : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">
                    {latestExplanation?.text
                      ? latestExplanation.text
                      : "No policy switches yet. When the agent switches strategies, you’ll see the explanation here (and the sim will pause)."}
                  </div>

                  {latestExplanation?.meta?.from_policy && latestExplanation?.meta?.to_policy ? (
                    <div className="mt-3 text-xs text-neutral-400">
                      Switch: {String(latestExplanation.meta.from_policy)} →{" "}
                      {String(latestExplanation.meta.to_policy)}
                    </div>
                  ) : null}
                  {latestExplanation?.meta?.source ? (
                    <div className="mt-2 text-[11px] text-neutral-500">
                      Source: {String(latestExplanation.meta.source)}
                      {latestExplanation?.meta?.reason
                        ? ` (${String(latestExplanation.meta.reason)})`
                        : ""}
                    </div>
                  ) : null}
                  {latestExplanation?.kind === "ai" ? (
                    <div className="mt-2 text-[11px] text-indigo-300">AI-generated simulation explanation</div>
                  ) : (
                    <div className="mt-2 text-[11px] text-neutral-500">
                      Switch explanation generated by routing events
                    </div>
                  )}
                </div>

                <div className="mt-auto space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-500">System Throughput</span>
                    <span className="font-mono font-bold text-emerald-500">
                      {throughput.toFixed(1)} j/s
                    </span>
                  </div>

                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-500">Avg Observed Latency</span>
                    <span className="font-mono font-bold text-neutral-200">
                      {overallAvgLatencyMs > 0 ? `${overallAvgLatencyMs.toFixed(0)}ms` : "---"}
                    </span>
                  </div>

                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-500">Optimization Trend</span>
                    <span className="font-mono font-bold">
                      {overallLatencyTrail.length >= 2
                        ? overallLatencyTrail[overallLatencyTrail.length - 1] <
                          overallLatencyTrail[overallLatencyTrail.length - 2]
                          ? "Improving"
                          : "Worsening"
                        : "---"}
                    </span>
                  </div>

                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-500">Best Policy (by reward)</span>
                    <span className="font-mono font-bold text-purple-400">
                      {bestByReward ? bestByReward.replace("-", " ") : "---"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}