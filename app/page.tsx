"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTelnyxClient, CallEndInfo } from "@/app/hooks/useTelnyxClient";
import { useRingGroup } from "@/app/hooks/useRingGroup";
import { useAuth } from "@/lib/auth-context";
import Sidebar, { NavPage } from "@/app/components/Sidebar";
import DialPad from "@/app/components/DialPad";
import ActiveCallUI from "@/app/components/ActiveCallUI";
import InboundCallUI from "@/app/components/InboundCallUI";
import TransferUI from "@/app/components/TransferUI";
import CallHistory from "@/app/components/CallHistory";
import CallHistoryPage from "@/app/components/CallHistoryPage";
import MonitorPage from "@/app/components/MonitorPage";
import ReportsPage from "@/app/components/ReportsPage";
import TranscriptsPage from "@/app/components/TranscriptsPage";
import AfterCallWork from "@/app/components/AfterCallWork";
import KeyboardShortcuts from "@/app/components/KeyboardShortcuts";
import MicError from "@/app/components/MicError";
import MissionControl from "@/app/components/home/MissionControl";
import RecentlyDialed from "@/app/components/home/RecentlyDialed";
import PostCallCelebration from "@/app/components/home/PostCallCelebration";
import type { DashboardPayload } from "@/lib/home/dashboard";
import { Loader2 } from "lucide-react";
import { insertCallLog, fetchCallLogs, CallLog } from "@/lib/call-logs";
import { CallHistoryEntry } from "@/app/lib/types";
import { useRouter } from "next/navigation";
import { formatUSPhone } from "@/lib/format-phone";

// Resolve the caller-ID to display on the inbound overlay.
//
// For server-orchestrated inbound (ring-group / fallback fan-out) the
// Telnyx SDK surfaces the SIP username of the outbound leg we dialed,
// not the actual caller — e.g. "gencredSkgd8M1u1tI3...". The Realtime
// broadcast carries the verified original caller number from the
// webhook payload, so we prefer that. The SDK value is only used as a
// fallback for direct-to-endpoint inbound (no ring-group orchestration)
// and only if it's actually phone-shaped.
function resolveCallerNumber(
  realtimeFrom: string | null | undefined,
  sdkCallerNumber: string | null | undefined
): string {
  if (realtimeFrom) return realtimeFrom;
  if (sdkCallerNumber && /^\+?\d{7,15}$/.test(sdkCallerNumber)) {
    return sdkCallerNumber;
  }
  return "Unknown";
}

const PAGE_TITLES: Record<NavPage, { title: string; subtitle: string }> = {
  phone: { title: "Phone", subtitle: "Make or receive calls" },
  history: { title: "Call History", subtitle: "Review past calls & AI analysis" },
  voicemails: { title: "Voicemails", subtitle: "Ring-group messages" },
  monitor: { title: "Live Monitoring", subtitle: "Manager view" },
  reports: { title: "Reports", subtitle: "Call analytics & metrics" },
  transcripts: { title: "Transcripts", subtitle: "Search call transcripts" },
  settings: { title: "Settings", subtitle: "Configuration" },
};

// Convert Supabase call_log to legacy CallHistoryEntry for compatibility
function callLogToEntry(log: CallLog): CallHistoryEntry {
  const statusMap: Record<string, CallHistoryEntry["status"]> = {
    completed: "completed",
    missed: "missed",
    declined: "rejected",
    voicemail: "voicemail",
    no_answer: "no-answer",
    initiated: "missed",
    ringing: "missed",
    connected: "completed",
  };

  let parsedTranscript;
  if (log.transcript) {
    try {
      parsedTranscript = JSON.parse(log.transcript);
    } catch {
      // If it's not JSON, leave as undefined
    }
  }

  let parsedAnalysis;
  if (log.ai_analysis) {
    parsedAnalysis = log.ai_analysis as unknown as CallHistoryEntry["aiAnalysis"];
  }

  return {
    id: log.id,
    number: log.phone_number,
    direction: log.direction,
    duration: log.duration_seconds,
    timestamp: new Date(log.created_at).getTime(),
    status: statusMap[log.status] || "completed",
    recordingUrl: log.recording_url || undefined,
    aiAnalysis: parsedAnalysis,
    transcript: parsedTranscript,
    transcriptStatus: log.transcript_status ?? undefined,
    transcriptError: log.transcript_error ?? undefined,
    aiStatus: log.ai_status ?? undefined,
  };
}

export default function Home() {
  const { user, isManager, loading: authLoading, updateStatus } = useAuth();
  const router = useRouter();

  const {
    connectionStatus,
    activeCall,
    inboundCall,
    callHistory: localCallHistory,
    micError,
    transferCall,
    agentStatus,
    acwCountdown,
    qualityLevel,
    latency,
    packetLoss,
    audioRef,
    makeCall,
    answerCall,
    rejectCall,
    hangup,
    toggleMute,
    toggleHold,
    sendDTMF,
    blindTransfer,
    initiateTransfer,
    completeTransfer,
    cancelTransfer,
    mergeConference,
    voicemailDrop,
    changeAgentStatus,
    setCallHistory: setLocalCallHistory,
  } = useTelnyxClient(handleCallEnd);

  const [activePage, setActivePage] = useState<NavPage>("phone");
  const [showTransfer, setShowTransfer] = useState(false);
  const [showVmConfirm, setShowVmConfirm] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [supabaseEntries, setSupabaseEntries] = useState<CallHistoryEntry[]>([]);
  const activeCallLogIdRef = useRef<string | null>(null);

  // Voicemails "Call back" stashes the target number here. We consume it once
  // on mount so a refresh doesn't re-dial stale numbers.
  const [prefilledNumber, setPrefilledNumber] = useState<string | undefined>();
  useEffect(() => {
    try {
      const n = sessionStorage.getItem("pepper:dial-number");
      if (n) {
        setPrefilledNumber(n);
        sessionStorage.removeItem("pepper:dial-number");
      }
    } catch {
      // ignore
    }
  }, []);

  // Ref for the dial-pad input so TopBar's "Make a call" button can focus it.
  const dialPadInputRef = useRef<HTMLInputElement | null>(null);

  // Post-call celebration window: the 30s after hangup where we show the
  // "That one's in the books" card with the score animating in. Tracked by
  // the last call_log id + the window deadline timestamp.
  const [postCall, setPostCall] = useState<
    | { logId: string; until: number }
    | null
  >(null);
  const prevActiveCallRef = useRef<typeof activeCall>(null);
  useEffect(() => {
    // Fires on transitions: active-call present → null triggers the window.
    if (prevActiveCallRef.current && !activeCall) {
      const logId = activeCallLogIdRef.current;
      if (logId) {
        setPostCall({ logId, until: Date.now() + 30_000 });
      }
    }
    prevActiveCallRef.current = activeCall;
  }, [activeCall]);
  useEffect(() => {
    if (!postCall) return;
    const remaining = Math.max(0, postCall.until - Date.now());
    const t = setTimeout(() => setPostCall(null), remaining);
    return () => clearTimeout(t);
  }, [postCall]);
  const dismissPostCall = useCallback(() => setPostCall(null), []);

  // Recently dialed chips — sourced from the dashboard endpoint so we don't
  // duplicate the aggregation. Only used on the phone tab.
  const [recentlyDialed, setRecentlyDialed] = useState<
    DashboardPayload["recently_dialed"]
  >([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/home/dashboard");
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as DashboardPayload;
        setRecentlyDialed(body.recently_dialed);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCall, postCall]);

  // Cross-tab nav bus — ActivityRail / TeamPresence fire custom events that
  // we translate to activePage changes. Keeps those components decoupled
  // from the page-level state machine.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const detail = (e as CustomEvent<{ page?: NavPage }>).detail;
      if (detail?.page) setActivePage(detail.page);
    };
    window.addEventListener("pepper:navigate", onNavigate as EventListener);
    return () =>
      window.removeEventListener("pepper:navigate", onNavigate as EventListener);
  }, []);

  const { groupCall, pickupToast, claimPickup, dismissGroupCall } =
    useRingGroup({ userId: user?.id ?? null, currentUserName: user?.full_name });

  // Load call history from Supabase
  const loadCallLogs = useCallback(async () => {
    if (!user) return;
    const logs = await fetchCallLogs(isManager ? undefined : { userId: user.id });
    setSupabaseEntries(logs.map(callLogToEntry));
  }, [user, isManager]);

  useEffect(() => {
    loadCallLogs();
  }, [loadCallLogs]);

  // Called by the Telnyx hook on ANY call end (user hangup or remote hangup)
  // The webhook handles status + duration authoritatively — client just reloads
  function handleCallEnd(_info: CallEndInfo) {
    activeCallLogIdRef.current = null;
    // Give webhook time to process before reloading
    setTimeout(loadCallLogs, 2000);
  }

  // Sync agent status changes to Supabase
  const handleAgentStatusChange = useCallback(
    (status: typeof agentStatus) => {
      changeAgentStatus(status);
      const dbStatus: Record<string, string> = {
        available: "available",
        "on-call": "on_call",
        "after-call-work": "after_call_work",
        dnd: "dnd",
      };
      updateStatus(dbStatus[status] || status);
    },
    [changeAgentStatus, updateStatus]
  );

  // Create call log in Supabase when making/receiving a call
  const handleMakeCall = useCallback(
    async (number: string) => {
      // Server-originated outbound (default). Two-leg architecture so
      // that /actions/transfer can address the customer's PSTN leg
      // independently — fixes the long-running outbound transfer bug
      // where transfer kept the rep and dropped the customer. The
      // server inserts the call_logs row with external_ccid stamped
      // at originate time. The rep's SDK auto-answers the resulting
      // inbound INVITE via client_state matching (see useTelnyxClient).
      //
      // Set ?legacy_dial=1 to fall back to direct SDK.newCall for
      // emergency rollback without redeploying.
      const useLegacy =
        typeof window !== "undefined" &&
        new URL(window.location.href).searchParams.get("legacy_dial") === "1";

      if (useLegacy) {
        const ccid = await makeCall(number);
        if (user) {
          const log = await insertCallLog({
            user_id: user.id,
            direction: "outbound",
            phone_number: number,
            status: "initiated",
            call_control_id: ccid,
          });
          if (log) activeCallLogIdRef.current = log.id;
          console.log(
            "[Call] (legacy SDK) outbound log, ccid:",
            ccid,
            "logId:",
            log?.id
          );
        }
        return;
      }

      try {
        const res = await fetch("/api/telnyx/dial-outbound", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: number }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          repCcid?: string;
          customerCcid?: string;
          error?: string;
        };
        if (!res.ok || !data?.success) {
          console.error(
            "[Call] dial-outbound failed:",
            res.status,
            data?.error || "(no detail)"
          );
          return;
        }
        console.log(
          "[Call] outbound originated repCcid=",
          data.repCcid,
          "customerCcid=",
          data.customerCcid
        );
        // The server inserts call_logs at originate time, so we don't
        // need a client-side insertCallLog here. The rep's SDK will
        // auto-answer the inbound INVITE that lands shortly.
      } catch (err) {
        console.error("[Call] dial-outbound threw:", err);
      }
    },
    [makeCall, user]
  );

  const handleAnswerCall = useCallback(async () => {
    // Same caller-resolution as the overlay — groupCall.from is the
    // verified original caller from the Realtime broadcast; the SDK's
    // value is a SIP username on server-orchestrated fan-out legs and
    // would pollute call_logs.phone_number.
    const callerNumber = resolveCallerNumber(
      groupCall?.from,
      inboundCall?.options?.callerNumber
    );
    const ccid = answerCall();

    // If this was a ring-group call, notify the other members so their
    // overlays clear with a "picked up by …" toast.
    if (groupCall) {
      claimPickup({
        call_control_id: groupCall.call_control_id,
        group_id: groupCall.group_id,
        member_user_ids: groupCall.member_user_ids,
      }).catch(() => {});
      dismissGroupCall();
    }

    if (user) {
      const log = await insertCallLog({
        user_id: user.id,
        direction: "inbound",
        phone_number: callerNumber,
        status: "connected",
        call_control_id: ccid,
      });
      if (log) activeCallLogIdRef.current = log.id;
      console.log("[Call] Created inbound log, ccid:", ccid, "logId:", log?.id);
    }
  }, [answerCall, inboundCall, user, groupCall, claimPickup, dismissGroupCall]);

  const handleHangup = useCallback(() => {
    hangup();
  }, [hangup]);

  // Combine Supabase entries with any live local entries not yet in Supabase
  const callHistory = supabaseEntries.length > 0 ? supabaseEntries : localCallHistory;

  const recentNumbers = useMemo(
    () => [...new Set(callHistory.map((e) => e.number))],
    [callHistory]
  );

  const handleTransferClick = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        if (new URL(window.location.href).searchParams.get("transferDebug") === "1") {
          console.log("[TRANSFER-DEBUG] transfer button clicked");
        }
      } catch {}
    }
    setShowTransfer(true);
  }, []);
  const handleTransferBlind = useCallback(
    async (number: string) => {
      const ok = await blindTransfer(number);
      if (ok) setShowTransfer(false);
    },
    [blindTransfer]
  );
  const handleTransferDial = useCallback(
    (number: string) => initiateTransfer(number),
    [initiateTransfer]
  );
  const handleTransferComplete = useCallback(() => {
    completeTransfer();
    setShowTransfer(false);
  }, [completeTransfer]);
  const handleTransferCancel = useCallback(() => {
    cancelTransfer();
    setShowTransfer(false);
  }, [cancelTransfer]);
  const handleConference = useCallback(() => {
    mergeConference();
    setShowTransfer(false);
  }, [mergeConference]);

  const handleVmDrop = useCallback(() => setShowVmConfirm(true), []);
  const confirmVmDrop = useCallback(() => {
    voicemailDrop();
    setShowVmConfirm(false);
  }, [voicemailDrop]);

  const handleAcwReady = useCallback(() => {
    handleAgentStatusChange("available");
  }, [handleAgentStatusChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === "?" && !isInput) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }

      if (isInput && e.key !== "Escape" && e.key !== "Enter") return;

      if (e.key === "Escape") {
        if (showShortcuts) {
          setShowShortcuts(false);
          return;
        }
        if (activeCall) {
          e.preventDefault();
          handleHangup();
        }
        return;
      }

      if (e.key === "Enter" && !activeCall && activePage === "phone") return;
      if (!activeCall) return;

      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        toggleMute();
      } else if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        toggleHold();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCall, handleHangup, toggleMute, toggleHold, activePage, showShortcuts]);

  // Auth loading state
  if (authLoading) {
    return (
      <div className="flex w-full min-h-screen bg-bg-app items-center justify-center">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  const pageInfo =
    activePage === "phone" && activeCall
      ? { title: "Active Call", subtitle: "In progress" }
      : activePage === "phone" && agentStatus === "after-call-work"
      ? { title: "After Call Work", subtitle: "Wrap up your call" }
      : PAGE_TITLES[activePage];

  return (
    <div className="flex w-full min-h-screen bg-cream relative">
      <audio ref={audioRef} id="remote-audio" autoPlay playsInline />

      <Sidebar
        activePage={activePage}
        onNavigate={(page) => {
          if (page === "settings") {
            router.push("/settings");
            return;
          }
          if (page === "voicemails") {
            router.push("/voicemails");
            return;
          }
          setActivePage(page);
        }}
        connectionStatus={connectionStatus}
        agentStatus={agentStatus}
        onAgentStatusChange={handleAgentStatusChange}
        acwCountdown={acwCountdown}
        qualityLevel={qualityLevel}
        latency={latency}
        packetLoss={packetLoss}
        onShowShortcuts={() => setShowShortcuts(true)}
      />

      {/* Inbound call overlay */}
      {inboundCall && !activeCall && (
        <InboundCallUI
          callerNumber={formatUSPhone(
            resolveCallerNumber(groupCall?.from, inboundCall.options.callerNumber)
          )}
          ringGroupName={
            groupCall?.group_id === "__fallback__" ? "Direct" : groupCall?.group_name
          }
          onAccept={handleAnswerCall}
          onReject={rejectCall}
        />
      )}

      {/* Ring-group pickup toast */}
      {pickupToast && (
        <div className="fixed top-6 right-6 z-[60] bg-paper border-[2.5px] border-navy rounded-[14px] px-4 py-3 shadow-pop-md animate-slide-up max-w-xs">
          <p className="text-[13px] font-semibold text-navy font-display">
            Picked up by {pickupToast.by_name}
          </p>
          <p className="text-[12px] text-slate mt-0.5">
            That ring group call has been answered.
          </p>
        </div>
      )}

      {/* Transfer overlay */}
      {showTransfer && activeCall && (
        <TransferUI
          originalCall={activeCall}
          transferCall={transferCall}
          onDial={handleTransferDial}
          onBlindTransfer={handleTransferBlind}
          onComplete={handleTransferComplete}
          onCancel={handleTransferCancel}
          onConference={handleConference}
        />
      )}

      {/* VM Drop confirm */}
      {showVmConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-sm">
          <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-6 max-w-sm w-full mx-4 animate-slide-up shadow-pop-lg">
            <h3 className="text-lg font-semibold text-navy mb-2 font-display">
              Drop Voicemail?
            </h3>
            <p className="text-[13px] text-navy-2 mb-5">
              This will play a pre-recorded message and disconnect you
              immediately.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowVmConfirm(false)}
                className="flex-1 py-2.5 rounded-full bg-paper border-2 border-navy text-navy text-sm font-semibold transition-all min-h-[44px] shadow-pop-sm shadow-pop-hover"
              >
                Cancel
              </button>
              <button
                onClick={confirmVmDrop}
                className="flex-1 py-2.5 rounded-full bg-coral border-2 border-navy text-white text-sm font-semibold transition-all min-h-[44px] shadow-pop-sm shadow-pop-hover"
              >
                Drop & Disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts overlay */}
      <KeyboardShortcuts
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-y-auto relative z-[1]">
        {activePage === "phone" && user ? (
          <MissionControl
            currentUserId={user.id}
            currentUserName={user.full_name}
            isManager={!!isManager}
            heroMode={
              activeCall ? "on_call" : postCall ? "post_call" : "idle"
            }
            dialPadInputRef={dialPadInputRef}
            hero={
              activeCall ? (
                <ActiveCallUI
                  call={activeCall}
                  onHangup={handleHangup}
                  onToggleMute={toggleMute}
                  onToggleHold={toggleHold}
                  onDTMF={sendDTMF}
                  onTransfer={handleTransferClick}
                  onVoicemailDrop={handleVmDrop}
                />
              ) : agentStatus === "after-call-work" && acwCountdown !== null ? (
                <AfterCallWork
                  countdown={acwCountdown}
                  onReady={handleAcwReady}
                />
              ) : postCall ? (
                <PostCallCelebration
                  callLogId={postCall.logId}
                  onDismiss={dismissPostCall}
                />
              ) : (
                <DialPad
                  onCall={handleMakeCall}
                  recentNumbers={recentNumbers}
                  disabled={
                    connectionStatus !== "connected" || agentStatus === "dnd"
                  }
                  initialNumber={prefilledNumber}
                  inputRef={dialPadInputRef}
                />
              )
            }
            belowHero={
              !activeCall && !postCall && recentlyDialed.length > 0 ? (
                <RecentlyDialed
                  items={recentlyDialed}
                  onPick={(n) => setPrefilledNumber(n)}
                />
              ) : undefined
            }
          />
        ) : (
        <div className="w-full max-w-[1200px] mx-auto px-6 py-8">
          {/* Page Header — kept for non-phone tabs */}
          {activePage !== "phone" && (
            <div className="mb-8">
              <h1 className="text-3xl font-semibold text-navy font-display">
                {pageInfo.title}
              </h1>
              <p className="text-[12px] text-slate mt-1 uppercase tracking-[0.5px] font-semibold">
                {pageInfo.subtitle}
              </p>
            </div>
          )}

          {/* History Page */}
          {activePage === "history" && (
            <CallHistoryPage
              entries={callHistory}
              onDial={(num) => {
                setActivePage("phone");
                handleMakeCall(num);
              }}
              onUpdate={(entries) => setSupabaseEntries(entries)}
              isManager={isManager}
            />
          )}

          {/* Monitor Page */}
          {activePage === "monitor" && isManager && <MonitorPage />}

          {/* Reports Page — role-aware; agents see their own, managers see team */}
          {activePage === "reports" && <ReportsPage />}

          {/* Transcripts Page */}
          {activePage === "transcripts" && isManager && (
            <TranscriptsPage entries={callHistory} />
          )}

          {/* Settings lives at /settings now — see sidebar nav. */}
        </div>
        )}
      </main>

      {micError && <MicError message={micError} />}
    </div>
  );
}
