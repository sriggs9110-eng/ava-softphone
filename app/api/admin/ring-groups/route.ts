import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };

  const { data } = await supabase
    .from("softphone_users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!data || data.role !== "admin") {
    return { error: "Forbidden", status: 403 as const };
  }
  return { user };
}

type MemberInput = { user_id: string; priority?: number };

// GET — list groups with member counts
export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const admin = createAdminClient();
  const { data: groups, error } = await admin
    .from("ring_groups")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: members } = await admin
    .from("ring_group_members")
    .select("group_id, user_id, priority");

  const byGroup = new Map<string, { user_id: string; priority: number }[]>();
  (members || []).forEach((m) => {
    const list = byGroup.get(m.group_id) || [];
    list.push({ user_id: m.user_id, priority: m.priority });
    byGroup.set(m.group_id, list);
  });

  const enriched = (groups || []).map((g) => ({
    ...g,
    members: byGroup.get(g.id) || [],
    member_count: (byGroup.get(g.id) || []).length,
  }));

  return NextResponse.json(enriched);
}

// POST — create group with members
export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json();
  const {
    name,
    inbound_number,
    strategy = "simultaneous",
    ring_timeout_seconds = 20,
    fallback_action = "hangup",
    members = [] as MemberInput[],
  } = body ?? {};

  if (!name || !inbound_number) {
    return NextResponse.json(
      { error: "name and inbound_number are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: group, error } = await admin
    .from("ring_groups")
    .insert({
      name,
      inbound_number,
      strategy,
      ring_timeout_seconds,
      fallback_action,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(members) && members.length > 0) {
    const rows = (members as MemberInput[]).map((m) => ({
      group_id: group.id,
      user_id: m.user_id,
      priority: m.priority ?? 1,
    }));
    const { error: memErr } = await admin.from("ring_group_members").insert(rows);
    if (memErr) {
      console.error("[ring-groups] member insert failed:", memErr.message);
    }
  }

  return NextResponse.json(group);
}

// PATCH — update group fields and/or replace membership
export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json();
  const { id, members, ...updates } = body ?? {};
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();

  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from("ring_groups").update(updates).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (Array.isArray(members)) {
    await admin.from("ring_group_members").delete().eq("group_id", id);
    if (members.length > 0) {
      const rows = (members as MemberInput[]).map((m) => ({
        group_id: id,
        user_id: m.user_id,
        priority: m.priority ?? 1,
      }));
      const { error: memErr } = await admin.from("ring_group_members").insert(rows);
      if (memErr) {
        return NextResponse.json({ error: memErr.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ success: true });
}

// DELETE — remove group (members cascade)
export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin();
  if ("error" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.from("ring_groups").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
