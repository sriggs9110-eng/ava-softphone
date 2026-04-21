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

  return (
    <div className="bg-paper border-[2.5px] border-navy rounded-[18px] shadow-pop-md p-4">
      <h3 className="text-base font-semibold text-navy font-display mb-1">
        Team on shift
      </h3>
      <p className="text-[11px] text-slate uppercase tracking-wider font-bold mb-3">
        {members.filter((m) => m.status !== "offline").length} online
      </p>
      {members.length === 0 ? (
        <p className="text-[12px] text-slate">Nobody clocked in yet.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {visible.map((m) => {
            const dot = STATUS_DOT[m.status] || STATUS_DOT.offline;
            const clickable = m.status === "on_call" && !!onMemberClick;
            return (
              <button
                key={m.user_id}
                onClick={() => clickable && onMemberClick?.(m.user_id)}
                disabled={!clickable}
                title={`${m.name} · ${dot.label}`}
                className={`relative w-10 h-10 rounded-full border-2 border-navy flex items-center justify-center text-[12px] font-bold text-navy ${
                  clickable ? "cursor-pointer hover:-translate-y-0.5 transition-transform" : "cursor-default"
                }`}
                style={{ background: m.avatar_color }}
              >
                {m.initials}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-navy ${dot.bg}`}
                />
              </button>
            );
          })}
          {overflow > 0 && (
            <div className="w-10 h-10 rounded-full bg-cream-2 border-2 border-navy flex items-center justify-center text-[11px] font-bold text-navy">
              +{overflow}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
