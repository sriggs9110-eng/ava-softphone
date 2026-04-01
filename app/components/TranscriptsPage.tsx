"use client";

import { useState, useMemo } from "react";
import { Search, FileText } from "lucide-react";
import { CallHistoryEntry } from "@/app/lib/types";

interface TranscriptsPageProps {
  entries: CallHistoryEntry[];
}

export default function TranscriptsPage({ entries }: TranscriptsPageProps) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Only show entries that have transcripts or AI analysis
  const transcribedEntries = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.transcript && e.transcript.length > 0 || e.aiAnalysis
      ),
    [entries]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return transcribedEntries;
    const q = search.toLowerCase();
    return transcribedEntries.filter((e) => {
      if (e.number.includes(q)) return true;
      if (e.aiAnalysis?.summary.toLowerCase().includes(q)) return true;
      if (
        e.transcript?.some((t) => t.text.toLowerCase().includes(q))
      )
        return true;
      if (
        e.aiAnalysis?.key_topics.some((t) =>
          t.toLowerCase().includes(q)
        )
      )
        return true;
      return false;
    });
  }, [search, transcribedEntries]);

  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-accent/30 text-text-primary rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  if (transcribedEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-text-tertiary animate-fade-in">
        <FileText size={40} className="mb-3 opacity-30" />
        <p className="text-sm text-center max-w-xs">
          No transcripts yet. Analyze calls from the History page to see
          transcripts here.
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
          placeholder="Search all transcripts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 text-sm bg-bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-text-tertiary text-sm">
          No matching transcripts
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => {
            const scoreColor = entry.aiAnalysis
              ? entry.aiAnalysis.score >= 7
                ? "bg-green/15 text-green border-green/30"
                : entry.aiAnalysis.score >= 4
                ? "bg-amber/15 text-amber border-amber/30"
                : "bg-red/15 text-red border-red/30"
              : "";

            // Find matching transcript lines for preview
            const matchingLines = search.trim()
              ? entry.transcript
                  ?.filter((t) =>
                    t.text.toLowerCase().includes(search.toLowerCase())
                  )
                  .slice(0, 3)
              : entry.transcript?.slice(0, 2);

            return (
              <div key={entry.id}>
                <button
                  onClick={() =>
                    setExpandedId(
                      expandedId === entry.id ? null : entry.id
                    )
                  }
                  className="w-full text-left px-4 py-3 hover:bg-bg-elevated rounded-xl transition-all duration-150 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-medium text-text-primary">
                          {entry.number}
                        </p>
                        {entry.aiAnalysis && (
                          <span
                            className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${scoreColor}`}
                          >
                            {entry.aiAnalysis.score}/10
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-text-tertiary mt-0.5">
                        {new Date(entry.timestamp).toLocaleDateString()} &middot;{" "}
                        {formatDuration(entry.duration)}
                      </p>
                    </div>
                  </div>

                  {/* Preview */}
                  {matchingLines && matchingLines.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {matchingLines.map((line, i) => (
                        <p
                          key={i}
                          className="text-[12px] text-text-tertiary truncate"
                        >
                          <span className="text-text-secondary font-medium">
                            {line.speaker}:
                          </span>{" "}
                          {highlightText(line.text, search)}
                        </p>
                      ))}
                    </div>
                  )}
                </button>

                {/* Expanded transcript */}
                {expandedId === entry.id && entry.transcript && (
                  <div className="ml-4 mr-4 mb-3 p-4 bg-bg-surface border border-border-subtle rounded-xl animate-fade-in">
                    <div className="space-y-3">
                      {entry.transcript.map((line, i) => (
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
