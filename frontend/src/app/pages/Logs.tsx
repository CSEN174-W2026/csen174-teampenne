import { useState, useEffect } from "react";
import { Terminal, Download, Trash2, Search, Filter } from "lucide-react";

interface LogEntry {
  id: number;
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  service: string;
  message: string;
}

export function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 1, timestamp: "2026-02-20 14:30:05", level: "INFO", service: "AUTH-API", message: "User session started for UID-9928" },
    { id: 2, timestamp: "2026-02-20 14:30:12", level: "WARN", service: "PAY-GATE", message: "Latency spike detected on upstream provider" },
    { id: 3, timestamp: "2026-02-20 14:30:15", level: "ERROR", service: "DB-SYNC", message: "Failed to replicate chunk #1284: Connection timeout" },
    { id: 4, timestamp: "2026-02-20 14:30:22", level: "INFO", service: "AUTH-API", message: "New deployment identified: v2.4.1" },
    { id: 5, timestamp: "2026-02-20 14:30:30", level: "DEBUG", service: "SEARCH", message: "Re-indexing triggered by schedule" },
  ]);

  const [isAutoScroll, setIsAutoScroll] = useState(true);

  // Simulate incoming logs
  useEffect(() => {
    const services = ["AUTH-API", "PAY-GATE", "DB-SYNC", "SEARCH", "WEB-TIER"];
    const levels: LogEntry["level"][] = ["INFO", "WARN", "ERROR", "DEBUG"];
    const messages = [
      "Health check passed",
      "Cache hit ratio: 94%",
      "Processing queue: 142 items",
      "Memory garbage collection completed",
      "Incoming request from edge node US-West",
      "Unexpected token in configuration",
      "Connection pool saturated"
    ];

    const interval = setInterval(() => {
      const newLog: LogEntry = {
        id: Date.now(),
        timestamp: new Date().toISOString().replace('T', ' ').split('.')[0],
        level: levels[Math.floor(Math.random() * levels.length)],
        service: services[Math.floor(Math.random() * services.length)],
        message: messages[Math.floor(Math.random() * messages.length)],
      };
      setLogs(prev => [...prev.slice(-49), newLog]);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-[calc(100vh-10rem)] flex flex-col space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            System Logs
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[10px] font-bold tracking-widest uppercase">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </div>
          </h1>
          <p className="text-neutral-400 mt-1">Aggregate stream of system events across all nodes.</p>
        </div>
        <div className="flex gap-2">
          <button className="p-2 border border-neutral-800 rounded-lg hover:bg-neutral-900 text-neutral-400 transition-colors">
            <Download className="w-5 h-5" />
          </button>
          <button className="p-2 border border-neutral-800 rounded-lg hover:bg-neutral-900 text-neutral-400 transition-colors">
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl flex flex-col overflow-hidden flex-1">
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input 
              type="text" 
              placeholder="Filter logs..." 
              className="w-full bg-neutral-800/50 border border-neutral-700 rounded-lg py-1.5 pl-10 pr-4 text-sm focus:outline-none focus:border-indigo-500 transition-all"
            />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer">
              <input 
                type="checkbox" 
                checked={isAutoScroll} 
                onChange={() => setIsAutoScroll(!isAutoScroll)}
                className="rounded border-neutral-700 bg-neutral-800 text-indigo-500 focus:ring-indigo-500"
              />
              Auto-scroll
            </label>
            <button className="flex items-center gap-2 px-3 py-1.5 border border-neutral-700 rounded text-xs font-bold text-neutral-300 hover:bg-neutral-800 transition-colors">
              <Filter className="w-3.5 h-3.5" />
              Levels
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-1 selection:bg-indigo-500/30">
          {logs.map((log) => (
            <div key={log.id} className="group hover:bg-neutral-800/50 rounded px-2 py-1 flex gap-4 transition-colors">
              <span className="text-neutral-600 shrink-0 w-[160px]">{log.timestamp}</span>
              <span className={`shrink-0 w-16 font-bold ${
                log.level === 'ERROR' ? 'text-rose-500' :
                log.level === 'WARN' ? 'text-amber-500' :
                log.level === 'DEBUG' ? 'text-indigo-400' : 'text-emerald-500'
              }`}>
                [{log.level}]
              </span>
              <span className="text-neutral-500 shrink-0 w-24">[{log.service}]</span>
              <span className="text-neutral-300 flex-1">{log.message}</span>
            </div>
          ))}
          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}
