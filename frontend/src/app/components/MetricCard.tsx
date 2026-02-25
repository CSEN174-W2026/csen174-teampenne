import { ArrowUpRight, ArrowDownRight, MoreHorizontal } from "lucide-react";
import { motion } from "motion/react";

interface MetricCardProps {
  label: string;
  value: string;
  trend?: number;
  icon: React.ElementType;
  color: "indigo" | "emerald" | "amber" | "rose";
}

export function MetricCard({ label, value, trend, icon: Icon, color }: MetricCardProps) {
  const colors = {
    indigo: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  };

  const iconColors = {
    indigo: "bg-indigo-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
  };

  return (
    <motion.div 
      whileHover={{ y: -2 }}
      className={`p-6 rounded-2xl border bg-neutral-900/40 backdrop-blur-sm ${colors[color]} flex flex-col gap-4 relative overflow-hidden group`}
    >
      <div className="flex justify-between items-start relative z-10">
        <div className={`p-2 rounded-lg ${iconColors[color]} text-white shadow-lg`}>
          <Icon className="w-5 h-5" />
        </div>
        <button className="text-neutral-500 hover:text-white transition-colors">
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </div>

      <div className="relative z-10">
        <p className="text-neutral-400 text-sm font-medium">{label}</p>
        <div className="flex items-end gap-2 mt-1">
          <h3 className="text-2xl font-bold tracking-tight text-white">{value}</h3>
          {trend !== undefined && (
            <span className={`text-xs font-semibold mb-1 flex items-center ${trend >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {trend >= 0 ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
              {Math.abs(trend)}%
            </span>
          )}
        </div>
      </div>
      
      {/* Decorative gradient */}
      <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full blur-3xl opacity-20 ${iconColors[color]}`} />
    </motion.div>
  );
}
