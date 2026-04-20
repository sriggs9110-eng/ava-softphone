import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Authenticated read-only endpoint for the active pool.
// Used by the client-side local-presence module (cached 60s per client).
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

  return NextResponse.json(data || [], {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
