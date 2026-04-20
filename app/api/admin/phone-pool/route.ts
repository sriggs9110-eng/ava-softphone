import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidatePoolCache } from "@/app/lib/local-presence";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };

  const { data } = await supabase
    .from("softphone_users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!data || data.role !== "admin") {
    return { error: "Forbidden", status: 403 as const };
  }
  return { user };
}

function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

function deriveAreaCode(e164: string): string | null {
  const digits = e164.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.substring(1, 4);
  if (digits.length === 10) return digits.substring(0, 3);
  return null;
}

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("phone_number_pool")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json();
  const raw = (body?.phone_number as string) || "";
  const e164 = toE164(raw);
  if (!e164) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }
  const area_code = deriveAreaCode(e164);
  if (!area_code) {
    return NextResponse.json({ error: "Could not derive area code" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("phone_number_pool")
    .insert({
      phone_number: e164,
      area_code,
      label: (body?.label as string) || null,
      is_active: body?.is_active ?? true,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidatePoolCache();
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json();
  const { id, ...updates } = body ?? {};
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("phone_number_pool")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidatePoolCache();
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.from("phone_number_pool").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidatePoolCache();
  return NextResponse.json({ success: true });
}
