"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trophy } from "lucide-react";
import type { LeaderboardBlock, LeaderboardPeriod } from "@/lib/home/dashboard";

interface Props {
  initial: LeaderboardBlock;
  currentUserId: string;
  // Bumped whenever the parent wants us to re-fetch (e.g. realtime ping).
  refreshKey?: number;
}

const PERIODS: LeaderboardPeriod[] = ["today", "week", "month"];

export default function Leaderboard({ initial, currentUserId, refreshKey }: Props) {
  const [period, setPeriod] = useState<LeaderboardPeriod>(initial.period);
  const [block, setBlock] = useState<LeaderboardBlock>(initial);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (p: LeaderboardPeriod) => {
      setLoading(true);
      const res = await fetch(`/api/home/leaderboard?period=${p}`);
      if (res.ok) {
        setBlock(await res.json());
      }
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    // Refresh on external bump (realtime event) if we're not already matching
    // the initial block's period — otherwise parent-provided `initial` will
    // cover us.
    if (refreshKey === undefined || refreshKey === 0) return;
    load(period);
  }, [refreshKey, period, load]);

  const onPick = (p: LeaderboardPeriod) => {
    setPeriod(p);
    load(p);
  };

  const myRow = block.rows.find((r) => r.user_id === currentUserId);
  const myRank = myRow?.rank ?? 0;
  const aheadRow = myRank > 1 ? block.rows[myRank - 2] : null;
  const gap = aheadRow && myRow ? aheadRow.connected_calls - myRow.connected_calls : 0;

  return (
    <div className="bg-paper border-[2.5px] border-navy rounded-[18px] shadow-pop-md overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-navy bg-cream-2">
        <h3 className="text-base font-semibold text-navy font-display">
          Leaderboard
        </h3>
        <div className="flex rounded-full border-2 border-navy overflow-hidden bg-paper">
          {PERIODS.map((p, i) => {
            const active = period === p;
            return (
              <button
                key={p}
                onClick={() => onPick(p)}
                className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  active ? "bg-banana text-navy" : "text-navy/70 hover:text-navy"
                } ${i > 0 ? "border-l border-navy" : ""}`}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>

      <div className="divide-y-2 divide-navy/10 relative">
        {loading && (
          <div className="absolute inset-0 bg-paper/70 flex items-center justify-center z-10">
            <Loader2 size={16} className="animate-spin text-slate" />
          </div>
        )}
        {block.rows.length === 0 ? (
          <p className="px-4 py-6 text-[12px] text-slate text-center">
            No calls in this window yet.
          </p>
        ) : (
          block.rows.slice(0, 8).map((r) => {
            const isMe = r.user_id === currentUserId;
            const tierBg =
              r.rank === 1
                ? "bg-banana"
                : r.rank === 2
                ? "bg-cream-2"
                : r.rank === 3
                ? "bg-cream-3"
                : "bg-paper";
            return (
              <div
                key={r.user_id}
                className={`flex items-center gap-3 px-4 py-2.5 ${tierBg} ${
                  isMe ? "border-l-[4px] border-coral" : ""
                }`}
              >
                <span className="w-6 text-[12px] font-semibold text-coral font-display italic tabular-nums shrink-0">
                  {String(r.rank).padStart(2, "0")}
                </span>
                <span
                  className="w-8 h-8 rounded-full border-2 border-navy flex items-center justify-center text-[11px] font-bold text-navy shrink-0"
                  style={{ background: r.avatar_color }}
                >
                  {r.initials}
                </span>
                <span className="flex-1 text-[13px] font-semibold text-navy truncate">
                  {r.name}
                  {isMe && (
                    <span className="ml-1 text-[10px] text-coral font-bold uppercase tracking-wider">
                      you
                    </span>
                  )}
                </span>
                <span className="text-[13px] font-bold text-navy tabular-nums shrink-0">
                  {r.connected_calls}
                </span>
              </div>
            );
          })
        )}
      </div>

      {myRow && (
        <div className="bg-cream-3 border-t-2 border-navy px-4 py-2 text-[11px] text-navy font-semibold flex items-center gap-1.5">
          {myRank === 1 ? (
            <>
              <Trophy size={12} className="text-banana-deep" />
              You&rsquo;re leading the pack
            </>
          ) : (
            <>
              You&rsquo;re #{myRank}
              {gap > 0 && (
                <>
                  {" "}· {gap} more to pass #{myRank - 1}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
