import React, { useEffect, useMemo, useState } from "react";
import { Play, Plus, Square, Trash2 } from "lucide-react";
import {
  createEc2Node,
  deleteEc2Node,
  listEc2Nodes,
  startEc2Node,
  stopEc2Node,
  type Ec2Node,
} from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

const ADMIN_NODE_EMAIL = "shypine8@gmail.com";

function isAllowedAdminEmail(email?: string | null): boolean {
  return (email ?? "").trim().toLowerCase() === ADMIN_NODE_EMAIL;
}

export function AdminNodes() {
  const { token, user } = useAuth();
  const [nodes, setNodes] = useState<Ec2Node[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyStartAll, setBusyStartAll] = useState(false);
  const [busyStopAll, setBusyStopAll] = useState(false);
  const [busyCreate, setBusyCreate] = useState(false);
  const [instanceType, setInstanceType] = useState("t3.micro");
  const [createCountInput, setCreateCountInput] = useState<string>("1");

  const allowed = useMemo(() => isAllowedAdminEmail(user?.email), [user?.email]);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    const tick = async () => {
      try {
        const t = requireToken();
        const res = await listEc2Nodes(t);
        if (!active) return;
        setNodes(res.nodes ?? []);
        setError(null);
      } catch (e: any) {
        if (!active) return;
        setError(e?.message ?? "Failed to load EC2 nodes");
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 2500);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [allowed]);

  if (!allowed) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 text-sm text-rose-300">
        This page is restricted to {ADMIN_NODE_EMAIL}.
      </div>
    );
  }

  const requireToken = () => {
    if (!token) throw new Error("Missing auth token. Please log in again.");
    return token;
  };

  const onCreate = async () => {
    try {
      const parsedCount = Number(createCountInput);
      const createCount = Number.isInteger(parsedCount) ? parsedCount : 0;
      if (!Number.isInteger(createCount) || createCount < 1 || createCount > 20) {
        throw new Error("Create count must be between 1 and 20.");
      }
      setBusyCreate(true);
      const t = requireToken();
      let created = 0;
      for (let i = 0; i < createCount; i++) {
        await createEc2Node(t, {
          instance_type: instanceType.trim() || "t3.micro",
        });
        created += 1;
      }
      setError(created > 0 ? null : "No nodes were created.");
      if (created > 0) {
        const res = await listEc2Nodes(t);
        setNodes(res.nodes ?? []);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to create EC2 node");
    } finally {
      setBusyCreate(false);
    }
  };

  const onStopAll = async () => {
    try {
      const t = requireToken();
      setBusyStopAll(true);
      const running = nodes.filter((n) => (n.state ?? "").toLowerCase() === "running");
      for (const n of running) {
        await stopEc2Node(t, n.instance_id);
      }
      const res = await listEc2Nodes(t);
      setNodes(res.nodes ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to stop all running nodes");
    } finally {
      setBusyStopAll(false);
    }
  };

  const onStartAll = async () => {
    try {
      const t = requireToken();
      setBusyStartAll(true);
      const notRunning = nodes.filter((n) => (n.state ?? "").toLowerCase() !== "running");
      for (const n of notRunning) {
        await startEc2Node(t, n.instance_id);
      }
      const res = await listEc2Nodes(t);
      setNodes(res.nodes ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to start all nodes");
    } finally {
      setBusyStartAll(false);
    }
  };

  const onAction = async (instanceId: string, fn: (t: string, i: string) => Promise<any>, label: string) => {
    try {
      setBusyId(instanceId);
      const t = requireToken();
      await fn(t, instanceId);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? `Failed to ${label} EC2 node`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin Nodes</h1>
        <p className="text-neutral-400 mt-1">Create, start, stop, and terminate EC2 node instances.</p>
        {error ? <p className="text-sm text-rose-400 mt-2">{error}</p> : null}
      </div>

      <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4 md:p-5">
        <h2 className="font-semibold text-neutral-100 mb-3">Create EC2 Nodes</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Uses backend defaults for AMI, subnet, and security group. Configure these in backend env.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <select
            value={instanceType}
            onChange={(e) => setInstanceType(e.target.value)}
            className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200"
          >
            <option value="t2.micro">t2.micro (free-tier eligible)</option>
            <option value="t3.micro">t3.micro (free-tier eligible in many accounts)</option>
            <option value="t4g.micro">t4g.micro (free-tier eligible ARM)</option>
          </select>
          <input
            type="number"
            min={1}
            max={20}
            value={createCountInput}
            onChange={(e) => setCreateCountInput(e.target.value)}
            className="bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm text-neutral-200"
            placeholder="How many nodes"
          />
          <div className="text-xs text-neutral-400 border border-neutral-800 rounded-lg px-3 py-2 flex items-center">
            Count: {createCountInput || "—"}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={onCreate}
            disabled={busyCreate}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {busyCreate
              ? "Creating..."
              : `Create ${Number(createCountInput) || 0} Node${Number(createCountInput) === 1 ? "" : "s"}`}
          </button>
          <button
            onClick={onStartAll}
            disabled={busyStartAll}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/30 hover:bg-sky-500/20 disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {busyStartAll ? "Starting..." : "Start All"}
          </button>
          <button
            onClick={onStopAll}
            disabled={busyStopAll}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-50"
          >
            <Square className="w-4 h-4" />
            {busyStopAll ? "Stopping..." : "Stop All"}
          </button>
        </div>
      </div>

      <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-4 md:p-5">
        <h2 className="font-semibold text-neutral-100 mb-3">Manage Existing Nodes</h2>
        <div className="space-y-2">
          {nodes.map((n, i) => {
            const instanceId = String(n.instance_id ?? n.name ?? `node-${i + 1}`);
            const addr = n.public_ip ?? n.private_ip ?? n.public_dns ?? "n/a";
            const state = (n.state ?? "").toLowerCase();
            const isRunning = state === "running";
            const isStopped = state === "stopped";
            return (
              <div
                key={`${instanceId}-${i}`}
                className="border border-neutral-800 rounded-xl px-3 py-2 flex items-center justify-between gap-2"
              >
                <div>
                  <div className="text-sm font-medium text-neutral-100 flex items-center gap-2">
                    <span>{n.name ?? instanceId}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full ${
                        isRunning ? "bg-emerald-500/10 text-emerald-400" : "bg-neutral-700 text-neutral-300"
                      }`}
                    >
                      {isRunning ? "ON" : "OFF"}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500">
                    {addr} • {n.region ?? "unknown-region"} • {n.state ?? "unknown"} • {instanceId}
                  </div>
                  <div className="text-xs text-neutral-500">Type: {n.instance_type ?? "unknown"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void onAction(instanceId, startEc2Node, "start")}
                    disabled={busyId === instanceId || !isStopped}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-400 hover:text-sky-300 disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Start
                  </button>
                  <button
                    onClick={() => void onAction(instanceId, stopEc2Node, "stop")}
                    disabled={busyId === instanceId || !isRunning}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-400 hover:text-amber-300 disabled:opacity-50"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Stop
                  </button>
                  <button
                    onClick={() => void onAction(instanceId, deleteEc2Node, "delete")}
                    disabled={busyId === instanceId}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-400 hover:text-rose-300 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
          {nodes.length === 0 ? <p className="text-sm text-neutral-500">No discovered nodes.</p> : null}
        </div>
      </div>
    </div>
  );
}
