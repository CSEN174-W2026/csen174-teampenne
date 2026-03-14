// src/lib/api.ts
const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
// Manager API requests default to the local proxy so frontend and backend can share an origin in dev.
const API_BASE = env.VITE_API_BASE ?? "/manager-api";
// Web API requests target the Next.js app endpoints that persist UI-facing data.
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
    // Surface the response body to make backend validation errors visible in the UI.
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// Separate helper because some frontend state is stored by the web app instead of the manager service.
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

export type JobType = "simulated" | "python" | "python_script" | "ml_script";

export type JobRequest = {
  job_id: string;
  user_id: string;

  // simulated jobs
  service_time_ms?: number;

  // real jobs
  job_type?: JobType;
  script_name?: string;
  script_content?: string;
  args?: string[];
  timeout_s?: number;

  metadata?: Record<string, any>;
};


export type RealJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";

export type JobExecutionRecord = {
  job_id: string;
  user_id: string;
  job_type: JobType;
  script_name?: string | null;
  status: RealJobStatus;
  queued_at_ms: number;
  started_at_ms?: number | null;
  finished_at_ms?: number | null;
  observed_latency_ms?: number | null;
  service_time_ms?: number | null;
  exit_code?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  node_name?: string | null;
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

export type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  is_active: boolean;
  created_at?: number | null;
  updated_at?: number | null;
};

export type SavedNodeRef = {
  id?: number;
  nodeKey: string;
  nodeName: string;
  host: string;
  port: number;
};

export type NodeGroup = {
  id: number;
  userId: string;
  userEmail?: string | null;
  name: string;
  color: string;
  createdAt?: string;
  updatedAt?: string;
  nodes: SavedNodeRef[];
};

export type NodeGroupSelection = {
  id: number;
  userId: string;
  userEmail?: string | null;
  groupIds: number[];
  updatedAt?: string;
};

export type Ec2Node = {
  instance_id: string;
  name: string;
  state: string; // pending | running | stopping | stopped | ...
  private_ip?: string | null;
  public_ip?: string | null;
  public_dns?: string | null;
  az?: string | null;
  region?: string | null;
  instance_type?: string | null;
};

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

export async function explainSimulation(payload: { config: AgentConfig; context: Record<string, any> }) {
  return http<{ explanation: string; provider: string; reason?: string; time_ms: number }>(
    "/agents/simulation/explain",
    {
    method: "POST",
    body: JSON.stringify(payload),
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
  // Clamp client requests so a bad caller cannot ask the backend for an unbounded log page.
  const safeLimit = Math.max(1, Math.min(limit, 2000));
  return http<SystemLogsResponse>(
    `/system/logs?since_ms=${encodeURIComponent(sinceMs)}&limit=${encodeURIComponent(safeLimit)}`
  );
}


export async function startRun(payload: Record<string, unknown>) {
  return http<RunStartResponse>("/runs/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function clearSystemLogs() {
  return http<{ ok: boolean; time_ms: number }>("/system/logs/clear", {
    method: "POST",
  });
}
export async function getRunStatus(runId: string) {
  return http<RunStatusResponse>(`/runs/${runId}`);
}

export async function listNodeGroups(userId: string) {
  return webHttp<{ rows: NodeGroup[] }>(`/api/node-groups?userId=${encodeURIComponent(userId)}`);
}

export async function createNodeGroup(payload: {
  userId: string;
  userEmail?: string;
  name: string;
  color?: string;
  nodes: SavedNodeRef[];
}) {
  return webHttp<{ row: NodeGroup }>("/api/node-groups", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteNodeGroup(groupId: number) {
  return webHttp<{ ok: boolean; deleted: number }>(`/api/node-groups/${groupId}`, {
    method: "DELETE",
  });
}

export async function getNodeGroupSelection(userId: string) {
  return webHttp<{ row: NodeGroupSelection | null }>(
    `/api/node-groups/selections?userId=${encodeURIComponent(userId)}`
  );
}

export async function saveNodeGroupSelection(payload: {
  userId: string;
  userEmail?: string;
  groupIds: number[];
}) {
  return webHttp<{ row: NodeGroupSelection }>("/api/node-groups/selections", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function me(token: string) {
  return http<AuthUser>("/auth/me", {
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

export async function getMyLastAgentConfig(token: string) {
  return http<{ time_ms: number; config: AgentConfig | null }>("/users/me/last_agent_config", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getMyAgentHistory(token: string) {
  return http<{ time_ms: number; history: { time_ms: number; config: AgentConfig }[] }>(
    "/users/me/agent_history",
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

export type CreateEc2NodePayload = {
  image_id?: string;
  instance_type: string;
  subnet_id?: string;
  security_group_id?: string;
  key_name?: string;
  iam_instance_profile?: string;
  user_data?: string;
};

export async function createEc2Node(token: string, payload: CreateEc2NodePayload) {
  return http("/ec2/nodes/create", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function startEc2Node(token: string, instanceId: string) {
  return http(`/ec2/nodes/${instanceId}/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function stopEc2Node(token: string, instanceId: string) {
  return http(`/ec2/nodes/${instanceId}/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function deleteEc2Node(token: string, instanceId: string) {
  return http(`/ec2/nodes/${instanceId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function listEc2Nodes(token: string) {
  return http<{ nodes: Ec2Node[]; count: number; time_ms: number }>("/ec2/nodes", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getNodeJobStatus(host: string, port: number, jobId: string) {
  return http<JobExecutionRecord>(
    `/nodes/job_status?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port)}&job_id=${encodeURIComponent(jobId)}`
  );
}

export async function cancelScopedJobs(payload: {
  user_id: string;
  allowed_node_keys: string[];
  include_running?: boolean;
}) {
  return http<{
    ok: boolean;
    nodes_attempted: number;
    cancelled_queued: number;
    cancelled_running: number;
    errors: string[];
  }>("/jobs/cancel_scope", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function pushRunEvent(payload: Record<string, unknown>) {
  return webHttp<{ ok: boolean }>("/api/runs/events", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}