import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDigestData } from "@/lib/reports/digest-data";
import { renderDigestHtml, digestSubject } from "@/lib/reports/digest-email";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const test = url.searchParams.get("test") === "true";
  const recipientOverride = url.searchParams.get("recipient");

  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>. We skip the check
  // in test mode so Stephen can poke the endpoint from a browser.
  const cronSecret = process.env.CRON_SECRET;
  if (!test && cronSecret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn(
      "[weekly-digest] RESEND_API_KEY missing — no emails will be sent"
    );
    return NextResponse.json(
      { error: "RESEND_API_KEY not configured" },
      { status: 503 }
    );
  }

  const fromAddress =
    process.env.DIGEST_FROM_ADDRESS || "Pepper <digest@trypepper.com>";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://ava-softphone.vercel.app";

  const admin = createAdminClient();

  // Build the team digest data once — same for every manager in a single-team
  // org. (Multi-tenant teams would scope userIds per team here.)
  const data = await buildDigestData(admin);
  const html = renderDigestHtml(data, appUrl);
  const subject = digestSubject(data);

  const { Resend } = await import("resend");
  const resend = new Resend(resendKey);

  // Test mode: one email to the override address, skip opt-in check.
  if (test && recipientOverride) {
    try {
      const r = await resend.emails.send({
        from: fromAddress,
        to: recipientOverride,
        subject: `[TEST] ${subject}`,
        html,
      });
      console.log("[weekly-digest] test send", r);
      return NextResponse.json({ ok: true, test: true, recipient: recipientOverride, id: r.data?.id });
    } catch (err) {
      console.error("[weekly-digest] test send failed:", err);
      return NextResponse.json(
        { ok: false, error: (err as Error).message },
        { status: 500 }
      );
    }
  }

  // Production mode: iterate managers/admins who've opted in.
  const { data: recipients, error } = await admin
    .from("softphone_users")
    .select("id, email, full_name, role, weekly_digest_enabled")
    .in("role", ["manager", "admin"])
    .eq("weekly_digest_enabled", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ email: string; ok: boolean; id?: string; error?: string }> = [];
  for (const r of (recipients || []) as Array<{ email: string; full_name: string }>) {
    try {
      const send = await resend.emails.send({
        from: fromAddress,
        to: r.email,
        subject,
        html,
      });
      results.push({ email: r.email, ok: true, id: send.data?.id });
      console.log(`[weekly-digest] sent to ${r.email}: ${send.data?.id}`);
    } catch (err) {
      results.push({
        email: r.email,
        ok: false,
        error: (err as Error).message,
      });
      console.error(`[weekly-digest] send to ${r.email} failed:`, err);
    }
    // Gentle pacing — Resend supports batching but this is simple and safe.
    await new Promise((res) => setTimeout(res, 250));
  }

  return NextResponse.json({
    ok: true,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
