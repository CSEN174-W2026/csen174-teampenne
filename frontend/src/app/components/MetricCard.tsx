import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowDownRight, MoreHorizontal, Info } from "lucide-react";
import { motion } from "motion/react";

interface MetricCardProps {
  label: string;
  value: string;
  trend?: number;
  icon: React.ElementType;
  color: "indigo" | "emerald" | "amber" | "rose";
  definition?: string;
}

type PopPos = { top: number; left: number };

export function MetricCard({ label, value, trend, icon: Icon, color, definition }: MetricCardProps) {
  const colors = {
    indigo: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  } as const;

  const iconColors = {
    indigo: "bg-indigo-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
  } as const;

  const cardRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopPos>({ top: 0, left: 0 });

  const POP_W = 300; // popup width in px
  const GAP = 10; // gap between card and popup

  function computePosition() {
    const card = cardRef.current;
    if (!card) return;

    const r = card.getBoundingClientRect();

    // Prefer right side
    let left = r.right + GAP;
    let top = r.top + 8;

    // If right side overflows, flip to left side
    if (left + POP_W > window.innerWidth - 8) {
      left = r.left - POP_W - GAP;
    }

    // Clamp vertically so it stays on screen
    const maxTop = window.innerHeight - 16;
    if (top > maxTop) top = maxTop;

    setPos({ top, left });
  }

  // Recompute when opening + on resize/scroll
  useLayoutEffect(() => {
    if (!open) return;
    computePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onResize = () => computePosition();
    // capture scroll anywhere
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;

    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (cardRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <motion.div
        ref={cardRef}
        whileHover={{ y: -2 }}
        className={`p-6 rounded-2xl border bg-neutral-900/40 backdrop-blur-sm ${colors[color]} flex flex-col gap-4 relative overflow-hidden group`}
      >
        <div className="flex justify-between items-start relative z-10">
          <div className={`p-2 rounded-lg ${iconColors[color]} text-white shadow-lg`}>
            <Icon className="w-5 h-5" />
          </div>

          <button
            type="button"
            onClick={() => {
              if (!definition) return;
              setOpen((v) => !v);
            }}
            className="text-neutral-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-neutral-800/50"
            aria-label={`Open definition for ${label}`}
            aria-expanded={open}
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>

        <div className="relative z-10">
          <p className="text-neutral-400 text-sm font-medium">{label}</p>
          <div className="flex items-end gap-2 mt-1">
            <h3 className="text-2xl font-bold tracking-tight text-white">{value}</h3>
            {trend !== undefined && (
              <span
                className={`text-xs font-semibold mb-1 flex items-center ${
                  trend >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {trend >= 0 ? (
                  <ArrowUpRight className="w-3 h-3 mr-0.5" />
                ) : (
                  <ArrowDownRight className="w-3 h-3 mr-0.5" />
                )}
                {Math.abs(trend)}%
              </span>
            )}
          </div>
        </div>

        {/* Decorative gradient */}
        <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-3xl opacity-20 ${iconColors[color]}`} />
      </motion.div>

      {open && definition ? (
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: POP_W }}
          className="z-[9999] rounded-2xl border border-neutral-800 bg-neutral-950/95 backdrop-blur p-3 shadow-2xl"
        >
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-neutral-400 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-neutral-200 mb-1">{label}</p>
              <p className="text-xs text-neutral-400 leading-relaxed">{definition}</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}