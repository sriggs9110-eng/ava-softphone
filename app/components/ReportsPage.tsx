"use client";

import { useMemo } from "react";
import {
  Phone,
  Clock,
  TrendingUp,
  Headphones,
  Download,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { CallHistoryEntry } from "@/app/lib/types";

interface ReportsPageProps {
  entries: CallHistoryEntry[];
}

export default function ReportsPage({ entries }: ReportsPageProps) {
  const stats = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();
    const todayCalls = entries.filter((e) => e.timestamp >= todayStart);
    const totalCalls = todayCalls.length;
    const connectedCalls = todayCalls.filter(
      (e) => e.status === "completed"
    );
    const avgDuration =
      connectedCalls.length > 0
        ? Math.round(
            connectedCalls.reduce((acc, e) => acc + e.duration, 0) /
              connectedCalls.length
          )
        : 0;
    const answerRate =
      totalCalls > 0
        ? Math.round((connectedCalls.length / totalCalls) * 100)
        : 0;
    const totalTalkTime = entries.reduce((acc, e) => acc + e.duration, 0);

    return { totalCalls, avgDuration, answerRate, totalTalkTime };
  }, [entries]);

  const dailyData = useMemo(() => {
    const days: Record<string, number> = {};
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      days[key] = 0;
    }
    entries.forEach((e) => {
      const d = new Date(e.timestamp);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      if (key in days) days[key]++;
    });
    return Object.entries(days).map(([date, count]) => ({ date, count }));
  }, [entries]);

  const breakdownData = useMemo(() => {
    const counts = { completed: 0, "no-answer": 0, voicemail: 0, missed: 0 };
    entries.forEach((e) => {
      if (e.status in counts) {
        counts[e.status as keyof typeof counts]++;
      }
    });
    return [
      { name: "Connected", value: counts.completed, color: "#22c55e" },
      { name: "No Answer", value: counts["no-answer"], color: "#f59e0b" },
      { name: "Voicemail", value: counts.voicemail, color: "#ef4444" },
      { name: "Missed", value: counts.missed, color: "#737373" },
    ].filter((d) => d.value > 0);
  }, [entries]);

  const handleExport = () => {
    const csv = [
      "Number,Direction,Duration,Status,Timestamp",
      ...entries.map(
        (e) =>
          `${e.number},${e.direction},${e.duration},${e.status},${new Date(e.timestamp).toISOString()}`
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ava-calls-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full animate-fade-in space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Phone size={18} />}
          label="Total Calls (Today)"
          value={stats.totalCalls.toString()}
        />
        <StatCard
          icon={<Clock size={18} />}
          label="Avg Duration"
          value={formatDuration(stats.avgDuration)}
        />
        <StatCard
          icon={<TrendingUp size={18} />}
          label="Answer Rate"
          value={`${stats.answerRate}%`}
        />
        <StatCard
          icon={<Headphones size={18} />}
          label="Total Talk Time"
          value={formatDuration(stats.totalTalkTime)}
        />
      </div>

      {/* Daily Chart */}
      <div className="bg-bg-surface border border-border-subtle rounded-xl p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-4">
          Calls Per Day (Last 30 Days)
        </h3>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData}>
              <XAxis
                dataKey="date"
                tick={{ fill: "#737373", fontSize: 10 }}
                axisLine={{ stroke: "#333333" }}
                tickLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fill: "#737373", fontSize: 10 }}
                axisLine={{ stroke: "#333333" }}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#242424",
                  border: "1px solid #333333",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "#f5f5f5",
                }}
                cursor={{ fill: "rgba(232,80,42,0.1)" }}
              />
              <Bar dataKey="count" fill="#e8502a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Breakdown + Export */}
      <div className="flex gap-4 flex-wrap">
        {breakdownData.length > 0 && (
          <div className="flex-1 min-w-[280px] bg-bg-surface border border-border-subtle rounded-xl p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-4">
              Call Breakdown
            </h3>
            <div className="flex items-center gap-6">
              <div className="w-[140px] h-[140px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={breakdownData}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={65}
                      paddingAngle={2}
                    >
                      {breakdownData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">
                {breakdownData.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: d.color }}
                    />
                    <span className="text-[12px] text-text-secondary">
                      {d.name}
                    </span>
                    <span className="text-[12px] font-semibold text-text-primary ml-auto">
                      {d.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-end">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-3 rounded-lg bg-bg-elevated border border-border-subtle hover:bg-bg-hover text-text-secondary text-sm font-semibold transition-all duration-150 min-h-[44px] hover:-translate-y-px"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-bg-surface border border-border-subtle rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] text-text-tertiary uppercase tracking-[0.5px] font-medium">
          {label}
        </span>
        <span className="text-text-tertiary">{icon}</span>
      </div>
      <p className="text-[36px] font-bold text-text-primary tabular-nums leading-none">
        {value}
      </p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}:${s.toString().padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}
