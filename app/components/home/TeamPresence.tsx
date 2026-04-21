"use client";

interface Props {
  members: Array<{
    user_id: string;
    name: string;
    initials: string;
    avatar_color: string;
    status: string;
  }>;
  onMemberClick?: (userId: string) => void;
}

const STATUS_DOT: Record<string, { bg: string; label: string }> = {
  available: { bg: "bg-leaf", label: "Available" },
  on_call: { bg: "bg-banana", label: "On call" },
  after_call_work: { bg: "bg-slate-2", label: "ACW" },
  dnd: { bg: "bg-coral", label: "Do not disturb" },
  offline: { bg: "bg-slate-2/40", label: "Offline" },
};

export default function TeamPresence({ members, onMemberClick }: Props) {
  const visible = members.slice(0, 8);
  const overflow = members.length - visible.length;

  const counts = members.reduce<Record<string, number>>((acc, m) => {
    const bucket =
      m.status === "available"
        ? "available"
        : m.status === "on_call"
        ? "on_call"
        : m.status === "dnd"
        ? "dnd"
        : "offline";
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
  const summary = [
    counts.available ? `${counts.available} available` : null,
    counts.on_call ? `${counts.on_call} on call` : null,
    counts.dnd ? `${counts.dnd} DND` : null,
    counts.offline ? `${counts.offline} offline` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="bg-paper border-[2.5px] border-navy rounded-[18px] shadow-pop-md px-4 py-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-base font-semibold text-navy font-display">
          Team on shift
        </h3>
        {summary && (
          <span className="text-[10px] text-slate uppercase tracking-wider font-bold truncate">
            {summary}
          </span>
        )}
      </div>
      {members.length === 0 ? (
        <p className="text-[12px] text-slate">Nobody clocked in yet.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {visible.map((m) => {
            const dot = STATUS_DOT[m.status] || STATUS_DOT.offline;
            const clickable = m.status === "on_call" && !!onMemberClick;
            return (
              <button
                key={m.user_id}
                onClick={() => clickable && onMemberClick?.(m.user_id)}
                disabled={!clickable}
                title={`${m.name} · ${dot.label}`}
                className={`relative w-8 h-8 rounded-full border-2 border-navy flex items-center justify-center text-[11px] font-bold text-navy ${
                  clickable ? "cursor-pointer hover:-translate-y-0.5 transition-transform" : "cursor-default"
                }`}
                style={{ background: m.avatar_color }}
              >
                {m.initials}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-navy ${dot.bg}`}
                />
              </button>
            );
          })}
          {overflow > 0 && (
            <div className="w-8 h-8 rounded-full bg-cream-2 border-2 border-navy flex items-center justify-center text-[10px] font-bold text-navy">
              +{overflow}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
