"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TelnyxRTC, Call, INotification } from "@telnyx/webrtc";
import {
  ActiveCallInfo,
  CallHistoryEntry,
  CallStatus,
  ConnectionStatus,
} from "@/app/lib/types";
import { addCallHistoryEntry, getCallHistory } from "@/app/lib/call-history";

export function useTelnyxClient() {
  const clientRef = useRef<TelnyxRTC | null>(null);
  const callRef = useRef<Call | null>(null);
  const transferCallRef = useRef<Call | null>(null);
  const callStartRef = useRef<number | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [activeCall, setActiveCall] = useState<ActiveCallInfo | null>(null);
  const [inboundCall, setInboundCall] = useState<Call | null>(null);
  const [callHistory, setCallHistory] = useState<CallHistoryEntry[]>([]);
  const [micError, setMicError] = useState<string | null>(null);
  const [transferCall, setTransferCall] = useState<ActiveCallInfo | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  // Load call history on mount
  useEffect(() => {
    setCallHistory(getCallHistory());
  }, []);

  const addToHistory = useCallback(
    (
      number: string,
      direction: "inbound" | "outbound",
      duration: number,
      status: "completed" | "missed" | "rejected"
    ) => {
      const entry: CallHistoryEntry = {
        id: crypto.randomUUID(),
        number,
        direction,
        duration,
        timestamp: Date.now(),
        status,
      };
      const updated = addCallHistoryEntry(entry);
      setCallHistory(updated);
    },
    []
  );

  const stopRingtone = useCallback(() => {
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }
  }, []);

  const playRingtone = useCallback(() => {
    if (!ringtoneRef.current) {
      ringtoneRef.current = new Audio("/ringtone.wav");
      ringtoneRef.current.loop = true;
    }
    ringtoneRef.current.play().catch(() => {});
  }, []);

  const connect = useCallback(async () => {
    if (clientRef.current) return;
    setConnectionStatus("connecting");

    try {
      const res = await fetch("/api/telnyx/token");
      if (!res.ok) throw new Error("Failed to fetch credentials");
      const creds = await res.json();

      const client = new TelnyxRTC({
        login: creds.username,
        password: creds.password,
        debug: false,
      });

      client.on("telnyx.ready" as string, () => {
        setConnectionStatus("connected");
      });

      client.on("telnyx.error" as string, () => {
        setConnectionStatus("disconnected");
      });

      client.on("telnyx.socket.close" as string, () => {
        setConnectionStatus("disconnected");
      });

      client.on("telnyx.notification" as string, (notification: INotification) => {
        const call = notification.call;
        if (!call) return;

        switch (notification.type) {
          case "callUpdate": {
            const state = call.state;

            if (state === "ringing" && call.direction === "inbound") {
              setInboundCall(call);
              playRingtone();
              if (Notification.permission === "granted") {
                new Notification("Incoming Call", {
                  body: `Call from ${call.options.callerNumber || "Unknown"}`,
                  icon: "/phone-icon.png",
                });
              }
              return;
            }

            if (state === "active") {
              stopRingtone();
              // Check if this is the transfer leg
              if (transferCallRef.current && call.id === transferCallRef.current.id) {
                setTransferCall({
                  number: call.options.destinationNumber || "",
                  direction: "outbound",
                  status: "active",
                  startTime: Date.now(),
                  isMuted: false,
                  isHeld: false,
                });
                return;
              }

              setInboundCall(null);
              callRef.current = call;
              callStartRef.current = Date.now();

              // Attach remote audio
              if (call.remoteStream && audioRef.current) {
                audioRef.current.srcObject = call.remoteStream;
                audioRef.current.play().catch(() => {});
              }

              setActiveCall({
                number:
                  call.direction === "inbound"
                    ? call.options.callerNumber || "Unknown"
                    : call.options.destinationNumber || "",
                direction: call.direction as "inbound" | "outbound",
                status: "active",
                startTime: Date.now(),
                isMuted: false,
                isHeld: false,
              });
            }

            if (state === "held") {
              if (transferCallRef.current && call.id === transferCallRef.current.id) {
                setTransferCall((prev) =>
                  prev ? { ...prev, isHeld: true, status: "held" } : null
                );
              } else {
                setActiveCall((prev) =>
                  prev ? { ...prev, isHeld: true, status: "held" } : null
                );
              }
            }

            if (state === "trying" || state === "requesting") {
              // Outbound call initiated
              if (transferCallRef.current && call.id === transferCallRef.current.id) {
                setTransferCall({
                  number: call.options.destinationNumber || "",
                  direction: "outbound",
                  status: "dialing",
                  startTime: null,
                  isMuted: false,
                  isHeld: false,
                });
              }
            }

            if (state === "hangup" || state === "destroy") {
              stopRingtone();

              // Transfer leg hung up
              if (transferCallRef.current && call.id === transferCallRef.current.id) {
                transferCallRef.current = null;
                setTransferCall(null);
                // Unhold the original call
                if (callRef.current) {
                  callRef.current.unhold().catch(() => {});
                  setActiveCall((prev) =>
                    prev ? { ...prev, isHeld: false, status: "active" } : null
                  );
                }
                return;
              }

              // Main call hung up
              const duration = callStartRef.current
                ? Math.floor((Date.now() - callStartRef.current) / 1000)
                : 0;
              const number =
                call.direction === "inbound"
                  ? call.options.callerNumber || "Unknown"
                  : call.options.destinationNumber || "";
              addToHistory(
                number,
                call.direction as "inbound" | "outbound",
                duration,
                duration > 0 ? "completed" : "missed"
              );

              callRef.current = null;
              callStartRef.current = null;
              setActiveCall(null);
              setInboundCall(null);

              if (audioRef.current) {
                audioRef.current.srcObject = null;
              }

              // Also hang up transfer if active
              if (transferCallRef.current) {
                transferCallRef.current.hangup();
                transferCallRef.current = null;
                setTransferCall(null);
              }
            }
            break;
          }
          case "userMediaError": {
            setMicError(
              "Microphone access denied. Please allow microphone access and reload."
            );
            break;
          }
        }
      });

      client.connect();
      clientRef.current = client;

      // Request notification permission
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
      }
    } catch {
      setConnectionStatus("disconnected");
    }
  }, [addToHistory, playRingtone, stopRingtone]);

  const makeCall = useCallback(
    (number: string) => {
      if (!clientRef.current || connectionStatus !== "connected") return;

      const call = clientRef.current.newCall({
        destinationNumber: number,
        callerNumber: process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER || "",
        audio: true,
        video: false,
      });

      callRef.current = call;
      setActiveCall({
        number,
        direction: "outbound",
        status: "dialing",
        startTime: null,
        isMuted: false,
        isHeld: false,
      });
    },
    [connectionStatus]
  );

  const answerCall = useCallback(() => {
    if (!inboundCall) return;
    stopRingtone();
    inboundCall.answer({ video: false });
  }, [inboundCall, stopRingtone]);

  const rejectCall = useCallback(() => {
    if (!inboundCall) return;
    stopRingtone();
    const number = inboundCall.options.callerNumber || "Unknown";
    inboundCall.hangup();
    setInboundCall(null);
    addToHistory(number, "inbound", 0, "rejected");
  }, [inboundCall, addToHistory, stopRingtone]);

  const hangup = useCallback(() => {
    if (callRef.current) {
      callRef.current.hangup();
    }
    if (transferCallRef.current) {
      transferCallRef.current.hangup();
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (!callRef.current) return;
    if (callRef.current.isAudioMuted) {
      callRef.current.unmuteAudio();
    } else {
      callRef.current.muteAudio();
    }
    setActiveCall((prev) =>
      prev ? { ...prev, isMuted: !prev.isMuted } : null
    );
  }, []);

  const toggleHold = useCallback(async () => {
    if (!callRef.current) return;
    await callRef.current.toggleHold();
    setActiveCall((prev) => {
      if (!prev) return null;
      const newHeld = !prev.isHeld;
      return {
        ...prev,
        isHeld: newHeld,
        status: newHeld ? "held" : "active",
      };
    });
  }, []);

  const sendDTMF = useCallback((digit: string) => {
    if (!callRef.current) return;
    callRef.current.dtmf(digit);
  }, []);

  const initiateTransfer = useCallback(
    (targetNumber: string) => {
      if (!clientRef.current || !callRef.current) return;

      // Hold the original call
      callRef.current.hold();
      setActiveCall((prev) =>
        prev ? { ...prev, isHeld: true, status: "held" } : null
      );

      // Dial the transfer target
      const tCall = clientRef.current.newCall({
        destinationNumber: targetNumber,
        callerNumber: process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER || "",
        audio: true,
        video: false,
      });

      transferCallRef.current = tCall;
      setTransferCall({
        number: targetNumber,
        direction: "outbound",
        status: "dialing",
        startTime: null,
        isMuted: false,
        isHeld: false,
      });
    },
    []
  );

  const completeTransfer = useCallback(() => {
    // In a warm transfer, we complete by hanging up our legs
    // and using the API to bridge the two calls
    if (callRef.current && transferCallRef.current) {
      const originalCallId = callRef.current.telnyxIDs.telnyxCallControlId;
      const transferCallId = transferCallRef.current.telnyxIDs.telnyxCallControlId;

      fetch("/api/telnyx/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_control_id: originalCallId,
          transfer_to_call_control_id: transferCallId,
        }),
      }).catch(() => {});

      // Hang up our end
      transferCallRef.current.hangup();
      callRef.current.hangup();
      transferCallRef.current = null;
      callRef.current = null;
      setTransferCall(null);
      setActiveCall(null);
    }
  }, []);

  const cancelTransfer = useCallback(() => {
    if (transferCallRef.current) {
      transferCallRef.current.hangup();
      transferCallRef.current = null;
      setTransferCall(null);
    }
    // Unhold original
    if (callRef.current) {
      callRef.current.unhold();
      setActiveCall((prev) =>
        prev ? { ...prev, isHeld: false, status: "active" } : null
      );
    }
  }, []);

  const mergeConference = useCallback(() => {
    if (!callRef.current || !transferCallRef.current) return;

    const originalCallId = callRef.current.telnyxIDs.telnyxCallControlId;
    const transferCallId = transferCallRef.current.telnyxIDs.telnyxCallControlId;

    fetch("/api/telnyx/conference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        call_control_ids: [originalCallId, transferCallId],
      }),
    }).catch(() => {});

    // Unhold both
    callRef.current.unhold().catch(() => {});
    setActiveCall((prev) =>
      prev ? { ...prev, isHeld: false, status: "active" } : null
    );
    setTransferCall(null);
    transferCallRef.current = null;
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
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
    setCallHistory,
  };
}
