import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createSipCredentialForUser,
  deleteSipCredentialForUser,
} from "@/lib/telnyx/provisioning";

// GET — list all softphone users
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check admin role
  const { data: caller } = await supabase
    .from("softphone_users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!caller || caller.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("softphone_users")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST — create new user. Also provisions a per-user Telnyx SIP
// credential so the new agent can place and receive calls immediately.
// If credential provisioning fails, the softphone_users row still
// exists (auth works), but the response includes a sip_provisioning_error
// flag so the admin UI can warn and offer a "Provision now" retry.
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

  const body = await req.json();
  const { email, full_name, password, role } = body;

  if (!email || !full_name || !password || !role) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Create auth user
  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  // Create softphone_users row
  const { error: profileError } = await admin.from("softphone_users").insert({
    id: authData.user.id,
    email,
    full_name,
    role,
    status: "offline",
  });

  if (profileError) {
    // Clean up auth user if profile creation fails
    await admin.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json(
      { error: profileError.message },
      { status: 500 }
    );
  }

  // Best-effort Telnyx credential provisioning. If this fails we don't
  // roll back user creation — auth / profile are the source of truth.
  // The admin UI surfaces the failure and can retry via /provision.
  let sipProvisioningError: string | null = null;
  try {
    await createSipCredentialForUser(authData.user.id, email);
  } catch (err) {
    sipProvisioningError = err instanceof Error ? err.message : String(err);
    console.error(
      `[admin/users] SIP provisioning failed for new user ${authData.user.id}: ${sipProvisioningError}`
    );
  }

  return NextResponse.json({
    id: authData.user.id,
    email,
    full_name,
    role,
    sip_provisioning_error: sipProvisioningError,
  });
}

// PATCH — update user role
export async function PATCH(req: NextRequest) {
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

  const body = await req.json();
  const { id, role } = body;

  const admin = createAdminClient();
  const { error } = await admin
    .from("softphone_users")
    .update({ role })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE — remove user (also deletes their Telnyx credential)
export async function DELETE(req: NextRequest) {
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

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  // Don't allow deleting yourself
  if (id === user.id) {
    return NextResponse.json(
      { error: "Cannot delete yourself" },
      { status: 400 }
    );
  }

  // Telnyx cleanup first — if this fails we still proceed with the
  // user delete so the operator isn't blocked. Orphan credentials in
  // Telnyx are harmless (they just won't register anywhere).
  try {
    await deleteSipCredentialForUser(id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin/users] SIP credential delete failed for ${id}: ${msg}`);
  }

  const admin = createAdminClient();

  // Delete softphone_users row (cascade from auth.users)
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
