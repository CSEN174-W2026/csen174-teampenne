import { useEffect, useState } from "react";
import { Play, RefreshCcw, Activity, Timer } from "lucide-react";
import { getRunStatus, startRun, type RunStatusResponse } from "../../lib/api";

export function Runs() {
  const [jobs, setJobs] = useState(25);
  const [seed, setSeed] = useState(42);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<RunStatusResponse | null>(null);

  const startBackendRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await startRun({
        goal_kind: "min_mean_latency",
        learner_kind: "sample_average",
        workload: {
          kind: "tiny",
          jobs,
          seed,
          sla_threshold_ms: 100,
        },
        poll_interval_ms: 50,
        job_timeout_ms: 15000,
      });

      setRunId(res.run_id);
      setStatus(res.status);
      setRun(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start run");
      setStatus("failed");
    } finally {
      setLoading(false);
    }
  };

  const refreshRunStatus = async () => {
    if (!runId) return;
    try {
      const st = await getRunStatus(runId);
      setRun(st);
      setStatus(st.status);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch run status");
    }
  };

  useEffect(() => {
    if (!runId || status !== "running") return;
    const id = setInterval(() => {
      void refreshRunStatus();
    }, 1000);
    return () => clearInterval(id);
  }, [runId, status]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Runs</h1>
        <p className="text-neutral-400 mt-1">Start backend manager runs and monitor progress in real time.</p>
      </div>

      <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="text-sm text-neutral-400">
            Jobs
            <input
              type="number"
              min={1}
              max={1000}
              value={jobs}
              onChange={(e) => setJobs(Math.max(1, Number(e.target.value) || 1))}
              className="mt-2 w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100"
            />
          </label>

          <label className="text-sm text-neutral-400">
            Seed
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
              className="mt-2 w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-neutral-100"
            />
          </label>

          <div className="flex items-end gap-2">
            <button
              onClick={startBackendRun}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium"
            >
              <Play className="w-4 h-4 fill-current" />
              {loading ? "Starting..." : "Start Run"}
            </button>
            <button
              onClick={() => void refreshRunStatus()}
              disabled={!runId}
              className="px-3 py-2 rounded-lg border border-neutral-700 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
              title="Refresh status"
            >
              <RefreshCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-neutral-800 p-3">
            <p className="text-xs text-neutral-500 uppercase tracking-wider">Run ID</p>
            <p className="text-sm text-neutral-200 font-mono break-all">{runId ?? "—"}</p>
          </div>
          <div className="rounded-xl border border-neutral-800 p-3">
            <p className="text-xs text-neutral-500 uppercase tracking-wider">Status</p>
            <p className="text-sm text-neutral-200">{status}</p>
          </div>
          <div className="rounded-xl border border-neutral-800 p-3">
            <p className="text-xs text-neutral-500 uppercase tracking-wider">Processed</p>
            <p className="text-sm text-neutral-200 flex items-center gap-1">
              <Activity className="w-4 h-4 text-indigo-400" />
              {run?.processed_jobs ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-800 p-3">
            <p className="text-xs text-neutral-500 uppercase tracking-wider">Total</p>
            <p className="text-sm text-neutral-200 flex items-center gap-1">
              <Timer className="w-4 h-4 text-emerald-400" />
              {run?.total_jobs ?? jobs}
            </p>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        ) : null}
      </div>

      <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-6">
        <h2 className="text-lg font-semibold mb-3">Latest Summary</h2>
        <pre className="text-xs text-neutral-300 bg-neutral-950 border border-neutral-800 rounded-xl p-4 overflow-auto">
          {JSON.stringify(run?.summary ?? {}, null, 2)}
        </pre>
      </div>
    </div>
  );
}
