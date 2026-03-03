import { useEffect, useRef } from "react";
import { getRunStatus, startRun } from "../../lib/api";

const SIM_BG_RUNNING_KEY = "sim_bg_running";
const SIM_BG_RUN_ID_KEY = "sim_bg_run_id";
const SIM_BG_RUN_STATUS_KEY = "sim_bg_run_status";
const SIM_BG_CONFIG_KEY = "sim_bg_config";

type BgConfig = {
  goal_kind: string;
  learner_kind: string;
  learner_kwargs?: Record<string, unknown>;
  goal_kwargs?: Record<string, unknown>;
  seed?: number | null;
  user_id?: string;
  sla_ms?: number;
  jobs?: number;
};

export function SimulationBackgroundRunner() {
  const inFlightRef = useRef(false);

  useEffect(() => {
    let active = true;

    const tick = async () => {
      if (!active || inFlightRef.current) return;
      if (typeof window === "undefined") return;

      // While the simulation page is mounted, it handles chaining itself.
      if (window.location.pathname.startsWith("/simulation")) return;

      const running = localStorage.getItem(SIM_BG_RUNNING_KEY) === "1";
      if (!running) return;

      const cfgRaw = localStorage.getItem(SIM_BG_CONFIG_KEY);
      if (!cfgRaw) return;

      let cfg: BgConfig;
      try {
        cfg = JSON.parse(cfgRaw) as BgConfig;
      } catch {
        return;
      }

      inFlightRef.current = true;
      try {
        const runId = localStorage.getItem(SIM_BG_RUN_ID_KEY);
        if (runId) {
          const st = await getRunStatus(runId);
          localStorage.setItem(SIM_BG_RUN_STATUS_KEY, st.status);
          if (st.status === "running") return;
          localStorage.removeItem(SIM_BG_RUN_ID_KEY);
        }

        const res = await startRun({
          goal_kind: cfg.goal_kind,
          learner_kind: cfg.learner_kind,
          learner_kwargs: cfg.learner_kwargs ?? {},
          goal_kwargs: cfg.goal_kwargs ?? {},
          workload: {
            kind: "tiny",
            jobs: Math.min(Math.max(Number(cfg.jobs ?? 10000), 1), 10000),
            seed: cfg.seed ?? (Date.now() % 100000),
            users: [cfg.user_id ?? "u1"],
            sla_threshold_ms: Number(cfg.sla_ms ?? 750),
          },
          poll_interval_ms: 50,
          job_timeout_ms: 15000,
        });
        localStorage.setItem(SIM_BG_RUN_ID_KEY, res.run_id);
        localStorage.setItem(SIM_BG_RUN_STATUS_KEY, res.status);
      } catch {
        localStorage.setItem(SIM_BG_RUN_STATUS_KEY, "failed");
      } finally {
        inFlightRef.current = false;
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 1500);

    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
