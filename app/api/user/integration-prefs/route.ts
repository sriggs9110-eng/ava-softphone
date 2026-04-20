import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Prefs = {
  signal_webhook_url?: string | null;
  auto_dial_popup?: boolean;
  auto_analyze_calls?: boolean;
};

function sanitize(input: unknown): Prefs {
  if (!input || typeof input !== "object") return {};
  const src = input as Record<string, unknown>;
  const out: Prefs = {};
  if ("signal_webhook_url" in src) {
    const v = src.signal_webhook_url;
    if (v === null || v === "") out.signal_webhook_url = null;
    else if (typeof v === "string") {
      try {
        const u = new URL(v);
        if (u.protocol === "http:" || u.protocol === "https:") {
          out.signal_webhook_url = v;
        }
      } catch {
        // ignore — leave field untouched
      }
    }
  }
  if (typeof src.auto_dial_popup === "boolean") {
    out.auto_dial_popup = src.auto_dial_popup;
  }
  if (typeof src.auto_analyze_calls === "boolean") {
    out.auto_analyze_calls = src.auto_analyze_calls;
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
    .select("signal_webhook_url, auto_dial_popup, auto_analyze_calls")
    .eq("id", user.id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    signal_webhook_url: data?.signal_webhook_url ?? null,
    auto_dial_popup: data?.auto_dial_popup ?? false,
    auto_analyze_calls: data?.auto_analyze_calls ?? true,
  });
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

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("softphone_users")
    .update(updates)
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, updated: updates });
}
