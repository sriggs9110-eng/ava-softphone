import { createClient } from "@/lib/supabase/client";

export type PipelineStatus =
  | "pending"
  | "processing"
  | "complete"
  | "failed"
  | "none";

export interface CallLog {
  id: string;
  user_id: string;
  direction: "inbound" | "outbound";
  phone_number: string;
  status: string;
  duration_seconds: number;
  recording_url: string | null;
  recording_id?: string | null;
  call_control_id: string | null;
  call_session_id: string | null;
  from_number: string | null;
  transcript: string | null;
  transcript_status?: PipelineStatus | null;
  transcript_error?: string | null;
  ai_summary: string | null;
  ai_score: number | null;
  ai_analysis: Record<string, unknown> | null;
  ai_status?: PipelineStatus | "skipped_no_transcript" | null;
  notes: string | null;
  created_at: string;
  // Joined fields
  agent_name?: string;
}

export async function insertCallLog(log: {
  user_id: string;
  direction: "inbound" | "outbound";
  phone_number: string;
  status?: string;
  call_control_id?: string;
  from_number?: string;
  external_id?: string | null;
}): Promise<CallLog | null> {
  const supabase = createClient();
  const insertRow: Record<string, unknown> = {
    user_id: log.user_id,
    direction: log.direction,
    phone_number: log.phone_number,
    status: log.status || "initiated",
    call_control_id: log.call_control_id || null,
    from_number: log.from_number || null,
  };
  if (log.external_id) insertRow.external_id = log.external_id;
  const { data, error } = await supabase
    .from("call_logs")
    .insert(insertRow)
    .select()
    .single();

  if (error) {
    console.error("insertCallLog error:", error);
    return null;
  }
  return data as CallLog;
}

export async function updateCallLog(
  id: string,
  updates: Partial<
    Pick<
      CallLog,
      | "status"
      | "duration_seconds"
      | "recording_url"
      | "call_control_id"
      | "transcript"
      | "ai_summary"
      | "ai_score"
      | "ai_analysis"
      | "notes"
    >
  >
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("call_logs")
    .update(updates)
    .eq("id", id);

  if (error) {
    console.error("updateCallLog error:", error);
  }
}

export async function fetchCallLogs(options?: {
  limit?: number;
  userId?: string;
}): Promise<CallLog[]> {
  const supabase = createClient();
  let query = supabase
    .from("call_logs")
    .select("*, softphone_users!call_logs_user_id_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(options?.limit || 100);

  if (options?.userId) {
    query = query.eq("user_id", options.userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("fetchCallLogs error:", error);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data || []).map((row: any) => {
    const agentName = row.softphone_users?.full_name || undefined;
    const { softphone_users: _, ...rest } = row;
    return { ...rest, agent_name: agentName } as CallLog;
  });
}

export async function fetchCallLogsForReports(): Promise<CallLog[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("call_logs")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchCallLogsForReports error:", error);
    return [];
  }

  return (data || []) as CallLog[];
}

export async function fetchTranscripts(): Promise<CallLog[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("call_logs")
    .select("*, softphone_users!call_logs_user_id_fkey(full_name)")
    .not("transcript", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchTranscripts error:", error);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data || []).map((row: any) => {
    const agentName = row.softphone_users?.full_name || undefined;
    const { softphone_users: _, ...rest } = row;
    return { ...rest, agent_name: agentName } as CallLog;
  });
}
