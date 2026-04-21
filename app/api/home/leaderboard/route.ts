import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchLeaderboard,
  type LeaderboardPeriod,
} from "@/lib/home/dashboard";

// Tiny independent cache for the leaderboard-only path. Period toggles don't
// invalidate the dashboard cache; they just land here.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const periodRaw = url.searchParams.get("period") || "today";
  const period: LeaderboardPeriod =
    periodRaw === "week" || periodRaw === "month" ? periodRaw : "today";

  const cached = cache.get(period);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, {
      headers: { "X-Pepper-Cache": "hit" },
    });
  }

  const admin = createAdminClient();
  const block = await fetchLeaderboard(admin, period);
  cache.set(period, { at: Date.now(), body: block });
  return NextResponse.json(block, { headers: { "X-Pepper-Cache": "miss" } });
}
