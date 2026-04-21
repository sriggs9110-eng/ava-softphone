// Shared aggregation for the mission-control homepage.
//
// Two endpoints consume it:
//   - /api/home/dashboard   — full payload on page load
//   - /api/home/leaderboard — just the leaderboard block on period toggle
//
// All queries are parallelized with Promise.all and return the minimal
// columns they need. In-JS aggregation is cheap for the row counts we
// see here (a few hundred per day); we'd swap to SQL aggregates past 10k
// rows per window.

import type { SupabaseClient } from "@supabase/supabase-js";

export type LeaderboardPeriod = "today" | "week" | "month";

export interface DashboardPayload {
  user: {
    id: string;
    name: string;
    first_name: string;
    role: string;
    initials: string;
  };
  today_stats: {
    calls_total: number;
    calls_answered: number;
    answer_rate: number;
    avg_score: number;
    calls_total_prev: number;
    answer_rate_prev: number;
    avg_score_prev: number;
  };
  leaderboard: LeaderboardBlock;
  recent_activity: ActivityItem[];
  recently_dialed: Array<{
    phone_number: string;
    contact_name: string | null;
    last_called_at: string;
  }>;
  team_presence: Array<{
    user_id: string;
    name: string;
    initials: string;
    avatar_color: string;
    status: string;
  }>;
  todays_focus_tip: string | null;
}

export interface LeaderboardBlock {
  period: LeaderboardPeriod;
  rows: Array<{
    user_id: string;
    name: string;
    initials: string;
    avatar_color: string;
    connected_calls: number;
    total_calls: number;
    rank: number;
  }>;
}

export type ActivityItem = {
  id: string;
  kind: "call" | "voicemail";
  contact_name: string | null;
  phone_number: string;
  direction: "inbound" | "outbound" | null;
  duration_seconds: number;
  ai_score: number | null;
  ai_summary_preview: string | null;
  recording_url: string | null;
  recording_id: string | null;
  transcript_status: string | null;
  ai_status: string | null;
  created_at: string;
};

const CONNECTED = new Set(["completed", "connected"]);

function firstNameOf(full: string): string {
  return (full || "").trim().split(/\s+/)[0] || full || "there";
}

function initialsOf(full: string): string {
  if (!full) return "?";
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColorFor(role: string): string {
  return role === "admin"
    ? "#FFCE3A"
    : role === "manager"
    ? "#2FB67C"
    : "#FFEEC9";
}

function periodWindow(period: LeaderboardPeriod, now = new Date()) {
  const end = now;
  const start = new Date(now);
  if (period === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (period === "week") {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(now.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

export async function fetchLeaderboard(
  admin: SupabaseClient,
  period: LeaderboardPeriod
): Promise<LeaderboardBlock> {
  const { start, end } = periodWindow(period);
  const [{ data: rows }, { data: users }] = await Promise.all([
    admin
      .from("call_logs")
      .select("user_id, status")
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString()),
    admin.from("softphone_users").select("id, full_name, role"),
  ]);

  const byUser = new Map<string, { connected: number; total: number }>();
  for (const r of (rows || []) as Array<{ user_id: string | null; status: string | null }>) {
    if (!r.user_id) continue;
    const rec = byUser.get(r.user_id) || { connected: 0, total: 0 };
    rec.total += 1;
    if (CONNECTED.has(r.status || "")) rec.connected += 1;
    byUser.set(r.user_id, rec);
  }

  const userList = (users || []) as Array<{
    id: string;
    full_name: string;
    role: string;
  }>;

  const populated = userList
    .map((u) => {
      const rec = byUser.get(u.id) || { connected: 0, total: 0 };
      return {
        user_id: u.id,
        name: u.full_name,
        initials: initialsOf(u.full_name),
        avatar_color: avatarColorFor(u.role),
        connected_calls: rec.connected,
        total_calls: rec.total,
        rank: 0,
      };
    })
    .sort((a, b) => {
      if (b.connected_calls !== a.connected_calls) {
        return b.connected_calls - a.connected_calls;
      }
      return b.total_calls - a.total_calls;
    })
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return { period, rows: populated };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export async function fetchDashboard(
  admin: SupabaseClient,
  opts: { userId: string }
): Promise<DashboardPayload> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = now;
  const yesterdayEnd = new Date(todayStart.getTime() - 1);
  const yesterdayStart = new Date(yesterdayEnd);
  yesterdayStart.setHours(0, 0, 0, 0);

  const [
    userRes,
    todayCallsRes,
    yesterdayCallsRes,
    leaderboard,
    activityRes,
    voicemailsRes,
    dialedRes,
    teamRes,
    lastCoachingRes,
  ] = await Promise.all([
    admin
      .from("softphone_users")
      .select("id, full_name, role")
      .eq("id", opts.userId)
      .single(),
    admin
      .from("call_logs")
      .select("status, duration_seconds, ai_score, talk_ratio_rep, question_count, interruption_count")
      .eq("user_id", opts.userId)
      .gte("created_at", todayStart.toISOString())
      .lte("created_at", todayEnd.toISOString()),
    admin
      .from("call_logs")
      .select("status, ai_score")
      .eq("user_id", opts.userId)
      .gte("created_at", yesterdayStart.toISOString())
      .lte("created_at", yesterdayEnd.toISOString()),
    fetchLeaderboard(admin, "today"),
    admin
      .from("call_logs")
      .select(
        "id, phone_number, direction, duration_seconds, ai_score, ai_summary, recording_url, recording_id, transcript_status, ai_status, created_at"
      )
      .eq("user_id", opts.userId)
      .order("created_at", { ascending: false })
      .limit(30),
    admin
      .from("voicemails")
      .select(
        "id, caller_number, called_number, recording_url, recording_telnyx_id, duration_seconds, transcript_status, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("call_logs")
      .select("phone_number, created_at")
      .eq("user_id", opts.userId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(50),
    admin.from("softphone_users").select("id, full_name, role, status"),
    admin
      .from("call_logs")
      .select("ai_analysis, talk_ratio_rep, question_count")
      .eq("user_id", opts.userId)
      .not("ai_analysis", "is", null)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const userRow = userRes.data as {
    id: string;
    full_name: string;
    role: string;
  } | null;
  const fullName = userRow?.full_name || "User";

  // Today stats
  const today = (todayCallsRes.data || []) as Array<{
    status: string | null;
    duration_seconds: number | null;
    ai_score: number | null;
    talk_ratio_rep: number | null;
    question_count: number | null;
    interruption_count: number | null;
  }>;
  const yesterday = (yesterdayCallsRes.data || []) as Array<{
    status: string | null;
    ai_score: number | null;
  }>;

  const callsTotal = today.length;
  const callsAnswered = today.filter((c) => CONNECTED.has(c.status || "")).length;
  const answerRate =
    callsTotal > 0 ? Math.round((callsAnswered / callsTotal) * 1000) / 10 : 0;
  const scoredToday = today.filter((c) => typeof c.ai_score === "number");
  const avgScore =
    scoredToday.length > 0
      ? Math.round(
          (scoredToday.reduce((a, c) => a + (c.ai_score as number), 0) /
            scoredToday.length) *
            100
        ) / 100
      : 0;

  const callsTotalPrev = yesterday.length;
  const answeredPrev = yesterday.filter((c) => CONNECTED.has(c.status || "")).length;
  const answerRatePrev =
    callsTotalPrev > 0
      ? Math.round((answeredPrev / callsTotalPrev) * 1000) / 10
      : 0;
  const scoredPrev = yesterday.filter((c) => typeof c.ai_score === "number");
  const avgScorePrev =
    scoredPrev.length > 0
      ? Math.round(
          (scoredPrev.reduce((a, c) => a + (c.ai_score as number), 0) /
            scoredPrev.length) *
            100
        ) / 100
      : 0;

  // Recent activity — calls + voicemails merged, sorted by time desc, trim to 30
  const callItems: ActivityItem[] = (
    (activityRes.data || []) as Array<{
      id: string;
      phone_number: string;
      direction: string;
      duration_seconds: number | null;
      ai_score: number | null;
      ai_summary: string | null;
      recording_url: string | null;
      recording_id: string | null;
      transcript_status: string | null;
      ai_status: string | null;
      created_at: string;
    }>
  ).map((r) => ({
    id: r.id,
    kind: "call",
    contact_name: null,
    phone_number: r.phone_number,
    direction: (r.direction as "inbound" | "outbound") ?? null,
    duration_seconds: r.duration_seconds ?? 0,
    ai_score: r.ai_score ?? null,
    ai_summary_preview: r.ai_summary ? r.ai_summary.slice(0, 200) : null,
    recording_url: r.recording_url,
    recording_id: r.recording_id,
    transcript_status: r.transcript_status,
    ai_status: r.ai_status,
    created_at: r.created_at,
  }));

  const vmItems: ActivityItem[] = (
    (voicemailsRes.data || []) as Array<{
      id: string;
      caller_number: string;
      duration_seconds: number | null;
      recording_url: string | null;
      recording_telnyx_id: string | null;
      transcript_status: string | null;
      created_at: string;
    }>
  ).map((v) => ({
    id: v.id,
    kind: "voicemail",
    contact_name: null,
    phone_number: v.caller_number,
    direction: "inbound",
    duration_seconds: v.duration_seconds ?? 0,
    ai_score: null,
    ai_summary_preview: null,
    recording_url: v.recording_url,
    recording_id: v.recording_telnyx_id,
    transcript_status: v.transcript_status,
    ai_status: null,
    created_at: v.created_at,
  }));

  const recentActivity = [...callItems, ...vmItems]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 30);

  // Recently dialed — distinct outbound numbers from last 50
  const seen = new Set<string>();
  const recentlyDialed: Array<{
    phone_number: string;
    contact_name: string | null;
    last_called_at: string;
  }> = [];
  for (const r of (dialedRes.data || []) as Array<{
    phone_number: string;
    created_at: string;
  }>) {
    if (seen.has(r.phone_number)) continue;
    seen.add(r.phone_number);
    recentlyDialed.push({
      phone_number: r.phone_number,
      contact_name: null,
      last_called_at: r.created_at,
    });
    if (recentlyDialed.length >= 5) break;
  }

  // Team presence
  const teamPresence = ((teamRes.data || []) as Array<{
    id: string;
    full_name: string;
    role: string;
    status: string;
  }>).map((u) => ({
    user_id: u.id,
    name: u.full_name,
    initials: initialsOf(u.full_name),
    avatar_color: avatarColorFor(u.role),
    status: u.status || "offline",
  }));

  // Today's focus tip — simple heuristic on recent talk/question patterns;
  // falls back to the first coaching tip from the most-recent analyzed call.
  const focusTip = (() => {
    const allTalk = today
      .filter((c): c is typeof c & { talk_ratio_rep: number } => typeof c.talk_ratio_rep === "number")
      .map((c) => c.talk_ratio_rep);
    const allQ = today
      .filter((c): c is typeof c & { question_count: number } => typeof c.question_count === "number")
      .map((c) => c.question_count);
    if (allTalk.length >= 2) {
      const avg = Math.round(
        allTalk.reduce((a, n) => a + n, 0) / allTalk.length
      );
      if (avg > 60) {
        return `You've been running about ${avg}% talk ratio. Aim closer to 50/50 today.`;
      }
      if (avg < 35) {
        return `Talk ratio averaged ${avg}% — lead the conversation a bit more today.`;
      }
    }
    if (allQ.length >= 2) {
      const m = median(allQ);
      if (m < 5) {
        return `You asked ~${m} question${m === 1 ? "" : "s"} per call. Ask more today — the good ones land 8–12.`;
      }
    }
    // Fallback to the most recent coaching tip
    const lastAnalysis = (lastCoachingRes.data || []) as Array<{
      ai_analysis: Record<string, unknown> | null;
    }>;
    for (const r of lastAnalysis) {
      const coaching = r.ai_analysis?.coaching;
      if (Array.isArray(coaching) && coaching.length > 0) {
        const tip = coaching[0];
        if (typeof tip === "string") return tip;
      }
    }
    return null;
  })();

  return {
    user: {
      id: opts.userId,
      name: fullName,
      first_name: firstNameOf(fullName),
      role: userRow?.role || "agent",
      initials: initialsOf(fullName),
    },
    today_stats: {
      calls_total: callsTotal,
      calls_answered: callsAnswered,
      answer_rate: answerRate,
      avg_score: avgScore,
      calls_total_prev: callsTotalPrev,
      answer_rate_prev: answerRatePrev,
      avg_score_prev: avgScorePrev,
    },
    leaderboard,
    recent_activity: recentActivity,
    recently_dialed: recentlyDialed,
    team_presence: teamPresence,
    todays_focus_tip: focusTip,
  };
}
