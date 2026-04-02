"use client";

import { useState, useCallback } from "react";
import {
  PhoneIncoming,
  PhoneOutgoing,
  Play,
  Search,
  TrendingUp,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { CallHistoryEntry, AIAnalysis } from "@/app/lib/types";
import { updateCallLog } from "@/lib/call-logs";

interface CallHistoryPageProps {
  entries: CallHistoryEntry[];
  onDial: (number: string) => void;
  onUpdate: (entries: CallHistoryEntry[]) => void;
  isManager?: boolean;
}

type FilterType = "all" | "inbound" | "outbound";

export default function CallHistoryPage({
  entries,
  onDial,
  onUpdate,
  isManager,
}: CallHistoryPageProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  const filtered = entries.filter((e) => {
    if (filter === "inbound" && e.direction !== "inbound") return false;
    if (filter === "outbound" && e.direction !== "outbound") return false;
    if (search && !e.number.includes(search)) return false;
    return true;
  });

  const handleAnalyze = useCallback(
    async (entry: CallHistoryEntry) => {
      console.log("[AI Analyze] Starting for:", entry.id, "recordingUrl:", entry.recordingUrl);
      setAnalyzingId(entry.id);
      try {
        const res = await fetch("/api/ai/analyze-call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recording_url: entry.recordingUrl,
            call_log_id: entry.id,
            call_metadata: {
              number: entry.number,
              direction: entry.direction,
              duration: entry.duration,
              status: entry.status,
              timestamp: entry.timestamp,
              transcript: entry.transcript
                ?.map((t) => `${t.speaker} [${t.timestamp}]: ${t.text}`)
                .join("\n"),
            },
          }),
        });

        console.log("[AI Analyze] Response status:", res.status);

        if (res.ok) {
          const analysis: AIAnalysis = await res.json();
          console.log("[AI Analyze] Got analysis:", analysis.score);

          await updateCallLog(entry.id, {
            ai_analysis: analysis as unknown as Record<string, unknown>,
            ai_summary: analysis.summary,
            ai_score: analysis.score,
          });

          const updated = entries.map((e) =>
            e.id === entry.id ? { ...e, aiAnalysis: analysis } : e
          );
          onUpdate(updated);
          setExpandedId(entry.id);
        } else {
          console.error("[AI Analyze] Failed:", res.status, await res.text());
        }
      } catch (err) {
        console.error("[AI Analyze] Error:", err);
      } finally {
        setAnalyzingId(null);
      }
    },
    [entries, onUpdate]
  );

  const scoreColor = (score: number) => {
    if (score >= 7) return "bg-green/15 text-green border-green/30";
    if (score >= 4) return "bg-amber/15 text-amber border-amber/30";
    return "bg-red/15 text-red border-red/30";
  };

  const toggleExpand = (id: string) => {
    console.log("[History] toggleExpand:", id, "current:", expandedId, "match:", expandedId === id);
    setExpandedId((prev) => prev === id ? null : id);
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
          {filtered.map((entry) => {
            const isExpanded = expandedId === entry.id;

            return (
              <div key={entry.id} className="rounded-xl overflow-hidden">
                {/* Row — NOT a button, just a flex container with separate click zones */}
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-bg-elevated transition-all duration-150 group">
                  {/* Expand toggle */}
                  <button
                    onClick={() => toggleExpand(entry.id)}
                    className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-secondary shrink-0"
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>

                  {/* Direction icon — clickable to expand */}
                  <button
                    onClick={() => toggleExpand(entry.id)}
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
                  </button>

                  {/* Number + time — clickable to expand */}
                  <button
                    onClick={() => toggleExpand(entry.id)}
                    className="flex-1 text-left min-w-0"
                  >
                    <p className="text-[14px] font-medium text-text-primary group-hover:text-accent transition-colors truncate">
                      {entry.number}
                    </p>
                    <p className="text-[12px] text-text-tertiary mt-0.5">
                      {formatTimestamp(entry.timestamp)}
                    </p>
                  </button>

                  {/* Duration */}
                  <span className="text-[12px] text-text-tertiary tabular-nums shrink-0">
                    {formatCallDuration(entry.duration)}
                  </span>

                  {/* Status */}
                  <StatusBadge status={entry.status} />

                  {/* Recording indicator */}
                  {entry.recordingUrl && (
                    <button
                      onClick={() => toggleExpand(entry.id)}
                      className="w-7 h-7 rounded-full bg-bg-elevated hover:bg-bg-hover flex items-center justify-center text-text-secondary transition-colors"
                      title="Has recording — click to expand"
                    >
                      <Play size={12} />
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

                  {/* Analyze button — completely separate, no parent button */}
                  {!entry.aiAnalysis && (
                    <button
                      onClick={() => handleAnalyze(entry)}
                      disabled={analyzingId === entry.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-bg-elevated hover:bg-bg-hover text-text-tertiary hover:text-accent text-[11px] font-medium transition-colors disabled:opacity-50"
                    >
                      {analyzingId === entry.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <TrendingUp size={12} />
                      )}
                      AI
                    </button>
                  )}
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="ml-14 mr-4 mb-3 p-4 bg-bg-surface border border-border-subtle rounded-xl animate-fade-in space-y-4">
                    {/* Recording player */}
                    {entry.recordingUrl && (
                      <div className="p-3 bg-bg-elevated rounded-lg space-y-2">
                        <audio
                          controls
                          src={entry.recordingUrl}
                          className="w-full h-8 [&::-webkit-media-controls-panel]:bg-bg-elevated"
                          preload="metadata"
                        />
                        <p className="text-[10px] text-text-tertiary truncate">
                          {entry.recordingUrl}
                        </p>
                      </div>
                    )}

                    {/* AI Analysis */}
                    {entry.aiAnalysis ? (
                      <AIAnalysisView analysis={entry.aiAnalysis} />
                    ) : (
                      <div className="space-y-2">
                        {!entry.recordingUrl && entry.status === "completed" && (
                          <p className="text-[12px] text-amber px-1">
                            Recording not available yet. It may take up to 60 seconds after the call ends.
                          </p>
                        )}
                        <button
                          onClick={() => handleAnalyze(entry)}
                          disabled={analyzingId === entry.id}
                          className="w-full py-3 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all duration-150 disabled:opacity-50 flex items-center justify-center gap-2 min-h-[44px]"
                        >
                          {analyzingId === entry.id ? (
                            <>
                              <Loader2 size={16} className="animate-spin" />
                              {entry.recordingUrl ? "Transcribing & Analyzing..." : "Analyzing..."}
                            </>
                          ) : (
                            <>
                              <TrendingUp size={16} />
                              {entry.recordingUrl ? "Transcribe & Analyze with AI" : "Analyze with AI (metadata only)"}
                            </>
                          )}
                        </button>
                      </div>
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
            );
          })}
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
