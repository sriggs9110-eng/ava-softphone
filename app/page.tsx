"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useTelnyxClient } from "@/app/hooks/useTelnyxClient";
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

const PAGE_TITLES: Record<NavPage, { title: string; subtitle: string }> = {
  phone: { title: "Phone", subtitle: "Make or receive calls" },
  history: { title: "Call History", subtitle: "Review past calls & AI analysis" },
  monitor: { title: "Live Monitoring", subtitle: "Manager view" },
  reports: { title: "Reports", subtitle: "Call analytics & metrics" },
  transcripts: { title: "Transcripts", subtitle: "Search call transcripts" },
  settings: { title: "Settings", subtitle: "Configuration" },
};

export default function Home() {
  const {
    connectionStatus,
    activeCall,
    inboundCall,
    callHistory,
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
    setCallHistory,
  } = useTelnyxClient();

  const [activePage, setActivePage] = useState<NavPage>("phone");
  const [showTransfer, setShowTransfer] = useState(false);
  const [showVmConfirm, setShowVmConfirm] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

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
    changeAgentStatus("available");
  }, [changeAgentStatus]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // ? always toggles shortcuts
      if (e.key === "?" && !isInput) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
        return;
      }

      // Don't intercept when typing in inputs (except Escape/Enter for call actions)
      if (isInput && e.key !== "Escape" && e.key !== "Enter") return;

      if (e.key === "Escape") {
        if (showShortcuts) {
          setShowShortcuts(false);
          return;
        }
        if (activeCall) {
          e.preventDefault();
          hangup();
        }
        return;
      }

      if (e.key === "Enter" && !activeCall && activePage === "phone") {
        // Enter handled by DialPad's own input
        return;
      }

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
  }, [activeCall, hangup, toggleMute, toggleHold, activePage, showShortcuts]);

  // Page title override
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
        onNavigate={setActivePage}
        connectionStatus={connectionStatus}
        agentStatus={agentStatus}
        onAgentStatusChange={changeAgentStatus}
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
          onAccept={answerCall}
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
                  onHangup={hangup}
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
                    onCall={makeCall}
                    recentNumbers={recentNumbers}
                    disabled={connectionStatus !== "connected" || agentStatus === "dnd"}
                  />
                  {callHistory.length > 0 && (
                    <div className="w-full max-w-md border-t border-border-subtle pt-6">
                      <CallHistory
                        entries={callHistory.slice(0, 5)}
                        onDial={makeCall}
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
                makeCall(num);
              }}
              onUpdate={setCallHistory}
            />
          )}

          {/* Monitor Page */}
          {activePage === "monitor" && <MonitorPage />}

          {/* Reports Page */}
          {activePage === "reports" && <ReportsPage entries={callHistory} />}

          {/* Transcripts Page */}
          {activePage === "transcripts" && (
            <TranscriptsPage entries={callHistory} />
          )}

          {/* Settings Page */}
          {activePage === "settings" && (
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
                  Outbound Number
                </h3>
                <p className="text-[14px] text-text-secondary tabular-nums mt-1">
                  {process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER || "Not configured"}
                </p>
              </div>
              <div className="bg-bg-surface border border-border-subtle rounded-xl p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-1">
                  Agent Status
                </h3>
                <div className="flex items-center gap-2 mt-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      agentStatus === "available"
                        ? "bg-green"
                        : agentStatus === "on-call"
                        ? "bg-amber"
                        : agentStatus === "dnd"
                        ? "bg-red"
                        : "bg-text-tertiary"
                    }`}
                  />
                  <p className="text-[14px] text-text-secondary capitalize">
                    {agentStatus.replace(/-/g, " ")}
                  </p>
                  {acwCountdown !== null && (
                    <span className="text-[12px] text-amber ml-2">
                      ({acwCountdown}s)
                    </span>
                  )}
                </div>
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
                  Ava Softphone v0.3.0
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
