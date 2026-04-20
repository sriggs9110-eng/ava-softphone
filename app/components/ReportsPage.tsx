"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Minus,
  Download,
  Loader2,
  RefreshCw,
  Play,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Clock,
  RotateCw,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Dot,
  ReferenceLine,
} from "recharts";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import PepperMascot from "@/components/pepper/PepperMascot";

type Period = "today" | "week" | "month" | "quarter" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  all: "All",
};

interface ReportsResponse {
  scope: {
    period: Period;
    period_start: string;
    period_end: string;
    agent_id: string;
    agent_name?: string;
    role: "agent" | "manager" | "admin";
  };
  volume: {
    total_calls: number;
    inbound: number;
    outbound: number;
    missed: number;
    connected: number;
    voicemail: number;
    answer_rate: number;
    vs_previous_period: { total_calls: number; connected: number; answer_rate: number };
  };
  time: {
    total_talk_seconds: number;
    avg_call_seconds: number;
    median_call_seconds: number;
    longest_call_seconds: number;
    total_talk_seconds_prev: number;
  };
  coaching: {
    avg_ai_score: number;
    avg_talk_ratio_rep: number;
    avg_question_count: number;
    avg_longest_monologue: number;
    avg_interruption_count: number;
    top_objections: Array<{ tag: string; count: number; pct_of_calls: number }>;
    top_topics: Array<{ tag: string; count: number }>;
    score_trend: Array<{ date: string; score: number; call_count: number }>;
  };
  outcomes: {
    calls_scored_7_plus: number;
    calls_scored_below_5: number;
    quality_call_rate: number;
  };
  operational: {
    local_presence: {
      matched_area_code_calls: number;
      matched_answer_rate: number;
      unmatched_area_code_calls: number;
      unmatched_answer_rate: number;
      lift: number;
    };
    ring_groups: Array<{
      id: string;
      name: string;
      inbound_calls: number;
      answered: number;
      answer_rate: number;
      avg_time_to_answer_sec: number;
      missed: number;
    }>;
  };
  heatmap: { data: number[][] };
  by_agent:
    | Array<{
        user_id: string;
        name: string;
        avatar_color: string;
        total_calls: number;
        connected: number;
        answer_rate: number;
        total_talk_seconds: number;
        avg_ai_score: number;
        avg_talk_ratio_rep: number;
        avg_question_count: number;
        closes: number;
        trend: "up" | "flat" | "down";
      }>
    | null;
}

interface PeppersPick {
  pick_id: string;
  call_log_id: string;
  rep_name: string;
  prospect_name: string | null;
  prospect_company: string | null;
  prospect_number: string;
  duration_seconds: number;
  ai_score: number | null;
  category: "jump" | "drop" | "outlier" | "high_effort" | "callback";
  pepper_headline: string;
  pepper_reason: string;
}

export default function ReportsPage() {
  const { user, isManager, isAdmin } = useAuth();
  const [period, setPeriod] = useState<Period>("week");
  const [agentId, setAgentId] = useState<string>(isManager ? "all" : "me");
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [picks, setPicks] = useState<PeppersPick[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<
    Array<{ id: string; full_name: string }>
  >([]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      const params = new URLSearchParams({ period, agent_id: agentId });

      // Reports + Pick run in parallel. Pick is slow (Claude) and the reports
      // endpoint is fast — don't make the whole UI wait on Pick.
      const [reportsRes, pickRes] = await Promise.allSettled([
        fetch(`/api/reports?${params.toString()}`, { signal }),
        // Picks only for this-week view; other periods don't get picks.
        period === "week"
          ? fetch(`/api/reports/peppers-pick?period=week`, { signal })
          : Promise.resolve(null),
      ]);

      if (reportsRes.status === "fulfilled") {
        const res = reportsRes.value;
        if (!res.ok) {
          setError(`Failed to load (${res.status})`);
          return;
        }
        const body = (await res.json()) as ReportsResponse;
        setData(body);
      } else {
        setError("Failed to load");
      }

      if (
        pickRes.status === "fulfilled" &&
        pickRes.value &&
        pickRes.value.ok
      ) {
        const body = (await pickRes.value.json()) as { picks: PeppersPick[] };
        setPicks(body.picks || []);
      } else if (period !== "week") {
        setPicks(null);
      }
    },
    [period, agentId]
  );

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    load(ac.signal).finally(() => setLoading(false));
    return () => ac.abort();
  }, [load]);

  useEffect(() => {
    if (!isManager) return;
    const supabase = createClient();
    supabase
      .from("softphone_users")
      .select("id, full_name")
      .order("full_name")
      .then(({ data }) => {
        if (data) setTeamMembers(data as Array<{ id: string; full_name: string }>);
      });
  }, [isManager]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleExportCsv = () => {
    if (!data) return;
    const rows: string[] = [];
    rows.push("# Pepper Report");
    rows.push(
      `# ${data.scope.period} | ${new Date(data.scope.period_start).toDateString()} – ${new Date(data.scope.period_end).toDateString()}`
    );
    rows.push("");
    rows.push("Section,Metric,Value");
    rows.push(`Volume,Total calls,${data.volume.total_calls}`);
    rows.push(`Volume,Inbound,${data.volume.inbound}`);
    rows.push(`Volume,Outbound,${data.volume.outbound}`);
    rows.push(`Volume,Connected,${data.volume.connected}`);
    rows.push(`Volume,Missed,${data.volume.missed}`);
    rows.push(`Volume,Answer rate %,${data.volume.answer_rate}`);
    rows.push(`Time,Total talk seconds,${data.time.total_talk_seconds}`);
    rows.push(`Time,Avg call seconds,${data.time.avg_call_seconds}`);
    rows.push(`Time,Median call seconds,${data.time.median_call_seconds}`);
    rows.push(`Time,Longest call seconds,${data.time.longest_call_seconds}`);
    rows.push(`Coaching,Avg AI score,${data.coaching.avg_ai_score}`);
    rows.push(`Coaching,Avg talk ratio rep %,${data.coaching.avg_talk_ratio_rep}`);
    rows.push(`Coaching,Avg questions per call,${data.coaching.avg_question_count}`);
    rows.push(
      `Coaching,Avg longest monologue sec,${data.coaching.avg_longest_monologue}`
    );
    rows.push(
      `Coaching,Avg interruption count,${data.coaching.avg_interruption_count}`
    );
    rows.push(`Outcomes,Calls scoring 7+,${data.outcomes.calls_scored_7_plus}`);
    rows.push(`Outcomes,Calls scoring <5,${data.outcomes.calls_scored_below_5}`);
    rows.push(`Outcomes,Quality call rate %,${data.outcomes.quality_call_rate}`);

    rows.push("");
    rows.push("Objection,Count,% of calls");
    for (const o of data.coaching.top_objections) {
      rows.push(`${csvCell(o.tag)},${o.count},${o.pct_of_calls}`);
    }

    if (data.by_agent) {
      rows.push("");
      rows.push(
        "Rank,Agent,Total calls,Connected,Answer rate %,Talk seconds,Avg AI score,Avg talk ratio rep %,Questions/call,Closes,Trend"
      );
      data.by_agent.forEach((a, i) => {
        rows.push(
          `${i + 1},${csvCell(a.name)},${a.total_calls},${a.connected},${a.answer_rate},${a.total_talk_seconds},${a.avg_ai_score},${a.avg_talk_ratio_rep},${a.avg_question_count},${a.closes},${a.trend}`
        );
      });
    }

    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `pepper-report-${data.scope.period}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-slate" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center text-center py-16 px-6">
        <PepperMascot size="md" state="alert" />
        <h3 className="mt-4 text-xl font-semibold text-navy font-display">
          {error}
        </h3>
      </div>
    );
  }

  if (!data) return null;

  const noData = data.volume.total_calls === 0;

  return (
    <div className="w-full animate-fade-in space-y-6">
      {/* SECTION A — header + scope bar */}
      <SectionA
        scope={data.scope}
        volume={data.volume}
        period={period}
        agentId={agentId}
        isManager={!!isManager}
        teamMembers={teamMembers}
        currentUserId={user?.id}
        onPeriodChange={setPeriod}
        onAgentChange={setAgentId}
        onRefresh={handleRefresh}
        onExport={handleExportCsv}
        refreshing={refreshing}
      />

      {noData ? (
        <EmptyFull period={period} isManager={!!isManager} />
      ) : (
        <>
          {/* Pepper's Pick — above coaching per spec. Week view only. */}
          {period === "week" && <PeppersPickSection picks={picks} />}

          {/* SECTION B — volume + time + charts */}
          <SectionB data={data} />

          {/* SECTION C — coaching deep-dive */}
          <SectionC data={data} />

          {/* SECTION D — per-agent table */}
          {data.by_agent && data.by_agent.length > 0 && (
            <SectionD
              rows={data.by_agent}
              onDrill={(uid) => setAgentId(uid)}
            />
          )}

          {/* SECTION E — operational */}
          <SectionE data={data} />

          {/* Ops-health panel — admin only */}
          {isAdmin && (
            <OpsHealthPanel periodStart={data.scope.period_start} periodEnd={data.scope.period_end} />
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- Pepper's Pick ---------------- */

const CATEGORY_CHIP: Record<PeppersPick["category"], { label: string; bg: string; icon: React.ReactNode }> = {
  jump: { label: "Score jump", bg: "bg-leaf text-white", icon: <TrendingUp size={11} /> },
  drop: { label: "Score drop", bg: "bg-coral text-white", icon: <TrendingDown size={11} /> },
  outlier: { label: "Outlier", bg: "bg-banana text-navy", icon: <Sparkles size={11} /> },
  high_effort: { label: "Long haul", bg: "bg-cream-2 text-navy", icon: <Clock size={11} /> },
  callback: { label: "Callback win", bg: "bg-sky text-navy", icon: <RotateCw size={11} /> },
};

function PeppersPickSection({ picks }: { picks: PeppersPick[] | null }) {
  const loading = picks === null;
  const empty = picks !== null && picks.length === 0;

  return (
    <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-8 h-8 rounded-full bg-banana border-2 border-navy flex items-center justify-center text-navy">
          <Sparkles size={14} />
        </span>
        <h3 className="text-lg font-semibold text-navy font-display">
          Pepper&rsquo;s Pick
        </h3>
        <span className="text-[11px] text-slate uppercase tracking-wider font-bold">
          Calls worth listening to this week
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={18} className="animate-spin text-slate" />
          <span className="text-[12px] text-slate ml-2">
            Pepper&rsquo;s picking…
          </span>
        </div>
      ) : empty ? (
        <div className="py-6 text-center">
          <p className="text-[13px] text-slate font-accent text-lg">
            Nothing stood out this week. Check back next Monday.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {picks!.slice(0, 3).map((p) => (
            <PickCard key={p.pick_id} pick={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PickCard({ pick }: { pick: PeppersPick }) {
  const chip = CATEGORY_CHIP[pick.category];
  const mins = Math.round(pick.duration_seconds / 60);
  return (
    <a
      href={`/?log=${pick.call_log_id}`}
      className="bg-cream-3 border-[2.5px] border-navy rounded-[14px] p-4 shadow-pop-sm shadow-pop-hover block no-underline"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border-[1.5px] border-navy text-[10px] font-bold uppercase tracking-wider ${chip.bg}`}
        >
          {chip.icon}
          {chip.label}
        </span>
        {typeof pick.ai_score === "number" && (
          <span className="text-[11px] tabular-nums font-bold text-navy bg-paper border-[1.5px] border-navy rounded-full px-2 py-0.5">
            {pick.ai_score.toFixed(1)}/10
          </span>
        )}
      </div>
      <p className="text-[14px] font-semibold text-navy font-display leading-snug mb-1">
        {pick.pepper_headline}
      </p>
      <p className="text-[12px] text-navy-2 leading-relaxed mb-3">
        {pick.pepper_reason}
      </p>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate">
          <span className="font-bold text-navy">{pick.rep_name}</span>
          {" → "}
          <span className="tabular-nums">{pick.prospect_number}</span>
          <span className="ml-2 tabular-nums">· {mins}m</span>
        </span>
        <span className="inline-flex items-center gap-1 text-navy font-semibold">
          <Play size={11} />
          Listen
        </span>
      </div>
    </a>
  );
}

/* ---------------- Ops-health panel ---------------- */

interface OpsHealthData {
  total: number;
  with_recording: number;
  with_transcript: number;
  with_ai: number;
  transcript_failed: number;
  ai_failed: number;
  avg_end_to_recording_sec: number | null;
  avg_recording_to_transcript_sec: number | null;
  avg_transcript_to_ai_sec: number | null;
}

function OpsHealthPanel({
  periodStart,
  periodEnd,
}: {
  periodStart: string;
  periodEnd: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<OpsHealthData | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ start: periodStart, end: periodEnd });
    const res = await fetch(`/api/reports/ops-health?${params.toString()}`);
    if (res.ok) {
      setData((await res.json()) as OpsHealthData);
      setLoaded(true);
    }
  }, [periodStart, periodEnd]);

  useEffect(() => {
    if (open && !loaded) load();
  }, [open, loaded, load]);

  const handleRetryAll = async (kind: "transcript" | "ai") => {
    setRetrying(true);
    await fetch(`/api/reports/ops-health/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, start: periodStart, end: periodEnd }),
    });
    setRetrying(false);
    await load();
  };

  const pct = (num: number, denom: number) =>
    denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;
  const transcriptPct = data ? pct(data.with_transcript, data.total) : 0;
  const transcriptAlert = data && data.total > 0 && transcriptPct < 95;

  return (
    <div className="bg-cream-2 border-[2.5px] border-navy rounded-[18px] shadow-pop-md overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-cream-3 transition-colors"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span className="text-base font-semibold text-navy font-display">
            Ops health
          </span>
          <span className="text-[11px] text-slate uppercase tracking-wider font-bold">
            Pipeline reliability · admin only
          </span>
          {transcriptAlert && (
            <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-coral text-white border-[1.5px] border-navy text-[10px] font-bold uppercase tracking-wider">
              <AlertTriangle size={10} />
              Below 95%
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t-2 border-navy px-5 py-4 bg-paper space-y-3">
          {!data ? (
            <div className="flex items-center gap-2 text-slate text-[13px]">
              <Loader2 size={14} className="animate-spin" />
              Loading pipeline stats…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <OpsStat label="Total calls" value={data.total.toString()} />
                <OpsStat
                  label="Recording"
                  value={`${data.with_recording} (${pct(
                    data.with_recording,
                    data.total
                  )}%)`}
                />
                <OpsStat
                  label="Transcript"
                  value={`${data.with_transcript} (${transcriptPct}%)`}
                  alert={transcriptAlert || false}
                />
                <OpsStat
                  label="AI analysis"
                  value={`${data.with_ai} (${pct(data.with_ai, data.total)}%)`}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-cream-3 border-2 border-navy rounded-[10px] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-navy uppercase tracking-wider">
                      Failed transcripts
                    </span>
                    <span className="text-[13px] font-bold text-navy tabular-nums">
                      {data.transcript_failed}
                    </span>
                  </div>
                  {data.transcript_failed > 0 && (
                    <button
                      onClick={() => handleRetryAll("transcript")}
                      disabled={retrying}
                      className="mt-2 px-2.5 py-1 rounded-full bg-paper border-2 border-navy text-navy text-[11px] font-bold inline-flex items-center gap-1 shadow-pop-sm"
                    >
                      {retrying ? <Loader2 size={10} className="animate-spin" /> : <RotateCw size={10} />}
                      Retry all
                    </button>
                  )}
                </div>
                <div className="bg-cream-3 border-2 border-navy rounded-[10px] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-navy uppercase tracking-wider">
                      Failed AI analyses
                    </span>
                    <span className="text-[13px] font-bold text-navy tabular-nums">
                      {data.ai_failed}
                    </span>
                  </div>
                  {data.ai_failed > 0 && (
                    <button
                      onClick={() => handleRetryAll("ai")}
                      disabled={retrying}
                      className="mt-2 px-2.5 py-1 rounded-full bg-paper border-2 border-navy text-navy text-[11px] font-bold inline-flex items-center gap-1 shadow-pop-sm"
                    >
                      {retrying ? <Loader2 size={10} className="animate-spin" /> : <RotateCw size={10} />}
                      Retry all
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[12px]">
                <OpsTime label="Call end → recording" seconds={data.avg_end_to_recording_sec} />
                <OpsTime label="Recording → transcript" seconds={data.avg_recording_to_transcript_sec} />
                <OpsTime label="Transcript → AI" seconds={data.avg_transcript_to_ai_sec} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OpsStat({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`border-2 border-navy rounded-[10px] p-3 ${
        alert ? "bg-rose" : "bg-cream-3"
      }`}
    >
      <p className="text-[10px] text-navy uppercase tracking-wider font-bold">
        {label}
      </p>
      <p className="text-[16px] font-bold text-navy tabular-nums mt-0.5">
        {value}
      </p>
    </div>
  );
}

function OpsTime({
  label,
  seconds,
}: {
  label: string;
  seconds: number | null;
}) {
  const display =
    seconds === null
      ? "—"
      : seconds < 60
      ? `${Math.round(seconds)}s`
      : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return (
    <div className="bg-cream-3 border-2 border-navy rounded-[10px] px-3 py-2">
      <p className="text-[10px] text-navy uppercase tracking-wider font-bold">
        {label}
      </p>
      <p className="text-[14px] font-bold text-navy tabular-nums">{display}</p>
    </div>
  );
}

/* ---------------- Section A ---------------- */

function SectionA({
  scope,
  volume,
  period,
  agentId,
  isManager,
  teamMembers,
  currentUserId,
  onPeriodChange,
  onAgentChange,
  onRefresh,
  onExport,
  refreshing,
}: {
  scope: ReportsResponse["scope"];
  volume: ReportsResponse["volume"];
  period: Period;
  agentId: string;
  isManager: boolean;
  teamMembers: Array<{ id: string; full_name: string }>;
  currentUserId?: string;
  onPeriodChange: (p: Period) => void;
  onAgentChange: (a: string) => void;
  onRefresh: () => void;
  onExport: () => void;
  refreshing: boolean;
}) {
  const periods: Period[] = ["today", "week", "month", "quarter", "all"];
  const agentCount = teamMembers.length;
  const start = new Date(scope.period_start);
  const end = new Date(scope.period_end);
  const sameYear = start.getFullYear() === end.getFullYear();
  const fmt = (d: Date) =>
    d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-full border-[2.5px] border-navy overflow-hidden shadow-pop-sm">
            {periods.map((p, i) => {
              const active = period === p;
              return (
                <button
                  key={p}
                  onClick={() => onPeriodChange(p)}
                  className={`px-3 py-2 text-[12px] font-bold uppercase tracking-wider transition-colors ${
                    active ? "bg-banana text-navy" : "bg-paper text-navy hover:bg-cream-2"
                  } ${i > 0 ? "border-l-2 border-navy" : ""}`}
                >
                  {PERIOD_LABELS[p]}
                </button>
              );
            })}
          </div>

          {isManager && (
            <select
              value={agentId}
              onChange={(e) => onAgentChange(e.target.value)}
              className="px-3 py-2 text-[13px] bg-paper border-[2.5px] border-navy rounded-full text-navy font-semibold shadow-pop-sm cursor-pointer"
            >
              <option value="all">Whole team</option>
              <option value="me">Just me</option>
              {teamMembers
                .filter((m) => m.id !== currentUserId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            aria-label="Refresh"
            className="px-3 py-2 rounded-full bg-paper border-2 border-navy text-navy text-[12px] font-bold flex items-center gap-1.5 shadow-pop-sm shadow-pop-hover"
          >
            <RefreshCw
              size={14}
              className={refreshing ? "animate-spin" : ""}
            />
            Refresh
          </button>
          <button
            onClick={onExport}
            className="px-3 py-2 rounded-full bg-paper border-2 border-navy text-navy text-[12px] font-bold flex items-center gap-1.5 shadow-pop-sm shadow-pop-hover"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      <p className="text-[12px] text-slate mt-3 font-semibold uppercase tracking-wider">
        {fmt(start)} – {fmt(end)} ·{" "}
        {isManager && agentId === "all"
          ? `${agentCount} agents`
          : scope.agent_name
          ? `${scope.agent_name}`
          : "You"}{" "}
        · {volume.total_calls.toLocaleString()} calls
      </p>
    </div>
  );
}

/* ---------------- Section B ---------------- */

function SectionB({ data }: { data: ReportsResponse }) {
  const { volume, time, coaching } = data;

  const trendData = useMemo(
    () =>
      coaching.score_trend.map((d) => ({
        date: d.date.slice(5),
        score: d.score || 0,
        calls: d.call_count,
      })),
    [coaching.score_trend]
  );

  const periodAvgScore = coaching.avg_ai_score || 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total calls"
          value={volume.total_calls.toLocaleString()}
          deltaPct={volume.vs_previous_period.total_calls}
          bg="bg-paper"
        />
        <MetricCard
          label="Talk time"
          value={formatTalkTime(time.total_talk_seconds)}
          deltaPct={pctChange(time.total_talk_seconds, time.total_talk_seconds_prev)}
          bg="bg-paper"
        />
        <MetricCard
          label="Answer rate"
          value={`${volume.answer_rate}%`}
          deltaPct={volume.vs_previous_period.answer_rate}
          deltaUnit="pp"
          bg="bg-[#D7F0E1]"
        />
        <MetricCard
          label="Avg AI score"
          value={coaching.avg_ai_score ? coaching.avg_ai_score.toFixed(1) : "—"}
          suffix={coaching.avg_ai_score ? " / 10" : ""}
          deltaPct={0}
          bg="bg-cream-2"
          hideDelta
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
          <h3 className="text-base font-semibold text-navy font-display mb-1">
            Daily volume
          </h3>
          <p className="text-[11px] text-slate uppercase tracking-wider font-bold mb-3">
            Bars: all calls · Coral: scored 8+
          </p>
          <DailyVolumeChart trend={coaching.score_trend} />
        </div>
        <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
          <h3 className="text-base font-semibold text-navy font-display mb-1">
            Score trend
          </h3>
          <p className="text-[11px] text-slate uppercase tracking-wider font-bold mb-3">
            Average AI score per day
          </p>
          <div className="h-[240px]">
            {trendData.every((d) => d.score === 0) ? (
              <EmptyChart note="No scored calls in this window yet." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#6B6E85", fontSize: 10 }}
                    axisLine={{ stroke: "#1B2340" }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 10]}
                    tick={{ fill: "#6B6E85", fontSize: 10 }}
                    axisLine={{ stroke: "#1B2340" }}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#FFFEFA",
                      border: "2px solid #1B2340",
                      borderRadius: "10px",
                      fontSize: "12px",
                      boxShadow: "4px 4px 0 #1B2340",
                    }}
                  />
                  <ReferenceLine
                    y={periodAvgScore}
                    stroke="#B88A0F"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#FFCE3A"
                    strokeWidth={3}
                    dot={(props: unknown) => <NavyDot {...(props as Record<string, unknown>)} />}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DailyVolumeChart({
  trend,
}: {
  trend: ReportsResponse["coaching"]["score_trend"];
}) {
  // We don't track per-day "scored 8+" separately in the response, so we
  // treat score_trend.score >= 8 as the signal for that day.
  const rows = trend.map((d) => ({
    date: d.date.slice(5),
    all: d.call_count,
    quality: d.score >= 8 ? d.call_count : 0,
  }));
  const avg =
    rows.length > 0
      ? Math.round((rows.reduce((a, r) => a + r.all, 0) / rows.length) * 10) / 10
      : 0;

  if (rows.every((r) => r.all === 0)) {
    return <EmptyChart note="No calls in this window yet." />;
  }

  return (
    <div className="h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <XAxis
            dataKey="date"
            tick={{ fill: "#6B6E85", fontSize: 10 }}
            axisLine={{ stroke: "#1B2340" }}
            tickLine={false}
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
              boxShadow: "4px 4px 0 #1B2340",
            }}
            cursor={{ fill: "rgba(255, 206, 58, 0.25)" }}
          />
          <ReferenceLine
            y={avg}
            stroke="#1B2340"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
          <Bar
            dataKey="all"
            fill="#FFCE3A"
            stroke="#1B2340"
            strokeWidth={1.5}
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="quality"
            fill="#FF7A5C"
            stroke="#1B2340"
            strokeWidth={1.5}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function NavyDot(props: Record<string, unknown>) {
  const cx = props.cx as number;
  const cy = props.cy as number;
  if (cx == null || cy == null) return <g />;
  return (
    <Dot
      cx={cx}
      cy={cy}
      r={4}
      stroke="#1B2340"
      strokeWidth={2}
      fill="#1B2340"
    />
  );
}

/* ---------------- Section C ---------------- */

function SectionC({ data }: { data: ReportsResponse }) {
  const { coaching, heatmap } = data;

  const repPct = Math.round(coaching.avg_talk_ratio_rep);
  const prospectPct = repPct > 0 ? 100 - repPct : 0;
  const inIdealRange = repPct >= 40 && repPct <= 60;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 space-y-4">
        <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
          <h3 className="text-base font-semibold text-navy font-display">
            Talk ratio
          </h3>
          <p className="text-[11px] text-slate uppercase tracking-wider font-bold">
            Ideal range: 40–60% rep
          </p>
          {repPct === 0 ? (
            <EmptyInline note="No scored transcripts yet." />
          ) : (
            <>
              <div className="mt-4 h-8 flex rounded-full overflow-hidden border-[2.5px] border-navy">
                <div
                  className={`flex items-center justify-end pr-2 ${
                    inIdealRange ? "bg-leaf" : "bg-coral"
                  } text-white text-[12px] font-bold`}
                  style={{ width: `${repPct}%` }}
                >
                  {repPct > 10 ? `${repPct}% rep` : ""}
                </div>
                <div
                  className="flex items-center justify-start pl-2 bg-cream-2 text-navy text-[12px] font-bold"
                  style={{ width: `${prospectPct}%` }}
                >
                  {prospectPct > 10 ? `${prospectPct}% prospect` : ""}
                </div>
              </div>
              <p className="text-[13px] text-navy-2 mt-3">
                {inIdealRange
                  ? `You talked ${repPct}% of the time on average — that's in the pocket.`
                  : repPct < 40
                  ? `You talked ${repPct}% of the time on average — a little more leadership might help steer the call.`
                  : `You talked ${repPct}% of the time on average — try slowing down and asking more questions.`}
              </p>
            </>
          )}
        </div>

        <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
          <h3 className="text-base font-semibold text-navy font-display">
            Question rate
          </h3>
          <p className="text-[11px] text-slate uppercase tracking-wider font-bold">
            Questions asked per call
          </p>
          {coaching.avg_question_count === 0 ? (
            <EmptyInline note="No analyzed calls yet." />
          ) : (
            <div className="mt-3 flex items-end gap-3">
              <span className="text-[48px] font-bold text-navy font-display leading-none">
                {coaching.avg_question_count}
              </span>
              <span className="text-[13px] text-slate pb-2">
                High performers ask 8–12 per call
              </span>
            </div>
          )}
        </div>

        <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
          <h3 className="text-base font-semibold text-navy font-display">
            Objection types
          </h3>
          <p className="text-[11px] text-slate uppercase tracking-wider font-bold mb-3">
            Top 5 across the period
          </p>
          {coaching.top_objections.length === 0 ? (
            <EmptyInline note="No objections surfaced in analyzed calls yet." />
          ) : (
            <div className="space-y-2">
              {coaching.top_objections.slice(0, 5).map((o) => {
                const max = coaching.top_objections[0]?.count || 1;
                return (
                  <div key={o.tag}>
                    <div className="flex items-baseline justify-between text-[13px]">
                      <span
                        className="font-semibold text-navy capitalize"
                        title={OBJECTION_DESCRIPTIONS[o.tag] || ""}
                      >
                        {o.tag}
                      </span>
                      <span className="text-slate tabular-nums">
                        {o.count} · {o.pct_of_calls}%
                      </span>
                    </div>
                    <div className="mt-1 h-3 bg-cream-2 border border-navy rounded-full overflow-hidden">
                      <div
                        className="h-full bg-banana border-r-2 border-navy"
                        style={{ width: `${(o.count / max) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="lg:col-span-2 space-y-4">
        <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
          <h3 className="text-base font-semibold text-navy font-display">
            Best time to reach prospects
          </h3>
          <p className="text-[11px] text-slate uppercase tracking-wider font-bold mb-3">
            Call volume by day and hour
          </p>
          <Heatmap data={heatmap.data} />
        </div>

        <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
          <h3 className="text-base font-semibold text-navy font-display mb-3">
            Top topics
          </h3>
          {coaching.top_topics.length === 0 ? (
            <EmptyInline note="No topics extracted yet." />
          ) : (
            <div className="flex flex-wrap gap-2">
              {coaching.top_topics.slice(0, 12).map((t) => (
                <span
                  key={t.tag}
                  className="px-2.5 py-1 rounded-full bg-cream-2 border-[1.5px] border-navy text-[12px] font-semibold text-navy"
                >
                  {t.tag}{" "}
                  <span className="text-slate tabular-nums font-normal">
                    {t.count}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const OBJECTION_DESCRIPTIONS: Record<string, string> = {
  price: "Prospect raised price or budget concerns.",
  timing: "Not the right time / deferred decision.",
  competitor: "Already evaluating or committed to a competitor.",
  authority: "Not the decision maker / needs approval.",
  need: "Doesn't see the need.",
  trust: "Concerns about brand, risk, or credibility.",
  unclear: "Ambiguous objection or vague reason to hold off.",
};

function Heatmap({ data }: { data: number[][] }) {
  const max = data.flat().reduce((m, v) => Math.max(m, v), 0);
  const days = ["S", "M", "T", "W", "T", "F", "S"];
  if (max === 0) {
    return <EmptyInline note="Heatmap unlocks after you log calls." />;
  }

  const color = (v: number) => {
    if (v === 0) return "#FFF9EC";
    const t = v / max;
    if (t < 0.2) return "#FFF3C9";
    if (t < 0.45) return "#FFE385";
    if (t < 0.7) return "#FFCE3A";
    if (t < 0.9) return "#E8B420";
    return "#B88A0F";
  };

  return (
    <div className="overflow-x-auto">
      <table className="text-[9px] border-separate border-spacing-[2px]">
        <thead>
          <tr>
            <th className="w-6" />
            {Array.from({ length: 24 }).map((_, h) => (
              <th
                key={h}
                className="w-5 text-center text-slate tabular-nums font-bold"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, di) => (
            <tr key={di}>
              <th className="text-navy font-bold pr-1">{days[di]}</th>
              {row.map((v, hi) => (
                <td
                  key={hi}
                  title={`${days[di]} ${hi}:00 — ${v} calls`}
                  className="w-5 h-5 rounded border border-navy/40"
                  style={{ background: color(v) }}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Section D ---------------- */

type AgentRow = NonNullable<ReportsResponse["by_agent"]>[number];
type SortKey =
  | "rank"
  | "name"
  | "total_calls"
  | "connected"
  | "talk_time"
  | "avg_ai_score"
  | "talk_ratio"
  | "questions"
  | "closes"
  | "trend";

function SectionD({
  rows,
  onDrill,
}: {
  rows: AgentRow[];
  onDrill: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "total_calls",
    dir: "desc",
  });

  const sorted = useMemo(() => {
    const clone = [...rows];
    const dir = sort.dir === "asc" ? 1 : -1;
    clone.sort((a, b) => {
      const va = valueFor(a, sort.key);
      const vb = valueFor(b, sort.key);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return clone;
  }, [rows, sort]);

  const onHead = (key: SortKey) => {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }
    );
  };

  return (
    <div className="bg-paper border-[2.5px] border-navy rounded-[18px] overflow-hidden shadow-pop-md">
      <h3 className="text-base font-semibold text-navy font-display px-5 py-4 border-b-2 border-navy bg-cream-2">
        By agent
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-navy bg-cream-3">
              <SortHead label="Rank" active={sort.key === "rank"} dir={sort.dir} onClick={() => onHead("rank")} />
              <SortHead label="Agent" active={sort.key === "name"} dir={sort.dir} onClick={() => onHead("name")} />
              <SortHead label="Calls" active={sort.key === "total_calls"} dir={sort.dir} onClick={() => onHead("total_calls")} />
              <SortHead label="Connected" active={sort.key === "connected"} dir={sort.dir} onClick={() => onHead("connected")} />
              <SortHead label="Talk time" active={sort.key === "talk_time"} dir={sort.dir} onClick={() => onHead("talk_time")} />
              <SortHead label="Avg score" active={sort.key === "avg_ai_score"} dir={sort.dir} onClick={() => onHead("avg_ai_score")} />
              <SortHead label="Talk %" active={sort.key === "talk_ratio"} dir={sort.dir} onClick={() => onHead("talk_ratio")} />
              <SortHead label="Q/call" active={sort.key === "questions"} dir={sort.dir} onClick={() => onHead("questions")} />
              <SortHead label="Closes" active={sort.key === "closes"} dir={sort.dir} onClick={() => onHead("closes")} />
              <SortHead label="Trend" active={sort.key === "trend"} dir={sort.dir} onClick={() => onHead("trend")} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((a, i) => {
              const scoreColor =
                a.avg_ai_score >= 8
                  ? "bg-leaf text-white"
                  : a.avg_ai_score >= 6
                  ? "bg-banana text-navy"
                  : a.avg_ai_score >= 1
                  ? "bg-coral text-white"
                  : "bg-cream-2 text-slate";
              const talkColor =
                a.avg_talk_ratio_rep >= 40 && a.avg_talk_ratio_rep <= 60
                  ? "text-leaf-dark"
                  : a.avg_talk_ratio_rep === 0
                  ? "text-slate"
                  : "text-coral-deep";
              return (
                <tr
                  key={a.user_id}
                  onClick={() => onDrill(a.user_id)}
                  className="border-b border-navy/10 last:border-0 hover:bg-cream-3 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-[12px] text-slate tabular-nums font-bold">
                    {String(i + 1).padStart(2, "0")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-8 h-8 rounded-full border-2 border-navy flex items-center justify-center text-[11px] font-bold text-navy"
                        style={{ background: a.avatar_color }}
                      >
                        {a.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="text-[13px] font-semibold text-navy">
                        {a.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-navy tabular-nums">
                    {a.total_calls}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-navy tabular-nums">
                    {a.connected}
                    <span className="text-slate ml-1">({a.answer_rate}%)</span>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-navy tabular-nums">
                    {formatTalkTime(a.total_talk_seconds)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full border-[1.5px] border-navy text-[11px] font-bold tabular-nums ${scoreColor}`}
                    >
                      {a.avg_ai_score > 0 ? a.avg_ai_score.toFixed(1) : "—"}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-[13px] font-semibold tabular-nums ${talkColor}`}>
                    {a.avg_talk_ratio_rep > 0 ? `${a.avg_talk_ratio_rep}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-navy tabular-nums">
                    {a.avg_question_count || "—"}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-navy tabular-nums">
                    {a.closes}
                  </td>
                  <td className="px-4 py-3 text-[13px]">
                    <TrendArrow t={a.trend} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate px-5 py-2 bg-cream-3 border-t-2 border-navy">
        Click a row to filter the whole report to that agent.
      </p>
    </div>
  );
}

function valueFor(a: AgentRow, key: SortKey): number | string {
  switch (key) {
    case "rank":
    case "total_calls":
      return a.total_calls;
    case "name":
      return a.name.toLowerCase();
    case "connected":
      return a.connected;
    case "talk_time":
      return a.total_talk_seconds;
    case "avg_ai_score":
      return a.avg_ai_score;
    case "talk_ratio":
      return a.avg_talk_ratio_rep;
    case "questions":
      return a.avg_question_count;
    case "closes":
      return a.closes;
    case "trend":
      return a.trend === "up" ? 2 : a.trend === "flat" ? 1 : 0;
  }
}

function SortHead({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className="text-left px-4 py-3 text-[10px] text-navy uppercase tracking-wider font-bold cursor-pointer select-none whitespace-nowrap"
    >
      <span className={active ? "underline decoration-coral decoration-2 underline-offset-2" : ""}>
        {label}
      </span>
      {active && (
        <span className="ml-1 text-slate">{dir === "asc" ? "↑" : "↓"}</span>
      )}
    </th>
  );
}

function TrendArrow({ t }: { t: "up" | "flat" | "down" }) {
  if (t === "up")
    return (
      <span className="inline-flex items-center gap-1 text-leaf-dark font-bold">
        <ArrowUp size={14} />
      </span>
    );
  if (t === "down")
    return (
      <span className="inline-flex items-center gap-1 text-coral-deep font-bold">
        <ArrowDown size={14} />
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-slate">
      <Minus size={14} />
    </span>
  );
}

/* ---------------- Section E ---------------- */

function SectionE({ data }: { data: ReportsResponse }) {
  const lp = data.operational.local_presence;
  const bigLift = lp.lift > 10;
  const smallLift = lp.lift < 5;

  const lpCardBg = bigLift
    ? "bg-banana"
    : smallLift
    ? "bg-cream-2"
    : "bg-paper";

  const rgHasIssue = data.operational.ring_groups.some(
    (g) => g.inbound_calls > 0 && g.answer_rate < 60
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className={`${lpCardBg} border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md`}>
        <h3 className="text-base font-semibold text-navy font-display">
          Local presence effectiveness
        </h3>
        {lp.matched_area_code_calls === 0 && lp.unmatched_area_code_calls === 0 ? (
          <EmptyInline note="Flags populate after calls are analyzed." />
        ) : (
          <>
            <p className="text-[48px] font-bold text-navy font-display leading-none mt-3 tabular-nums">
              {lp.lift > 0 ? "+" : ""}
              {lp.lift}pp
            </p>
            <p className="text-[13px] text-navy-2 mt-2">
              {lp.matched_answer_rate}% answered when caller ID matched area code vs{" "}
              {lp.unmatched_answer_rate}% when it didn&rsquo;t.
            </p>
            {smallLift && (
              <p className="text-[12px] text-navy mt-3 font-accent text-lg">
                Consider expanding your number pool — go to{" "}
                <a
                  href="/settings"
                  className="underline decoration-coral decoration-2 underline-offset-2 font-semibold"
                >
                  Settings → Phone Numbers
                </a>
                .
              </p>
            )}
            {bigLift && (
              <p className="text-[12px] text-navy mt-3 font-accent text-lg">
                Local presence is earning its keep.
              </p>
            )}
          </>
        )}
      </div>

      <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
        <h3 className="text-base font-semibold text-navy font-display mb-3">
          Ring group performance
        </h3>
        {data.operational.ring_groups.length === 0 ? (
          <EmptyInline note="No ring groups configured yet." />
        ) : (
          <ul className="divide-y-2 divide-navy/10">
            {data.operational.ring_groups.map((g) => {
              const flag = g.inbound_calls > 0 && g.answer_rate < 60;
              return (
                <li
                  key={g.id}
                  className="flex items-center gap-2 py-2.5 text-[13px]"
                >
                  {flag && (
                    <span
                      className="w-2 h-2 rounded-full bg-coral"
                      aria-label="Below 60% answer rate"
                    />
                  )}
                  <span className="font-semibold text-navy flex-1 truncate">
                    {g.name}
                  </span>
                  <span className="text-slate tabular-nums">
                    {g.answer_rate}% ans
                  </span>
                  <span className="text-slate tabular-nums">
                    · {g.avg_time_to_answer_sec}s avg
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {rgHasIssue && (
          <p className="text-[11px] text-coral-deep font-semibold mt-2">
            Flagged groups are answering under 60%.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------- Helpers ---------------- */

function csvCell(s: string) {
  if (s.includes(",") || s.includes('"') || s.includes("\n"))
    return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function pctChange(a: number, b: number): number {
  if (b === 0) return a > 0 ? 100 : 0;
  return Math.round(((a - b) / b) * 1000) / 10;
}

function formatTalkTime(seconds: number): string {
  if (seconds === 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function MetricCard({
  label,
  value,
  suffix,
  deltaPct,
  deltaUnit = "%",
  bg,
  hideDelta,
}: {
  label: string;
  value: string;
  suffix?: string;
  deltaPct: number;
  deltaUnit?: "%" | "pp";
  bg: string;
  hideDelta?: boolean;
}) {
  const up = deltaPct > 0;
  const down = deltaPct < 0;
  const deltaBg = up ? "bg-leaf text-white" : down ? "bg-coral text-white" : "bg-cream-2 text-navy";
  return (
    <div className={`${bg} border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md`}>
      <p className="text-[11px] text-navy uppercase tracking-[0.5px] font-bold">
        {label}
      </p>
      <p className="text-[36px] font-bold text-navy tabular-nums leading-none font-display mt-2">
        {value}
        {suffix && (
          <span className="text-[18px] font-semibold text-navy-2">{suffix}</span>
        )}
      </p>
      {!hideDelta && deltaPct !== 0 && (
        <span
          className={`inline-flex items-center gap-1 mt-3 px-2 py-0.5 rounded-full border-[1.5px] border-navy text-[11px] font-bold tabular-nums ${deltaBg}`}
        >
          {up ? <ArrowUp size={10} /> : down ? <ArrowDown size={10} /> : <Minus size={10} />}
          {Math.abs(deltaPct)}
          {deltaUnit} vs prev
        </span>
      )}
    </div>
  );
}

function EmptyChart({ note }: { note: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center">
      <PepperMascot size="sm" state="thinking" />
      <p className="text-[12px] text-slate mt-2 max-w-xs">{note}</p>
    </div>
  );
}

function EmptyInline({ note }: { note: string }) {
  return <p className="text-[13px] text-slate font-accent text-lg mt-2">{note}</p>;
}

function EmptyFull({ period, isManager }: { period: Period; isManager: boolean }) {
  const msg = isManager
    ? `Your team hasn't made any calls in the selected ${period === "today" ? "day" : period}. Try a longer range.`
    : "Not enough data yet — make some calls and check back.";
  return (
    <div className="flex flex-col items-center text-center py-20 px-6">
      <PepperMascot size="md" state="thinking" />
      <h3 className="mt-4 text-xl font-semibold text-navy font-display">
        No calls in this window
      </h3>
      <p className="mt-1 text-[14px] text-slate max-w-md font-accent text-lg leading-snug">
        {msg}
      </p>
    </div>
  );
}
