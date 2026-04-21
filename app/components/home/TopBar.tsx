"use client";

import { ArrowDown, ArrowUp, Minus, Phone } from "lucide-react";

interface Props {
  firstName: string;
  stats: {
    calls_total: number;
    answer_rate: number;
    avg_score: number;
    calls_total_prev: number;
    answer_rate_prev: number;
    avg_score_prev: number;
  };
  onMakeCall: () => void;
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function delta(current: number, prev: number): "up" | "flat" | "down" {
  if (current > prev) return "up";
  if (current < prev) return "down";
  return "flat";
}

export default function TopBar({ firstName, stats, onMakeCall }: Props) {
  const greeting = greetingFor(new Date().getHours());
  const zero = stats.calls_total === 0;

  return (
    <div className="w-full bg-cream-2 border-b-2 border-navy">
      <div className="flex flex-wrap items-center gap-4 px-6 py-4 min-h-[72px]">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-[1.5rem] leading-tight font-semibold text-navy font-display tracking-tight">
            {greeting}, {firstName} 🌶️
          </h1>
          {zero ? (
            <p className="text-[12px] text-slate font-medium mt-0.5">
              Ready to make your first call
            </p>
          ) : (
            <p className="text-[12px] text-slate font-medium mt-0.5 tabular-nums">
              <DeltaChip kind={delta(stats.calls_total, stats.calls_total_prev)} />
              {stats.calls_total} calls · {stats.answer_rate}% answer ·{" "}
              {stats.avg_score > 0 ? `${stats.avg_score.toFixed(1)}/10` : "—"} avg
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={onMakeCall}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-banana border-[2.5px] border-navy text-navy text-sm font-bold shadow-pop-md shadow-pop-hover"
          >
            <Phone size={14} />
            Make a call
          </button>
        </div>
      </div>
    </div>
  );
}

function DeltaChip({ kind }: { kind: "up" | "flat" | "down" }) {
  if (kind === "flat") return <Minus size={11} className="inline mr-1 text-slate" />;
  const Icon = kind === "up" ? ArrowUp : ArrowDown;
  const color = kind === "up" ? "text-leaf-dark" : "text-coral-deep";
  return <Icon size={11} className={`inline mr-1 ${color}`} />;
}
