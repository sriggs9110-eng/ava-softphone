"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTelnyxClient, CallEndInfo } from "@/app/hooks/useTelnyxClient";
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
import { Loader2 } from "lucide-react";
import { insertCallLog, updateCallLog, fetchCallLogs, CallLog } from "@/lib/call-logs";
import { CallHistoryEntry } from "@/app/lib/types";
import { useRouter } from "next/navigation";

const PAGE_TITLES: Record<NavPage, { title: string; subtitle: string }> = {
  phone: { title: "Phone", subtitle: "Make or receive calls" },
  history: { title: "Call History", subtitle: "Review past calls & AI analysis" },
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
  };
}

export default function Home() {
  const { user, isManager, isAdmin, loading: authLoading, updateStatus } = useAuth();
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
      makeCall(number);
      if (user) {
        const log = await insertCallLog({
          user_id: user.id,
          direction: "outbound",
          phone_number: number,
          status: "initiated",
        });
        if (log) activeCallLogIdRef.current = log.id;
      }
    },
    [makeCall, user]
  );

  const handleAnswerCall = useCallback(async () => {
    const callerNumber = inboundCall?.options?.callerNumber || "Unknown";
    answerCall();
    if (user) {
      const log = await insertCallLog({
        user_id: user.id,
        direction: "inbound",
        phone_number: callerNumber,
        status: "connected",
      });
      if (log) activeCallLogIdRef.current = log.id;
    }
  }, [answerCall, inboundCall, user]);

  const handleHangup = useCallback(() => {
    hangup();
  }, [hangup]);

  // When call becomes active, save call_control_id to the Supabase row
  useEffect(() => {
    if (activeCall?.callControlId && activeCallLogIdRef.current) {
      updateCallLog(activeCallLogIdRef.current, {
        status: "connected",
        call_control_id: activeCall.callControlId,
      });
    }
  }, [activeCall?.callControlId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Combine Supabase entries with any live local entries not yet in Supabase
  const callHistory = supabaseEntries.length > 0 ? supabaseEntries : localCallHistory;

  const recentNumbers = useMemo(
    () => [...new Set(callHistory.map((e) => e.number))],
    [callHistory]
  );

  const handleTransferClick = useCallback(() => setShowTransfer(true), []);
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
    <div className="flex w-full min-h-screen bg-bg-app">
      <audio ref={audioRef} id="remote-audio" autoPlay playsInline />

      <Sidebar
        activePage={activePage}
        onNavigate={(page) => {
          if (page === "settings" && isAdmin) {
            router.push("/settings/users");
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
          callerNumber={inboundCall.options.callerNumber || "Unknown"}
          onAccept={handleAnswerCall}
          onReject={rejectCall}
        />
      )}

      {/* Transfer overlay */}
      {showTransfer && activeCall && (
        <TransferUI
          originalCall={activeCall}
          transferCall={transferCall}
          onDial={handleTransferDial}
          onComplete={handleTransferComplete}
          onCancel={handleTransferCancel}
          onConference={handleConference}
        />
      )}

      {/* VM Drop confirm */}
      {showVmConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg-app/80 backdrop-blur-sm">
          <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 max-w-sm w-full mx-4 animate-slide-up">
            <h3 className="text-base font-semibold text-text-primary mb-2">
              Drop Voicemail?
            </h3>
            <p className="text-[13px] text-text-secondary mb-5">
              This will play a pre-recorded message and disconnect you
              immediately.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowVmConfirm(false)}
                className="flex-1 py-2.5 rounded-lg bg-bg-elevated hover:bg-bg-hover text-text-secondary text-sm font-semibold transition-all min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={confirmVmDrop}
                className="flex-1 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all min-h-[44px]"
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
      <main className="flex-1 flex flex-col overflow-y-auto">
        <div className="w-full max-w-[1200px] mx-auto px-6 py-8">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-xl font-semibold text-text-primary">
              {pageInfo.title}
            </h1>
            <p className="text-[12px] text-text-tertiary mt-1 uppercase tracking-[0.5px] font-medium">
              {pageInfo.subtitle}
            </p>
          </div>

          {/* Phone Page */}
          {activePage === "phone" && (
            <>
              {activeCall ? (
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
              ) : (
                <div className="flex flex-col items-center gap-8">
                  <DialPad
                    onCall={handleMakeCall}
                    recentNumbers={recentNumbers}
                    disabled={connectionStatus !== "connected" || agentStatus === "dnd"}
                  />
                  {callHistory.length > 0 && (
                    <div className="w-full max-w-md border-t border-border-subtle pt-6">
                      <CallHistory
                        entries={callHistory.slice(0, 5)}
                        onDial={handleMakeCall}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
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

          {/* Reports Page */}
          {activePage === "reports" && isManager && (
            <ReportsPage entries={callHistory} />
          )}

          {/* Transcripts Page */}
          {activePage === "transcripts" && isManager && (
            <TranscriptsPage entries={callHistory} />
          )}

          {/* Settings Page */}
          {activePage === "settings" && isAdmin && (
            <div className="max-w-lg space-y-4">
              <div className="bg-bg-surface border border-border-subtle rounded-xl p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-1">
                  Connection
                </h3>
                <div className="flex items-center gap-2 mt-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      connectionStatus === "connected"
                        ? "bg-green"
                        : connectionStatus === "connecting"
                        ? "bg-amber"
                        : "bg-red"
                    }`}
                  />
                  <p className="text-[14px] text-text-secondary capitalize">
                    {connectionStatus}
                  </p>
                </div>
              </div>
              <div className="bg-bg-surface border border-border-subtle rounded-xl p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-1">
                  User Management
                </h3>
                <button
                  onClick={() => router.push("/settings/users")}
                  className="mt-2 text-[13px] text-accent hover:underline"
                >
                  Manage users &rarr;
                </button>
              </div>
              <div className="bg-bg-surface border border-border-subtle rounded-xl p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-1">
                  Outbound Number
                </h3>
                <p className="text-[14px] text-text-secondary tabular-nums mt-1">
                  {process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER || "Not configured"}
                </p>
              </div>
              <div className="bg-bg-surface border border-border-subtle rounded-xl p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-1">
                  Keyboard Shortcuts
                </h3>
                <button
                  onClick={() => setShowShortcuts(true)}
                  className="mt-2 text-[13px] text-accent hover:underline"
                >
                  View all shortcuts
                </button>
              </div>
              <div className="bg-bg-surface border border-border-subtle rounded-xl p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-1">
                  Version
                </h3>
                <p className="text-[12px] text-text-tertiary mt-1">
                  Ava Softphone v0.4.0
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      {micError && <MicError message={micError} />}
    </div>
  );
}
