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
import PepperMascot from "@/components/pepper/PepperMascot";

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
      { name: "Connected", value: counts.completed, color: "#2FB67C" },
      { name: "No Answer", value: counts["no-answer"], color: "#FFCE3A" },
      { name: "Voicemail", value: counts.voicemail, color: "#FF7A5C" },
      { name: "Missed", value: counts.missed, color: "#6B6E85" },
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
    a.download = `pepper-calls-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center text-center py-16 px-6">
        <PepperMascot size="md" state="coach" />
        <h3 className="mt-4 text-xl font-semibold text-navy font-display">
          No numbers to crunch yet
        </h3>
        <p className="mt-1 text-[14px] text-slate max-w-xs font-accent text-lg leading-snug">
          Make a few calls and Pepper will bring receipts.
        </p>
      </div>
    );
  }

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
      <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
        <h3 className="text-base font-semibold text-navy mb-4 font-display">
          Calls Per Day (Last 30 Days)
        </h3>
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData}>
              <XAxis
                dataKey="date"
                tick={{ fill: "#6B6E85", fontSize: 10 }}
                axisLine={{ stroke: "#1B2340" }}
                tickLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fill: "#6B6E85", fontSize: 10 }}
                axisLine={{ stroke: "#1B2340" }}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "#FFFEFA",
                  border: "2px solid #1B2340",
                  borderRadius: "10px",
                  fontSize: "12px",
                  color: "#1B2340",
                  boxShadow: "4px 4px 0 #1B2340",
                }}
                cursor={{ fill: "rgba(255, 206, 58, 0.25)" }}
              />
              <Bar dataKey="count" fill="#FFCE3A" stroke="#1B2340" strokeWidth={1.5} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Breakdown + Export */}
      <div className="flex gap-4 flex-wrap">
        {breakdownData.length > 0 && (
          <div className="flex-1 min-w-[280px] bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
            <h3 className="text-base font-semibold text-navy mb-4 font-display">
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
            className="flex items-center gap-2 px-4 py-3 rounded-full bg-paper border-[2.5px] border-navy text-navy text-sm font-semibold transition-all duration-150 min-h-[48px] shadow-pop-sm shadow-pop-hover"
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
    <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] text-slate uppercase tracking-[0.5px] font-bold">
          {label}
        </span>
        <span className="w-8 h-8 rounded-full bg-banana border-2 border-navy flex items-center justify-center text-navy">
          {icon}
        </span>
      </div>
      <p className="text-[36px] font-bold text-navy tabular-nums leading-none font-display">
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
