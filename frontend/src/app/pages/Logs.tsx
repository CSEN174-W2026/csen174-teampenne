import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Trash2, Search, Filter } from "lucide-react";
import {
  clearSystemLogs,
  getSystemLogs,
  type SystemLogEvent,
} from "../../lib/api"; // <-- adjust path if needed

type Level = "ALL" | "info" | "warn" | "error";

function fmtTimestamp(ms: number) {
  const d = new Date(ms);
  // Example: 2026-03-01 19:05:22
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function normalizeLevel(lvl: string): "info" | "warn" | "error" {
  const x = (lvl || "").toLowerCase();
  if (x === "error") return "error";
  if (x === "warn" || x === "warning") return "warn";
  return "info";
}

export function Logs() {
  const [events, setEvents] = useState<SystemLogEvent[]>([]);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<Level>("ALL");
  const [showLevels, setShowLevels] = useState(false);
  const [paused, setPaused] = useState(false);

  const sinceRef = useRef<number>(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // --- polling real logs ---
  useEffect(() => {
    let alive = true;

    const tick = async () => {
      if (!alive || paused) return;
      try {
        const res = await getSystemLogs(sinceRef.current, 500);
        if (!alive) return;

        const incoming = res.events ?? [];
        if (incoming.length > 0) {
          // move cursor forward
          sinceRef.current = Math.max(
            sinceRef.current,
            ...incoming.map((e) => e.ts_ms)
          );

          setEvents((prev) => {
            const merged = [...prev, ...incoming];
            // keep last 1500 in UI
            const max = 1500;
            return merged.length > max ? merged.slice(merged.length - max) : merged;
          });
        }
      } catch {
        // backend might restart; ignore
      }
    };

    // immediate fetch
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [paused]);

  // --- auto scroll to bottom when new events arrive ---
  useEffect(() => {
    if (!isAutoScroll) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events, isAutoScroll]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => {
        const lvl = normalizeLevel(String(e.level));
        if (level === "ALL") return true;
        return lvl === level;
      })
      .filter((e) => {
        if (!q) return true;
        const hay = (
          (e.topic ?? "") +
          " " +
          (e.message ?? "") +
          " " +
          JSON.stringify(e.data ?? {})
        ).toLowerCase();
        return hay.includes(q);
      });
  }, [events, query, level]);

  const onDownload = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `system-logs-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onClear = async () => {
    await clearSystemLogs();
    sinceRef.current = 0;
    setEvents([]);
  };

  const levelBadgeClass = (lvl: string) => {
    const n = normalizeLevel(lvl);
    if (n === "error") return "text-rose-500";
    if (n === "warn") return "text-amber-500";
    return "text-emerald-500";
  };

  const levelLabel = (lvl: string) => {
    const n = normalizeLevel(lvl);
    return n.toUpperCase();
  };

  const topicToService = (topic?: string) => {
    // your old UI had a "service" column
    // We'll map topic to that spot
    const t = (topic ?? "system").toUpperCase();
    // Keep it short-ish in the UI
    return t.length > 10 ? t.slice(0, 10) : t;
  };

  return (
    <div className="h-[calc(100vh-10rem)] flex flex-col space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            System Logs
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[10px] font-bold tracking-widest uppercase">
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  paused ? "bg-neutral-500" : "bg-emerald-500 animate-pulse"
                }`}
              />
              {paused ? "Paused" : "Live"}
            </div>
          </h1>
          <p className="text-neutral-400 mt-1">
            Real stream of manager + simulation + node membership events.
          </p>
        </div>

        <div className="flex gap-2 items-center">
          <button
            onClick={() => setPaused((p) => !p)}
            className="px-3 py-2 border border-neutral-800 rounded-lg hover:bg-neutral-900 text-neutral-300 transition-colors text-sm font-semibold"
            title="Pause polling"
          >
            {paused ? "Resume" : "Pause"}
          </button>

          <button
            onClick={onDownload}
            className="p-2 border border-neutral-800 rounded-lg hover:bg-neutral-900 text-neutral-400 transition-colors"
            title="Download filtered logs as JSON"
          >
            <Download className="w-5 h-5" />
          </button>

          <button
            onClick={onClear}
            className="p-2 border border-neutral-800 rounded-lg hover:bg-neutral-900 text-neutral-400 transition-colors"
            title="Clear backend logs"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="bg-neutral-900/40 border border-neutral-800 rounded-2xl flex flex-col overflow-hidden flex-1">
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="text"
              placeholder="Filter logs (topic/message/data)..."
              className="w-full bg-neutral-800/50 border border-neutral-700 rounded-lg py-1.5 pl-10 pr-4 text-sm focus:outline-none focus:border-indigo-500 transition-all text-neutral-200"
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

            <div className="relative">
              <button
                onClick={() => setShowLevels((s) => !s)}
                className="flex items-center gap-2 px-3 py-1.5 border border-neutral-700 rounded text-xs font-bold text-neutral-300 hover:bg-neutral-800 transition-colors"
              >
                <Filter className="w-3.5 h-3.5" />
                Levels: {level}
              </button>

              {showLevels && (
                <div className="absolute right-0 mt-2 w-44 rounded-xl border border-neutral-800 bg-neutral-950 shadow-lg overflow-hidden z-20">
                  {(["ALL", "info", "warn", "error"] as Level[]).map((l) => (
                    <button
                      key={l}
                      onClick={() => {
                        setLevel(l);
                        setShowLevels(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-900 transition-colors ${
                        level === l ? "text-white" : "text-neutral-300"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="text-xs text-neutral-500">
              Showing <span className="text-neutral-200">{filtered.length}</span>{" "}
              / {events.length}
            </div>
          </div>
        </div>

        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-1 selection:bg-indigo-500/30"
        >
          {filtered.map((ev, idx) => (
            <div
              key={`${ev.ts_ms}-${idx}`}
              className="group hover:bg-neutral-800/50 rounded px-2 py-1 flex gap-4 transition-colors"
            >
              <span className="text-neutral-600 shrink-0 w-[180px]">
                {fmtTimestamp(ev.ts_ms)}
              </span>

              <span
                className={`shrink-0 w-16 font-bold ${levelBadgeClass(
                  String(ev.level)
                )}`}
              >
                [{levelLabel(String(ev.level))}]
              </span>

              <span className="text-neutral-500 shrink-0 w-28">
                [{topicToService(ev.topic)}]
              </span>

              <span className="text-neutral-300 flex-1">
                {ev.message}
                {ev.data ? (
                  <span className="text-neutral-500">
                    {" "}
                    {JSON.stringify(ev.data)}
                  </span>
                ) : null}
              </span>
            </div>
          ))}

          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}