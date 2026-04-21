/**
 * Audit: which Telnyx connection each phone number on this account is
 * routed through, and the webhook URL configured on each connection.
 *
 * Use this when inbound calls fail ("Your call cannot be completed at
 * this time") — confirms whether numbers are pointed at the Call
 * Control App (correct) or a SIP credential connection (webhook-less,
 * will fail at the carrier).
 *
 * Does NOT modify anything. Read-only.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/audit-number-routing.ts
 *
 * Required env:
 *   TELNYX_API_KEY
 *   TELNYX_CONNECTION_ID          (credential connection, for reference)
 *   TELNYX_CALL_CONTROL_APP_ID    (call control app, for reference)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export {};

const TELNYX_API = "https://api.telnyx.com/v2";

type TelnyxResponse<T> = { data?: T; errors?: Array<{ detail?: string }> };

async function telnyxGet(
  path: string,
  apiKey: string
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${TELNYX_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function short(obj: any): string {
  return JSON.stringify(obj, null, 2);
}

async function fetchAllPhoneNumbers(apiKey: string): Promise<any[]> {
  const results: any[] = [];
  let page = 1;
  const pageSize = 250;
  while (true) {
    const path = `/phone_numbers?page[number]=${page}&page[size]=${pageSize}`;
    const { status, body } = await telnyxGet(path, apiKey);
    if (status !== 200) {
      console.error(`[phone_numbers page=${page}] HTTP ${status}`);
      console.error(short(body));
      return results;
    }
    const data = (body.data || []) as any[];
    results.push(...data);
    const meta = body.meta || {};
    const totalPages = meta.total_pages || 1;
    if (page >= totalPages) break;
    page += 1;
  }
  return results;
}

async function describeConnection(
  connectionId: string,
  apiKey: string
): Promise<{ type: string; webhookUrl: string; raw: any }> {
  // Try call_control_applications first, then credential_connections,
  // then the generic connections endpoint. Reports which one matched.
  const tries = [
    {
      type: "call_control_application",
      path: `/call_control_applications/${connectionId}`,
    },
    {
      type: "credential_connection",
      path: `/credential_connections/${connectionId}`,
    },
    { type: "connection", path: `/connections/${connectionId}` },
  ];

  for (const t of tries) {
    const { status, body } = await telnyxGet(t.path, apiKey);
    if (status === 200 && body?.data) {
      const d = body.data;
      const webhookUrl =
        d.webhook_event_url || d.inbound?.webhook_event_url || "";
      return { type: t.type, webhookUrl, raw: d };
    }
  }
  return {
    type: "unknown",
    webhookUrl: "",
    raw: { error: `connection ${connectionId} not found under any endpoint` },
  };
}

async function main() {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    console.error("Missing TELNYX_API_KEY");
    process.exit(1);
  }
  const credConnId = process.env.TELNYX_CONNECTION_ID;
  const callAppId = process.env.TELNYX_CALL_CONTROL_APP_ID;

  console.log("=".repeat(72));
  console.log("Reference connections");
  console.log("=".repeat(72));

  if (credConnId) {
    const { status, body } = await telnyxGet(
      `/credential_connections/${credConnId}`,
      apiKey
    );
    console.log(`\nTELNYX_CONNECTION_ID = ${credConnId}`);
    console.log(`GET /credential_connections/${credConnId} → HTTP ${status}`);
    if (status === 200 && body?.data) {
      const d = body.data;
      console.log(
        `  name=${d.connection_name || d.name} active=${d.active} webhook_event_url=${d.webhook_event_url || "(none)"}`
      );
      console.log(
        `  inbound.webhook_event_url=${d.inbound?.webhook_event_url || "(none)"}`
      );
    } else {
      console.log(short(body));
    }
  } else {
    console.log("TELNYX_CONNECTION_ID not set");
  }

  if (callAppId) {
    const { status, body } = await telnyxGet(
      `/call_control_applications/${callAppId}`,
      apiKey
    );
    console.log(`\nTELNYX_CALL_CONTROL_APP_ID = ${callAppId}`);
    console.log(
      `GET /call_control_applications/${callAppId} → HTTP ${status}`
    );
    if (status === 200 && body?.data) {
      const d = body.data;
      console.log(
        `  application_name=${d.application_name} active=${d.active} webhook_event_url=${d.webhook_event_url || "(none)"}`
      );
    } else {
      console.log(short(body));
    }
  } else {
    console.log("TELNYX_CALL_CONTROL_APP_ID not set");
  }

  console.log("\n" + "=".repeat(72));
  console.log("Phone numbers");
  console.log("=".repeat(72));

  const numbers = await fetchAllPhoneNumbers(apiKey);
  console.log(`Found ${numbers.length} phone numbers on the account`);

  const connectionCache = new Map<
    string,
    { type: string; webhookUrl: string; raw: any }
  >();

  // Per-connection totals.
  const byConnection = new Map<string, number>();
  let unassigned = 0;

  for (const n of numbers) {
    const phone = n.phone_number;
    const connectionId: string | undefined = n.connection_id;
    const status: string | undefined = n.status;
    const tags: string[] = n.tags || [];

    if (!connectionId) {
      unassigned += 1;
      console.log(
        `\n${phone}  status=${status}  connection_id=(none)  ← unassigned`
      );
      continue;
    }

    if (!connectionCache.has(connectionId)) {
      const desc = await describeConnection(connectionId, apiKey);
      connectionCache.set(connectionId, desc);
    }
    const desc = connectionCache.get(connectionId)!;

    byConnection.set(connectionId, (byConnection.get(connectionId) || 0) + 1);

    const flag =
      connectionId === callAppId
        ? "✓ Call Control App"
        : connectionId === credConnId
        ? "⚠ Credential connection (SIP trunk) — inbound will have no webhook"
        : "? other";

    console.log(
      `\n${phone}  status=${status}  tags=${JSON.stringify(tags)}`
    );
    console.log(`  connection_id=${connectionId}`);
    console.log(`  connection type=${desc.type} → ${flag}`);
    console.log(`  connection webhook_event_url=${desc.webhookUrl || "(none)"}`);
  }

  console.log("\n" + "=".repeat(72));
  console.log("Summary");
  console.log("=".repeat(72));
  console.log(`Total numbers: ${numbers.length}`);
  console.log(`Unassigned to any connection: ${unassigned}`);
  for (const [cid, count] of byConnection) {
    const desc = connectionCache.get(cid);
    const label =
      cid === callAppId
        ? `Call Control App (${cid})`
        : cid === credConnId
        ? `Credential connection (${cid})`
        : `Other connection (${cid}) type=${desc?.type}`;
    console.log(
      `  ${count} number(s) → ${label}  webhook=${desc?.webhookUrl || "(none)"}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
