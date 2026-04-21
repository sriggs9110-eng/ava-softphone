"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  ChevronDown,
  ChevronRight,
  Phone,
  Voicemail as VoicemailIcon,
  Check,
  X as XIcon,
  Loader,
  RotateCw,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import PepperMascot from "@/components/pepper/PepperMascot";

type VmStatus = "new" | "handled" | "ignored";
type TStatus = "pending" | "processing" | "complete" | "failed" | "none";

interface Voicemail {
  id: string;
  ring_group_id: string | null;
  caller_number: string;
  called_number: string;
  recording_url: string | null;
  recording_telnyx_id: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  transcript_status: TStatus;
  status: VmStatus;
  handled_by: string | null;
  handled_at: string | null;
  handled_note: string | null;
  created_at: string;
  // joined
  group_name?: string;
}

type Filter = "new" | "handled" | "all";

export default function VoicemailsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [voicemails, setVoicemails] = useState<Voicemail[]>([]);
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>("new");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: vms } = await supabase
      .from("voicemails")
      .select("*")
      .order("created_at", { ascending: false });
    const { data: gs } = await supabase
      .from("ring_groups")
      .select("id, name");
    const groupMap: Record<string, string> = {};
    for (const g of (gs || []) as Array<{ id: string; name: string }>) {
      groupMap[g.id] = g.name;
    }
    setGroups(groupMap);
    setVoicemails((vms || []) as Voicemail[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?next=/voicemails");
      return;
    }
    load();
  }, [authLoading, user, load, router]);

  // Realtime: refresh on any voicemails change so new messages appear
  // without reload and status transitions stay in sync across tabs.
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel("voicemails-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voicemails" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const filtered = useMemo(() => {
    return voicemails.filter((v) => {
      if (filter === "new") return v.status === "new";
      if (filter === "handled") return v.status === "handled";
      return true;
    });
  }, [voicemails, filter]);

  const onMarkHandled = async (vm: Voicemail) => {
    const note = prompt(
      "Optional note about how this was handled:",
      vm.handled_note || ""
    );
    if (note === null) return;
    const supabase = createClient();
    await supabase
      .from("voicemails")
      .update({
        status: "handled",
        handled_by: user?.id,
        handled_at: new Date().toISOString(),
        handled_note: note || null,
      })
      .eq("id", vm.id);
    load();
  };

  const onIgnore = async (vm: Voicemail) => {
    const supabase = createClient();
    await supabase
      .from("voicemails")
      .update({ status: "ignored" })
      .eq("id", vm.id);
    load();
  };

  const onCallBack = (vm: Voicemail) => {
    // Pop the phone view with the number pre-filled. We use sessionStorage
    // so the main page can pick it up on mount without URL noise.
    try {
      sessionStorage.setItem("pepper:dial-number", vm.caller_number);
    } catch {
      // noop
    }
    router.push("/");
  };

  const retryTranscription = async (vm: Voicemail) => {
    await fetch("/api/ai/transcribe-voicemail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voicemail_id: vm.id }),
    });
    load();
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-slate" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream pepper-gradients">
      <div className="relative z-[1] max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-2">
          <Link
            href="/"
            className="w-10 h-10 rounded-[14px] bg-paper border-[2.5px] border-navy flex items-center justify-center text-navy shadow-pop-sm shadow-pop-hover"
            aria-label="Back to Pepper"
          >
            <ArrowLeft size={16} />
          </Link>
          <h1 className="text-3xl font-semibold text-navy font-display">
            Voicemails
          </h1>
        </div>
        <p className="text-[12px] text-slate mb-6 uppercase tracking-[0.5px] font-bold ml-[52px]">
          Ring-group messages left when nobody picked up
        </p>

        <div className="flex items-center gap-2 mb-5">
          {(["new", "handled", "all"] as const).map((f, i) => {
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 text-[12px] font-bold uppercase tracking-wider rounded-full border-[2.5px] border-navy transition-colors ${
                  active ? "bg-banana text-navy shadow-pop-sm" : "bg-paper text-navy hover:bg-cream-2"
                } ${i > 0 ? "" : ""}`}
              >
                {f}
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <ul className="space-y-3">
            {filtered.map((vm) => (
              <VoicemailCard
                key={vm.id}
                vm={vm}
                groupName={
                  vm.ring_group_id ? groups[vm.ring_group_id] : undefined
                }
                expanded={expandedId === vm.id}
                onToggle={() =>
                  setExpandedId((cur) => (cur === vm.id ? null : vm.id))
                }
                onCallBack={() => onCallBack(vm)}
                onMarkHandled={() => onMarkHandled(vm)}
                onIgnore={() => onIgnore(vm)}
                onRetryTranscription={() => retryTranscription(vm)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function VoicemailCard({
  vm,
  groupName,
  expanded,
  onToggle,
  onCallBack,
  onMarkHandled,
  onIgnore,
  onRetryTranscription,
}: {
  vm: Voicemail;
  groupName: string | undefined;
  expanded: boolean;
  onToggle: () => void;
  onCallBack: () => void;
  onMarkHandled: () => void;
  onIgnore: () => void;
  onRetryTranscription: () => void;
}) {
  const statusBadge =
    vm.status === "new"
      ? { bg: "bg-banana text-navy", label: "New" }
      : vm.status === "handled"
      ? { bg: "bg-leaf text-white", label: "Handled" }
      : { bg: "bg-slate-2 text-white", label: "Ignored" };

  return (
    <li className="bg-paper border-[2.5px] border-navy rounded-[18px] shadow-pop-md overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 flex items-center gap-3 hover:bg-cream-3 transition-colors text-left"
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-navy font-display tabular-nums truncate">
            {vm.caller_number}
          </p>
          <p className="text-[12px] text-slate truncate">
            {groupName || "Ring group"} · {formatRelative(vm.created_at)}
          </p>
        </div>
        <span className="text-[12px] text-slate tabular-nums shrink-0">
          {formatDur(vm.duration_seconds ?? 0)}
        </span>
        <span
          className={`px-2 py-0.5 rounded-full border-[1.5px] border-navy text-[10px] font-bold uppercase tracking-wider shrink-0 ${statusBadge.bg}`}
        >
          {statusBadge.label}
        </span>
      </button>

      {expanded && (
        <div className="border-t-2 border-navy bg-cream-3 px-5 py-4 space-y-4">
          {vm.recording_url ? (
            <audio
              controls
              src={vm.recording_url}
              className="w-full h-10"
              preload="metadata"
            />
          ) : (
            <p className="text-[12px] text-slate italic">
              Recording not yet available.
            </p>
          )}

          <div>
            <p className="text-[11px] text-navy uppercase tracking-wider font-bold mb-1.5">
              Transcript
            </p>
            <TranscriptBlock
              status={vm.transcript_status}
              transcript={vm.transcript}
              onRetry={onRetryTranscription}
            />
          </div>

          {vm.handled_note && (
            <div className="bg-cream-2 border-2 border-navy rounded-[10px] px-3 py-2">
              <p className="text-[11px] text-navy uppercase tracking-wider font-bold mb-0.5">
                Handled note
              </p>
              <p className="text-[13px] text-navy">{vm.handled_note}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onCallBack}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-banana border-[2.5px] border-navy text-navy text-[13px] font-bold shadow-pop-sm shadow-pop-hover"
            >
              <Phone size={13} />
              Call back
            </button>
            {vm.status !== "handled" && (
              <button
                onClick={onMarkHandled}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-paper border-2 border-navy text-navy text-[13px] font-semibold shadow-pop-sm shadow-pop-hover"
              >
                <Check size={13} />
                Mark handled
              </button>
            )}
            {vm.status === "new" && (
              <button
                onClick={onIgnore}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-transparent border-2 border-navy text-navy text-[13px] font-semibold"
              >
                <XIcon size={13} />
                Ignore
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function TranscriptBlock({
  status,
  transcript,
  onRetry,
}: {
  status: TStatus;
  transcript: string | null;
  onRetry: () => void;
}) {
  if (status === "complete" && transcript) {
    return (
      <p className="text-[13px] text-navy-2 leading-relaxed bg-paper border-2 border-navy rounded-[10px] px-3 py-2 whitespace-pre-wrap">
        {transcript}
      </p>
    );
  }
  if (status === "processing" || status === "pending") {
    return (
      <p className="text-[13px] text-slate inline-flex items-center gap-1.5">
        <Loader size={12} className="animate-spin" />
        Transcribing…
      </p>
    );
  }
  if (status === "failed") {
    return (
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="text-coral-deep" />
        <p className="text-[13px] text-navy">Transcription failed.</p>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-navy underline decoration-coral decoration-2 underline-offset-2"
        >
          <RotateCw size={11} />
          Retry
        </button>
      </div>
    );
  }
  return (
    <p className="text-[13px] text-slate italic">
      No transcript available.
    </p>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const msg =
    filter === "new"
      ? "No new voicemails. Pepper will drop them here when nobody answers a ring-group call."
      : filter === "handled"
      ? "No handled voicemails yet."
      : "No voicemails yet. When no one answers a ring group call, messages land here.";
  return (
    <div className="flex flex-col items-center text-center py-16 px-6">
      <PepperMascot size="md" state="listening" />
      <h3 className="mt-4 text-xl font-semibold text-navy font-display flex items-center gap-2">
        <VoicemailIcon size={18} />
        Quiet inbox
      </h3>
      <p className="mt-1 text-[14px] text-slate max-w-sm font-accent text-lg leading-snug">
        {msg}
      </p>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDur(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, Math.floor(seconds % 60));
  return `${m}:${s.toString().padStart(2, "0")}`;
}
