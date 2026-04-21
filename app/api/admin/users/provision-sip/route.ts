import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSipCredentialForUser } from "@/lib/telnyx/provisioning";

// Provision (or re-provision, idempotent) a Telnyx SIP credential for a
// single softphone_users row. Used by the Users admin table's "Provision
// now" action for rows showing ⚠ Missing or ✗ Failed.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: caller } = await supabase
    .from("softphone_users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!caller || caller.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { id } = body as { id?: string };
  if (!id) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  const { data: target } = await supabase
    .from("softphone_users")
    .select("id, email")
    .eq("id", id)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  try {
    const result = await createSipCredentialForUser(target.id, target.email || "");
    return NextResponse.json({
      success: true,
      sip_username: result.sipUsername,
      credential_id: result.credentialId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin/users/provision-sip] ${id}: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
