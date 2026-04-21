"use client";

import { ArrowDown, ArrowUp, ArrowRight } from "lucide-react";
import type { DashboardPayload } from "@/lib/home/dashboard";

interface Props {
  stats: DashboardPayload["today_stats"];
}

/**
 * Five scannable metric cards below the top bar. Alternating backgrounds
 * so the row pops against the cream body. Trend arrows compare against
 * the same metric from yesterday; if yesterday had zero calls we show a
 * neutral → arrow instead of a misleading % change.
 */
export default function DayStats({ stats }: Props) {
  const anyYesterday = stats.calls_total_prev > 0;

  return (
    <div className="w-full px-4 lg:px-6 pt-4">
      <div className="grid gap-3 grid-cols-1 min-[700px]:grid-cols-3 min-[1100px]:grid-cols-5">
        <StatCard
          label="Calls"
          value={stats.calls_total.toLocaleString()}
          delta={
            anyYesterday
              ? pctDelta(stats.calls_total, stats.calls_total_prev)
              : null
          }
          bg="bg-banana"
        />
        <StatCard
          label="Talk Time"
          value={formatTalk(stats.talk_seconds_total)}
          delta={
            anyYesterday
              ? pctDelta(
                  stats.talk_seconds_total,
                  stats.talk_seconds_total_prev
                )
              : null
          }
          bg="bg-paper"
        />
        <StatCard
          label="Answer Rate"
          value={
            stats.outbound_total === 0 ? "—" : `${Math.round(stats.answer_rate)}%`
          }
          delta={
            anyYesterday && stats.outbound_total > 0
              ? ppDelta(stats.answer_rate, stats.answer_rate_prev)
              : null
          }
          deltaUnit="pp"
          bg="bg-cream-2"
        />
        <StatCard
          label="Avg Score"
          value={
            stats.avg_score > 0 ? stats.avg_score.toFixed(1) : "—"
          }
          delta={
            anyYesterday && stats.avg_score > 0 && stats.avg_score_prev > 0
              ? ptsDelta(stats.avg_score, stats.avg_score_prev)
              : null
          }
          deltaUnit="pts"
          bg="bg-[#D7F0E1]"
        />
        <StatCard
          label="Quality Calls"
          value={stats.quality_calls_count.toLocaleString()}
          delta={
            anyYesterday
              ? countDelta(
                  stats.quality_calls_count,
                  stats.quality_calls_count_prev
                )
              : null
          }
          deltaUnit="vs yesterday"
          bg="bg-cream-2"
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  delta,
  deltaUnit = "%",
  bg,
}: {
  label: string;
  value: string;
  delta: Delta | null;
  deltaUnit?: "%" | "pp" | "pts" | "vs yesterday";
  bg: string;
}) {
  return (
    <div
      className={`${bg} border-[2.5px] border-navy rounded-[14px] px-4 py-3 shadow-pop-md min-h-[100px] flex flex-col justify-between`}
    >
      <p className="text-[11px] font-semibold text-slate uppercase tracking-[0.08em] font-display">
        {label}
      </p>
      <p className="text-[2.25rem] leading-none font-bold text-navy tabular-nums font-display mt-1">
        {value}
      </p>
      <DeltaLine delta={delta} unit={deltaUnit} />
    </div>
  );
}

type Delta = { kind: "up" | "down" | "flat"; pct: number };

function DeltaLine({
  delta,
  unit,
}: {
  delta: Delta | null;
  unit: "%" | "pp" | "pts" | "vs yesterday";
}) {
  if (!delta) {
    return (
      <p className="text-[12px] text-slate font-medium mt-1 inline-flex items-center gap-1">
        <ArrowRight size={11} />
        no comparison
      </p>
    );
  }
  const Icon =
    delta.kind === "up" ? ArrowUp : delta.kind === "down" ? ArrowDown : ArrowRight;
  const color =
    delta.kind === "up"
      ? "text-leaf-dark"
      : delta.kind === "down"
      ? "text-coral-deep"
      : "text-slate";
  const magnitude = Math.abs(delta.pct);
  // "pp" and "pts" render with their suffix inline. "vs yesterday" is the
  // plain count-delta case so we don't glue on "%" to an integer.
  const label =
    unit === "vs yesterday"
      ? `${delta.kind === "up" ? "+" : delta.kind === "down" ? "-" : ""}${magnitude} vs yesterday`
      : `${magnitude}${unit} vs yesterday`;

  return (
    <p
      className={`text-[12px] font-semibold mt-1 inline-flex items-center gap-1 ${color}`}
    >
      <Icon size={11} strokeWidth={2.5} />
      {label}
    </p>
  );
}

function pctDelta(current: number, prev: number): Delta {
  if (prev === 0) return { kind: current > 0 ? "up" : "flat", pct: 0 };
  const pct = Math.round(((current - prev) / prev) * 100);
  if (pct === 0) return { kind: "flat", pct: 0 };
  return { kind: pct > 0 ? "up" : "down", pct };
}

function ppDelta(current: number, prev: number): Delta {
  const diff = Math.round((current - prev) * 10) / 10;
  if (diff === 0) return { kind: "flat", pct: 0 };
  return { kind: diff > 0 ? "up" : "down", pct: Math.abs(diff) };
}

function ptsDelta(current: number, prev: number): Delta {
  const diff = Math.round((current - prev) * 10) / 10;
  if (diff === 0) return { kind: "flat", pct: 0 };
  return { kind: diff > 0 ? "up" : "down", pct: Math.abs(diff) };
}

function countDelta(current: number, prev: number): Delta {
  const diff = current - prev;
  if (diff === 0) return { kind: "flat", pct: 0 };
  return { kind: diff > 0 ? "up" : "down", pct: Math.abs(diff) };
}

function formatTalk(seconds: number): string {
  if (seconds === 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
