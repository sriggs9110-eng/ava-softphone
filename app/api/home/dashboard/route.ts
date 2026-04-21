import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchDashboard, type DashboardPayload } from "@/lib/home/dashboard";

// 30s per-user cache. Homepage queries are fast but cached for UX —
// multiple tabs opening at once shouldn't hammer the DB.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; body: DashboardPayload }>();

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cached = cache.get(user.id);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, {
      headers: { "X-Pepper-Cache": "hit" },
    });
  }

  const admin = createAdminClient();
  const body = await fetchDashboard(admin, { userId: user.id });
  cache.set(user.id, { at: Date.now(), body });

  return NextResponse.json(body, { headers: { "X-Pepper-Cache": "miss" } });
}
