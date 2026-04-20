// Pepper's Pick selection logic.
//
// Consumed by:
//   - /api/reports/peppers-pick (for the /reports UI)
//   - /api/cron/weekly-digest (for the Monday email)
//
// Returns up to 5 picks ordered by category priority + magnitude.

import type { SupabaseClient } from "@supabase/supabase-js";

export type PickCategory =
  | "jump"
  | "drop"
  | "outlier"
  | "high_effort"
  | "callback";

export interface PickRowDb {
  id: string;
  user_id: string | null;
  phone_number: string;
  direction: string;
  duration_seconds: number | null;
  ai_score: number | null;
  status: string | null;
  created_at: string;
  transcript: string | null;
  external_id: string | null;
}

export interface PeppersPick {
  pick_id: string;
  call_log_id: string;
  rep_name: string;
  prospect_name: string | null;
  prospect_company: string | null;
  prospect_number: string;
  duration_seconds: number;
  ai_score: number | null;
  category: PickCategory;
  pepper_headline: string;
  pepper_reason: string;
}

const ANALYZED_COLS =
  "id, user_id, phone_number, direction, duration_seconds, ai_score, status, created_at, transcript, external_id";

function weeksAgoIso(weeks: number): string {
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7);
  return d.toISOString();
}

function avgScore(rows: PickRowDb[]): number | null {
  const scored = rows.filter((r) => typeof r.ai_score === "number");
  if (scored.length === 0) return null;
  return scored.reduce((a, r) => a + (r.ai_score as number), 0) / scored.length;
}

async function generateHeadlineAndReason(
  args: {
    transcript: string | null;
    category: PickCategory;
    rep: string;
    score: number | null;
    duration: number;
    scoreDelta?: number;
  }
): Promise<{ headline: string; reason: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  const fallback = fallbackPitch(args);
  if (!key) return fallback;

  const { transcript, category, rep, score, duration, scoreDelta } = args;
  const snippet = (transcript || "").slice(0, 4000);
  const mins = Math.round(duration / 60);

  const categoryContext: Record<PickCategory, string> = {
    jump: `${rep}'s average score jumped ${scoreDelta?.toFixed(1) ?? "?"} points this week vs their trailing 4-week average — celebrate and spread what's working.`,
    drop: `${rep}'s average score dropped ${Math.abs(scoreDelta ?? 0).toFixed(1)} points this week — coaching opportunity.`,
    outlier:
      score && score >= 9
        ? `Exceptional single call scoring ${score} — worth bottling up.`
        : `Rough single call scoring ${score} over ${mins} minutes — dig in.`,
    high_effort: `${mins}-minute call that scored only ${score} — rep put the work in, something didn't land.`,
    callback: `${rep} missed this prospect earlier; the callback scored ${score}. Good recovery story.`,
  };

  const system = `You are a sales enablement coach writing for a busy manager. In ${categoryContext[category]}

Return ONLY valid JSON of the form:
{"headline": "one punchy sentence under 90 chars selling why this call matters", "reason": "2-3 sentences with a specific thing worth noticing from the call, in managerial voice"}

Ground claims in the transcript excerpt when provided. No marketing gloss.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        system,
        messages: [
          {
            role: "user",
            content: `Category: ${category}\nRep: ${rep}\nScore: ${score ?? "n/a"}\nDuration: ${mins} minutes\n\nTranscript excerpt:\n${snippet || "(no transcript available)"}`,
          },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const content = data.content?.[0]?.text || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]) as { headline?: string; reason?: string };
    return {
      headline: parsed.headline || fallback.headline,
      reason: parsed.reason || fallback.reason,
    };
  } catch (err) {
    console.error("[peppers-pick] claude error:", err);
    return fallback;
  }
}

function fallbackPitch({
  category,
  score,
  duration,
}: {
  category: PickCategory;
  score: number | null;
  duration: number;
}): { headline: string; reason: string } {
  const mins = Math.round(duration / 60);
  switch (category) {
    case "jump":
      return {
        headline: "Score spike — listen for what clicked this week.",
        reason: `This rep's average moved up meaningfully. ${mins} minutes of listening usually surfaces a specific new move worth cloning.`,
      };
    case "drop":
      return {
        headline: "Sharp score drop — catch the slip early.",
        reason: `Average dropped enough that a single call should tell the story. Check pacing, question count, and whether a specific objection threw them off.`,
      };
    case "outlier":
      return score && score >= 9
        ? {
            headline: "Near-perfect call — worth bottling.",
            reason: `Scored ${score}/10 and lasted ${mins} minutes. Flag the highlight moments to the team.`,
          }
        : {
            headline: "Weak call with real length — diagnose.",
            reason: `Scored ${score}/10 across ${mins} minutes. Something unproductive is burning time; pinpoint it.`,
          };
    case "high_effort":
      return {
        headline: "Long call, low score — put in the work, didn't pay.",
        reason: `${mins} minutes with a ${score}/10 outcome. Effort was there; coaching should help next time.`,
      };
    case "callback":
      return {
        headline: "Missed → called back → converted. Great recovery.",
        reason: `Prospect wasn't reached the first try but the follow-up scored ${score}/10. Nice muscle to reinforce.`,
      };
  }
}

function pickId(cat: PickCategory, callId: string) {
  return `${cat}-${callId.slice(0, 8)}`;
}

export async function selectPeppersPicks(
  admin: SupabaseClient,
  opts: { period: "week"; userIds?: string[] }
): Promise<PeppersPick[]> {
  const weekStart = weeksAgoIso(1);
  const trailingStart = weeksAgoIso(5); // 4 weeks prior to last week

  // Fetch last 5 weeks scoped to the set of users (or everyone).
  let q = admin
    .from("call_logs")
    .select(ANALYZED_COLS)
    .gte("created_at", trailingStart);
  if (opts.userIds && opts.userIds.length > 0) {
    q = q.in("user_id", opts.userIds);
  }
  const { data: rows, error } = await q;
  if (error) {
    console.error("[peppers-pick] fetch error:", error.message);
    return [];
  }
  const allRows = (rows || []) as PickRowDb[];

  // Load rep names so we can pitch in managerial voice.
  const userIds = Array.from(
    new Set(allRows.map((r) => r.user_id).filter((v): v is string => !!v))
  );
  let users = new Map<string, string>();
  if (userIds.length > 0) {
    const { data } = await admin
      .from("softphone_users")
      .select("id, full_name")
      .in("id", userIds);
    users = new Map(
      (data || []).map((u) => [
        (u as { id: string; full_name: string }).id,
        (u as { id: string; full_name: string }).full_name,
      ])
    );
  }
  const repName = (uid: string | null) =>
    (uid && users.get(uid)) || "A teammate";

  const thisWeekRows = allRows.filter((r) => r.created_at >= weekStart);
  const trailingRows = allRows.filter(
    (r) => r.created_at < weekStart && r.created_at >= trailingStart
  );

  // Organize by rep.
  const byRepThis = new Map<string, PickRowDb[]>();
  const byRepTrail = new Map<string, PickRowDb[]>();
  for (const r of thisWeekRows) {
    if (!r.user_id) continue;
    const list = byRepThis.get(r.user_id) || [];
    list.push(r);
    byRepThis.set(r.user_id, list);
  }
  for (const r of trailingRows) {
    if (!r.user_id) continue;
    const list = byRepTrail.get(r.user_id) || [];
    list.push(r);
    byRepTrail.set(r.user_id, list);
  }

  type Candidate = {
    category: PickCategory;
    row: PickRowDb;
    scoreDelta?: number;
    rank: number;
  };

  const candidates: Candidate[] = [];

  // 1 & 2 — biggest score jumps/drops
  for (const [uid, thisList] of byRepThis.entries()) {
    const trail = byRepTrail.get(uid) || [];
    const thisAvg = avgScore(thisList);
    const trailAvg = avgScore(trail);
    if (thisAvg === null || trailAvg === null) continue;
    const delta = thisAvg - trailAvg;
    if (Math.abs(delta) < 1.5) continue;
    // Best representative call for this rep this week
    const scored = thisList
      .filter((r) => typeof r.ai_score === "number")
      .sort((a, b) =>
        delta > 0
          ? (b.ai_score as number) - (a.ai_score as number)
          : (a.ai_score as number) - (b.ai_score as number)
      );
    if (scored.length === 0) continue;
    candidates.push({
      category: delta > 0 ? "jump" : "drop",
      row: scored[0],
      scoreDelta: delta,
      rank: Math.abs(delta) * 10,
    });
  }

  // 3 — outlier single calls
  for (const r of thisWeekRows) {
    if (typeof r.ai_score !== "number") continue;
    if ((r.duration_seconds ?? 0) <= 180) continue;
    if (r.ai_score >= 9) {
      candidates.push({ category: "outlier", row: r, rank: 100 + r.ai_score });
    } else if (r.ai_score <= 3) {
      candidates.push({ category: "outlier", row: r, rank: 90 + (3 - r.ai_score) });
    }
  }

  // 4 — high-effort lost cause
  for (const r of thisWeekRows) {
    if (typeof r.ai_score !== "number") continue;
    if ((r.duration_seconds ?? 0) < 600) continue;
    if (r.ai_score > 4) continue;
    candidates.push({
      category: "high_effort",
      row: r,
      rank: 80 + (r.duration_seconds ?? 0) / 60,
    });
  }

  // 5 — callback-then-won-back: missed call followed by a connected call to
  //       the same number, same rep, where the second scored 7+.
  const byRepNumber = new Map<string, PickRowDb[]>();
  for (const r of allRows) {
    if (!r.user_id) continue;
    const key = `${r.user_id}|${r.phone_number}`;
    const list = byRepNumber.get(key) || [];
    list.push(r);
    byRepNumber.set(key, list);
  }
  for (const list of byRepNumber.values()) {
    const sorted = [...list].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    );
    // Look for a missed-ish call followed by a connected call with score 7+
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.created_at < weekStart) continue;
      const prevMissed =
        prev.status === "missed" ||
        prev.status === "no_answer" ||
        prev.status === "no-answer" ||
        prev.status === "rejected";
      const curGood =
        (cur.status === "completed" || cur.status === "connected") &&
        typeof cur.ai_score === "number" &&
        cur.ai_score >= 7;
      if (prevMissed && curGood) {
        candidates.push({
          category: "callback",
          row: cur,
          rank: 70 + (cur.ai_score as number),
        });
        break;
      }
    }
  }

  // Order by rank, then cap at 5 — prefer diverse categories.
  candidates.sort((a, b) => b.rank - a.rank);

  const picked: Candidate[] = [];
  const seenCats = new Set<PickCategory>();
  for (const c of candidates) {
    if (picked.length >= 5) break;
    if (!seenCats.has(c.category)) {
      picked.push(c);
      seenCats.add(c.category);
    }
  }
  if (picked.length < 5) {
    for (const c of candidates) {
      if (picked.length >= 5) break;
      if (!picked.includes(c)) picked.push(c);
    }
  }

  // Build headlines in parallel.
  const picks = await Promise.all(
    picked.map(async (c) => {
      const { headline, reason } = await generateHeadlineAndReason({
        transcript: c.row.transcript,
        category: c.category,
        rep: repName(c.row.user_id),
        score: c.row.ai_score,
        duration: c.row.duration_seconds ?? 0,
        scoreDelta: c.scoreDelta,
      });
      const pick: PeppersPick = {
        pick_id: pickId(c.category, c.row.id),
        call_log_id: c.row.id,
        rep_name: repName(c.row.user_id),
        prospect_name: null,
        prospect_company: null,
        prospect_number: c.row.phone_number,
        duration_seconds: c.row.duration_seconds ?? 0,
        ai_score: c.row.ai_score,
        category: c.category,
        pepper_headline: headline,
        pepper_reason: reason,
      };
      return pick;
    })
  );
  return picks;
}
