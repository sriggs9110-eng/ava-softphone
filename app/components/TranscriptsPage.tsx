"use client";

import { useState, useMemo } from "react";
import {
  Search,
  FileText,
  PhoneIncoming,
  PhoneOutgoing,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { CallHistoryEntry, AIAnalysis } from "@/app/lib/types";

interface TranscriptsPageProps {
  entries: CallHistoryEntry[];
}

export default function TranscriptsPage({ entries }: TranscriptsPageProps) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Show entries that have transcripts OR AI analysis
  const analyzedEntries = useMemo(
    () =>
      entries.filter(
        (e) =>
          (e.transcript && e.transcript.length > 0) || e.aiAnalysis
      ),
    [entries]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return analyzedEntries;
    const q = search.toLowerCase();
    return analyzedEntries.filter((e) => {
      if (e.number.includes(q)) return true;
      if (e.aiAnalysis?.summary.toLowerCase().includes(q)) return true;
      if (e.transcript?.some((t) => t.text.toLowerCase().includes(q)))
        return true;
      if (e.aiAnalysis?.key_topics.some((t) => t.toLowerCase().includes(q)))
        return true;
      if (e.aiAnalysis?.coaching.some((t) => t.toLowerCase().includes(q)))
        return true;
      return false;
    });
  }, [search, analyzedEntries]);

  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const regex = new RegExp(
      `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi"
    );
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark
          key={i}
          className="bg-accent/30 text-text-primary rounded px-0.5"
        >
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  if (analyzedEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-tertiary animate-fade-in">
        <FileText size={40} className="mb-3 opacity-30" />
        <p className="text-sm text-center max-w-xs">
          No analyzed calls yet. Use the AI button on the History page to
          analyze calls, then view results here.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full animate-fade-in">
      {/* Search */}
      <div className="relative max-w-lg mb-6">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
        />
        <input
          type="text"
          placeholder="Search transcripts & analysis..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 text-sm bg-bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-text-tertiary text-sm">
          No matching results
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => {
            const isExpanded = expandedId === entry.id;
            const hasTranscript =
              entry.transcript && entry.transcript.length > 0;
            const hasAnalysis = !!entry.aiAnalysis;

            const scoreColor = entry.aiAnalysis
              ? entry.aiAnalysis.score >= 7
                ? "bg-green/15 text-green border-green/30"
                : entry.aiAnalysis.score >= 4
                ? "bg-amber/15 text-amber border-amber/30"
                : "bg-red/15 text-red border-red/30"
              : "";

            return (
              <div key={entry.id} className="rounded-xl overflow-hidden">
                {/* Row */}
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-bg-elevated transition-all duration-150">
                  {/* Expand toggle */}
                  <button
                    onClick={() =>
                      setExpandedId(isExpanded ? null : entry.id)
                    }
                    className="w-5 h-5 flex items-center justify-center text-text-tertiary hover:text-text-secondary shrink-0"
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </button>

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

                  {/* Number + date — click to expand */}
                  <button
                    onClick={() =>
                      setExpandedId(isExpanded ? null : entry.id)
                    }
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-medium text-text-primary">
                        {entry.number}
                      </p>
                      {hasAnalysis && (
                        <span
                          className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${scoreColor}`}
                        >
                          {entry.aiAnalysis!.score}/10
                        </span>
                      )}
                      {hasTranscript && (
                        <span className="px-2 py-0.5 rounded-full border border-accent/30 bg-accent/10 text-accent text-[10px] font-semibold">
                          Transcript
                        </span>
                      )}
                      {hasAnalysis && !hasTranscript && (
                        <span className="px-2 py-0.5 rounded-full border border-text-tertiary/30 bg-text-tertiary/10 text-text-tertiary text-[10px] font-semibold">
                          Estimated
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-text-tertiary mt-0.5">
                      {new Date(entry.timestamp).toLocaleDateString()}{" "}
                      &middot; {formatDuration(entry.duration)}
                    </p>
                  </button>

                  {/* AI Summary preview */}
                  {hasAnalysis && (
                    <p className="text-[11px] text-text-tertiary max-w-[250px] truncate hidden lg:block">
                      {entry.aiAnalysis!.summary}
                    </p>
                  )}
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="ml-14 mr-4 mb-3 space-y-4 animate-fade-in">
                    {/* AI Analysis */}
                    {hasAnalysis && (
                      <div className="p-4 bg-bg-surface border border-border-subtle rounded-xl space-y-4">
                        {/* Score + Summary */}
                        <div className="flex items-start gap-3">
                          <div
                            className={`px-3 py-1.5 rounded-full border text-sm font-bold shrink-0 ${scoreColor}`}
                          >
                            {entry.aiAnalysis!.score}/10
                          </div>
                          <p className="text-[13px] text-text-secondary leading-relaxed">
                            {highlightText(
                              entry.aiAnalysis!.summary,
                              search
                            )}
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
                              style={{
                                width: `${entry.aiAnalysis!.talk_ratio.agent}%`,
                              }}
                            />
                            <div
                              className="bg-green rounded-r-full"
                              style={{
                                width: `${entry.aiAnalysis!.talk_ratio.prospect}%`,
                              }}
                            />
                          </div>
                          <div className="flex justify-between mt-1.5">
                            <span className="text-[10px] text-accent font-medium">
                              Agent{" "}
                              {entry.aiAnalysis!.talk_ratio.agent}%
                            </span>
                            <span className="text-[10px] text-green font-medium">
                              Prospect{" "}
                              {entry.aiAnalysis!.talk_ratio.prospect}%
                            </span>
                          </div>
                        </div>

                        {/* Key Topics */}
                        <div>
                          <p className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-2">
                            Key Topics
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {entry.aiAnalysis!.key_topics.map(
                              (topic, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-1 rounded-full bg-bg-elevated border border-border-subtle text-[11px] text-text-secondary"
                                >
                                  {highlightText(topic, search)}
                                </span>
                              )
                            )}
                          </div>
                        </div>

                        {/* Coaching */}
                        <div>
                          <p className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-2">
                            Coaching
                          </p>
                          <ul className="space-y-1.5">
                            {entry.aiAnalysis!.coaching.map(
                              (tip, i) => (
                                <li
                                  key={i}
                                  className="text-[13px] text-text-secondary pl-3 border-l-2 border-accent/40"
                                >
                                  {highlightText(tip, search)}
                                </li>
                              )
                            )}
                          </ul>
                        </div>

                        {/* Sentiment */}
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium">
                            Sentiment:
                          </span>
                          <span
                            className={`text-[12px] font-semibold capitalize ${
                              entry.aiAnalysis!.sentiment === "positive"
                                ? "text-green"
                                : entry.aiAnalysis!.sentiment ===
                                  "negative"
                                ? "text-red"
                                : "text-text-secondary"
                            }`}
                          >
                            {entry.aiAnalysis!.sentiment}
                          </span>
                        </div>

                        {/* Highlights */}
                        {entry.aiAnalysis!.highlights.length > 0 && (
                          <div>
                            <p className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-2">
                              Notable Quotes
                            </p>
                            {entry.aiAnalysis!.highlights.map(
                              (h, i) => (
                                <p
                                  key={i}
                                  className="text-[12px] text-text-tertiary italic pl-3 border-l-2 border-border mb-1.5"
                                >
                                  &ldquo;{h}&rdquo;
                                </p>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Transcript */}
                    {hasTranscript && (
                      <div className="p-4 bg-bg-surface border border-border-subtle rounded-xl">
                        <p className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium mb-3">
                          Transcript
                        </p>
                        <div className="space-y-3">
                          {entry.transcript!.map((line, i) => (
                            <div key={i} className="flex gap-3">
                              <span className="text-[10px] text-text-tertiary tabular-nums shrink-0 pt-0.5 w-10">
                                {line.timestamp}
                              </span>
                              <div>
                                <span
                                  className={`text-[11px] font-semibold uppercase tracking-wider ${
                                    line.speaker === "Agent"
                                      ? "text-accent"
                                      : "text-green"
                                  }`}
                                >
                                  {line.speaker}
                                </span>
                                <p className="text-[13px] text-text-secondary mt-0.5 leading-relaxed">
                                  {highlightText(line.text, search)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* No transcript note for analysis-only entries */}
                    {!hasTranscript && hasAnalysis && (
                      <p className="text-[11px] text-text-tertiary italic px-4">
                        Analysis estimated from call metadata. Audio
                        transcription will be available when recording is
                        processed.
                      </p>
                    )}
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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
