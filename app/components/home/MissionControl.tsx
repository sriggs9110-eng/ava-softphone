"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import TopBar from "./TopBar";
import Leaderboard from "./Leaderboard";
import ActivityRail from "./ActivityRail";
import TeamPresence from "./TeamPresence";
import PepperCorner, { type PepperCornerMode } from "./PepperCorner";
import type { DashboardPayload, ActivityItem } from "@/lib/home/dashboard";

interface Props {
  currentUserId: string;
  currentUserName: string | null;
  isManager: boolean;
  heroMode: PepperCornerMode;
  onRecentlyDialedPick?: (phone: string) => void;
  // Ref for the dial pad input so "Make a call" can focus it on desktop.
  dialPadInputRef?: React.RefObject<HTMLInputElement | null>;
  // Slot for the hero content — DialPad, ActiveCallUI, or PostCallCelebration.
  hero: React.ReactNode;
  // Optional below-hero content (e.g. RecentlyDialed chips).
  belowHero?: React.ReactNode;
}

export default function MissionControl({
  currentUserId,
  isManager,
  heroMode,
  hero,
  belowHero,
  dialPadInputRef,
}: Props) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [leaderboardPing, setLeaderboardPing] = useState(0);
  const pollHandleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    const res = await fetch("/api/home/dashboard");
    if (!res.ok) return;
    const body = (await res.json()) as DashboardPayload;
    setData((prev) => {
      // Detect freshly inserted activity item for fade-in animation
      const prevIds = new Set(prev?.recent_activity.map((a) => a.id) || []);
      const fresh = body.recent_activity.find((a) => !prevIds.has(a.id));
      if (fresh && prev) setLastAddedId(fresh.id);
      return body;
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime on call_logs + voicemails + softphone_users. Any change
  // refreshes the dashboard and bumps the leaderboard ping.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("home-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_logs" },
        () => {
          load();
          setLeaderboardPing((n) => n + 1);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voicemails" },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "softphone_users" },
        () => load()
      )
      .subscribe();

    // Polling fallback — fires every 30s regardless of realtime state.
    pollHandleRef.current = setInterval(load, 30_000);

    return () => {
      supabase.removeChannel(channel);
      if (pollHandleRef.current) clearInterval(pollHandleRef.current);
    };
  }, [load]);

  const handleMonitorAgent = useCallback(
    (userId: string) => {
      if (!isManager) return;
      window.dispatchEvent(
        new CustomEvent("pepper:navigate", {
          detail: { page: "monitor", agentId: userId },
        })
      );
    },
    [isManager]
  );

  // If the initial fetch hasn't landed yet, render a minimal frame so the
  // hero (dial pad) is usable immediately.
  const user = data?.user;
  const stats = data?.today_stats;
  const lastCallScore = useMemo(() => {
    if (!data) return null;
    const first = data.recent_activity.find(
      (a: ActivityItem) => a.kind === "call" && typeof a.ai_score === "number"
    );
    return first?.ai_score ?? null;
  }, [data]);

  return (
    <div className="w-full flex flex-col">
      {user && stats ? (
        <TopBar firstName={user.first_name} stats={stats} />
      ) : (
        <div className="w-full bg-cream-2 border-b-2 border-navy min-h-[72px] flex items-center px-6">
          <Loader2 size={16} className="animate-spin text-slate" />
        </div>
      )}

      <div className="flex-1 w-full px-4 lg:px-6 py-5">
        <div className="grid gap-4 grid-cols-1 min-[900px]:grid-cols-[1fr_340px] min-[1280px]:grid-cols-[280px_1fr_340px]">
          {/* LEFT RAIL — hidden below 1280px */}
          <div className="hidden min-[1280px]:flex flex-col gap-4 w-[280px]">
            {data ? (
              <>
                <Leaderboard
                  initial={data.leaderboard}
                  currentUserId={currentUserId}
                  refreshKey={leaderboardPing}
                />
                <ActivityRail
                  items={data.recent_activity}
                  isManager={isManager}
                  lastAddedId={lastAddedId}
                />
              </>
            ) : (
              <RailSkeleton />
            )}
          </div>

          {/* HERO ZONE — always present; biggest shadow on the page since
              this is where the rep's eye should land. */}
          <div className="flex flex-col min-w-0">
            <div className="w-full bg-paper border-[3px] border-navy rounded-[18px] shadow-pop-lg p-5 flex flex-col items-center justify-center min-h-[420px]">
              {hero}
            </div>
            {belowHero}
          </div>

          {/* RIGHT RAIL — shown above 900px */}
          <div className="hidden min-[900px]:flex flex-col gap-4 w-[340px]">
            {data ? (
              <>
                <PepperCorner
                  mode={heroMode}
                  focusTip={data.todays_focus_tip}
                  lastCallScore={lastCallScore}
                />
                <TeamPresence
                  members={data.team_presence}
                  onMemberClick={isManager ? handleMonitorAgent : undefined}
                />
              </>
            ) : (
              <RailSkeleton />
            )}
          </div>
        </div>

        {/* COMPACT LAYOUT: activity rail stacks below on narrow viewports */}
        <div className="min-[1280px]:hidden mt-4 grid gap-4 grid-cols-1 min-[900px]:grid-cols-2">
          {data ? (
            <>
              <Leaderboard
                initial={data.leaderboard}
                currentUserId={currentUserId}
                refreshKey={leaderboardPing}
              />
              <ActivityRail
                items={data.recent_activity}
                isManager={isManager}
                lastAddedId={lastAddedId}
              />
            </>
          ) : null}
        </div>

        {/* Stacked right rail for <900px viewports */}
        <div className="min-[900px]:hidden mt-4 flex flex-col gap-4">
          {data && (
            <>
              <PepperCorner
                mode={heroMode}
                focusTip={data.todays_focus_tip}
                lastCallScore={lastCallScore}
              />
              <TeamPresence
                members={data.team_presence}
                onMemberClick={isManager ? handleMonitorAgent : undefined}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-6 shadow-pop-md">
        <Loader2 size={16} className="animate-spin text-slate" />
      </div>
      <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-6 shadow-pop-md">
        <Loader2 size={16} className="animate-spin text-slate" />
      </div>
    </div>
  );
}

export function useDashboardMeta() {
  // Light hook for callers who just need { recently_dialed } without
  // re-fetching the whole dashboard — pulls from the same cached endpoint.
  const [recentlyDialed, setRecentlyDialed] = useState<
    DashboardPayload["recently_dialed"]
  >([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/home/dashboard");
      if (!res.ok || cancelled) return;
      const body = (await res.json()) as DashboardPayload;
      setRecentlyDialed(body.recently_dialed);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { recentlyDialed };
}
