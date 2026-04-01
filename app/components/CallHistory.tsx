"use client";

import { CallHistoryEntry } from "@/app/lib/types";

interface CallHistoryProps {
  entries: CallHistoryEntry[];
  onDial: (number: string) => void;
}

export default function CallHistory({ entries, onDial }: CallHistoryProps) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-40">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <p className="text-sm">No call history yet</p>
      </div>
    );
  }

  return (
    <div className="w-full animate-fade-in">
      <h2 className="text-[12px] font-medium text-text-tertiary uppercase tracking-[0.5px] px-1 mb-3">
        Recent Calls
      </h2>
      <div className="space-y-0.5">
        {entries.map((entry) => (
          <button
            key={entry.id}
            onClick={() => onDial(entry.number)}
            className="w-full flex items-center gap-3 px-3 py-3 hover:bg-bg-elevated rounded-lg transition-all duration-150 group"
          >
            {/* Direction icon */}
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                entry.status === "missed" || entry.status === "rejected"
                  ? "bg-red/10 text-red"
                  : entry.direction === "inbound"
                  ? "bg-green/10 text-green"
                  : "bg-accent/10 text-accent"
              }`}
            >
              {entry.direction === "inbound" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="7 17 17 7" />
                  <polyline points="7 7 7 17 17 17" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 7 7 17" />
                  <polyline points="17 17 17 7 7 7" />
                </svg>
              )}
            </div>

            {/* Number and time */}
            <div className="flex-1 text-left min-w-0">
              <p className="text-[14px] font-medium text-text-primary group-hover:text-accent transition-colors truncate">
                {entry.number}
              </p>
              <p className="text-[12px] text-text-tertiary mt-0.5">
                {formatTimestamp(entry.timestamp)}
              </p>
            </div>

            {/* Duration / Status */}
            <div className="text-right shrink-0">
              {entry.status === "missed" ? (
                <span className="text-[11px] font-medium text-red uppercase tracking-wider">
                  Missed
                </span>
              ) : entry.status === "rejected" ? (
                <span className="text-[11px] font-medium text-red uppercase tracking-wider">
                  Declined
                </span>
              ) : (
                <span className="text-[12px] text-text-tertiary tabular-nums">
                  {formatCallDuration(entry.duration)}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function formatCallDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
