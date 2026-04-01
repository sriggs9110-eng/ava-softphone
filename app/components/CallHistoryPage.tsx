"use client";

import { useState, useCallback } from "react";
import {
  PhoneIncoming,
  PhoneOutgoing,
  Play,
  Pause,
  Search,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { CallHistoryEntry, AIAnalysis } from "@/app/lib/types";
import { updateCallHistoryEntry } from "@/app/lib/call-history";

interface CallHistoryPageProps {
  entries: CallHistoryEntry[];
  onDial: (number: string) => void;
  onUpdate: (entries: CallHistoryEntry[]) => void;
}

type FilterType = "all" | "inbound" | "outbound";

export default function CallHistoryPage({
  entries,
  onDial,
  onUpdate,
}: CallHistoryPageProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const filtered = entries.filter((e) => {
    if (filter === "inbound" && e.direction !== "inbound") return false;
    if (filter === "outbound" && e.direction !== "outbound") return false;
    if (search && !e.number.includes(search)) return false;
    return true;
  });

  const handleAnalyze = useCallback(
    async (entry: CallHistoryEntry) => {
      setAnalyzingId(entry.id);
      try {
        const res = await fetch("/api/ai/analyze-call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recording_url: entry.recordingUrl,
            call_metadata: {
              number: entry.number,
              direction: entry.direction,
              duration: entry.duration,
            },
          }),
        });

        if (res.ok) {
          const analysis: AIAnalysis = await res.json();
          const updated = updateCallHistoryEntry(entry.id, {
            aiAnalysis: analysis,
          });
          onUpdate(updated);
        }
      } catch {
        // silently fail
      } finally {
        setAnalyzingId(null);
      }
    },
    [onUpdate]
  );

  const scoreColor = (score: number) => {
    if (score >= 7) return "bg-green/15 text-green border-green/30";
    if (score >= 4) return "bg-amber/15 text-amber border-amber/30";
    return "bg-red/15 text-red border-red/30";
  };

  return (
    <div className="w-full animate-fade-in">
      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <input
            type="text"
            placeholder="Search by number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
          />
        </div>
        <div className="flex bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
          {(["all", "inbound", "outbound"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 text-[12px] font-semibold uppercase tracking-wider transition-colors ${
                filter === f
                  ? "bg-accent text-text-on-accent"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-text-tertiary text-sm">
          No calls found
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((entry) => (
            <div key={entry.id}>
              {/* Row */}
              <button
                onClick={() =>
                  setExpandedId(expandedId === entry.id ? null : entry.id)
                }
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-elevated rounded-xl transition-all duration-150 group"
              >
                {/* Direction */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    entry.direction === "inbound"
                      ? "bg-green/10 text-green"
                      : "bg-accent/10 text-accent"
                  }`}
                >
                  {entry.direction === "inbound" ? (
                    <PhoneIncoming size={14} />
                  ) : (
                    <PhoneOutgoing size={14} />
                  )}
                </div>

                {/* Number */}
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[14px] font-medium text-text-primary group-hover:text-accent transition-colors truncate">
                    {entry.number}
                  </p>
                  <p className="text-[12px] text-text-tertiary mt-0.5">
                    {formatTimestamp(entry.timestamp)}
                  </p>
                </div>

                {/* Duration */}
                <span className="text-[12px] text-text-tertiary tabular-nums shrink-0">
                  {formatCallDuration(entry.duration)}
                </span>

                {/* Status */}
                <StatusBadge status={entry.status} />

                {/* Recording */}
                {entry.recordingUrl && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPlayingId(playingId === entry.id ? null : entry.id);
                    }}
                    className="w-7 h-7 rounded-full bg-bg-elevated hover:bg-bg-hover flex items-center justify-center text-text-secondary transition-colors"
                  >
                    {playingId === entry.id ? (
                      <Pause size={12} />
                    ) : (
                      <Play size={12} />
                    )}
                  </button>
                )}

                {/* AI Score */}
                {entry.aiAnalysis && (
                  <div
                    className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${scoreColor(
                      entry.aiAnalysis.score
                    )}`}
                  >
                    {entry.aiAnalysis.score}/10
                  </div>
                )}

                {/* Analyze button */}
                {!entry.aiAnalysis && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAnalyze(entry);
                    }}
                    disabled={analyzingId === entry.id}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-bg-elevated hover:bg-bg-hover text-text-tertiary hover:text-accent text-[11px] font-medium transition-colors disabled:opacity-50"
                  >
                    {analyzingId === entry.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <TrendingUp size={12} />
                    )}
                    AI
                  </button>
                )}
              </button>

              {/* Expanded Details */}
              {expandedId === entry.id && (
                <div className="ml-11 mr-4 mb-3 p-4 bg-bg-surface border border-border-subtle rounded-xl animate-fade-in space-y-4">
                  {/* Recording player placeholder */}
                  {entry.recordingUrl && (
                    <div className="flex items-center gap-3 p-3 bg-bg-elevated rounded-lg">
                      <button
                        onClick={() =>
                          setPlayingId(
                            playingId === entry.id ? null : entry.id
                          )
                        }
                        className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white shrink-0"
                      >
                        {playingId === entry.id ? (
                          <Pause size={14} />
                        ) : (
                          <Play size={14} />
                        )}
                      </button>
                      <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                        <div className="h-full w-0 bg-accent rounded-full" />
                      </div>
                      <span className="text-[11px] text-text-tertiary tabular-nums">
                        {formatCallDuration(entry.duration)}
                      </span>
                    </div>
                  )}

                  {/* AI Analysis */}
                  {entry.aiAnalysis ? (
                    <AIAnalysisView analysis={entry.aiAnalysis} />
                  ) : (
                    <button
                      onClick={() => handleAnalyze(entry)}
                      disabled={analyzingId === entry.id}
                      className="w-full py-3 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all duration-150 disabled:opacity-50 flex items-center justify-center gap-2 min-h-[44px]"
                    >
                      {analyzingId === entry.id ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <TrendingUp size={16} />
                          Analyze with AI
                        </>
                      )}
                    </button>
                  )}

                  {/* Dial button */}
                  <button
                    onClick={() => onDial(entry.number)}
                    className="w-full py-2.5 rounded-lg bg-bg-elevated hover:bg-bg-hover text-text-secondary text-sm font-medium transition-colors min-h-[44px]"
                  >
                    Call {entry.number}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AIAnalysisView({ analysis }: { analysis: AIAnalysis }) {
  const scoreColor =
    analysis.score >= 7
      ? "bg-green/15 text-green border-green/30"
      : analysis.score >= 4
      ? "bg-amber/15 text-amber border-amber/30"
      : "bg-red/15 text-red border-red/30";

  return (
    <div className="space-y-4">
      {/* Score + Summary */}
      <div className="flex items-start gap-3">
        <div
          className={`px-3 py-1.5 rounded-full border text-sm font-bold shrink-0 ${scoreColor}`}
        >
          {analysis.score}/10
        </div>
        <p className="text-[13px] text-text-secondary leading-relaxed">
          {analysis.summary}
        </p>
      </div>

      {/* Talk Ratio */}
      <div>
        <p className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-2">
          Talk Ratio
        </p>
        <div className="flex h-2.5 rounded-full overflow-hidden bg-bg-elevated">
          <div
            className="bg-accent rounded-l-full"
            style={{ width: `${analysis.talk_ratio.agent}%` }}
          />
          <div
            className="bg-green rounded-r-full"
            style={{ width: `${analysis.talk_ratio.prospect}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[10px] text-accent font-medium">
            You {analysis.talk_ratio.agent}%
          </span>
          <span className="text-[10px] text-green font-medium">
            Prospect {analysis.talk_ratio.prospect}%
          </span>
        </div>
      </div>

      {/* Topics */}
      <div>
        <p className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-2">
          Key Topics
        </p>
        <div className="flex flex-wrap gap-1.5">
          {analysis.key_topics.map((topic, i) => (
            <span
              key={i}
              className="px-2 py-1 rounded-full bg-bg-elevated border border-border-subtle text-[11px] text-text-secondary"
            >
              {topic}
            </span>
          ))}
        </div>
      </div>

      {/* Coaching */}
      <div>
        <p className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-2">
          Coaching
        </p>
        <ul className="space-y-1.5">
          {analysis.coaching.map((tip, i) => (
            <li
              key={i}
              className="text-[13px] text-text-secondary pl-3 border-l-2 border-accent/40"
            >
              {tip}
            </li>
          ))}
        </ul>
      </div>

      {/* Highlights */}
      {analysis.highlights.length > 0 && (
        <div>
          <p className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-2">
            Notable Quotes
          </p>
          {analysis.highlights.map((h, i) => (
            <p
              key={i}
              className="text-[12px] text-text-tertiary italic pl-3 border-l-2 border-border mb-1.5"
            >
              &ldquo;{h}&rdquo;
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    completed: {
      bg: "bg-green/10 border-green/20",
      text: "text-green",
      label: "Connected",
    },
    missed: {
      bg: "bg-red/10 border-red/20",
      text: "text-red",
      label: "Missed",
    },
    rejected: {
      bg: "bg-red/10 border-red/20",
      text: "text-red",
      label: "Declined",
    },
    voicemail: {
      bg: "bg-amber/10 border-amber/20",
      text: "text-amber",
      label: "Voicemail",
    },
    "no-answer": {
      bg: "bg-text-tertiary/10 border-text-tertiary/20",
      text: "text-text-tertiary",
      label: "No Answer",
    },
  };

  const c = config[status] || config.completed;

  return (
    <span
      className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider shrink-0 ${c.bg} ${c.text}`}
    >
      {c.label}
    </span>
  );
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatCallDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
