// Local-presence outbound dialing: pick a `from` number whose area code
// matches the prospect's area code. Pool is stored in phone_number_pool.
//
// Cache the full active pool in-memory with a short TTL. Works on both
// server (reads directly via Supabase) and client (reads via /api/phone-pool).
//
// Logs are intentionally permanent. On the server they land in Vercel logs;
// on the client they surface in the browser console during a dial, which is
// where you need them when debugging why a rep's call picked the wrong CID.

type PoolRow = {
  id: string;
  phone_number: string;
  area_code: string;
  is_active: boolean;
};

type CacheEntry = {
  rows: PoolRow[];
  fetchedAt: number;
};

// 10s TTL bounds worst-case staleness after an admin adds or toggles a
// number. Browser tabs that pre-date the change will pick up the new row
// within ~10s without a hard reload.
const CACHE_TTL_MS = 10_000;
let cache: CacheEntry | null = null;
let inFlight: Promise<PoolRow[]> | null = null;

function defaultFromNumber(): string {
  const fallback =
    (typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER
      : process.env.TELNYX_PHONE_NUMBER ||
        process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER) || "";
  return fallback;
}

function extractAreaCode(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.substring(1, 4);
  if (digits.length === 10) return digits.substring(0, 3);
  if (digits.length > 11 && digits.startsWith("1")) return digits.substring(1, 4);
  return null;
}

function normalizeAreaCode(raw: unknown): string | null {
  if (typeof raw !== "string") {
    if (typeof raw === "number") return String(raw).padStart(3, "0");
    return null;
  }
  // Guard against stored values that slipped through as "251 ", "+1251",
  // or similar by stripping non-digits and taking the last 3.
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-3);
}

async function fetchPool(): Promise<PoolRow[]> {
  if (typeof window === "undefined") {
    // Server path — uses service role when available.
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      console.warn("[local-presence] no SUPABASE creds — returning empty pool");
      return [];
    }

    const admin = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin
      .from("phone_number_pool")
      .select("id, phone_number, area_code, is_active")
      .eq("is_active", true);
    if (error) {
      console.error("[local-presence] server fetch failed:", error.message);
      return [];
    }
    const rows = (data as PoolRow[]) || [];
    console.log(
      "[local-presence] server pool rows:",
      rows.map((r) => ({
        phone_number: r.phone_number,
        area_code: r.area_code,
        area_code_len: r.area_code?.length,
        is_active: r.is_active,
      }))
    );
    return rows;
  }

  // Client path
  try {
    const res = await fetch("/api/phone-pool", { cache: "no-store" });
    if (!res.ok) {
      console.warn("[local-presence] /api/phone-pool status", res.status);
      return [];
    }
    const data = (await res.json()) as PoolRow[];
    const rows = data || [];
    console.log(
      "[local-presence] client pool rows:",
      rows.map((r) => ({
        phone_number: r.phone_number,
        area_code: r.area_code,
        area_code_len: r.area_code?.length,
        is_active: r.is_active,
      }))
    );
    return rows;
  } catch (err) {
    console.error("[local-presence] client fetch failed:", err);
    return [];
  }
}

async function getPool(forceRefresh = false): Promise<PoolRow[]> {
  const now = Date.now();
  if (!forceRefresh && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rows;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const rows = await fetchPool();
    cache = { rows, fetchedAt: Date.now() };
    return rows;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export async function getLocalNumber(prospectPhone: string): Promise<string> {
  const fallback = defaultFromNumber();
  console.log("[local-presence] input:", prospectPhone);

  const area = extractAreaCode(prospectPhone);
  console.log("[local-presence] extracted area code:", area);

  if (!area) {
    console.log("[local-presence] no area code — falling back to default:", fallback);
    return fallback;
  }

  let pool = await getPool();
  let matches = pool.filter(
    (p) => normalizeAreaCode(p.area_code) === area && p.is_active
  );
  console.log(
    "[local-presence] pool matches:",
    matches.map((m) => m.phone_number)
  );

  // Retry once on miss: the in-memory cache may be stale if an admin added a
  // new number after this tab loaded. One forced refresh covers that without
  // extra traffic on the happy path.
  if (matches.length === 0) {
    console.log("[local-presence] miss — forcing cache refresh and retrying");
    pool = await getPool(true);
    matches = pool.filter(
      (p) => normalizeAreaCode(p.area_code) === area && p.is_active
    );
    console.log(
      "[local-presence] pool matches (after refresh):",
      matches.map((m) => m.phone_number)
    );
  }

  const selected = matches[0]?.phone_number || fallback;
  console.log("[local-presence] selected:", selected);
  return selected;
}

/** Forces the next getLocalNumber() call to re-fetch the pool. Call after admin writes. */
export function invalidatePoolCache() {
  cache = null;
  console.log("[local-presence] cache invalidated");
}
