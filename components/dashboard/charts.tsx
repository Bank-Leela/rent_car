"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const COLORS = {
  primary: "#6366f1",
  approved: "#10b981",
  denied: "#ef4444",
  cancelled: "#f59e0b",
  neutral: "#94a3b8",
};

const FUNNEL_COLOR_BY_LABEL: Record<string, string> = {
  Approved: COLORS.approved,
  อนุมัติ: COLORS.approved,
  Denied: COLORS.denied,
  ไม่อนุมัติ: COLORS.denied,
  Cancelled: COLORS.cancelled,
  ยกเลิก: COLORS.cancelled,
};

function tooltipStyle() {
  return {
    contentStyle: {
      borderRadius: 8,
      border: "1px solid var(--border)",
      background: "var(--popover)",
      color: "var(--popover-foreground)",
      fontSize: 12,
      boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
    },
    labelStyle: { color: "var(--muted-foreground)", fontWeight: 500 },
    itemStyle: { color: "var(--popover-foreground)" },
  };
}

export function VolumeBarChart({ data }: { data: Array<{ month: string; count: number }> }) {
  return (
    <div className="h-64 text-muted-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            strokeOpacity={0.2}
            vertical={false}
          />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 12, fill: "currentColor" }}
            axisLine={{ stroke: "currentColor", strokeOpacity: 0.3 }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: "currentColor" }}
            axisLine={false}
            tickLine={false}
            width={32}
          />
          <Tooltip {...tooltipStyle()} cursor={{ fill: "currentColor", fillOpacity: 0.06 }} />
          <Bar
            dataKey="count"
            fill={COLORS.primary}
            radius={[6, 6, 0, 0]}
            maxBarSize={56}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FunnelPieChart({
  data,
}: {
  data: Array<{ label: string; value: number }>;
}) {
  const filtered = data.filter((d) => d.value > 0);
  if (filtered.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No data in range.</p>;
  }
  const total = filtered.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className="h-64 text-muted-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={filtered}
            dataKey="value"
            nameKey="label"
            outerRadius={88}
            innerRadius={48}
            paddingAngle={2}
            label={({ value }) => `${Math.round((value / total) * 100)}%`}
            labelLine={false}
          >
            {filtered.map((d, i) => (
              <Cell
                key={i}
                fill={FUNNEL_COLOR_BY_LABEL[d.label] ?? COLORS.neutral}
                stroke="var(--card)"
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            wrapperStyle={{ fontSize: 12, paddingTop: 8, color: "currentColor" }}
          />
          <Tooltip
            {...tooltipStyle()}
            formatter={(value, name) => {
              const n = Number(value);
              return [`${n} (${Math.round((n / total) * 100)}%)`, String(name)];
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
