import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";

export type ResourcePoint = {
  // what the chart reads
  time: string;       // e.g. "14:02"
  cpu: number;        // 0..100
  mem: number;        // 0..100
  network?: number;   // optional (only used for bar mode)
};

function formatTimeLabel(ms: number) {
  // keeps it simple: "HH:MM"
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function ResourceChart({
  type = "area",
  data,
}: {
  type?: "area" | "bar";
  data: ResourcePoint[];
}) {
  // Safety: if parent hasn't loaded anything yet, show an empty chart with axes.
  const safeData = data?.length ? data : [{ time: formatTimeLabel(Date.now()), cpu: 0, mem: 0, network: 0 }];

  if (type === "bar") {
    return (
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={safeData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#262626" />
            <XAxis
              dataKey="time"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#737373", fontSize: 12 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#737373", fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#171717",
                border: "1px solid #404040",
                borderRadius: "8px",
              }}
              itemStyle={{ color: "#fff" }}
            />
            <Bar dataKey="network" radius={[4, 4, 0, 0]}>
              {safeData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={(entry.network ?? 0) > 400 ? "#f43f5e" : "#6366f1"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={safeData}>
          <defs>
            <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#262626" />
          <XAxis
            dataKey="time"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#737373", fontSize: 12 }}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#737373", fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#171717",
              border: "1px solid #404040",
              borderRadius: "8px",
            }}
            itemStyle={{ color: "#fff" }}
          />

          <Area
            type="monotone"
            dataKey="cpu"
            stroke="#6366f1"
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#colorCpu)"
          />
          <Area
            type="monotone"
            dataKey="mem"
            stroke="#10b981"
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#colorMem)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}