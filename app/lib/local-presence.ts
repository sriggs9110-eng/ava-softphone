// Local-presence outbound dialing: pick a `from` number whose area code
// matches the prospect's area code. Pool is stored in phone_number_pool.
//
// Cache the full active pool in-memory for 60 seconds. Works on both
// server (reads directly via Supabase) and client (reads via /api/phone-pool).

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

const CACHE_TTL_MS = 60_000;
let cache: CacheEntry | null = null;
let inFlight: Promise<PoolRow[]> | null = null;

function defaultFromNumber(): string {
  // Both env var names supported; NEXT_PUBLIC_ is readable client-side.
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

async function fetchPool(): Promise<PoolRow[]> {
  if (typeof window === "undefined") {
    // Server path — use service role if available, else anon via ssr client.
    // We avoid importing admin here to keep this module usable from the webhook
    // context without cookies; callers that don't have auth can still read
    // the active pool via the RLS "agents read pool" policy with any auth token,
    // OR via service role. For simplicity on the server, use service role when
    // available since local-presence runs during outbound call creation.
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return [];

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
    return (data as PoolRow[]) || [];
  }

  // Client path
  try {
    const res = await fetch("/api/phone-pool", { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as PoolRow[];
    return data || [];
  } catch (err) {
    console.error("[local-presence] client fetch failed:", err);
    return [];
  }
}

async function getPool(): Promise<PoolRow[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
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
  const area = extractAreaCode(prospectPhone);
  if (!area) return fallback;

  const pool = await getPool();
  const match = pool.find((p) => p.area_code === area && p.is_active);
  return match?.phone_number || fallback;
}

/** Forces the next getLocalNumber() call to re-fetch the pool. Call after admin writes. */
export function invalidatePoolCache() {
  cache = null;
}
