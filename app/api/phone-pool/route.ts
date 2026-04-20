import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Authenticated read-only endpoint for the active pool.
// Used by the client-side local-presence module. We explicitly disable any
// HTTP-layer caching so admin writes to phone_number_pool are visible on
// the next client fetch without waiting for a TTL.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("phone_number_pool")
    .select("id, phone_number, area_code, is_active")
    .eq("is_active", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data || [];
  console.log(
    "[/api/phone-pool] returning rows:",
    rows.map((r) => ({
      phone_number: r.phone_number,
      area_code: r.area_code,
      area_code_len: (r.area_code as string | null)?.length,
      is_active: r.is_active,
    }))
  );

  return NextResponse.json(rows, {
    headers: { "Cache-Control": "no-store" },
  });
}
