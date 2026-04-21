// Per-user Telnyx SIP credential provisioning.
//
// Every softphone_users row owns its own Telnyx telephony_credential so
// each agent's browser registers with a distinct SIP identity. This
// replaces the single shared TELNYX_SIP_USERNAME / TELNYX_SIP_PASSWORD
// setup that caused inbound INVITE race conditions.
//
// SERVER-SIDE ONLY. TELNYX_API_KEY and SUPABASE_ENCRYPTION_KEY must
// never leak to the browser. Callers should be route handlers, server
// actions, or scripts.
//
// Endpoint choice: `POST /v2/telephony_credentials` is the modern API
// and returns `sip_username` / `sip_password` directly in the response
// (no separate token-mint step required). The @telnyx/webrtc SDK's
// TelnyxRTC({ login, password }) accepts those values as-is. Older
// `/v2/sip_credentials` is deprecated and not used here.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const TELNYX_API = "https://api.telnyx.com/v2";

type CredentialRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  sip_username: string | null;
  sip_credential_id: string | null;
  sip_password_encrypted: string | null;
  sip_provisioned_at: string | null;
};

export type ProvisionResult = {
  userId: string;
  sipUsername: string;
  sipPassword: string;
  credentialId: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function adminClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// AES-256-GCM symmetric encryption.
//
// Key derivation: SHA-256 of SUPABASE_ENCRYPTION_KEY (any length input,
// deterministic 32-byte key out). The env value should be a high-entropy
// secret (e.g. `openssl rand -hex 32`), but we hash rather than hex-decode
// so operators can't accidentally produce a short key.
//
// Storage format: "v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>". The
// version tag lets us rotate key/algorithm later without breaking reads.
function getEncryptionKey(): Buffer {
  const raw = requireEnv("SUPABASE_ENCRYPTION_KEY");
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

export function encryptPassword(plain: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptPassword(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unsupported encrypted-password format");
  }
  const [, ivHex, tagHex, ctHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

async function telnyxFetch(
  path: string,
  init: { method: string; body?: unknown }
): Promise<Response> {
  const apiKey = requireEnv("TELNYX_API_KEY");
  return fetch(`${TELNYX_API}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

type TelnyxCredential = {
  id: string;
  sip_username: string;
  sip_password: string;
  resource_id: string;
  name: string;
  expired: boolean;
};

async function telnyxCreateCredential(args: {
  connectionId: string;
  name: string;
  tag?: string;
}): Promise<TelnyxCredential> {
  const res = await telnyxFetch("/telephony_credentials", {
    method: "POST",
    body: {
      connection_id: args.connectionId,
      name: args.name,
      tag: args.tag,
    },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(
      `Telnyx create credential failed (${res.status}): ${err.slice(0, 400)}`
    );
  }
  const body = (await res.json()) as { data: TelnyxCredential };
  if (!body?.data?.sip_username || !body?.data?.sip_password) {
    throw new Error(
      "Telnyx response missing sip_username or sip_password — cannot recover"
    );
  }
  return body.data;
}

async function telnyxDeleteCredential(credentialId: string): Promise<void> {
  const res = await telnyxFetch(`/telephony_credentials/${credentialId}`, {
    method: "DELETE",
  });
  // 404 is tolerable — means the credential is already gone in Telnyx.
  if (!res.ok && res.status !== 404) {
    const err = await res.text().catch(() => "");
    throw new Error(
      `Telnyx delete credential failed (${res.status}): ${err.slice(0, 400)}`
    );
  }
}

async function loadUserRow(
  admin: SupabaseClient,
  userId: string
): Promise<CredentialRow> {
  const { data, error } = await admin
    .from("softphone_users")
    .select(
      "id, email, full_name, sip_username, sip_credential_id, sip_password_encrypted, sip_provisioned_at"
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load user ${userId}: ${error.message}`);
  if (!data) throw new Error(`User ${userId} not found in softphone_users`);
  return data as CredentialRow;
}

// Creates a Telnyx telephony_credential for the given user and stores the
// id + encrypted password on softphone_users. Idempotent: if the row
// already has sip_credential_id + sip_password_encrypted, returns the
// existing values without calling Telnyx.
export async function createSipCredentialForUser(
  userId: string,
  userEmail: string
): Promise<ProvisionResult> {
  const connectionId = requireEnv("TELNYX_CONNECTION_ID");
  const admin = adminClient();

  const row = await loadUserRow(admin, userId);

  if (row.sip_credential_id && row.sip_username && row.sip_password_encrypted) {
    return {
      userId,
      sipUsername: row.sip_username,
      sipPassword: decryptPassword(row.sip_password_encrypted),
      credentialId: row.sip_credential_id,
    };
  }

  // Telnyx "name" only accepts a limited charset. Strip anything that
  // isn't alphanumeric / dash / underscore and append a short uuid suffix
  // to keep names unique across users who share an email domain.
  const emailLocal = (userEmail || row.email || "user").split("@")[0];
  const safeLocal = emailLocal.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "user";
  const suffix = userId.replace(/-/g, "").slice(0, 8);
  const credentialName = `pepper-${safeLocal}-${suffix}`;

  const cred = await telnyxCreateCredential({
    connectionId,
    name: credentialName,
    tag: userId,
  });

  const encrypted = encryptPassword(cred.sip_password);

  const { error } = await admin
    .from("softphone_users")
    .update({
      sip_username: cred.sip_username,
      sip_credential_id: cred.id,
      sip_password_encrypted: encrypted,
      sip_provisioned_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    // Telnyx credential now exists but we failed to persist it locally.
    // Attempt to delete so we don't leak orphan credentials in Telnyx.
    await telnyxDeleteCredential(cred.id).catch(() => {});
    throw new Error(
      `Failed to persist SIP credential for user ${userId}: ${error.message}`
    );
  }

  return {
    userId,
    sipUsername: cred.sip_username,
    sipPassword: cred.sip_password,
    credentialId: cred.id,
  };
}

// Deletes the user's Telnyx credential and clears the columns. Used when
// a user is removed from the system.
export async function deleteSipCredentialForUser(userId: string): Promise<void> {
  const admin = adminClient();
  const row = await loadUserRow(admin, userId);

  if (row.sip_credential_id) {
    await telnyxDeleteCredential(row.sip_credential_id);
  }

  const { error } = await admin
    .from("softphone_users")
    .update({
      sip_username: null,
      sip_credential_id: null,
      sip_password_encrypted: null,
      sip_provisioned_at: null,
    })
    .eq("id", userId);

  if (error) {
    throw new Error(
      `Failed to clear SIP credential columns for user ${userId}: ${error.message}`
    );
  }
}

// Destroys the existing credential and issues a fresh one. For
// suspected-compromise rotation or manual re-provisioning.
export async function rotateSipCredentialForUser(
  userId: string
): Promise<ProvisionResult> {
  const admin = adminClient();
  const row = await loadUserRow(admin, userId);

  if (row.sip_credential_id) {
    await telnyxDeleteCredential(row.sip_credential_id);
  }

  const { error } = await admin
    .from("softphone_users")
    .update({
      sip_username: null,
      sip_credential_id: null,
      sip_password_encrypted: null,
      sip_provisioned_at: null,
    })
    .eq("id", userId);
  if (error) {
    throw new Error(
      `Failed to clear SIP credential columns during rotation for ${userId}: ${error.message}`
    );
  }

  return createSipCredentialForUser(userId, row.email || "");
}
