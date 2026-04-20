import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type CoachingPrefs = {
  live_cards?: boolean;
  sound_fx?: boolean;
  celebrations?: boolean;
  auto_whisper?: boolean;
};

const DEFAULTS: Required<CoachingPrefs> = {
  live_cards: true,
  sound_fx: true,
  celebrations: true,
  auto_whisper: false,
};

const ALLOWED_KEYS = new Set<keyof CoachingPrefs>([
  "live_cards",
  "sound_fx",
  "celebrations",
  "auto_whisper",
]);

function sanitize(input: unknown): CoachingPrefs {
  if (!input || typeof input !== "object") return {};
  const out: CoachingPrefs = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (ALLOWED_KEYS.has(k as keyof CoachingPrefs) && typeof v === "boolean") {
      out[k as keyof CoachingPrefs] = v;
    }
  }
  return out;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("softphone_users")
    .select("coaching_prefs")
    .eq("id", user.id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ...DEFAULTS, ...((data?.coaching_prefs as CoachingPrefs) || {}) });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const updates = sanitize(body);

  // Merge with existing values — use service-role client to avoid RLS pitfalls
  // on a self-update (user still has to be authenticated above).
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("softphone_users")
    .select("coaching_prefs")
    .eq("id", user.id)
    .single();

  const merged = {
    ...DEFAULTS,
    ...((existing?.coaching_prefs as CoachingPrefs) || {}),
    ...updates,
  };

  const { error } = await admin
    .from("softphone_users")
    .update({ coaching_prefs: merged })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(merged);
}
