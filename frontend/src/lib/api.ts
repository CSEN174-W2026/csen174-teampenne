// src/lib/api.ts
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store", // IMPORTANT: prevent stale GET caching
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ----------------------------------------------------
// TYPES
// ----------------------------------------------------

export type NodeSnapshot = {
  name: string;
  host: string;
  port: number;
  cpus?: number;
  memory_mb?: number;

  cpu_pct?: number; // 0..100
  mem_pct?: number; // 0..100
  queue_len?: number;
  time_ms?: number;

  [k: string]: any;
};

export type NodesResponse = {
  count: number;
  nodes: NodeSnapshot[];
  time_ms: number;
};

export type ClusterStatsResponse = {
  time_ms: number;
  window_ms: number;
  nodes_count: number;
  jobs_count: number;
  avg_latency_ms: number | null;
  throughput_rps: number; // jobs/sec
  disk_usage_pct: number | null; // 0..100

  // allow extra fields because backend also returns nested debug payload
  [k: string]: any;
};

export type AgentConfig = {
  learner_kind: string;
  goal_kind: string;
  seed?: number | null;
  learner_kwargs?: Record<string, any> | null;
  goal_kwargs?: Record<string, any> | null;
};

export type JobRequest = {
  job_id: string;
  user_id: string;
  service_time_ms: number;
  metadata?: Record<string, any>;
};

// ----------------------------------------------------
// SYSTEM LOG TYPES
// ----------------------------------------------------

export type SystemLogLevel = "info" | "warn" | "error";

export type SystemLogEvent = {
  ts_ms: number;
  level: SystemLogLevel | string;
  topic: string;
  message: string;
  data?: Record<string, any> | null;
};

export type SystemLogsResponse = {
  time_ms: number;
  since_ms: number;
  limit: number;
  events: SystemLogEvent[];
};

// ----------------------------------------------------
// BASIC API
// ----------------------------------------------------

export async function getHealth() {
  return http<{ ok: boolean; time_ms: number }>("/health");
}

export async function getNodes() {
  return http<NodesResponse>("/nodes");
}

/**
 * IMPORTANT:
 * Your backend cluster_stats signature is:
 *   /cluster/stats?window_s=...&limit=...
 *
 * Your old frontend used recent_limit.
 * We now send BOTH: limit and recent_limit for compatibility,
 * but backend will actually use `limit`.
 */
export async function getClusterStats(windowS = 60, limit = 800) {
  return http<ClusterStatsResponse>(
    `/cluster/stats?window_s=${windowS}&limit=${limit}&recent_limit=${limit}`
  );
}

export async function submitJob(payload: { config: AgentConfig; job: JobRequest }) {
  return http("/jobs/submit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getLearnerStats(cfg: AgentConfig) {
  return http<any>("/agents/learner_stats", {
    method: "POST",
    body: JSON.stringify(cfg),
  });
}

export async function listAgents() {
  return http<any>("/agents");
}

export async function getPending(cfg: AgentConfig) {
  return http<{ pending_job_ids: string[]; time_ms?: number }>("/agents/pending", {
    method: "POST",
    body: JSON.stringify(cfg),
  });
}

export async function getRecentExplanations(cfg: AgentConfig, limit = 10) {
  return http<{ events: any[]; time_ms?: number }>(
    `/agents/explanations/recent?limit=${limit}`,
    {
      method: "POST",
      body: JSON.stringify(cfg),
    }
  );
}

export async function getLatencyStats(cfg: AgentConfig) {
  return http<any>("/agents/latency_stats", {
    method: "POST",
    body: JSON.stringify(cfg),
  });
}

export async function getStats(cfg: AgentConfig) {
  return http<any>("/agents/stats", {
    method: "POST",
    body: JSON.stringify(cfg),
  });
}

export async function resetManager() {
  return http<{ ok: boolean; time_ms: number }>("/reset", {
    method: "POST",
  });
}

// ----------------------------------------------------
// SYSTEM LOGS API
// ----------------------------------------------------

export async function getSystemLogs(sinceMs = 0, limit = 500) {
  const safeLimit = Math.max(1, Math.min(limit, 2000));
  return http<SystemLogsResponse>(
    `/system/logs?since_ms=${encodeURIComponent(sinceMs)}&limit=${encodeURIComponent(safeLimit)}`
  );
}

export async function postSystemLog(payload: {
  level?: SystemLogLevel | string;
  topic?: string;
  message: string;
  data?: Record<string, any> | null;
}) {
  return http<{ ok: boolean; time_ms: number }>("/system/logs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function clearSystemLogs() {
  return http<{ ok: boolean; time_ms: number }>("/system/logs/clear", {
    method: "POST",
  });
}