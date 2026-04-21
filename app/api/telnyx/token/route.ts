import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createSipCredentialForUser,
  decryptPassword,
} from "@/lib/telnyx/provisioning";

// Issues per-user Telnyx SIP credentials. The shared
// TELNYX_SIP_USERNAME / TELNYX_SIP_PASSWORD env vars are NO LONGER used
// on this happy path — they remain in env only for emergency rollback.
//
// Flow:
//   1. Verify the caller is authenticated.
//   2. Look up their softphone_users row.
//   3. If they already have sip_username + sip_password_encrypted,
//      decrypt and return those.
//   4. Otherwise, self-provision a credential in Telnyx on first request
//      and return the freshly-minted creds.
//
// Each token issuance logs with a [token] prefix so we can debug
// per-user registrations in Vercel logs.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: row, error: rowError } = await admin
    .from("softphone_users")
    .select("id, email, sip_username, sip_password_encrypted")
    .eq("id", user.id)
    .maybeSingle();

  if (rowError) {
    console.error(`[token] load user row failed for ${user.id}:`, rowError.message);
    return NextResponse.json(
      { error: "Failed to load user" },
      { status: 500 }
    );
  }
  if (!row) {
    return NextResponse.json(
      { error: "No softphone_users row for this auth user" },
      { status: 403 }
    );
  }

  if (row.sip_username && row.sip_password_encrypted) {
    try {
      const password = decryptPassword(row.sip_password_encrypted);
      console.log(`[token] issued existing creds for ${user.id} username=${row.sip_username}`);
      return NextResponse.json({
        username: row.sip_username,
        password,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[token] decrypt failed for ${user.id}: ${msg}`);
      return NextResponse.json(
        { error: "Failed to decrypt SIP password" },
        { status: 500 }
      );
    }
  }

  // Self-provision on first token request. A user created before the
  // backfill script ran, or a brand-new user whose create-flow skipped
  // provisioning, hits this path.
  try {
    const result = await createSipCredentialForUser(user.id, row.email || user.email || "");
    console.log(
      `[token] self-provisioned ${user.id} username=${result.sipUsername} credentialId=${result.credentialId}`
    );
    return NextResponse.json({
      username: result.sipUsername,
      password: result.sipPassword,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[token] self-provision failed for ${user.id}: ${msg}`);
    return NextResponse.json(
      { error: "Failed to provision SIP credentials" },
      { status: 500 }
    );
  }
}
