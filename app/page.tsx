"use client";

import { useState, useMemo, useCallback } from "react";
import { useTelnyxClient } from "@/app/hooks/useTelnyxClient";
import StatusBar from "@/app/components/StatusBar";
import DialPad from "@/app/components/DialPad";
import ActiveCallUI from "@/app/components/ActiveCallUI";
import InboundCallUI from "@/app/components/InboundCallUI";
import TransferUI from "@/app/components/TransferUI";
import CallHistory from "@/app/components/CallHistory";
import MicError from "@/app/components/MicError";

export default function Home() {
  const {
    connectionStatus,
    activeCall,
    inboundCall,
    callHistory,
    micError,
    transferCall,
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
  } = useTelnyxClient();

  const [showTransfer, setShowTransfer] = useState(false);

  const recentNumbers = useMemo(
    () => [...new Set(callHistory.map((e) => e.number))],
    [callHistory]
  );

  const handleTransferClick = useCallback(() => {
    setShowTransfer(true);
  }, []);

  const handleTransferDial = useCallback(
    (number: string) => {
      initiateTransfer(number);
    },
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

  return (
    <div className="flex flex-col flex-1 min-h-screen bg-background">
      {/* Hidden audio element for remote stream */}
      <audio ref={audioRef} autoPlay playsInline />

      <StatusBar status={connectionStatus} />

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

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center pt-8 pb-4 px-4">
        {activeCall ? (
          <ActiveCallUI
            call={activeCall}
            onHangup={hangup}
            onToggleMute={toggleMute}
            onToggleHold={toggleHold}
            onDTMF={sendDTMF}
            onTransfer={handleTransferClick}
          />
        ) : (
          <>
            <div className="mb-8">
              <DialPad
                onCall={makeCall}
                recentNumbers={recentNumbers}
                disabled={connectionStatus !== "connected"}
              />
            </div>
            <div className="w-full border-t border-border pt-4">
              <CallHistory entries={callHistory} onDial={makeCall} />
            </div>
          </>
        )}
      </main>

      {/* Mic error toast */}
      {micError && <MicError message={micError} />}
    </div>
  );
}
