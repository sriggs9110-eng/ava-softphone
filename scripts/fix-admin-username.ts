/**
 * One-time fix for softphone_users rows whose full_name is a placeholder
 * ("Admin", "Admin User", "Manager", "Agent", "User") rather than a real
 * name. Rewrites full_name from the auth.users email local-part so the
 * homepage greeting reads naturally.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/fix-admin-username.ts
 *   npx tsx --env-file=.env.local scripts/fix-admin-username.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/fix-admin-username.ts \
 *     --email=sriggs9110@gmail.com
 *
 * Safe to re-run — skips any row whose full_name doesn't match the
 * placeholder pattern.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export {};

const PLACEHOLDER_WORDS = ["admin", "manager", "agent", "user"];

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] || "";
  if (!local) return "";
  const tokens = local
    .split(/[._-]/)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return tokens[0];
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const emailFlag = args.find((a) => a.startsWith("--email="));
  const onlyEmail = emailFlag ? emailFlag.split("=")[1] : null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: users, error } = await admin
    .from("softphone_users")
    .select("id, email, full_name");
  if (error) {
    console.error("Failed to list softphone_users:", error.message);
    process.exit(1);
  }

  let fixed = 0;
  let skipped = 0;
  for (const u of (users || []) as Array<{
    id: string;
    email: string | null;
    full_name: string | null;
  }>) {
    if (onlyEmail && u.email !== onlyEmail) continue;

    const raw = (u.full_name || "").trim();
    const firstWord = raw.split(/\s+/)[0]?.toLowerCase() || "";
    const isPlaceholder = !raw || PLACEHOLDER_WORDS.includes(firstWord);
    if (!isPlaceholder) {
      skipped += 1;
      continue;
    }

    const derived = u.email ? nameFromEmail(u.email) : "";
    if (!derived) {
      console.log(`- skip ${u.id} — no email to derive from`);
      skipped += 1;
      continue;
    }

    // If the derived name is ALSO a placeholder (admin@ava.com), the
    // greeting fallback in lib/home/dashboard.ts will land on "there".
    // Nothing to write here.
    const derivedFirst = derived.split(/\s+/)[0]?.toLowerCase() || "";
    if (PLACEHOLDER_WORDS.includes(derivedFirst)) {
      console.log(`- skip ${u.email} — derived "${derived}" is also a placeholder`);
      skipped += 1;
      continue;
    }

    console.log(
      `- ${u.email || u.id}: "${raw || "(empty)"}" → "${derived}"${dry ? " [dry-run]" : ""}`
    );
    if (!dry) {
      const { error: upErr } = await admin
        .from("softphone_users")
        .update({ full_name: derived })
        .eq("id", u.id);
      if (upErr) {
        console.error(`  update failed:`, upErr.message);
        continue;
      }
      fixed += 1;
    }
  }

  console.log(
    `\nDone. ${dry ? "Would fix" : "Fixed"} ${fixed}, skipped ${skipped}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
