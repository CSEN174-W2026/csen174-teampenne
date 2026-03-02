import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
} from "lucide-react";
import { motion as Motion, AnimatePresence } from "motion/react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from "recharts";

import {
  getNodes,
  submitJob,
  getLearnerStats,
  getPending,
  getLatencyStats,
  getStats,
  getRunStatus,
  startRun,
  // (optional) resetManager if you added it
  resetManager,
  getRecentExplanations,
  type AgentConfig,
} from "../../lib/api";

type Json = Record<string, any>;

type Policy = "round-robin" | "least-loaded" | "resource-aware" | "random";

interface NodeUI {
  id: string;
  name: string;
  cpuCapacity: number;
  memCapacity: number;
  cpuUsed: number;
  memUsed: number;
  tasks: any[];
  status: "active" | "draining" | "offline";
}

interface PolicyStatUI {
  policy: Policy;
  completedTasks: number; // observed completed jobs for this policy (from latency_stats[p].n)
  totalLatency: number; // ms
  avgLatency: number; // ms
  recentLatency: number[]; // last N
  reward: number; // learner estimated reward / value for this policy
  selectionPct: number; // 0..100 based on completedTasks / totalCompleted
}

interface AgentState {
  isActive: boolean;
  explorationRate: number;
  lastDecisionTime: number;
  status: "exploring" | "optimizing" | "monitoring";
}

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

function normalizePolicyKey(k: string): string {
  return (k || "").toLowerCase().replace(/\s+/g, "_");
}

function backendKeyToUiPolicy(k: string): Policy | null {
  const kk = normalizePolicyKey(k);
  if (kk.includes("round") && kk.includes("robin")) return "round-robin";
  if (kk.includes("least") && (kk.includes("load") || kk.includes("loaded")))
    return "least-loaded";
  if (kk.includes("resource") && (kk.includes("aware") || kk.includes("awareness")))
    return "resource-aware";
  if (kk.includes("random")) return "random";
  return null;
}

// Rewards from learner_stats
function extractReward(stat: any): number {
  if (!stat || typeof stat !== "object") return 0;
  // common keys from your learners:
  // - SampleAverage / EMA / UCB1: { n, Q }
  // - Thompson: { n, mean, std }
  if (typeof stat.mean_reward === "number") return stat.mean_reward;
  if (typeof stat.Q === "number") return stat.Q;
  if (typeof stat.mean === "number") return stat.mean;
  if (typeof stat.mean_window === "number") return stat.mean_window;
  return 0;
}

// Latency stats from ManagerAgent.latency_stats(): { policy: {n,total_latency_ms,avg_latency_ms} }
function buildPolicyStatsFromBackend(
  learnerStats: Record<string, any>,
  latencyStats: Record<string, any>,
  prev: Record<Policy, PolicyStatUI>,
  selectedPolicies: Policy[]
): Record<Policy, PolicyStatUI> {
  const next: Record<Policy, PolicyStatUI> = { ...prev };

  // 1) apply latency stats (real observed)
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

  // 2) apply reward stats (learner estimates)
  for (const [k, v] of Object.entries(learnerStats || {})) {
    const ui = backendKeyToUiPolicy(k);
    if (!ui) continue;
    const r = extractReward(v);

    next[ui] = {
      ...next[ui],
      reward: Number.isFinite(r) ? r : next[ui].reward,
    };
  }

  // 3) selection frequency (%)
  const active = selectedPolicies.length ? selectedPolicies : (Object.keys(next) as Policy[]);
  const totalCompleted = active.reduce((acc, p) => acc + (next[p]?.completedTasks || 0), 0);

  for (const p of active) {
    const n = next[p]?.completedTasks || 0;
    next[p] = {
      ...next[p],
      selectionPct: totalCompleted > 0 ? (n / totalCompleted) * 100 : 0,
    };
  }

  // for policies not active, set pct 0
  const all: Policy[] = ["round-robin", "least-loaded", "resource-aware", "random"];
  for (const p of all) {
    if (!active.includes(p)) next[p] = { ...next[p], selectionPct: 0 };
  }

  return next;
}

export function Simulation() {
  const runIdRef = useRef(`frontend-sim-${Date.now()}`);
  const iterationRef = useRef(0);

  const [isRunning, setIsRunning] = useState(false);

  // ---- NEW: Explanation modal state ----
  const [explainOpen, setExplainOpen] = useState(false);
  const [currentExplanation, setCurrentExplanation] = useState<any | null>(null);
  const [latestExplanation, setLatestExplanation] = useState<any | null>(null);
  const lastExplainTmsRef = useRef<number>(0);
  const resumeRunningRef = useRef<boolean>(false);

  const [isAgentControlled, setIsAgentControlled] = useState(false);
  const [policy, setPolicy] = useState<Policy>("round-robin");

  // DISPLAY as the current routing strategy
  // - In manual mode: follows `policy`
  // - In agent mode: updated from backend submit response decision
  const [currentRouteStrategy, setCurrentRouteStrategy] = useState<Policy>("round-robin");

  // track which node was chosen by the backend for the last submitted job
  const [lastChosenNodeId, setLastChosenNodeId] = useState<string | null>(null);
  const [lastChosenNodeLabel, setLastChosenNodeLabel] = useState<string>("—");

  const [simulationSpeed, setSimulationSpeed] = useState(1);

  const [nodes, setNodes] = useState<NodeUI[]>([
    {
      id: "node-1",
      name: "us-east-1a",
      cpuCapacity: 100,
      memCapacity: 1024,
      cpuUsed: 0,
      memUsed: 0,
      tasks: [],
      status: "offline",
    },
    {
      id: "node-2",
      name: "us-east-1b",
      cpuCapacity: 100,
      memCapacity: 1024,
      cpuUsed: 0,
      memUsed: 0,
      tasks: [],
      status: "offline",
    },
    {
      id: "node-3",
      name: "us-west-2a",
      cpuCapacity: 150,
      memCapacity: 2048,
      cpuUsed: 0,
      memUsed: 0,
      tasks: [],
      status: "offline",
    },
    {
      id: "node-4",
      name: "eu-central-1",
      cpuCapacity: 80,
      memCapacity: 512,
      cpuUsed: 0,
      memUsed: 0,
      tasks: [],
      status: "offline",
    },
  ]);

  const [incomingJobs, setIncomingJobs] = useState(0);
  const [submittedJobs, setSubmittedJobs] = useState(0);
  const [backendInFlightJobs, setBackendInFlightJobs] = useState(0);
  const simStartMsRef = useRef<number | null>(null);
  const cumulativeRunProcessedRef = useRef(0);
  const lastRunIdRef = useRef<string | null>(null);
  const lastRunProcessedRef = useRef(0);

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
  const [backendRunId, setBackendRunId] = useState<string | null>(null);
  const [backendRunStatus, setBackendRunStatus] = useState<string>("idle");
  const BACKEND_RUN_CHUNK_JOBS = 25;

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
      { value: "ucb1", label: "UCB1" },
      { value: "sample_average", label: "Sample Average" },
      { value: "ema", label: "EMA" },
      { value: "thompson_gaussian", label: "Thompson (Gaussian)" },
      { value: "sliding_window", label: "Sliding Window" },
      { value: "contextual_linear", label: "Contextual Linear" },
    ],
    []
  );

  const GOAL_OPTIONS = useMemo(
    () => [
      { value: "min_mean_latency", label: "Min Mean Latency" },
      { value: "min_latency_with_sla", label: "Min Latency w/ SLA" },
      { value: "min_latency_plus_tail", label: "Min Latency + Tail" },
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

    // IMPORTANT: your ManagerAgent only reads learner_kwargs.policy_allowlist
    const learner_kwargs: Json = {
      policy_allowlist: backendPolicies,
    };

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

  const userId = "u1";

  const serviceTimeMsFromCpu = useCallback((cpu: number) => {
    return Math.max(50, Math.round(150 + cpu * 12));
  }, []);

  const submitOneJob = useCallback(
    async (metadata: Json = {}) => {
      const manualPolicyBackend =
        POLICY_OPTIONS.find((p) => p.ui === policy)?.backend ?? "round_robin";

      const job = {
        job_id: mkJobId(),
        user_id: userId,
        service_time_ms: serviceTimeMsFromCpu(manualTask.cpu),
        metadata: {
          cpu_intensity: manualTask.cpu,
          mem_hint: manualTask.mem,
          duration_hint: manualTask.duration,

          // backend expects underscore keys
          manual_policy: isAgentControlled ? null : manualPolicyBackend,

          ...metadata,
        },
      };

      try {
        // capture response so we can display the backend’s chosen policy
        const resp: any = await submitJob({ config: agentConfig, job });
        setSubmittedJobs((p) => p + 1);

        // extract chosen node from response and store for UI highlight
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

        // Update the displayed route strategy
        if (isAgentControlled) {
          const chosen =
            resp?.decision?.policy ??
            resp?.decision?.policy_name ??
            resp?.decision?.policy_kind ??
            null;

          const ui = typeof chosen === "string" ? backendKeyToUiPolicy(chosen) : null;
          if (ui) setCurrentRouteStrategy(ui);
        } else {
          setCurrentRouteStrategy(policy);
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
      serviceTimeMsFromCpu,
    ]
  );

  const spikeLoad = useCallback(async () => {
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      await submitOneJob({ spike: true, idx: i });
    }
  }, [submitOneJob]);

  const refreshBackendRunStatus = useCallback(async () => {
    if (!backendRunId) return;
    try {
      const st = await getRunStatus(backendRunId);
      setBackendRunStatus(st.status);
      const processed = Number(st.processed_jobs ?? 0);
      const total = Number(st.total_jobs ?? 0);
      const inFlight = Math.max(0, total - processed);
      setBackendInFlightJobs(inFlight);

      // Track cumulative processed jobs across chained backend runs for throughput.
      if (lastRunIdRef.current !== backendRunId) {
        lastRunIdRef.current = backendRunId;
        lastRunProcessedRef.current = 0;
      }
      const delta = Math.max(0, processed - lastRunProcessedRef.current);
      if (delta > 0) {
        cumulativeRunProcessedRef.current += delta;
        setSubmittedJobs(cumulativeRunProcessedRef.current);
      }
      lastRunProcessedRef.current = processed;

      // Build policy log directly from backend run events while simulation is run-driven.
      const eventList = Array.isArray(st.events) ? st.events : [];
      const latencyByPolicy: Record<string, { n: number; total_latency_ms: number; avg_latency_ms: number }> = {};
      const rewardByPolicy: Record<string, { mean_reward: number }> = {};
      const rewardAcc: Record<string, { sum: number; n: number }> = {};
      let runLatencyTotal = 0;

      for (const ev of eventList) {
        const policy = typeof ev?.policy_name === "string" ? ev.policy_name : "";
        const latency = Number(ev?.latency_ms ?? 0);
        const reward = Number(ev?.reward ?? 0);
        if (!policy || !Number.isFinite(latency)) continue;

        const latRec = latencyByPolicy[policy] ?? { n: 0, total_latency_ms: 0, avg_latency_ms: 0 };
        latRec.n += 1;
        latRec.total_latency_ms += latency;
        latRec.avg_latency_ms = latRec.total_latency_ms / Math.max(1, latRec.n);
        latencyByPolicy[policy] = latRec;
        runLatencyTotal += latency;

        if (Number.isFinite(reward)) {
          const r = rewardAcc[policy] ?? { sum: 0, n: 0 };
          r.sum += reward;
          r.n += 1;
          rewardAcc[policy] = r;
        }
      }

      for (const [policy, rec] of Object.entries(rewardAcc)) {
        rewardByPolicy[policy] = { mean_reward: rec.sum / Math.max(1, rec.n) };
      }

      if (eventList.length > 0) {
        setPolicyStats((prev) =>
          buildPolicyStatsFromBackend(rewardByPolicy, latencyByPolicy, prev, selectedPolicies)
        );
        const runMeanLatency = runLatencyTotal / Math.max(1, eventList.length);
        setOverallAvgLatencyMs(runMeanLatency);
        setOverallLatencyTrail((prev) => [...prev, runMeanLatency].slice(-25));
      }
    } catch (_err: unknown) {
      setBackendRunStatus("failed");
      setBackendInFlightJobs(0);
    }
  }, [backendRunId, selectedPolicies]);

  // ---- explanation polling helpers ----
  const fetchLatestExplanation = useCallback(async () => {
    try {
      const data = await getRecentExplanations(agentConfig, 25);
      const events: any[] = data?.events ?? [];

      // Only use real switch events with text
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

    // New explanation detected -> pause sim and show modal
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
    resumeRunningRef.current = false; // ✅ important
  }, []);

  const pollManager = useCallback(async () => {
    // 1) Nodes
    try {
      const nodesResp = await getNodes();
      const mapped: NodeUI[] = (nodesResp.nodes || []).map((n: any) => {
        const cpuPct = safePct(n.cpu_pct);
        const memPct = safePct(n.mem_pct);
        const cpuCap = 100;
        const memCap = 100;

        return {
          id: `${n.host}:${n.port}`,
          name: (n.name ?? `${n.host}:${n.port}`).toLowerCase(),
          cpuCapacity: cpuCap,
          memCapacity: memCap,
          cpuUsed: (cpuPct / 100) * cpuCap,
          memUsed: (memPct / 100) * memCap,
          tasks: [],
          status: n.error ? "offline" : "active",
        };
      });

      if (mapped.length > 0) setNodes(mapped);
      else
        setNodes((prev) =>
          prev.map((x) => ({ ...x, status: "offline", cpuUsed: 0, memUsed: 0, tasks: [] }))
        );
    } catch {
      setNodes((prev) =>
        prev.map((x) => ({ ...x, status: "offline", cpuUsed: 0, memUsed: 0, tasks: [] }))
      );
    }

    // 2) Stats
    try {
      let pendingIds: string[] = [];
      let learnerStats: Record<string, any> = {};
      let latencyStats: Record<string, any> = {};
      let summary: any = {};

      try {
        const stats = await getStats(agentConfig);
        pendingIds = stats?.pending_job_ids ?? [];
        learnerStats = stats?.learner ?? {};
        latencyStats = stats?.latency ?? {};
        summary = stats?.summary ?? {};
      } catch {
        const p = await getPending(agentConfig);
        pendingIds = p.pending_job_ids ?? [];

        learnerStats = await getLearnerStats(agentConfig);
        latencyStats = await getLatencyStats(agentConfig);
      }

      setIncomingJobs(pendingIds.length);

      if (!backendRunId) {
        setPolicyStats((prev) =>
          buildPolicyStatsFromBackend(learnerStats, latencyStats, prev, selectedPolicies)
        );

        const backendOverall = typeof summary?.mean_latency_ms === "number" ? summary.mean_latency_ms : 0;
        setOverallAvgLatencyMs(backendOverall);
        if (backendOverall > 0) setOverallLatencyTrail((prev) => [...prev, backendOverall].slice(-25));
      }

      setAgent((prev) => {
        const nextExploration = isAgentControlled
          ? Math.max(0.05, prev.explorationRate * 0.985)
          : prev.explorationRate;
        return {
          ...prev,
          isActive: isAgentControlled,
          explorationRate: nextExploration,
          status: isAgentControlled ? (nextExploration > 0.2 ? "exploring" : "optimizing") : "monitoring",
          lastDecisionTime: nowMs(),
        };
      });

      // 3) Explanation: if agent produced a new explanation, pause and show it
      await maybePauseForExplanation();
    } catch {
      setIncomingJobs(0);
    }
  }, [agentConfig, isAgentControlled, selectedPolicies, maybePauseForExplanation, backendRunId]);

  const pollIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isRunning) {
      if (pollIntervalRef.current) window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
      return;
    }

    if (simStartMsRef.current == null) simStartMsRef.current = nowMs();

    pollManager();
    pollIntervalRef.current = window.setInterval(() => pollManager(), 1500);

    return () => {
      if (pollIntervalRef.current) window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    };
  }, [isRunning, pollManager]);

  useEffect(() => {
    if (!isRunning) return;
    if (!backendRunId) return;
    if (backendRunStatus !== "running") return;

    void refreshBackendRunStatus();
    const id = window.setInterval(() => {
      void refreshBackendRunStatus();
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRunning, backendRunId, backendRunStatus, refreshBackendRunStatus]);

  // Start simulation => start backend runs continuously in chunks.
  useEffect(() => {
    if (!isRunning) return;
    if (backendRunStatus === "running") return;

    let cancelled = false;
    const launchNextRun = async () => {
      try {
        const res = await startRun({
          goal_kind: goalKind,
          learner_kind: learnerKind,
          learner_kwargs: agentConfig.learner_kwargs ?? {},
          goal_kwargs: agentConfig.goal_kwargs ?? {},
          workload: {
            kind: "tiny",
            jobs: BACKEND_RUN_CHUNK_JOBS,
            seed: seed ?? (Date.now() % 100000),
            users: [userId],
            sla_threshold_ms: slaMs,
          },
          poll_interval_ms: 50,
          job_timeout_ms: 15000,
        });
        if (cancelled) return;
        setBackendRunId(res.run_id);
        setBackendRunStatus(res.status);
        setBackendInFlightJobs(BACKEND_RUN_CHUNK_JOBS);
      } catch (_err: unknown) {
        if (cancelled) return;
        setBackendRunStatus("failed");
        setBackendInFlightJobs(0);
      }
    };

    void launchNextRun();
    return () => {
      cancelled = true;
    };
  }, [
    isRunning,
    backendRunStatus,
    goalKind,
    learnerKind,
    agentConfig.learner_kwargs,
    agentConfig.goal_kwargs,
    seed,
    userId,
    slaMs,
  ]);

  const resetSimulation = () => {
    setIsRunning(false);
    setIsAgentControlled(false);
    setIncomingJobs(0);
    setSubmittedJobs(0);
    setBackendInFlightJobs(0);
    setOverallAvgLatencyMs(0);
    setOverallLatencyTrail([]);
    simStartMsRef.current = null;
    cumulativeRunProcessedRef.current = 0;
    lastRunIdRef.current = null;
    lastRunProcessedRef.current = 0;

    setPolicy("round-robin");
    setCurrentRouteStrategy("round-robin");

    setLastChosenNodeId(null);
    setLastChosenNodeLabel("—");

    setPolicyStats({
      "round-robin": { policy: "round-robin", completedTasks: 0, totalLatency: 0, avgLatency: 0, recentLatency: [], reward: 0, selectionPct: 0 },
      "least-loaded": { policy: "least-loaded", completedTasks: 0, totalLatency: 0, avgLatency: 0, recentLatency: [], reward: 0, selectionPct: 0 },
      "resource-aware": { policy: "resource-aware", completedTasks: 0, totalLatency: 0, avgLatency: 0, recentLatency: [], reward: 0, selectionPct: 0 },
      random: { policy: "random", completedTasks: 0, totalLatency: 0, avgLatency: 0, recentLatency: [], reward: 0, selectionPct: 0 },
    });
    setAgent({
      isActive: false,
      explorationRate: 1.0,
      lastDecisionTime: Date.now(),
      status: "exploring",
    });
    setNodes((prev) => prev.map((x) => ({ ...x, status: "offline", cpuUsed: 0, memUsed: 0, tasks: [] })));
    setBackendRunId(null);
    setBackendRunStatus("idle");

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
  const displayIncomingJobs = Math.max(incomingJobs, backendInFlightJobs);

  const bestByReward = useMemo(() => {
    const active = selectedPolicies.length ? selectedPolicies : (Object.keys(policyStats) as Policy[]);
    return active.reduce(
      (best, p) => (policyStats[p].reward >= policyStats[best].reward ? p : best),
      active[0] || "round-robin"
    );
  }, [policyStats, selectedPolicies]);

  return (
    <div className="space-y-8 pb-12">
      {/* ------------------ Explanation Modal ------------------ */}
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

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-neutral-300">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-neutral-400">Job</div>
                    <div className="mt-1 font-mono break-all">{currentExplanation?.job_id ?? "—"}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-neutral-400">Node</div>
                    <div className="mt-1 font-mono break-all">{currentExplanation?.node ?? "—"}</div>
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
                  <summary className="cursor-pointer text-xs text-neutral-300 select-none">
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
                  className="rounded-xl bg-white text-black px-4 py-2 text-sm font-semibold hover:opacity-90"
                  onClick={continueAfterExplanation}
                >
                  Continue
                </button>
              </div>
            </Motion.div>
          </Motion.div>
        ) : null}
      </AnimatePresence>

      {/* ------------------ Original page below ------------------ */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agentic Resource Simulator</h1>
          <p className="text-neutral-400 mt-1">
            A manager agent that learns the optimal routing policy to minimize latency.
          </p>
        </div>

        <div className="flex items-center gap-3 bg-neutral-900 border border-neutral-800 p-2 rounded-xl">
          <button
            onClick={() => {
              setIsAgentControlled(!isAgentControlled);
              if (!isRunning) setIsRunning(true);

              if (!isAgentControlled) {
                // turning ON agent: backend will update route strategy on submit
              } else {
                // turning OFF agent: display manual policy
                setCurrentRouteStrategy(policy);
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              isAgentControlled
                ? "bg-purple-500 text-white shadow-lg shadow-purple-500/20"
                : "bg-neutral-800 text-neutral-400 hover:text-white"
            }`}
          >
            <Cpu className="w-4 h-4" />
            {isAgentControlled ? "Agent Running" : "Enable Manager Agent"}
          </button>

          <div className="h-6 w-px bg-neutral-800 mx-1" />

          <button
            onClick={() => {
              const nextRunning = !isRunning;
              setIsRunning(nextRunning);
              if (!nextRunning) {
                // Stop auto-chaining backend runs when simulation is paused.
                setBackendRunId(null);
                setBackendRunStatus("idle");
                setBackendInFlightJobs(0);
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              isRunning
                ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-500/20"
            }`}
          >
            {isRunning ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
            {isRunning ? "Pause" : "Start Sim"}
          </button>

          <button
            onClick={resetSimulation}
            className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-6">
          <AnimatePresence>
            {isAgentControlled && (
              <Motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-purple-950/20 border border-purple-500/30 rounded-2xl p-6 relative overflow-hidden group"
              >
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Cpu className="w-12 h-12 text-purple-400" />
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                  <h3 className="font-semibold text-purple-300">Agent Intelligence</h3>
                </div>

                <div className="space-y-4 relative z-10">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-purple-400 uppercase font-bold tracking-tighter">Status</span>
                    <span className="text-white capitalize px-2 py-0.5 rounded bg-purple-500/40 border border-purple-400/30">
                      {agent.status}
                    </span>
                  </div>

                  <div className="space-y-3 pt-2">
                    <div className="flex justify-between text-[10px] text-purple-300">
                      <span>Exploration Rate</span>
                      <span className="font-mono">{(agent.explorationRate * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-1 bg-purple-900/50 rounded-full overflow-hidden">
                      <Motion.div
                        animate={{ width: `${agent.explorationRate * 100}%` }}
                        className="h-full bg-purple-400"
                      />
                    </div>
                  </div>

                  {/* show selection frequency + reward */}
                  <div className="space-y-2 pt-2 border-t border-purple-500/20">
                    <p className="text-[10px] text-purple-400 uppercase font-bold mb-2">
                      Policy Reward + Selection
                    </p>

                    {(selectedPolicies as Policy[]).map((p) => {
                      const s = policyStats[p];
                      const pct = s?.selectionPct ?? 0;
                      const reward = s?.reward ?? 0;

                      return (
                        <div key={p} className="space-y-1">
                          <div className="flex justify-between text-[10px]">
                            <span className={`capitalize ${policy === p ? "text-white" : "text-purple-400/60"}`}>
                              {p.replace("-", " ")}
                            </span>
                            <span className="text-white font-mono">
                              {pct > 0 ? `${pct.toFixed(0)}%` : "0%"} · r={reward.toFixed(3)}
                            </span>
                          </div>
                          <div className="h-1 bg-purple-900/30 rounded-full overflow-hidden">
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

          {/* --- everything below = your original JSX structure --- */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-6">
              <Network className="w-5 h-5 text-purple-400" />
              <h3 className="font-semibold">Agent Config</h3>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-400">Learner</label>
                <select
                  value={learnerKind}
                  onChange={(e) => setLearnerKind(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200"
                >
                  {LEARNER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-400">Goal</label>
                <select
                  value={goalKind}
                  onChange={(e) => setGoalKind(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200"
                >
                  {GOAL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {goalKind === "min_latency_with_sla" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-400">SLA (ms)</label>
                  <input
                    type="number"
                    min={1}
                    value={slaMs}
                    onChange={(e) => setSlaMs(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200"
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
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200"
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
                        className={`text-left px-3 py-2 rounded-lg text-sm transition-all border ${
                          checked
                            ? "bg-purple-500/10 text-purple-300 border-purple-500/30"
                            : "border-transparent text-neutral-500 hover:bg-neutral-800"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-neutral-500 leading-snug">
                  Sent to backend via <span className="font-mono">learner_kwargs.policy_allowlist</span>.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-400">Seed (optional)</label>
                <input
                  type="number"
                  value={seed ?? ""}
                  onChange={(e) => setSeed(e.target.value === "" ? null : Number(e.target.value))}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200"
                  placeholder="null"
                />
              </div>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-6">
              <Settings2 className="w-5 h-5 text-indigo-400" />
              <h3 className="font-semibold">Manual Overrides</h3>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium text-neutral-400">Fixed Policy</label>
              <div className="grid grid-cols-1 gap-2">
                {(selectedPolicies as Policy[]).map((p) => (
                  <button
                    key={p}
                    disabled={isAgentControlled}
                    onClick={() => {
                      setPolicy(p);
                      if (!isAgentControlled) setCurrentRouteStrategy(p);
                    }}
                    className={`text-left px-3 py-2 rounded-lg text-sm capitalize transition-all border ${
                      policy === p && !isAgentControlled
                        ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/30"
                        : "border-transparent text-neutral-500 hover:bg-neutral-800"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {p.replace("-", " ")}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Plus className="w-5 h-5 text-emerald-400" />
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
                  onChange={(e) => setManualTask((prev) => ({ ...prev, cpu: parseInt(e.target.value) }))}
                  className="w-full h-1 bg-neutral-800 rounded-lg appearance-none accent-emerald-500"
                />
              </div>

              <button
                onClick={spikeLoad}
                className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 rounded-lg text-sm font-medium transition-colors"
              >
                Spike Load
              </button>
            </div>
          </div>
        </div>

        {/* Main */}
        <div className="lg:col-span-3 space-y-6">
          <div className="relative bg-neutral-900 border border-neutral-800 rounded-2xl p-8 min-h-[420px] flex flex-col items-center overflow-hidden">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black,transparent)] pointer-events-none" />

            <div className="absolute top-6 left-6 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-neutral-800 border border-neutral-700">
                <History className="w-4 h-4 text-neutral-400" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-neutral-500 uppercase">Incoming Jobs</p>
                <p className="text-xl font-mono font-bold">{displayIncomingJobs}</p>
              </div>
            </div>

            <div className="z-10 flex flex-col items-center gap-4 mb-16">
              <Motion.div
                animate={{
                  scale: [1, 1.05, 1],
                  borderColor: isAgentControlled ? "rgba(168, 85, 247, 0.5)" : "rgba(99, 102, 241, 0.5)",
                }}
                transition={{ duration: 2, repeat: Infinity }}
                className="p-5 rounded-2xl border bg-neutral-950 flex flex-col items-center gap-3 relative"
              >
                {isAgentControlled && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-purple-500 text-[10px] font-bold text-white rounded-full uppercase tracking-widest shadow-lg shadow-purple-500/30">
                    Agent Controlled
                  </div>
                )}
                <div
                  className={`w-14 h-14 rounded-xl flex items-center justify-center shadow-lg transition-colors ${
                    isAgentControlled ? "bg-purple-600 shadow-purple-500/30" : "bg-indigo-600 shadow-indigo-500/30"
                  }`}
                >
                  <Network className="w-8 h-8 text-white" />
                </div>
                <div className="text-center">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-widest ${
                      isAgentControlled ? "text-purple-400" : "text-indigo-400"
                    }`}
                  >
                    Current Route Strategy
                  </span>

                  <h4 className="text-lg font-bold capitalize">{currentRouteStrategy.replace("-", " ")}</h4>

                  <p className="text-[11px] text-neutral-400 mt-1">
                    Last routed to: <span className="font-mono text-white">{lastChosenNodeLabel}</span>
                  </p>
                </div>
              </Motion.div>
            </div>

            <div className="absolute top-[160px] inset-x-0 h-[100px] pointer-events-none">
              <AnimatePresence>
                {Array.from({ length: Math.min(12, displayIncomingJobs) }).map((_, i) => (
                  <Motion.div
                    key={`pending_${i}`}
                    initial={{ y: -80, opacity: 0, scale: 0 }}
                    animate={{ y: 0, opacity: 1, scale: 1, x: (i % 3 - 1) * 60 }}
                    exit={{ y: 200, opacity: 0, scale: 0.5 }}
                    transition={{ type: "spring", stiffness: 100 }}
                    className="absolute left-1/2 -ml-4"
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center border shadow-sm ${
                        isAgentControlled
                          ? "bg-purple-900/50 border-purple-500/30"
                          : "bg-neutral-800 border-neutral-700"
                      }`}
                    >
                      <Zap className={`w-4 h-4 ${isAgentControlled ? "text-purple-400" : "text-indigo-400"}`} />
                    </div>
                  </Motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full z-10 mt-auto">
              {nodes.map((node) => (
                <div
                  key={node.id}
                  className={`bg-neutral-900/80 backdrop-blur-sm border rounded-xl p-4 transition-all ${
                    lastChosenNodeId && node.id === lastChosenNodeId
                      ? "border-emerald-400 shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-500/20"
                      : "border-neutral-800 hover:border-neutral-700"
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="text-[10px] font-bold text-neutral-500 uppercase tracking-tight">{node.name}</h4>
                      <p className="text-sm font-mono font-bold text-neutral-300">
                        {node.status === "offline" ? "Offline" : "Active"}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {lastChosenNodeId && node.id === lastChosenNodeId && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          CHOSEN
                        </span>
                      )}
                      <div className="p-1.5 rounded-lg bg-neutral-800/50 border border-neutral-700/50">
                        <Cpu className="w-3 h-3 text-neutral-500" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-neutral-500">Saturation</span>
                      <span className="text-neutral-300 font-mono">
                        {Math.round((node.cpuUsed / Math.max(1, node.cpuCapacity)) * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800/50">
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
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Leaderboard + Diagnostics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-amber-500" />
                  <h3 className="font-semibold">Policy Performance Log</h3>
                </div>
                <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest bg-neutral-800 px-3 py-1 rounded-full border border-neutral-700">
                  RL Enabled
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-neutral-800 text-neutral-500 text-[10px] uppercase tracking-wider">
                      <th className="pb-3 font-medium">Rank</th>
                      <th className="pb-3 font-medium">Policy</th>
                      <th className="pb-3 font-medium text-right">Tasks</th>
                      <th className="pb-3 font-medium text-right">Avg Latency</th>
                      <th className="pb-3 font-medium text-right">Reward</th>
                      <th className="pb-3 font-medium text-right">Optimization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/50">
                    {leaderboard.map((stat, index) => (
                      <tr key={stat.policy} className={`${policy === stat.policy ? "bg-indigo-500/5" : ""}`}>
                        <td className="py-3">
                          <div
                            className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              index === 0
                                ? "bg-amber-500/20 text-amber-500 border border-amber-500/30"
                                : "bg-neutral-800 text-neutral-500"
                            }`}
                          >
                            {index + 1}
                          </div>
                        </td>

                        <td className="py-3">
                          <span
                            className={`text-sm font-medium capitalize ${
                              policy === stat.policy ? "text-indigo-400 font-bold" : "text-neutral-400"
                            }`}
                          >
                            {stat.policy.replace("-", " ")}
                          </span>
                          <div className="text-[10px] text-neutral-600">selected {stat.selectionPct.toFixed(0)}%</div>
                        </td>

                        <td className="py-3 text-right text-xs font-mono text-neutral-500">{stat.completedTasks}</td>

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
                                  className={`w-1 h-3 rounded-full ${
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

            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 flex flex-col">
              <div className="flex items-center gap-2 mb-6">
                <Activity className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-sm">System Diagnostics</h3>
              </div>

              <div className="space-y-6 flex-1">
                <div className="p-4 rounded-xl bg-neutral-800/30 border border-neutral-700/30">
                  <p className="text-[10px] text-neutral-500 uppercase font-bold mb-3">Live Saturation Flow</p>
                  <div className="h-[120px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <XAxis dataKey="name" hide />
                        <YAxis hide domain={[0, 100]} />
                        <Bar dataKey="cpu" radius={[2, 2, 0, 0]}>
                          {chartData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.cpu > 80 ? "#f43f5e" : isAgentControlled ? "#a855f7" : "#6366f1"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Explanation Box (Latest switch) */}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <History className="h-4 w-4 text-neutral-300" />
                      <div className="text-sm font-semibold">Latest Explanation</div>
                    </div>
                    <div className="text-xs text-neutral-400">
                      {latestExplanation?.policy ? String(latestExplanation.policy) : "—"}
                    </div>
                  </div>

                  <div className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-neutral-200">
                    {latestExplanation?.text
                      ? latestExplanation.text
                      : "No policy switches yet. When the agent switches strategies, you’ll see the explanation here (and the sim will pause)."}
                  </div>

                  {latestExplanation?.meta?.from_policy && latestExplanation?.meta?.to_policy ? (
                    <div className="mt-3 text-xs text-neutral-400">
                      Switch: {String(latestExplanation.meta.from_policy)} → {String(latestExplanation.meta.to_policy)}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3 mt-auto">
                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-500">System Throughput</span>
                    <span className="text-emerald-500 font-mono font-bold">{throughput.toFixed(1)} j/s</span>
                  </div>

                  <div className="flex justify-between text-xs">
                    <span className="text-neutral-500">Avg Observed Latency</span>
                    <span className="text-neutral-200 font-mono font-bold">
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
                    <span className="text-purple-400 font-mono font-bold">
                      {bestByReward ? bestByReward.replace("-", " ") : "---"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* If you want: add a UI knob for simulationSpeed too */}
        </div>
      </div>
    </div>
  );
}