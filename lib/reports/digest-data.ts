// Data builder for the weekly manager digest. Runs with the service role
// since the cron has no user context.

import type { SupabaseClient } from "@supabase/supabase-js";
import { selectPeppersPicks, type PeppersPick } from "./peppers-pick";

export interface DigestData {
  period_start: string;
  period_end: string;
  headline: {
    total_calls: number;
    total_calls_delta: number;
    answer_rate: number;
    answer_rate_delta: number;
    avg_score: number;
    avg_score_delta: number;
  };
  picks: PeppersPick[];
  top_performer: {
    score: { name: string; avg_score: number } | null;
    volume: { name: string; total_calls: number } | null;
  };
  coaching_opportunity: string | null;
}

interface Row {
  user_id: string | null;
  status: string | null;
  ai_score: number | null;
  talk_ratio_rep: number | null;
  question_count: number | null;
  interruption_count: number | null;
  duration_seconds: number | null;
  created_at: string;
}

const CONNECTED = new Set(["completed", "connected"]);

function iso(d: Date) {
  return d.toISOString();
}

function pctChange(a: number, b: number): number {
  if (b === 0) return a > 0 ? 100 : 0;
  return Math.round(((a - b) / b) * 1000) / 10;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, n) => a + n, 0) / nums.length;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export async function buildDigestData(
  admin: SupabaseClient
): Promise<DigestData> {
  const now = new Date();
  const weekEnd = now;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const prevStart = new Date(now);
  prevStart.setDate(now.getDate() - 14);

  const { data: thisWeek } = await admin
    .from("call_logs")
    .select(
      "user_id, status, ai_score, talk_ratio_rep, question_count, interruption_count, duration_seconds, created_at"
    )
    .gte("created_at", iso(weekStart))
    .lt("created_at", iso(weekEnd));
  const { data: prevWeek } = await admin
    .from("call_logs")
    .select("user_id, status, ai_score, created_at")
    .gte("created_at", iso(prevStart))
    .lt("created_at", iso(weekStart));

  const current = (thisWeek as Row[]) || [];
  const previous = ((prevWeek as Row[]) || []);

  const totalCalls = current.length;
  const connected = current.filter((r) => CONNECTED.has(r.status || "")).length;
  const answerRate =
    totalCalls > 0 ? round1((connected / totalCalls) * 100) : 0;
  const scored = current.filter((r) => typeof r.ai_score === "number");
  const avgScore = scored.length > 0 ? round1(avg(scored.map((r) => r.ai_score as number))) : 0;

  const prevTotal = previous.length;
  const prevConnected = previous.filter((r) => CONNECTED.has(r.status || "")).length;
  const prevAnswerRate =
    prevTotal > 0 ? round1((prevConnected / prevTotal) * 100) : 0;
  const prevScored = previous.filter((r) => typeof r.ai_score === "number");
  const prevAvgScore =
    prevScored.length > 0 ? round1(avg(prevScored.map((r) => r.ai_score as number))) : 0;

  // Top performers this week
  const byUser = new Map<
    string,
    { calls: number; scored: number[]; talk: number[] }
  >();
  for (const r of current) {
    if (!r.user_id) continue;
    const rec = byUser.get(r.user_id) || { calls: 0, scored: [], talk: [] };
    rec.calls += 1;
    if (typeof r.ai_score === "number") rec.scored.push(r.ai_score);
    if (typeof r.talk_ratio_rep === "number") rec.talk.push(r.talk_ratio_rep);
    byUser.set(r.user_id, rec);
  }

  const userIds = Array.from(byUser.keys());
  const nameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data } = await admin
      .from("softphone_users")
      .select("id, full_name")
      .in("id", userIds);
    for (const u of (data || []) as Array<{ id: string; full_name: string }>) {
      nameMap.set(u.id, u.full_name);
    }
  }

  let topScore: { name: string; avg_score: number } | null = null;
  let topVolume: { name: string; total_calls: number } | null = null;
  for (const [uid, rec] of byUser.entries()) {
    if (rec.scored.length >= 3) {
      const s = round1(avg(rec.scored));
      if (!topScore || s > topScore.avg_score) {
        topScore = { name: nameMap.get(uid) || "Unknown", avg_score: s };
      }
    }
    if (!topVolume || rec.calls > topVolume.total_calls) {
      topVolume = { name: nameMap.get(uid) || "Unknown", total_calls: rec.calls };
    }
  }

  // Coaching opportunity — simple heuristic across a few signals.
  const coachingOpp = (() => {
    const allTalk = current
      .filter((r) => typeof r.talk_ratio_rep === "number")
      .map((r) => r.talk_ratio_rep as number);
    const allQuestions = current
      .filter((r) => typeof r.question_count === "number")
      .map((r) => r.question_count as number);
    const allInterruptions = current
      .filter((r) => typeof r.interruption_count === "number")
      .map((r) => r.interruption_count as number);

    if (allTalk.length >= 5) {
      const t = round1(avg(allTalk));
      if (t > 65)
        return `Talk ratio averaged ${t}% — the team is talking too much. Listen more, ask more.`;
      if (t < 30)
        return `Talk ratio averaged only ${t}% — the team may be ceding the call. Steer the conversation.`;
    }
    if (allQuestions.length >= 5) {
      const q = round1(avg(allQuestions));
      if (q < 5)
        return `Only ${q} questions per call on average — top performers land 8-12. More discovery next week.`;
    }
    if (allInterruptions.length >= 5) {
      const i = round1(avg(allInterruptions));
      if (i > 3)
        return `Interruptions averaged ${i} per call — let the prospect finish before you respond.`;
    }
    return null;
  })();

  const picks = await selectPeppersPicks(admin, { period: "week" });

  return {
    period_start: iso(weekStart),
    period_end: iso(weekEnd),
    headline: {
      total_calls: totalCalls,
      total_calls_delta: pctChange(totalCalls, prevTotal),
      answer_rate: answerRate,
      answer_rate_delta: round1(answerRate - prevAnswerRate),
      avg_score: avgScore,
      avg_score_delta: round1(avgScore - prevAvgScore),
    },
    picks,
    top_performer: {
      score: topScore,
      volume: topVolume,
    },
    coaching_opportunity: coachingOpp,
  };
}
