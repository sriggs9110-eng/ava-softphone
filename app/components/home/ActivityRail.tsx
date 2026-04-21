"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  PhoneIncoming,
  PhoneOutgoing,
  Voicemail,
} from "lucide-react";
import type { ActivityItem } from "@/lib/home/dashboard";
import { formatUSPhone } from "@/lib/format-phone";

interface Props {
  items: ActivityItem[];
  isManager: boolean;
  // Fired when a call lands in realtime — newest items enter with an animation.
  lastAddedId?: string | null;
}

export default function ActivityRail({ items, lastAddedId }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="bg-paper border-[2.5px] border-navy rounded-[18px] shadow-pop-md">
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-navy bg-cream-2">
        <h3 className="text-base font-semibold text-navy font-display">
          Recent activity
        </h3>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-[12px] text-slate text-center">
          No activity yet — make a call to populate the feed.
        </p>
      ) : (
        <ul className="divide-y-2 divide-navy/10 max-h-[520px] overflow-y-auto">
          {items.map((item) => (
            <ActivityRow
              key={item.id}
              item={item}
              expanded={expanded === item.id}
              fresh={item.id === lastAddedId}
              onToggle={() =>
                setExpanded((cur) => (cur === item.id ? null : item.id))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityRow({
  item,
  expanded,
  onToggle,
  fresh,
}: {
  item: ActivityItem;
  expanded: boolean;
  onToggle: () => void;
  fresh?: boolean;
}) {
  // Prefer contact name if the backend provides one; otherwise the
  // formatted phone. `call_logs` has no contact join today, so this
  // effectively always falls through to the formatter — wired up for when
  // we add a contacts source.
  const label = item.contact_name || formatUSPhone(item.phone_number);
  const sub = formatRelative(item.created_at);
  const scoreBadge = scoreBadgeFor(item.ai_score);

  const Icon =
    item.kind === "voicemail"
      ? Voicemail
      : item.direction === "inbound"
      ? PhoneIncoming
      : PhoneOutgoing;

  return (
    <li className={fresh ? "animate-fade-in" : ""}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-cream-3 transition-colors text-left"
      >
        <span className="w-4 flex-shrink-0">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span
          className={`w-7 h-7 rounded-full border-2 border-navy flex items-center justify-center text-navy flex-shrink-0 ${
            item.kind === "voicemail"
              ? "bg-coral"
              : item.direction === "inbound"
              ? "bg-leaf/20"
              : "bg-banana/30"
          }`}
        >
          <Icon size={12} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold text-navy truncate tabular-nums">
            {label}
          </span>
          <span className="block text-[10px] text-slate tabular-nums">
            {sub} · {formatDur(item.duration_seconds)}
          </span>
        </span>
        {scoreBadge ? (
          <span
            className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full border-[1.5px] border-navy ${scoreBadge.bg}`}
          >
            {scoreBadge.label}
          </span>
        ) : (
          <span className="text-[10px] text-slate">—</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 bg-cream-3 border-t border-navy/10">
          {item.recording_url ? (
            <audio
              controls
              src={item.recording_url}
              className="w-full h-9"
              preload="metadata"
            />
          ) : (
            <p className="text-[11px] text-slate italic">
              {item.kind === "voicemail"
                ? "Voicemail recording pending."
                : "No recording for this call."}
            </p>
          )}
          {item.ai_summary_preview && (
            <p className="text-[12px] text-navy leading-snug">
              {item.ai_summary_preview}
              {item.ai_summary_preview.length >= 200 && <>…</>}
            </p>
          )}
          {item.kind === "call" ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                window.dispatchEvent(
                  new CustomEvent("pepper:navigate", {
                    detail: { page: "history" },
                  })
                );
              }}
              className="text-[11px] font-semibold text-navy underline decoration-coral decoration-2 underline-offset-2"
            >
              Full details →
            </a>
          ) : (
            <a
              href="/voicemails"
              className="text-[11px] font-semibold text-navy underline decoration-coral decoration-2 underline-offset-2"
            >
              Open in voicemails →
            </a>
          )}
        </div>
      )}
    </li>
  );
}

function scoreBadgeFor(
  score: number | null
): { label: string; bg: string } | null {
  if (score === null || typeof score !== "number") return null;
  if (score >= 8) return { label: score.toFixed(1), bg: "bg-leaf text-white" };
  if (score >= 6) return { label: score.toFixed(1), bg: "bg-banana text-navy" };
  return { label: score.toFixed(1), bg: "bg-coral text-white" };
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDur(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, Math.floor(seconds % 60));
  return `${m}:${s.toString().padStart(2, "0")}`;
}
