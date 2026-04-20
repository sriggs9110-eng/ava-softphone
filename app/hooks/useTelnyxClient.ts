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
import { getLocalNumber } from "@/app/lib/local-presence";
import { QualityLevel } from "@/app/components/ConnectionQuality";

const ACW_DURATION = 30;

// Web Audio ringtone generator
function createRingtoneOscillator(audioCtx: AudioContext): { start: () => void; stop: () => void } {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let osc1: OscillatorNode | null = null;
  let osc2: OscillatorNode | null = null;
  let gain: GainNode | null = null;

  return {
    start: () => {
      let ringing = true;
      const ring = () => {
        if (!ringing) return;
        gain = audioCtx.createGain();
        gain.gain.value = 0.15;
        gain.connect(audioCtx.destination);

        osc1 = audioCtx.createOscillator();
        osc1.frequency.value = 440;
        osc1.connect(gain);
        osc1.start();

        osc2 = audioCtx.createOscillator();
        osc2.frequency.value = 480;
        osc2.connect(gain);
        osc2.start();

        // Ring for 1s, silence for 2s
        setTimeout(() => {
          osc1?.stop();
          osc2?.stop();
          gain?.disconnect();
        }, 1000);
      };

      ring();
      intervalId = setInterval(ring, 3000);
    },
    stop: () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = null;
      try { osc1?.stop(); } catch {}
      try { osc2?.stop(); } catch {}
      try { gain?.disconnect(); } catch {}
    },
  };
}

export interface CallEndInfo {
  number: string;
  direction: "inbound" | "outbound";
  duration: number;
  status: "completed" | "missed" | "rejected" | "voicemail" | "no-answer";
}

export function useTelnyxClient(onCallEnd?: (info: CallEndInfo) => void) {
  const onCallEndRef = useRef(onCallEnd);
  onCallEndRef.current = onCallEnd;

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
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>("unknown");
  const [latency, setLatency] = useState<number | null>(null);
  const [packetLoss, setPacketLoss] = useState<number | null>(null);
  const acwTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneOscRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringtoneTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qualityIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    ringtoneOscRef.current?.stop();
    ringtoneOscRef.current = null;
    if (ringtoneTimeoutRef.current) {
      clearTimeout(ringtoneTimeoutRef.current);
      ringtoneTimeoutRef.current = null;
    }
  }, []);

  const playRingtone = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    stopRingtone();
    const osc = createRingtoneOscillator(audioCtxRef.current);
    ringtoneOscRef.current = osc;
    osc.start();

    // Auto-dismiss after 30s
    ringtoneTimeoutRef.current = setTimeout(() => {
      stopRingtone();
      setInboundCall((current) => {
        if (current) {
          const number = current.options.callerNumber || "Unknown";
          current.hangup();
          addToHistory(number, "inbound", 0, "missed");
        }
        return null;
      });
    }, 30000);
  }, [stopRingtone, addToHistory]);

  // Connection quality monitoring
  const startQualityMonitor = useCallback(() => {
    qualityIntervalRef.current = setInterval(() => {
      if (!callRef.current?.peer?.instance) return;
      callRef.current.peer.instance.getStats().then((stats) => {
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            const rtt = report.currentRoundTripTime;
            if (rtt !== undefined) {
              const rttMs = Math.round(rtt * 1000);
              setLatency(rttMs);
              if (rttMs < 150) setQualityLevel("good");
              else if (rttMs < 300) setQualityLevel("degraded");
              else setQualityLevel("poor");
            }
          }
          if (report.type === "inbound-rtp" && report.kind === "audio") {
            const lost = report.packetsLost || 0;
            const received = report.packetsReceived || 0;
            const total = lost + received;
            if (total > 0) {
              const loss = (lost / total) * 100;
              setPacketLoss(loss);
              if (loss > 5) setQualityLevel("poor");
              else if (loss > 1) setQualityLevel("degraded");
            }
          }
        });
      }).catch(() => {});
    }, 3000);
  }, []);

  const stopQualityMonitor = useCallback(() => {
    if (qualityIntervalRef.current) {
      clearInterval(qualityIntervalRef.current);
      qualityIntervalRef.current = null;
    }
    setQualityLevel("unknown");
    setLatency(null);
    setPacketLoss(null);
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

        console.log("[Telnyx]", notification.type, call.state, call.direction, call.cause);

        // Always try to attach remote audio on any update
        if (call.remoteStream && audioRef.current) {
          if (audioRef.current.srcObject !== call.remoteStream) {
            audioRef.current.srcObject = call.remoteStream;
          }
          audioRef.current.play().catch(() => {});
        }

        switch (notification.type) {
          case "callUpdate": {
            const state = call.state;

            if (state === "ringing" && call.direction === "inbound") {
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
              startQualityMonitor();

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
                callControlId: call.telnyxIDs?.telnyxCallControlId || undefined,
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
              stopQualityMonitor();

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
              const finalStatus = duration > 0 ? "completed" : "missed";
              addToHistory(
                number,
                call.direction as "inbound" | "outbound",
                duration,
                finalStatus
              );

              onCallEndRef.current?.({
                number,
                direction: call.direction as "inbound" | "outbound",
                duration,
                status: finalStatus,
              });

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
  }, [addToHistory, playRingtone, stopRingtone, agentStatus, startAcw, startQualityMonitor, stopQualityMonitor]);

  const makeCall = useCallback(
    async (number: string): Promise<string | undefined> => {
      if (!clientRef.current || connectionStatus !== "connected") return undefined;
      if (agentStatus === "dnd") return undefined;

      // Unlock audio element with user gesture (required on production domains)
      if (audioRef.current) {
        audioRef.current.srcObject = null;
        audioRef.current.play().catch(() => {});
      }
      // Also ensure AudioContext is resumed for ringtones
      if (audioCtxRef.current?.state === "suspended") {
        audioCtxRef.current.resume();
      }

      const fromNumber = await getLocalNumber(number);

      const call = clientRef.current.newCall({
        destinationNumber: number,
        callerNumber: fromNumber,
        audio: true,
        video: false,
        remoteElement: audioRef.current || undefined,
      });

      callRef.current = call;
      const ccid = call.telnyxIDs?.telnyxCallControlId || undefined;
      const csid = call.telnyxIDs?.telnyxSessionId || undefined;
      const clegid = call.telnyxIDs?.telnyxLegId || undefined;
      console.log("[SDK] newCall IDs — ccid:", ccid, "sessionId:", csid, "legId:", clegid, "allIDs:", JSON.stringify(call.telnyxIDs));

      setAgentStatus("on-call");
      setActiveCall({
        number,
        direction: "outbound",
        status: "dialing",
        startTime: null,
        isMuted: false,
        isHeld: false,
        callControlId: ccid,
      });

      return ccid;
    },
    [connectionStatus, agentStatus]
  );

  const answerCall = useCallback((): string | undefined => {
    if (!inboundCall) return undefined;
    stopRingtone();
    // Unlock audio element with user gesture
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.play().catch(() => {});
    }
    inboundCall.answer({ video: false });
    return inboundCall.telnyxIDs?.telnyxCallControlId || undefined;
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
      remoteElement: audioRef.current || undefined,
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
      stopQualityMonitor();
      stopRingtone();
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
  };
}
