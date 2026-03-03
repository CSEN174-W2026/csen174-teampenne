// src/lib/api.ts
const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
const API_BASE = env.VITE_API_BASE ?? "/manager-api";
const WEB_API_BASE = env.VITE_WEB_API_BASE ?? "/web-api";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function webHttp<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${WEB_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export type NodeSnapshot = {
  name: string;
  host: string;
  port: number;
  cpus?: number;
  memory_mb?: number;
  cpu_pct?: number;
  mem_pct?: number;
  queue_len?: number;
  time_ms?: number;
  [k: string]: any;
};

export type NodesResponse = {
  count: number;
  nodes: NodeSnapshot[];
  time_ms: number;
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

export type RunStartResponse = {
  run_id: string;
  status: string;
};

export type RunStatusResponse = {
  run_id: string;
  status: string;
  processed_jobs: number;
  total_jobs: number;
  summary: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
};

export type StoredNodeSample = {
  id: number;
  nodeName: string;
  host: string;
  port: number;
  cpuPct?: number | null;
  memPct?: number | null;
  queueLen?: number | null;
  capturedAtMs: string;
  source: string;
  createdAt: string;
};

export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  is_active: boolean;
  created_at?: number | null;
  updated_at?: number | null;
};

export async function getHealth() {
  return http<{ ok: boolean; time_ms: number }>("/health");
}

export async function getNodes() {
  return http<NodesResponse>("/nodes");
}

export async function submitJob(payload: { config: AgentConfig; job: JobRequest }) {
  return http("/jobs/submit", { method: "POST", body: JSON.stringify(payload) });
}

export async function getLearnerStats(cfg: AgentConfig) {
  return http<any>("/agents/learner_stats", { method: "POST", body: JSON.stringify(cfg) });
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
  return http<{ events: any[]; time_ms?: number }>(`/agents/explanations/recent?limit=${limit}`, {
    method: "POST",
    body: JSON.stringify(cfg),
  });
}

export async function getLatencyStats(cfg: AgentConfig) {
  return http<any>("/agents/latency_stats", { method: "POST", body: JSON.stringify(cfg) });
}

export async function getStats(cfg: AgentConfig) {
  return http<any>("/agents/stats", { method: "POST", body: JSON.stringify(cfg) });
}

export async function resetManager() {
  return http<{ ok: boolean; time_ms: number }>("/reset", { method: "POST" });
}

export async function startRun(payload: Record<string, unknown>) {
  return http<RunStartResponse>("/runs/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getRunStatus(runId: string) {
  return http<RunStatusResponse>(`/runs/${runId}`);
}

export async function getStoredNodeSamples(limit = 20) {
  return webHttp<{ rows: StoredNodeSample[] }>(`/api/metrics/node-samples?limit=${limit}`);
}

export async function me(token: string) {
  return http<AuthUser>("/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function logout(token: string) {
  return http<{ ok: boolean; message: string }>("/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function listUsers(token: string) {
  return http<{ rows: AuthUser[] }>("/users", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function createUser(
  token: string,
  payload: { email: string; password: string; full_name?: string; is_admin?: boolean; is_active?: boolean }
) {
  return http<AuthUser>("/users", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function updateUser(
  token: string,
  userId: string,
  payload: { email?: string; password?: string; full_name?: string; is_admin?: boolean; is_active?: boolean }
) {
  return http<AuthUser>(`/users/${userId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function deleteUser(token: string, userId: string) {
  return http<AuthUser>(`/users/${userId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}