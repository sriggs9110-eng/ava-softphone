import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

type Period = "today" | "week" | "month" | "quarter" | "all";

export interface ReportsResponse {
  scope: {
    period: Period;
    period_start: string;
    period_end: string;
    agent_id: string;
    agent_name?: string;
    role: "agent" | "manager" | "admin";
  };
  volume: {
    total_calls: number;
    inbound: number;
    outbound: number;
    missed: number;
    connected: number;
    voicemail: number;
    answer_rate: number;
    vs_previous_period: {
      total_calls: number;
      connected: number;
      answer_rate: number;
    };
  };
  time: {
    total_talk_seconds: number;
    avg_call_seconds: number;
    median_call_seconds: number;
    longest_call_seconds: number;
    total_talk_seconds_prev: number;
  };
  coaching: {
    avg_ai_score: number;
    avg_talk_ratio_rep: number;
    avg_question_count: number;
    avg_longest_monologue: number;
    avg_interruption_count: number;
    top_objections: Array<{ tag: string; count: number; pct_of_calls: number }>;
    top_topics: Array<{ tag: string; count: number }>;
    score_trend: Array<{ date: string; score: number; call_count: number }>;
  };
  outcomes: {
    calls_scored_7_plus: number;
    calls_scored_below_5: number;
    quality_call_rate: number;
  };
  operational: {
    local_presence: {
      matched_area_code_calls: number;
      matched_answer_rate: number;
      unmatched_area_code_calls: number;
      unmatched_answer_rate: number;
      lift: number;
    };
    ring_groups: Array<{
      id: string;
      name: string;
      inbound_calls: number;
      answered: number;
      answer_rate: number;
      avg_time_to_answer_sec: number;
      missed: number;
    }>;
  };
  heatmap: { data: number[][] };
  by_agent:
    | Array<{
        user_id: string;
        name: string;
        avatar_color: string;
        total_calls: number;
        connected: number;
        answer_rate: number;
        total_talk_seconds: number;
        avg_ai_score: number;
        avg_talk_ratio_rep: number;
        avg_question_count: number;
        closes: number;
        trend: "up" | "flat" | "down";
      }>
    | null;
}

// 60s in-memory cache keyed on role/agent/period.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; body: ReportsResponse }>();

type Role = "agent" | "manager" | "admin";

function computeWindow(
  period: Period,
  now = new Date()
): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
  const end = now;
  let start: Date;
  switch (period) {
    case "today": {
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case "week": {
      start = new Date(now);
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case "month": {
      start = new Date(now);
      start.setDate(now.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case "quarter": {
      start = new Date(now);
      start.setDate(now.getDate() - 89);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case "all":
      // 2 years back is "all" for this purpose — keeps queries bounded.
      start = new Date(now);
      start.setFullYear(now.getFullYear() - 2);
      break;
  }
  const msWindow = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(start.getTime() - msWindow);
  return { start, end, prevStart, prevEnd };
}

function pctDelta(current: number, prev: number): number {
  if (prev === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - prev) / prev) * 1000) / 10;
}

type CallRow = {
  id: string;
  user_id: string | null;
  direction: string | null;
  status: string | null;
  duration_seconds: number | null;
  ai_score: number | null;
  talk_ratio_rep: number | null;
  question_count: number | null;
  longest_monologue_sec: number | null;
  interruption_count: number | null;
  objection_tags: string[] | null;
  topic_tags: string[] | null;
  matched_area_code: boolean | null;
  created_at: string;
};

const SCOPED_COLS =
  "id, user_id, direction, status, duration_seconds, ai_score, talk_ratio_rep, question_count, longest_monologue_sec, interruption_count, objection_tags, topic_tags, matched_area_code, created_at";

async function fetchRowsInWindow(
  admin: SupabaseClient,
  userFilter: string | null,
  start: Date,
  end: Date
): Promise<CallRow[]> {
  let q = admin
    .from("call_logs")
    .select(SCOPED_COLS)
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());
  if (userFilter) q = q.eq("user_id", userFilter);
  const { data, error } = await q;
  if (error) {
    console.error("[reports] fetchRowsInWindow error:", error.message);
    return [];
  }
  return (data || []) as CallRow[];
}

const CONNECTED_STATUSES = new Set(["completed", "connected"]);
const MISSED_STATUSES = new Set(["missed", "no_answer", "no-answer"]);

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function aggregate(rows: CallRow[]) {
  let total = 0;
  let inbound = 0;
  let outbound = 0;
  let missed = 0;
  let connected = 0;
  let voicemail = 0;
  let totalTalk = 0;
  let longest = 0;
  const durations: number[] = [];

  let scoreSum = 0;
  let scoreCount = 0;
  let talkRatioSum = 0;
  let talkRatioCount = 0;
  let questionSum = 0;
  let questionCount = 0;
  let monologueSum = 0;
  let monologueCount = 0;
  let interruptionSum = 0;
  let interruptionCount = 0;
  let scored7Plus = 0;
  let scoredBelow5 = 0;

  const objectionCounts: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};

  let matchedTotal = 0;
  let matchedConnected = 0;
  let unmatchedTotal = 0;
  let unmatchedConnected = 0;

  for (const r of rows) {
    total += 1;
    if (r.direction === "inbound") inbound += 1;
    if (r.direction === "outbound") outbound += 1;
    const status = r.status || "";
    if (MISSED_STATUSES.has(status)) missed += 1;
    if (CONNECTED_STATUSES.has(status)) connected += 1;
    if (status === "voicemail") voicemail += 1;

    const d = r.duration_seconds ?? 0;
    totalTalk += d;
    if (d > longest) longest = d;
    if (d > 0) durations.push(d);

    if (typeof r.ai_score === "number") {
      scoreSum += r.ai_score;
      scoreCount += 1;
      if (r.ai_score >= 7) scored7Plus += 1;
      if (r.ai_score < 5) scoredBelow5 += 1;
    }

    if (typeof r.talk_ratio_rep === "number") {
      talkRatioSum += r.talk_ratio_rep;
      talkRatioCount += 1;
    }
    if (typeof r.question_count === "number") {
      questionSum += r.question_count;
      questionCount += 1;
    }
    if (typeof r.longest_monologue_sec === "number") {
      monologueSum += r.longest_monologue_sec;
      monologueCount += 1;
    }
    if (typeof r.interruption_count === "number") {
      interruptionSum += r.interruption_count;
      interruptionCount += 1;
    }

    if (Array.isArray(r.objection_tags)) {
      for (const t of r.objection_tags) {
        if (!t) continue;
        objectionCounts[t] = (objectionCounts[t] || 0) + 1;
      }
    }
    if (Array.isArray(r.topic_tags)) {
      for (const t of r.topic_tags) {
        if (!t) continue;
        topicCounts[t] = (topicCounts[t] || 0) + 1;
      }
    }

    if (r.matched_area_code === true) {
      matchedTotal += 1;
      if (CONNECTED_STATUSES.has(status)) matchedConnected += 1;
    } else if (r.matched_area_code === false) {
      unmatchedTotal += 1;
      if (CONNECTED_STATUSES.has(status)) unmatchedConnected += 1;
    }
  }

  return {
    total,
    inbound,
    outbound,
    missed,
    connected,
    voicemail,
    totalTalk,
    longest,
    durations,
    scoreSum,
    scoreCount,
    talkRatioSum,
    talkRatioCount,
    questionSum,
    questionCount,
    monologueSum,
    monologueCount,
    interruptionSum,
    interruptionCount,
    scored7Plus,
    scoredBelow5,
    objectionCounts,
    topicCounts,
    matchedTotal,
    matchedConnected,
    unmatchedTotal,
    unmatchedConnected,
  };
}

function scoreTrend(rows: CallRow[], start: Date, end: Date) {
  const byDay = new Map<string, { sum: number; count: number }>();
  for (
    let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    d <= end;
    d.setDate(d.getDate() + 1)
  ) {
    byDay.set(d.toISOString().slice(0, 10), { sum: 0, count: 0 });
  }
  for (const r of rows) {
    if (typeof r.ai_score !== "number") continue;
    const key = r.created_at.slice(0, 10);
    const b = byDay.get(key);
    if (!b) continue;
    b.sum += r.ai_score;
    b.count += 1;
  }
  return Array.from(byDay.entries()).map(([date, b]) => ({
    date,
    score: b.count > 0 ? Math.round((b.sum / b.count) * 100) / 100 : 0,
    call_count: b.count,
  }));
}

function heatmap(rows: CallRow[]): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0)
  );
  for (const r of rows) {
    const d = new Date(r.created_at);
    grid[d.getDay()][d.getHours()] += 1;
  }
  return grid;
}

async function fetchAgentAvatars(
  admin: SupabaseClient
): Promise<Map<string, { name: string; role: string }>> {
  const { data } = await admin
    .from("softphone_users")
    .select("id, full_name, role");
  const m = new Map<string, { name: string; role: string }>();
  for (const u of (data || []) as Array<{ id: string; full_name: string; role: string }>) {
    m.set(u.id, { name: u.full_name, role: u.role });
  }
  return m;
}

function avatarColorFor(role: string) {
  return role === "admin"
    ? "#FFCE3A"
    : role === "manager"
    ? "#2FB67C"
    : "#FFEEC9";
}

type AgentAgg = {
  user_id: string;
  name: string;
  avatar_color: string;
  total_calls: number;
  connected: number;
  answer_rate: number;
  total_talk_seconds: number;
  avg_ai_score: number;
  avg_talk_ratio_rep: number;
  avg_question_count: number;
  closes: number;
  trend: "up" | "flat" | "down";
};

function aggregateByAgent(
  rows: CallRow[],
  prevRows: CallRow[],
  users: Map<string, { name: string; role: string }>
): AgentAgg[] {
  const rollup = new Map<string, ReturnType<typeof aggregate>>();
  const rollupPrev = new Map<string, number>();

  for (const r of rows) {
    if (!r.user_id) continue;
    if (!rollup.has(r.user_id)) rollup.set(r.user_id, aggregate([]));
    // Rebuilt below by accumulating — simpler to push then reduce.
  }

  // Build per-user groups then aggregate once.
  const grouped = new Map<string, CallRow[]>();
  for (const r of rows) {
    if (!r.user_id) continue;
    const list = grouped.get(r.user_id) || [];
    list.push(r);
    grouped.set(r.user_id, list);
  }
  const groupedPrev = new Map<string, number>();
  for (const r of prevRows) {
    if (!r.user_id) continue;
    if (typeof r.ai_score !== "number") continue;
    const prev = groupedPrev.get(r.user_id) || 0;
    groupedPrev.set(r.user_id, prev + 1);
  }

  const out: AgentAgg[] = [];
  for (const [uid, list] of grouped.entries()) {
    const agg = aggregate(list);
    const closes = list.filter(
      (r) => typeof r.ai_score === "number" && r.ai_score >= 8
    ).length;
    const prevCloses = rollupPrev.get(uid) ?? 0;
    let trend: "up" | "flat" | "down" = "flat";
    if (closes > prevCloses) trend = "up";
    else if (closes < prevCloses) trend = "down";

    const user = users.get(uid);
    out.push({
      user_id: uid,
      name: user?.name || "Unknown",
      avatar_color: avatarColorFor(user?.role || "agent"),
      total_calls: agg.total,
      connected: agg.connected,
      answer_rate: agg.total > 0 ? Math.round((agg.connected / agg.total) * 1000) / 10 : 0,
      total_talk_seconds: agg.totalTalk,
      avg_ai_score:
        agg.scoreCount > 0 ? Math.round((agg.scoreSum / agg.scoreCount) * 100) / 100 : 0,
      avg_talk_ratio_rep:
        agg.talkRatioCount > 0
          ? Math.round((agg.talkRatioSum / agg.talkRatioCount) * 10) / 10
          : 0,
      avg_question_count:
        agg.questionCount > 0
          ? Math.round((agg.questionSum / agg.questionCount) * 10) / 10
          : 0,
      closes,
      trend,
    });
  }
  return out.sort((a, b) => b.total_calls - a.total_calls);
}

async function fetchRingGroupStats(
  admin: SupabaseClient,
  start: Date,
  end: Date
) {
  const { data: groups } = await admin
    .from("ring_groups")
    .select("id, name, inbound_number");
  if (!groups || groups.length === 0) return [];

  const numbers = groups.map((g) => (g as { inbound_number: string }).inbound_number);
  const { data: calls } = await admin
    .from("call_logs")
    .select("phone_number, from_number, status, duration_seconds, direction, created_at")
    .eq("direction", "inbound")
    .in("from_number", numbers)
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());

  // Note: inbound calls have from_number = caller, phone_number = the dialed
  // group number. We therefore match on phone_number in practice. Keep the
  // above "from_number" filter as well for schemas where the convention was
  // inverted at some point.
  const { data: callsByTo } = await admin
    .from("call_logs")
    .select("phone_number, from_number, status, duration_seconds, direction, created_at")
    .eq("direction", "inbound")
    .in("phone_number", numbers)
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());

  const seen = new Set<string>();
  const allInbound = [...(calls || []), ...(callsByTo || [])].filter((r) => {
    const k = `${r.created_at}-${r.phone_number}-${r.from_number}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return groups.map((g) => {
    const group = g as { id: string; name: string; inbound_number: string };
    const hits = allInbound.filter(
      (r) =>
        r.phone_number === group.inbound_number ||
        r.from_number === group.inbound_number
    );
    const answered = hits.filter((r) =>
      CONNECTED_STATUSES.has(r.status || "")
    ).length;
    const missed = hits.filter((r) => MISSED_STATUSES.has(r.status || "")).length;
    const answerRate =
      hits.length > 0 ? Math.round((answered / hits.length) * 1000) / 10 : 0;
    // Avg pickup: we don't track ring-start-to-answer granularly today, so
    // approximate via average duration of connected calls. Honest about the
    // approximation — a precise number would need a ring_events table.
    const avgPickup =
      answered > 0
        ? Math.round(
            hits
              .filter((r) => CONNECTED_STATUSES.has(r.status || ""))
              .reduce((a, r) => a + (r.duration_seconds || 0), 0) / answered
          )
        : 0;
    return {
      id: group.id,
      name: group.name,
      inbound_calls: hits.length,
      answered,
      answer_rate: answerRate,
      avg_time_to_answer_sec: avgPickup,
      missed,
    };
  });
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userRow } = await supabase
    .from("softphone_users")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();

  const role = (userRow?.role || "agent") as Role;

  const url = new URL(req.url);
  const period = (url.searchParams.get("period") || "week") as Period;
  const rawAgent = url.searchParams.get("agent_id") || "me";

  let scopeAgentId = rawAgent;
  if (role === "agent") {
    scopeAgentId = user.id;
  } else if (scopeAgentId === "me") {
    scopeAgentId = user.id;
  }

  const cacheKey = `${role}:${scopeAgentId}:${period}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, {
      headers: { "X-Pepper-Cache": "hit" },
    });
  }

  const admin = createAdminClient();
  const { start, end, prevStart, prevEnd } = computeWindow(period);
  const userFilter = scopeAgentId === "all" ? null : scopeAgentId;

  const [
    rowsCurrent,
    rowsPrev,
    users,
    ringGroups,
  ] = await Promise.all([
    fetchRowsInWindow(admin, userFilter, start, end),
    fetchRowsInWindow(admin, userFilter, prevStart, prevEnd),
    fetchAgentAvatars(admin),
    // Ring groups only exist at team scope — skip for single-agent views.
    scopeAgentId === "all" ? fetchRingGroupStats(admin, start, end) : Promise.resolve([]),
  ]);

  const agg = aggregate(rowsCurrent);
  const aggPrev = aggregate(rowsPrev);

  const answerRate =
    agg.total > 0 ? Math.round((agg.connected / agg.total) * 1000) / 10 : 0;
  const answerRatePrev =
    aggPrev.total > 0 ? Math.round((aggPrev.connected / aggPrev.total) * 1000) / 10 : 0;

  const avgCall =
    agg.connected > 0 ? Math.round(agg.totalTalk / agg.connected) : 0;

  const matchedAR =
    agg.matchedTotal > 0
      ? Math.round((agg.matchedConnected / agg.matchedTotal) * 1000) / 10
      : 0;
  const unmatchedAR =
    agg.unmatchedTotal > 0
      ? Math.round((agg.unmatchedConnected / agg.unmatchedTotal) * 1000) / 10
      : 0;

  const objectionEntries = Object.entries(agg.objectionCounts).sort(
    (a, b) => b[1] - a[1]
  );
  const topObjections = objectionEntries.slice(0, 7).map(([tag, count]) => ({
    tag,
    count,
    pct_of_calls:
      agg.total > 0 ? Math.round((count / agg.total) * 1000) / 10 : 0,
  }));

  const topTopics = Object.entries(agg.topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  const by_agent =
    role !== "agent" && scopeAgentId === "all"
      ? aggregateByAgent(rowsCurrent, rowsPrev, users)
      : null;

  const scopeUser = userFilter ? users.get(userFilter) : undefined;

  const body: ReportsResponse = {
    scope: {
      period,
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      agent_id: scopeAgentId,
      agent_name: scopeUser?.name,
      role,
    },
    volume: {
      total_calls: agg.total,
      inbound: agg.inbound,
      outbound: agg.outbound,
      missed: agg.missed,
      connected: agg.connected,
      voicemail: agg.voicemail,
      answer_rate: answerRate,
      vs_previous_period: {
        total_calls: pctDelta(agg.total, aggPrev.total),
        connected: pctDelta(agg.connected, aggPrev.connected),
        answer_rate: Math.round((answerRate - answerRatePrev) * 10) / 10,
      },
    },
    time: {
      total_talk_seconds: agg.totalTalk,
      avg_call_seconds: avgCall,
      median_call_seconds: median(agg.durations),
      longest_call_seconds: agg.longest,
      total_talk_seconds_prev: aggPrev.totalTalk,
    },
    coaching: {
      avg_ai_score:
        agg.scoreCount > 0
          ? Math.round((agg.scoreSum / agg.scoreCount) * 100) / 100
          : 0,
      avg_talk_ratio_rep:
        agg.talkRatioCount > 0
          ? Math.round((agg.talkRatioSum / agg.talkRatioCount) * 10) / 10
          : 0,
      avg_question_count:
        agg.questionCount > 0
          ? Math.round((agg.questionSum / agg.questionCount) * 10) / 10
          : 0,
      avg_longest_monologue:
        agg.monologueCount > 0
          ? Math.round(agg.monologueSum / agg.monologueCount)
          : 0,
      avg_interruption_count:
        agg.interruptionCount > 0
          ? Math.round((agg.interruptionSum / agg.interruptionCount) * 10) / 10
          : 0,
      top_objections: topObjections,
      top_topics: topTopics,
      score_trend: scoreTrend(rowsCurrent, start, end),
    },
    outcomes: {
      calls_scored_7_plus: agg.scored7Plus,
      calls_scored_below_5: agg.scoredBelow5,
      quality_call_rate:
        agg.connected > 0
          ? Math.round((agg.scored7Plus / agg.connected) * 1000) / 10
          : 0,
    },
    operational: {
      local_presence: {
        matched_area_code_calls: agg.matchedTotal,
        matched_answer_rate: matchedAR,
        unmatched_area_code_calls: agg.unmatchedTotal,
        unmatched_answer_rate: unmatchedAR,
        lift: Math.round((matchedAR - unmatchedAR) * 10) / 10,
      },
      ring_groups: ringGroups,
    },
    heatmap: { data: heatmap(rowsCurrent) },
    by_agent,
  };

  cache.set(cacheKey, { at: Date.now(), body });
  return NextResponse.json(body, { headers: { "X-Pepper-Cache": "miss" } });
}
