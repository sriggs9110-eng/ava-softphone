"use client";

import { CallHistoryEntry } from "@/app/lib/types";

interface CallHistoryProps {
  entries: CallHistoryEntry[];
  onDial: (number: string) => void;
}

export default function CallHistory({ entries, onDial }: CallHistoryProps) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-muted text-sm">
        No call history yet
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <h2 className="text-sm font-medium text-muted uppercase tracking-wide px-4 mb-3">
        Recent Calls
      </h2>
      <div className="space-y-1">
        {entries.map((entry) => (
          <button
            key={entry.id}
            onClick={() => onDial(entry.number)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-card rounded-xl transition-colors group"
          >
            {/* Direction icon */}
            <div
              className={`flex-shrink-0 ${
                entry.status === "missed" || entry.status === "rejected"
                  ? "text-red"
                  : entry.direction === "inbound"
                  ? "text-green"
                  : "text-coral"
              }`}
            >
              {entry.direction === "inbound" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="7 17 17 7" />
                  <polyline points="7 7 7 17 17 17" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 7 7 17" />
                  <polyline points="17 17 17 7 7 7" />
                </svg>
              )}
            </div>

            {/* Number and time */}
            <div className="flex-1 text-left">
              <p className="text-sm text-foreground group-hover:text-coral transition-colors">
                {entry.number}
              </p>
              <p className="text-xs text-muted">
                {formatTimestamp(entry.timestamp)}
              </p>
            </div>

            {/* Duration */}
            <div className="text-xs text-muted">
              {entry.status === "missed"
                ? "Missed"
                : entry.status === "rejected"
                ? "Declined"
                : formatCallDuration(entry.duration)}
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
