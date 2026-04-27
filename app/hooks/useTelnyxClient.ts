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

// Verbose transfer logging toggled by ?transferDebug=1 in the URL. Lets
// Stephen (or any operator) flip on instrumentation without shipping a
// code change. Logs are prefixed [TRANSFER-DEBUG] for easy filtering.
function transferDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URL(window.location.href).searchParams.get("transferDebug") === "1";
  } catch {
    return false;
  }
}

function transferDebug(msg: string, ...args: unknown[]) {
  if (transferDebugEnabled()) console.log(`[TRANSFER-DEBUG] ${msg}`, ...args);
}

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
  const transferTargetNumberRef = useRef<string | null>(null);
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
              // Outbound-dial auto-answer. The /api/telnyx/dial-outbound
              // endpoint originates two legs server-side (customer +
              // rep) and INVITEs the rep's SIP endpoint with a
              // base64-encoded client_state marker {type: "outbound_dial"}.
              // From Telnyx's perspective this is an "inbound" call to
              // the rep's credential, but it's actually the second leg
              // of an outbound dial the rep just initiated. Auto-answer
              // silently and tag the call as outbound for the active-
              // call UI flow downstream.
              const tryAutoAnswerOutboundDial = (): boolean => {
                // Diagnostic: dump everything the SDK gives us so we
                // can see how Telnyx is actually delivering the marker.
                const opts = (call.options || {}) as Record<string, unknown>;
                const cs = (opts.clientState ||
                  (opts as { client_state?: string }).client_state ||
                  "") as string;
                const cause = (call as unknown as { cause?: string }).cause;
                console.log("[Telnyx] inbound ringing diagnostics:", {
                  clientStateRaw: cs ? cs.slice(0, 120) : "(none)",
                  clientStateLen: cs ? cs.length : 0,
                  callerNumber: opts.callerNumber,
                  destinationNumber: opts.destinationNumber,
                  remoteCallerName: (call as unknown as { remoteCallerName?: string })
                    .remoteCallerName,
                  cause,
                });
                if (!cs) return false;
                // Try base64 decode first, fall back to raw JSON.
                let decoded: { type?: string; to?: string } | null = null;
                try {
                  decoded = JSON.parse(atob(cs));
                } catch {
                  try {
                    decoded = JSON.parse(cs);
                  } catch {
                    /* not JSON either */
                  }
                }
                console.log("[Telnyx] decoded client_state:", decoded);
                if (decoded?.type !== "outbound_dial") return false;
                console.log(
                  "[Telnyx] outbound_dial auto-answer to=",
                  decoded.to
                );
                try {
                  (call as unknown as { direction?: string }).direction =
                    "outbound";
                  (
                    call.options as unknown as {
                      destinationNumber?: string;
                      callerNumber?: string;
                    }
                  ).destinationNumber = decoded.to;
                } catch {}
                try {
                  call.answer();
                  return true;
                } catch (err) {
                  console.error("[Telnyx] auto-answer threw:", err);
                  return false;
                }
              };
              if (tryAutoAnswerOutboundDial()) return;

              // Defense-in-depth auto-reject. With per-user SIP
              // credentials the server-side dispatchRingGroup already
              // filters out unavailable members before inviting — so in
              // theory a mid-call / wrap-up / DND agent shouldn't be
              // receiving an INVITE here at all. In practice we keep all
              // three conditions as a client-side safety net:
              //
              //   - DND: the rep explicitly opted out; reject no matter
              //     what the routing decided.
              //   - on-call: if a stale registration or race somehow
              //     invited an already-busy rep, a second call ringing
              //     over the active call is jarring.
              //   - after-call-work: same race protection; ACW is a
              //     short recovery window and forcing a pick-up during
              //     it hurts call quality.
              //
              // If any of these fire in practice it's a signal to
              // investigate the ring-group dispatch, not remove the
              // guard. Hangup reads as a decline at the SIP layer so
              // Telnyx continues ringing the rest of the group.
              const cannotTake =
                agentStatus === "dnd" ||
                agentStatus === "on-call" ||
                agentStatus === "after-call-work";
              if (cannotTake) {
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
                transferTargetNumberRef.current = null;
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
                transferTargetNumberRef.current = null;
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

  // Warm / attended transfer — START.
  //
  // Server-side: /api/telnyx/warm-transfer/initiate issues actions/hold
  // on the ORIGINAL caller's external leg. Telnyx plays hold music to
  // A and parks the leg.
  //
  // Client-side: once the hold lands, the rep's browser SDK-dials the
  // transfer target. The second WebRTC call is what lets the rep talk
  // to B privately. When rep presses Complete or Cancel, the matching
  // server endpoint bridges-or-unholds; the client cleans up B's SDK
  // call.
  // Warm transfer — START.
  //
  // Hold the customer via the SDK (Verto call.hold over WebSocket), then
  // dial the transfer target as a second SDK call. HOLD IS CLIENT-SIDE:
  // Telnyx's v2 Call Control HTTP API has NO /actions/hold endpoint
  // (probed — every /hold* variant returns 404, while /speak /bridge
  // /transfer etc. exist and return 422 on a dead call). The earlier
  // server-side /warm-transfer/initiate → /actions/hold path was built
  // on a non-existent endpoint. This replaces it with the SDK's
  // Verto-level hold, which is the actual supported mechanism.
  const warmTransferStart = useCallback(
    async (targetNumber: string): Promise<boolean> => {
      if (!clientRef.current || !callRef.current) return false;
      const active = callRef.current;
      transferDebug("warmTransferStart — SDK hold", {
        ccid: active.telnyxIDs?.telnyxCallControlId,
        targetNumber,
      });

      try {
        await active.hold();
      } catch (err) {
        console.error("[warm] SDK hold() threw:", err);
        setMicError("Warm transfer failed: could not hold the caller.");
        return false;
      }

      // Reflect hold state in the UI immediately.
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
      transferTargetNumberRef.current = targetNumber;
      setTransferCall({
        number: targetNumber,
        direction: "outbound",
        status: "dialing",
        startTime: null,
        isMuted: false,
        isHeld: false,
      });
      return true;
    },
    []
  );

  // Legacy alias — kept so existing page.tsx wiring compiles. Prefer
  // warmTransferStart in new code.
  const initiateTransfer = useCallback(
    (targetNumber: string) => {
      warmTransferStart(targetNumber);
    },
    [warmTransferStart]
  );

  // Blind transfer.
  //
  // Server-side: we POST to /api/telnyx/transfer which issues SIP REFER
  // on the EXTERNAL leg of the rep's current bridge. Telnyx then
  // redirects the external party to the new destination and tears down
  // the rep's side of the bridge for us. The previous link_to +
  // bridge_on_answer approach collapsed the original bridge before
  // Telnyx could set up the new one — rep and caller both dropped.
  //
  // Client-side: once the POST returns 200, we do NOTHING. The rep's
  // WebRTC leg drops naturally via a callUpdate → hangup event as soon
  // as Telnyx completes the REFER. Calling hangup here would recreate
  // the original race.
  const blindTransfer = useCallback(
    async (targetNumber: string): Promise<boolean> => {
      const active = callRef.current;
      if (!active) {
        transferDebug("blindTransfer — no active call");
        return false;
      }
      const ccid = active.telnyxIDs?.telnyxCallControlId;
      if (!ccid) {
        transferDebug("blindTransfer — no call_control_id on active call");
        return false;
      }
      transferDebug("blindTransfer — POST /api/telnyx/transfer", {
        call_control_id: ccid,
        to: targetNumber,
      });
      try {
        const res = await fetch("/api/telnyx/transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            call_control_id: ccid,
            to: targetNumber,
          }),
        });
        const data = await res.json().catch(() => ({}));
        transferDebug("blindTransfer — response", { status: res.status, data });
        if (!res.ok) {
          console.error(
            "[transfer] blind failed:",
            res.status,
            data?.error || "(no detail)"
          );
          setMicError(
            `Transfer failed: ${data?.error || "Telnyx rejected the transfer"}. The call is still active; try again or cancel.`
          );
          return false;
        }
        transferDebug("blindTransfer — REFER accepted, waiting for hangup", {
          targetCcid: data?.target_call_control_id,
          usedExternalLeg: data?.used_external_leg,
        });
        return true;
      } catch (err) {
        console.error("[transfer] blind threw:", err);
        setMicError("Transfer failed: network error. The call is still active.");
        return false;
      }
    },
    []
  );

  // Warm transfer — COMPLETE.
  //
  // POSTs to /api/telnyx/warm-transfer/complete with both ccids. Server
  // looks up their external_ccids and bridges the two carrier legs.
  // Rep's two WebRTC legs drop naturally via callUpdate → hangup as
  // Telnyx reassigns the bridges.
  const warmTransferComplete = useCallback(async () => {
    if (!callRef.current || !transferCallRef.current) return;
    const repCcid = callRef.current.telnyxIDs.telnyxCallControlId;
    const targetRepCcid =
      transferCallRef.current.telnyxIDs.telnyxCallControlId;
    transferDebug("warmTransferComplete — POST /api/telnyx/warm-transfer/complete", {
      repCcid,
      targetRepCcid,
    });

    // Unhold the original leg before the server bridges. Bridging into
    // a held leg can leave the customer with no audio after the
    // handoff; unholding first restores the media path.
    try {
      await callRef.current.unhold();
    } catch (err) {
      console.warn("[warm] unhold before bridge threw (continuing):", err);
    }

    const targetPhoneNumber = transferTargetNumberRef.current || "";
    try {
      const res = await fetch("/api/telnyx/warm-transfer/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repCcid, targetRepCcid, targetPhoneNumber }),
      });
      const data = await res.json().catch(() => ({}));
      transferDebug("warmTransferComplete — response", { status: res.status, data });
      if (!res.ok) {
        console.error(
          "[warm] complete failed:",
          res.status,
          data?.error || "(no detail)"
        );
        setMicError(
          `Transfer failed: ${data?.error || "Telnyx rejected the bridge"}. The call is still active; try again or cancel.`
        );
        return;
      }
    } catch (err) {
      console.error("[warm] complete threw:", err);
      setMicError("Transfer failed: network error. The call is still active.");
      return;
    }

    // Telnyx is bridging the two external legs. Rep's WebRTC legs
    // should receive BYEs from Telnyx as the bridge completes; our
    // existing callUpdate handler clears state on those events. Collapse
    // the transfer-panel UI now (UI is rep-driven; doesn't affect the
    // server-side bridge). Don't force-hangup here — early hangup tore
    // down media before the bridge completed in earlier tests.
    setTransferCall(null);
  }, []);

  // Warm transfer — CANCEL.
  //
  // POSTs to /api/telnyx/warm-transfer/cancel to unhold the original
  // caller's external leg. The client hangs up the target SDK leg;
  // the rep is left talking to A again.
  const warmTransferCancel = useCallback(async () => {
    const repCcid = callRef.current?.telnyxIDs.telnyxCallControlId;
    if (transferCallRef.current) {
      try {
        transferCallRef.current.hangup();
      } catch {}
      transferCallRef.current = null;
      setTransferCall(null);
    }
    // SDK-side unhold — mirrors warmTransferStart's SDK-side hold.
    // Server /warm-transfer/cancel is no longer needed (it targeted a
    // non-existent /actions/unhold endpoint on Telnyx's v2 HTTP API).
    void repCcid;
    if (callRef.current) {
      try {
        await callRef.current.unhold();
      } catch (err) {
        console.error("[warm] SDK unhold() threw:", err);
      }
      setActiveCall((prev) =>
        prev ? { ...prev, isHeld: false, status: "active" } : null
      );
    }
  }, []);

  // Legacy aliases for existing UI wiring.
  const completeTransfer = warmTransferComplete;
  const cancelTransfer = warmTransferCancel;

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
    blindTransfer,
    initiateTransfer,
    completeTransfer,
    cancelTransfer,
    warmTransferStart,
    warmTransferComplete,
    warmTransferCancel,
    mergeConference,
    voicemailDrop,
    changeAgentStatus,
    setCallHistory,
  };
}
