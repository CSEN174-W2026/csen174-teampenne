import { useState, useEffect, useCallback, useRef } from "react";
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
  Activity
} from "lucide-react";
import { motion as Motion, AnimatePresence } from "motion/react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from "recharts";
import { persistIterations, submitJob as submitJobApi } from "../../lib/api";

interface Node {
  id: string;
  name: string;
  cpuCapacity: number;
  memCapacity: number;
  cpuUsed: number;
  memUsed: number;
  tasks: Task[];
  status: 'active' | 'draining' | 'offline';
}

interface Task {
  id: string;
  cpuReq: number;
  memReq: number;
  duration: number; 
  remainingTime: number;
  startTime?: number;
  queuedAt: number;
  nodeId?: string;
  status: 'queued' | 'running' | 'completed';
}

interface PolicyStat {
  policy: Policy;
  completedTasks: number;
  totalLatency: number;
  avgLatency: number;
  recentLatency: number[]; // Last 5 tasks for learning
}

interface AgentState {
  isActive: boolean;
  explorationRate: number;
  lastDecisionTime: number;
  status: 'exploring' | 'optimizing' | 'monitoring';
  confidence: Record<Policy, number>;
}

type Policy = 'round-robin' | 'least-loaded' | 'resource-aware' | 'random';

export function Simulation() {
  const runIdRef = useRef(`frontend-sim-${Date.now()}`);
  const iterationRef = useRef(0);

  const [isRunning, setIsRunning] = useState(false);
  const [isAgentControlled, setIsAgentControlled] = useState(false);
  const [policy, setPolicy] = useState<Policy>('round-robin');
  const [nodes, setNodes] = useState<Node[]>([
    { id: 'node-1', name: 'us-east-1a', cpuCapacity: 100, memCapacity: 1024, cpuUsed: 0, memUsed: 0, tasks: [], status: 'active' },
    { id: 'node-2', name: 'us-east-1b', cpuCapacity: 100, memCapacity: 1024, cpuUsed: 0, memUsed: 0, tasks: [], status: 'active' },
    { id: 'node-3', name: 'us-west-2a', cpuCapacity: 150, memCapacity: 2048, cpuUsed: 0, memUsed: 0, tasks: [], status: 'active' },
    { id: 'node-4', name: 'eu-central-1', cpuCapacity: 80, memCapacity: 512, cpuUsed: 0, memUsed: 0, tasks: [], status: 'active' },
  ]);
  const [lastAssignedIndex, setLastAssignedIndex] = useState(-1);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [globalQueue, setGlobalQueue] = useState<Task[]>([]);
  const [processedTasksCount, setProcessedTasksCount] = useState(0);
  const [policyStats, setPolicyStats] = useState<Record<Policy, PolicyStat>>({
    'round-robin': { policy: 'round-robin', completedTasks: 0, totalLatency: 0, avgLatency: 0, recentLatency: [] },
    'least-loaded': { policy: 'least-loaded', completedTasks: 0, totalLatency: 0, avgLatency: 0, recentLatency: [] },
    'resource-aware': { policy: 'resource-aware', completedTasks: 0, totalLatency: 0, avgLatency: 0, recentLatency: [] },
    'random': { policy: 'random', completedTasks: 0, totalLatency: 0, avgLatency: 0, recentLatency: [] },
  });

  const [agent, setAgent] = useState<AgentState>({
    isActive: false,
    explorationRate: 1.0, // Start fully exploring
    lastDecisionTime: Date.now(),
    status: 'exploring',
    confidence: {
      'round-robin': 0.25,
      'least-loaded': 0.25,
      'resource-aware': 0.25,
      'random': 0.25,
    }
  });

  const [manualTask, setManualTask] = useState({ cpu: 20, mem: 128, duration: 10 });

  const createRandomTask = useCallback((overrides = {}) => {
    const id = Math.random().toString(36).substr(2, 9);
    return {
      id,
      cpuReq: Math.floor(Math.random() * 20) + 5,
      memReq: Math.floor(Math.random() * 128) + 32,
      duration: Math.floor(Math.random() * 10) + 5,
      remainingTime: 0,
      queuedAt: Date.now(),
      status: 'queued' as const,
      ...overrides
    };
  }, []);

  const enqueueTask = (overrides = {}) => {
    const newTask = createRandomTask(overrides);
    newTask.remainingTime = newTask.duration;
    setGlobalQueue(prev => [...prev, newTask]);
  };

  const dispatchTaskToBackend = useCallback(async (task: Task, fallbackTarget: Node) => {
    const startedAt = performance.now();
    let success = true;
    let decision: Record<string, any> = {};
    let responseBody: Record<string, any> = {};
    let errorMessage: string | null = null;

    try {
      responseBody = await submitJobApi({
        config: {
          learner_kind: "sample_average",
          goal_kind: "min_mean_latency",
        },
        job: {
          job_id: task.id,
          user_id: "frontend-sim-user",
          service_time_ms: Math.max(1, task.duration * 100),
          metadata: {
            source: "frontend-simulation",
            cpuReq: task.cpuReq,
            memReq: task.memReq,
            queuedAt: task.queuedAt,
          },
        },
      });
      decision = (responseBody?.decision ?? {}) as Record<string, any>;
    } catch (err: unknown) {
      success = false;
      errorMessage = err instanceof Error ? err.message : "unknown error";
    }

    const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));
    iterationRef.current += 1;

    try {
      await persistIterations({
        userId: "frontend-sim-user",
        runId: runIdRef.current,
        records: [
          {
            iteration: iterationRef.current,
            policyName: (decision.policy_name as string) ?? policy,
            nodeName: (decision.node_name as string) ?? fallbackTarget.name,
            targetHost: (decision.host as string) ?? "127.0.0.1",
            targetPort: Number(decision.port ?? 0) || 0,
            success,
            latencyMs: elapsedMs,
            learnerArm: (decision.policy_name as string) ?? policy,
            metadata: {
              taskId: task.id,
              simTask: {
                cpuReq: task.cpuReq,
                memReq: task.memReq,
                duration: task.duration,
              },
              fallbackTarget: {
                name: fallbackTarget.name,
                id: fallbackTarget.id,
              },
              backendDecision: decision,
              backendResponse: responseBody,
              error: errorMessage,
            },
          },
        ],
      });
    } catch (persistErr) {
      console.error("Failed to persist iteration", persistErr);
    }
  }, [policy]);

  const selectNode = useCallback((task: Task, currentNodes: Node[]) => {
    const activeNodes = currentNodes.filter(n => 
      n.status === 'active' && 
      (n.cpuCapacity - n.cpuUsed) >= task.cpuReq &&
      (n.memCapacity - n.memUsed) >= task.memReq
    );
    
    if (activeNodes.length === 0) return null;

    // Use a specific policy for selection
    const applyPolicy = (p: Policy) => {
      switch (p) {
        case 'round-robin': {
          const nextIndex = (lastAssignedIndex + 1) % activeNodes.length;
          setLastAssignedIndex(nextIndex);
          return activeNodes[nextIndex];
        }
        case 'least-loaded': {
          return [...activeNodes].sort((a, b) => (a.cpuUsed / a.cpuCapacity) - (b.cpuUsed / b.cpuCapacity))[0];
        }
        case 'resource-aware': {
          return [...activeNodes].sort((a, b) => {
            const aRemaining = (a.cpuCapacity - a.cpuUsed) + (a.memCapacity - a.memUsed) / 10;
            const bRemaining = (b.cpuCapacity - b.cpuUsed) + (b.memCapacity - b.memUsed) / 10;
            return bRemaining - aRemaining;
          })[0];
        }
        case 'random': {
          return activeNodes[Math.floor(Math.random() * activeNodes.length)];
        }
      }
    };

    return applyPolicy(policy);
  }, [policy, lastAssignedIndex]);

  // Agent Learning Loop
  useEffect(() => {
    if (!isRunning || !isAgentControlled) return;

    const learningInterval = setInterval(() => {
      setAgent(prev => {
        const now = Date.now();
        const policies = Object.keys(policyStats) as Policy[];
        
        // 1. Update Confidence Scores based on Latency (Reward = 1 / Latency)
        // Lower latency = Higher score
        const newConfidence = { ...prev.confidence };
        let totalScore = 0;
        const scores = policies.map(p => {
          const stat = policyStats[p];
          // Use a default for policies with no data yet to encourage exploration
          if (stat.completedTasks === 0) return 1.0;
          // Reward is inverse to latency. We use avgLatency or recent if available.
          const lat = stat.avgLatency || 5;
          return 1 / (lat + 0.1); 
        });

        const sumScores = scores.reduce((a, b) => a + b, 0);
        policies.forEach((p, i) => {
          newConfidence[p] = scores[i] / sumScores;
        });

        // 2. Decide Policy (Epsilon-Greedy)
        let nextPolicy = policy;
        let nextStatus = prev.status;
        const newExplorationRate = Math.max(0.05, prev.explorationRate * 0.98); // Decay exploration

        if (Math.random() < prev.explorationRate) {
          // Explore: Pick random
          nextPolicy = policies[Math.floor(Math.random() * policies.length)];
          nextStatus = 'exploring';
        } else {
          // Exploit: Pick best
          nextPolicy = policies.reduce((a, b) => newConfidence[a] > newConfidence[b] ? a : b);
          nextStatus = 'optimizing';
        }

        if (nextPolicy !== policy) {
          setPolicy(nextPolicy);
        }

        return {
          ...prev,
          confidence: newConfidence,
          explorationRate: newExplorationRate,
          status: nextStatus,
          lastDecisionTime: now
        };
      });
    }, 3000 / simulationSpeed); // Decisions every 3s scaled by speed

    return () => clearInterval(learningInterval);
  }, [isRunning, isAgentControlled, policy, policyStats, simulationSpeed]);

  // Simulation Loop
  useEffect(() => {
    if (!isRunning) return;

    const tick = setInterval(() => {
      const now = Date.now();

      // 1. Process running tasks
      setNodes(prevNodes => prevNodes.map(node => {
        const completed: Task[] = [];
        const updatedTasks = node.tasks.map(t => {
          const newRemaining = t.remainingTime - (1 * simulationSpeed);
          if (newRemaining <= 0) completed.push(t);
          return { ...t, remainingTime: newRemaining };
        }).filter(t => t.remainingTime > 0);

        if (completed.length > 0) {
          setProcessedTasksCount(prev => prev + completed.length);
          setPolicyStats(prev => {
            const current = prev[policy];
            const batchLatency = completed.reduce((acc, t) => acc + (now - t.queuedAt), 0) / (completed.length * 1000);
            const newTotalLatency = current.totalLatency + (batchLatency * completed.length);
            const newCompleted = current.completedTasks + completed.length;
            
            // Keep recent history for learning visualizer
            const newRecent = [...current.recentLatency, batchLatency].slice(-10);

            return {
              ...prev,
              [policy]: {
                ...current,
                completedTasks: newCompleted,
                totalLatency: newTotalLatency,
                avgLatency: newTotalLatency / newCompleted,
                recentLatency: newRecent
              }
            };
          });
        }

        return { 
          ...node, 
          tasks: updatedTasks, 
          cpuUsed: updatedTasks.reduce((acc, t) => acc + t.cpuReq, 0),
          memUsed: updatedTasks.reduce((acc, t) => acc + t.memReq, 0)
        };
      }));

      // 2. Assign from queue
      setGlobalQueue(prevQueue => {
        const assignedIds: string[] = [];
        setNodes(currentNodes => {
          const nextNodes = [...currentNodes];
          prevQueue.forEach(task => {
            const target = selectNode(task, nextNodes);
            if (target) {
              const nodeIdx = nextNodes.findIndex(n => n.id === target.id);
              nextNodes[nodeIdx] = {
                ...nextNodes[nodeIdx],
                tasks: [...nextNodes[nodeIdx].tasks, { ...task, status: 'running', startTime: now }],
                cpuUsed: nextNodes[nodeIdx].cpuUsed + task.cpuReq,
                memUsed: nextNodes[nodeIdx].memUsed + task.memReq,
              };
              assignedIds.push(task.id);
              void dispatchTaskToBackend(task, target);
            }
          });
          return nextNodes;
        });
        return prevQueue.filter(t => !assignedIds.includes(t.id));
      });

      // 3. Spawn random
      if (Math.random() < 0.25 * simulationSpeed) {
        enqueueTask();
      }

    }, 1000 / simulationSpeed);

    return () => clearInterval(tick);
  }, [isRunning, simulationSpeed, policy, selectNode]);

  const resetSimulation = () => {
    setNodes(nodes.map(n => ({ ...n, cpuUsed: 0, memUsed: 0, tasks: [] })));
    setGlobalQueue([]);
    setProcessedTasksCount(0);
    setLastAssignedIndex(-1);
    setIsRunning(false);
    setIsAgentControlled(false);
    setPolicyStats({
      'round-robin': { policy: 'round-robin', completedTasks: 0, totalLatency: 0, avgLatency: 0, recentLatency: [] },
      'least-loaded': { policy: 'least-loaded', completedTasks: 0, totalLatency: 0, avgLatency: 0, recentLatency: [] },
      'resource-aware': { policy: 'resource-aware', completedTasks: 0, totalLatency: 0, avgLatency: 0, recentLatency: [] },
      'random': { policy: 'random', completedTasks: 0, totalLatency: 0, avgLatency: 0, recentLatency: [] },
    });
    setAgent({
      isActive: false,
      explorationRate: 1.0,
      lastDecisionTime: Date.now(),
      status: 'exploring',
      confidence: {
        'round-robin': 0.25,
        'least-loaded': 0.25,
        'resource-aware': 0.25,
        'random': 0.25,
      }
    });
  };

  const chartData = nodes.map(n => ({
    name: n.name,
    cpu: Math.round((n.cpuUsed / n.cpuCapacity) * 100),
  }));

  const leaderboard = Object.values(policyStats).sort((a, b) => {
    if (a.completedTasks === 0) return 1;
    if (b.completedTasks === 0) return -1;
    return a.avgLatency - b.avgLatency;
  });

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agentic Resource Simulator</h1>
          <p className="text-neutral-400 mt-1">A manager agent that learns the optimal routing policy to minimize latency.</p>
        </div>

        <div className="flex items-center gap-3 bg-neutral-900 border border-neutral-800 p-2 rounded-xl">
          <button 
            onClick={() => {
              setIsAgentControlled(!isAgentControlled);
              if (!isRunning) setIsRunning(true);
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
            onClick={() => setIsRunning(!isRunning)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              isRunning 
                ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20" 
                : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-500/20"
            }`}
          >
            {isRunning ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            {isRunning ? "Pause" : "Start Sim"}
          </button>
          <button onClick={resetSimulation} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Configuration Sidebar */}
        <div className="lg:col-span-1 space-y-6">
          {/* Agent Brain Card */}
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

                  <div className="space-y-2 pt-2 border-t border-purple-500/20">
                    <p className="text-[10px] text-purple-400 uppercase font-bold mb-2">Policy Confidence</p>
                    {(Object.keys(agent.confidence) as Policy[]).map(p => (
                      <div key={p} className="space-y-1">
                        <div className="flex justify-between text-[10px]">
                          <span className={`capitalize ${policy === p ? 'text-white' : 'text-purple-400/60'}`}>{p.replace('-', ' ')}</span>
                          <span className="text-white font-mono">{(agent.confidence[p] * 100).toFixed(0)}%</span>
                        </div>
                        <div className="h-1 bg-purple-900/30 rounded-full overflow-hidden">
                          <Motion.div 
                            animate={{ 
                              width: `${agent.confidence[p] * 100}%`,
                              backgroundColor: policy === p ? '#a855f7' : '#581c87'
                            }}
                            className="h-full" 
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Motion.div>
            )}
          </AnimatePresence>

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-6">
              <Settings2 className="w-5 h-5 text-indigo-400" />
              <h3 className="font-semibold">Manual Overrides</h3>
            </div>
            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-sm font-medium text-neutral-400">Fixed Policy</label>
                <div className="grid grid-cols-1 gap-2">
                  {(['round-robin', 'least-loaded', 'resource-aware', 'random'] as Policy[]).map((p) => (
                    <button
                      key={p} 
                      disabled={isAgentControlled}
                      onClick={() => setPolicy(p)}
                      className={`text-left px-3 py-2 rounded-lg text-sm capitalize transition-all border ${
                        policy === p && !isAgentControlled ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/30" : "border-transparent text-neutral-500 hover:bg-neutral-800"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {p.replace('-', ' ')}
                    </button>
                  ))}
                </div>
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
                <div className="flex justify-between text-xs text-neutral-500"><span>CPU Intensity</span><span>{manualTask.cpu}</span></div>
                <input type="range" min="10" max="80" step="5" value={manualTask.cpu} onChange={e => setManualTask(prev => ({ ...prev, cpu: parseInt(e.target.value) }))} className="w-full h-1 bg-neutral-800 rounded-lg appearance-none accent-emerald-500" />
              </div>
              <button onClick={() => enqueueTask({ cpuReq: manualTask.cpu, memReq: manualTask.mem, duration: 15 })} className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 rounded-lg text-sm font-medium transition-colors">
                Spike Load
              </button>
            </div>
          </div>
        </div>

        {/* Visualizer Area */}
        <div className="lg:col-span-3 space-y-6">
          <div className="relative bg-neutral-900 border border-neutral-800 rounded-2xl p-8 min-h-[420px] flex flex-col items-center overflow-hidden">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black,transparent)] pointer-events-none" />
            
            <div className="absolute top-6 left-6 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-neutral-800 border border-neutral-700"><History className="w-4 h-4 text-neutral-400" /></div>
              <div><p className="text-[10px] font-bold text-neutral-500 uppercase">Incoming Jobs</p><p className="text-xl font-mono font-bold">{globalQueue.length}</p></div>
            </div>

            <div className="z-10 flex flex-col items-center gap-4 mb-16">
              <Motion.div 
                animate={{ 
                  scale: [1, 1.05, 1],
                  borderColor: isAgentControlled ? 'rgba(168, 85, 247, 0.5)' : 'rgba(99, 102, 241, 0.5)'
                }}
                transition={{ duration: 2, repeat: Infinity }}
                className={`p-5 rounded-2xl border bg-neutral-950 flex flex-col items-center gap-3 relative`}
              >
                {isAgentControlled && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-purple-500 text-[10px] font-bold text-white rounded-full uppercase tracking-widest shadow-lg shadow-purple-500/30">
                    Agent Controlled
                  </div>
                )}
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center shadow-lg transition-colors ${isAgentControlled ? 'bg-purple-600 shadow-purple-500/30' : 'bg-indigo-600 shadow-indigo-500/30'}`}>
                  <Network className="w-8 h-8 text-white" />
                </div>
                <div className="text-center">
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${isAgentControlled ? 'text-purple-400' : 'text-indigo-400'}`}>Current Route Strategy</span>
                  <h4 className="text-lg font-bold capitalize">{policy.replace('-', ' ')}</h4>
                </div>
              </Motion.div>
            </div>

            <div className="absolute top-[160px] inset-x-0 h-[100px] pointer-events-none">
              <AnimatePresence>
                {globalQueue.slice(0, 12).map((task, i) => (
                  <Motion.div 
                    key={task.id} 
                    initial={{ y: -80, opacity: 0, scale: 0 }} 
                    animate={{ y: 0, opacity: 1, scale: 1, x: (i % 3 - 1) * 60 }} 
                    exit={{ y: 200, opacity: 0, scale: 0.5 }} 
                    transition={{ type: "spring", stiffness: 100 }} 
                    className="absolute left-1/2 -ml-4"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shadow-sm ${isAgentControlled ? 'bg-purple-900/50 border-purple-500/30' : 'bg-neutral-800 border-neutral-700'}`}>
                      <Zap className={`w-4 h-4 ${isAgentControlled ? 'text-purple-400' : 'text-indigo-400'}`} />
                    </div>
                  </Motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full z-10 mt-auto">
              {nodes.map((node) => (
                <div key={node.id} className="bg-neutral-900/80 backdrop-blur-sm border border-neutral-800 rounded-xl p-4 transition-all hover:border-neutral-700">
                  <div className="flex justify-between items-start mb-4">
                    <div><h4 className="text-[10px] font-bold text-neutral-500 uppercase tracking-tight">{node.name}</h4><p className="text-sm font-mono font-bold text-neutral-300">{node.tasks.length} Active</p></div>
                    <div className="p-1.5 rounded-lg bg-neutral-800/50 border border-neutral-700/50"><Cpu className="w-3 h-3 text-neutral-500" /></div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] mb-1"><span className="text-neutral-500">Saturation</span><span className="text-neutral-300 font-mono">{Math.round((node.cpuUsed / node.cpuCapacity) * 100)}%</span></div>
                    <div className="h-1.5 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800/50">
                      <Motion.div 
                        animate={{ 
                          width: `${Math.min(100, (node.cpuUsed / node.cpuCapacity) * 100)}%`,
                          backgroundColor: node.cpuUsed > node.cpuCapacity ? '#f43f5e' : (isAgentControlled ? '#a855f7' : '#6366f1')
                        }} 
                        className="h-full" 
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2"><Trophy className="w-5 h-5 text-amber-500" /><h3 className="font-semibold">Policy Performance Log</h3></div>
                <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest bg-neutral-800 px-3 py-1 rounded-full border border-neutral-700">Reinforcement Learning Enabled</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-neutral-800 text-neutral-500 text-[10px] uppercase tracking-wider">
                      <th className="pb-3 font-medium">Rank</th><th className="pb-3 font-medium">Policy</th><th className="pb-3 font-medium text-right">Tasks</th><th className="pb-3 font-medium text-right">Avg Latency</th><th className="pb-3 font-medium text-right">Optimization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/50">
                    {leaderboard.map((stat, index) => (
                      <tr key={stat.policy} className={`group ${policy === stat.policy ? 'bg-indigo-500/5' : ''}`}>
                        <td className="py-3"><div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${index === 0 ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' : 'bg-neutral-800 text-neutral-500'}`}>{index + 1}</div></td>
                        <td className="py-3"><span className={`text-sm font-medium capitalize ${policy === stat.policy ? 'text-indigo-400 font-bold' : 'text-neutral-400'}`}>{stat.policy.replace('-', ' ')}</span></td>
                        <td className="py-3 text-right text-xs font-mono text-neutral-500">{stat.completedTasks}</td>
                        <td className="py-3 text-right text-xs font-mono"><span className={stat.avgLatency < 5 ? 'text-emerald-400' : stat.avgLatency < 10 ? 'text-neutral-300' : 'text-rose-400'}>{stat.avgLatency > 0 ? `${stat.avgLatency.toFixed(2)}ms` : '---'}</span></td>
                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-1">
                            {stat.recentLatency.slice(-5).map((l, i) => (
                              <div key={i} className={`w-1 h-3 rounded-full ${l < (stat.avgLatency || 10) ? 'bg-emerald-500/40' : 'bg-rose-500/40'}`} />
                            ))}
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
                        <XAxis dataKey="name" hide /><YAxis hide domain={[0, 100]} />
                        <Bar dataKey="cpu" radius={[2, 2, 0, 0]}>
                          {chartData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.cpu > 80 ? '#f43f5e' : (isAgentControlled ? '#a855f7' : '#6366f1')} />))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="space-y-3 mt-auto">
                  <div className="flex justify-between text-xs"><span className="text-neutral-500">System Throughput</span><span className="text-emerald-500 font-mono font-bold">{(processedTasksCount / (Date.now() / 100000) || 1).toFixed(1)} j/s</span></div>
                  <div className="flex justify-between text-xs"><span className="text-neutral-500">Agent Confidence</span><span className="text-purple-400 font-mono font-bold">{isAgentControlled ? (Math.max(...Object.values(agent.confidence)) * 100).toFixed(0) : 0}%</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
