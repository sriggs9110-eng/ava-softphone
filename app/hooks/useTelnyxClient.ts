"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TelnyxRTC, Call, INotification } from "@telnyx/webrtc";
import {
  ActiveCallInfo,
  AgentStatus,
  CallHistoryEntry,
  ConnectionStatus,
} from "@/app/lib/types";
import { addCallHistoryEntry, getCallHistory } from "@/app/lib/call-history";

const ACW_DURATION = 30; // seconds

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
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("available");
  const [acwCountdown, setAcwCountdown] = useState<number | null>(null);
  const acwTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCallHistory(getCallHistory());
  }, []);

  const startAcw = useCallback(() => {
    setAgentStatus("after-call-work");
    setAcwCountdown(ACW_DURATION);
    acwTimerRef.current = setInterval(() => {
      setAcwCountdown((prev) => {
        if (prev === null || prev <= 1) {
          if (acwTimerRef.current) clearInterval(acwTimerRef.current);
          setAgentStatus("available");
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const addToHistory = useCallback(
    (
      number: string,
      direction: "inbound" | "outbound",
      duration: number,
      status: "completed" | "missed" | "rejected" | "voicemail" | "no-answer"
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
    if (ringtoneTimeoutRef.current) {
      clearTimeout(ringtoneTimeoutRef.current);
      ringtoneTimeoutRef.current = null;
    }
  }, []);

  const playRingtone = useCallback(() => {
    if (!ringtoneRef.current) {
      ringtoneRef.current = new Audio("/ringtone.wav");
      ringtoneRef.current.loop = true;
    }
    ringtoneRef.current.play().catch(() => {});
    // Auto-dismiss after 30s
    ringtoneTimeoutRef.current = setTimeout(() => {
      stopRingtone();
      if (inboundCall) {
        const number = inboundCall.options.callerNumber || "Unknown";
        inboundCall.hangup();
        setInboundCall(null);
        addToHistory(number, "inbound", 0, "missed");
      }
    }, 30000);
  }, [stopRingtone, inboundCall, addToHistory]);

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

        console.log("[Telnyx]", notification.type, call.state, call.direction, call.cause);

        switch (notification.type) {
          case "callUpdate": {
            const state = call.state;

            if (state === "ringing" && call.direction === "inbound") {
              // Reject if DND
              if (agentStatus === "dnd") {
                call.hangup();
                return;
              }
              setInboundCall(call);
              playRingtone();
              if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                new Notification("Incoming Call", {
                  body: `Call from ${call.options.callerNumber || "Unknown"}`,
                });
              }
              return;
            }

            if (state === "active") {
              stopRingtone();
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
              setAgentStatus("on-call");

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

              if (transferCallRef.current && call.id === transferCallRef.current.id) {
                transferCallRef.current = null;
                setTransferCall(null);
                if (callRef.current) {
                  callRef.current.unhold().catch(() => {});
                  setActiveCall((prev) =>
                    prev ? { ...prev, isHeld: false, status: "active" } : null
                  );
                }
                return;
              }

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

              if (transferCallRef.current) {
                transferCallRef.current.hangup();
                transferCallRef.current = null;
                setTransferCall(null);
              }

              // Start ACW timer
              startAcw();
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

      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
      }
    } catch {
      setConnectionStatus("disconnected");
    }
  }, [addToHistory, playRingtone, stopRingtone, agentStatus, startAcw]);

  const makeCall = useCallback(
    (number: string) => {
      if (!clientRef.current || connectionStatus !== "connected") return;
      if (agentStatus === "dnd") return;

      const call = clientRef.current.newCall({
        destinationNumber: number,
        callerNumber: process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER || "",
        audio: true,
        video: false,
      });

      callRef.current = call;
      setAgentStatus("on-call");
      setActiveCall({
        number,
        direction: "outbound",
        status: "dialing",
        startTime: null,
        isMuted: false,
        isHeld: false,
      });
    },
    [connectionStatus, agentStatus]
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
    if (callRef.current) callRef.current.hangup();
    if (transferCallRef.current) transferCallRef.current.hangup();
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
      return { ...prev, isHeld: newHeld, status: newHeld ? "held" : "active" };
    });
  }, []);

  const sendDTMF = useCallback((digit: string) => {
    if (!callRef.current) return;
    callRef.current.dtmf(digit);
  }, []);

  const initiateTransfer = useCallback((targetNumber: string) => {
    if (!clientRef.current || !callRef.current) return;
    callRef.current.hold();
    setActiveCall((prev) =>
      prev ? { ...prev, isHeld: true, status: "held" } : null
    );
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
  }, []);

  const completeTransfer = useCallback(() => {
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
    callRef.current.unhold().catch(() => {});
    setActiveCall((prev) =>
      prev ? { ...prev, isHeld: false, status: "active" } : null
    );
    setTransferCall(null);
    transferCallRef.current = null;
  }, []);

  const voicemailDrop = useCallback(() => {
    if (!callRef.current) return;
    const callControlId = callRef.current.telnyxIDs.telnyxCallControlId;
    fetch("/api/telnyx/voicemail-drop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call_control_id: callControlId }),
    }).catch(() => {});
    // Hang up our end immediately
    callRef.current.hangup();
  }, []);

  const changeAgentStatus = useCallback((status: AgentStatus) => {
    if (acwTimerRef.current) {
      clearInterval(acwTimerRef.current);
      acwTimerRef.current = null;
    }
    setAcwCountdown(null);
    setAgentStatus(status);
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      if (acwTimerRef.current) clearInterval(acwTimerRef.current);
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
    agentStatus,
    acwCountdown,
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
  };
}
