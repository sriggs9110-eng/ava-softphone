import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectPeppersPicks } from "@/lib/reports/peppers-pick";

// Single in-memory cache — selection is expensive because it calls Claude.
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; body: unknown }>();

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
    .select("role")
    .eq("id", user.id)
    .single();
  const role = userRow?.role || "agent";

  const url = new URL(req.url);
  const period = (url.searchParams.get("period") || "week") as "week";

  // Scoping: agents see only their own; managers/admins see everyone.
  const userIds = role === "agent" ? [user.id] : undefined;
  const cacheKey = `${period}:${userIds?.join(",") || "all"}`;

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, {
      headers: { "X-Pepper-Cache": "hit" },
    });
  }

  const admin = createAdminClient();
  const picks = await selectPeppersPicks(admin, { period, userIds });
  const body = { picks };
  cache.set(cacheKey, { at: Date.now(), body });

  return NextResponse.json(body, { headers: { "X-Pepper-Cache": "miss" } });
}
