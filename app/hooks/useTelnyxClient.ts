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
  // Set by the page/hook just before kicking off a server-originated
  // outbound dial OR a server-originated warm-transfer consult. The SDK
  // doesn't expose client_state on incoming INVITEs (verified in
  // @telnyx/webrtc source — VertoMethod handles client_state on Bye
  // only), so we can't tag the auto-answer leg via SIP metadata. The
  // ref carries the marker out-of-band: when the rep just clicked
  // Dial/Warm-transfer and the server-originated leg INVITES this SDK,
  // the next "ringing inbound" notification within the expiration
  // window is the one to auto-answer.
  //
  // kind="main"    → main outbound dial; auto-answer routes the Call
  //                  to callRef (becomes the active call).
  // kind="consult" → warm-transfer consult; auto-answer routes the Call
  //                  to transferCallRef so the existing call (callRef)
  //                  stays intact as the held customer call.
  const outboundDialExpectRef = useRef<{
    customer: string;
    expiresAt: number;
    kind: "main" | "consult";
  } | null>(null);
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
              // Auto-answer for server-originated legs. Two flavors:
              //   kind="main"    → main outbound dial; routes to callRef.
              //   kind="consult" → warm-transfer consult; routes to
              //                    transferCallRef so the original call
              //                    (which is on hold) stays intact.
              const expect = outboundDialExpectRef.current;
              if (expect && expect.expiresAt > Date.now()) {
                outboundDialExpectRef.current = null; // consume once
                console.log(
                  `[Telnyx] auto-answer kind=${expect.kind} customer=${expect.customer}`
                );
                try {
                  // Flip direction + stamp destinationNumber so the
                  // active-call UI renders as outbound to the customer.
                  (call as unknown as { direction?: string }).direction =
                    "outbound";
                  (
                    call.options as unknown as {
                      destinationNumber?: string;
                    }
                  ).destinationNumber = expect.customer;
                } catch {}
                if (expect.kind === "consult") {
                  // Pre-bind to transferCallRef BEFORE answering so that
                  // when state===active fires, the consult is recognized
                  // as the transfer call and doesn't overwrite callRef
                  // (which still points at the original held customer
                  // call).
                  transferCallRef.current = call;
                  transferTargetNumberRef.current = expect.customer;
                  setTransferCall({
                    number: expect.customer,
                    direction: "outbound",
                    status: "dialing",
                    startTime: null,
                    isMuted: false,
                    isHeld: false,
                  });
                }
                try {
                  call.answer();
                  return;
                } catch (err) {
                  console.error("[Telnyx] auto-answer threw:", err);
                  // fall through to the inbound flow as a safety net
                }
              }

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

  // Page calls this just before POSTing /api/telnyx/dial-outbound (or
  // before warmTransferStart triggers /api/telnyx/warm-transfer/start)
  // so the very next "ringing inbound" INVITE we receive auto-answers
  // and routes correctly. The flag is consumed on the first match or
  // on expiry.
  const markOutboundDialExpected = useCallback(
    (customer: string, kind: "main" | "consult" = "main") => {
      outboundDialExpectRef.current = {
        customer,
        expiresAt: Date.now() + 15_000,
        kind,
      };
    },
    []
  );

  const clearOutboundDialExpected = useCallback(() => {
    outboundDialExpectRef.current = null;
  }, []);

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
  // Warm transfer — START.
  //
  // Server-originates the consult call via /api/telnyx/warm-transfer/
  // start. Why: SDK.newCall puts the consult on the rep's CREDENTIAL
  // connection while the original customer leg lives on the CALL
  // CONTROL APP. Bridging across those two worlds has been silently
  // broken for warm-transfer Complete (Stephen's reports: 'dropped
  // the third party', 'no longer active'). With server-originated
  // consult, all four legs (rep+customer+rep_consult+target_consult)
  // live in the Call Control App, and Complete is a single
  // /actions/bridge between two known ccids.
  //
  // Steps:
  //   1. SDK-side hold the original call (Verto call.hold). Customer
  //      hears Telnyx hold music.
  //   2. Mark outboundDialExpectRef kind=consult so the next "ringing
  //      inbound" INVITE auto-answers AND routes to transferCallRef
  //      (not callRef — the original held customer call must stay
  //      addressable through callRef).
  //   3. POST /api/telnyx/warm-transfer/start. Server originates rep_
  //      consult leg + downstream target leg; the SDK auto-answers
  //      rep_consult when Telnyx INVITES it.
  const warmTransferStart = useCallback(
    async (targetNumber: string): Promise<boolean> => {
      if (!clientRef.current || !callRef.current) return false;
      const active = callRef.current;
      const repCcid = active.telnyxIDs?.telnyxCallControlId;
      transferDebug("warmTransferStart — server-originated consult", {
        repCcid,
        targetNumber,
      });
      if (!repCcid) {
        setMicError("Warm transfer failed: no call_control_id on active call.");
        return false;
      }

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

      const normalizedTarget = targetNumber.startsWith("+")
        ? targetNumber
        : `+${targetNumber}`;

      // Arm the auto-answer ref BEFORE the fetch — Telnyx's INVITE to
      // the SDK can race ahead of our /start response on a fast network.
      outboundDialExpectRef.current = {
        customer: normalizedTarget,
        kind: "consult",
        expiresAt: Date.now() + 15_000,
      };

      try {
        const res = await fetch("/api/telnyx/warm-transfer/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: targetNumber, repCcid }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          repConsultCcid?: string;
          error?: string;
        };
        transferDebug("warmTransferStart — response", {
          status: res.status,
          data,
        });
        if (!res.ok || !data?.success) {
          // Clear the expect ref so we don't accidentally auto-answer a
          // real inbound that arrives within the 15s window.
          outboundDialExpectRef.current = null;
          // Roll back the hold so the rep can keep talking to the
          // customer.
          try {
            await active.unhold();
          } catch {}
          setActiveCall((prev) =>
            prev ? { ...prev, isHeld: false, status: "active" } : null
          );
          setTransferCall(null);
          setMicError(
            `Warm transfer failed: ${data?.error || "could not start consult"}.`
          );
          return false;
        }
      } catch (err) {
        outboundDialExpectRef.current = null;
        try {
          await active.unhold();
        } catch {}
        setActiveCall((prev) =>
          prev ? { ...prev, isHeld: false, status: "active" } : null
        );
        setTransferCall(null);
        console.error("[warm] start threw:", err);
        setMicError("Warm transfer failed: network error.");
        return false;
      }
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
  // POSTs /api/telnyx/warm-transfer/complete with the rep's two ccids.
  // The server resolves both external_ccids (customer + target) from
  // call_logs and issues ONE /actions/bridge customerCcid ↔
  // targetConsultCcid. Both rep legs become unbridged; Telnyx tears
  // them down; the SDK gets BYE on both and our callUpdate handler
  // clears state.
  const warmTransferComplete = useCallback(async () => {
    if (!callRef.current || !transferCallRef.current) return;
    const repCcid = callRef.current.telnyxIDs.telnyxCallControlId;
    const repConsultCcid =
      transferCallRef.current.telnyxIDs.telnyxCallControlId;
    transferDebug(
      "warmTransferComplete — POST /api/telnyx/warm-transfer/complete",
      { repCcid, repConsultCcid }
    );

    // Unhold first so customer's audio path is open when Telnyx swaps
    // the bridge target. Bridging into a held leg can leave the
    // customer hearing silence after the handoff.
    try {
      await callRef.current.unhold();
    } catch (err) {
      console.warn("[warm] unhold before bridge threw (continuing):", err);
    }

    try {
      const res = await fetch("/api/telnyx/warm-transfer/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repCcid, repConsultCcid }),
      });
      const data = await res.json().catch(() => ({}));
      transferDebug("warmTransferComplete — response", {
        status: res.status,
        data,
      });
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

    // Bridge accepted. Telnyx will hang up both rep legs; the
    // callUpdate hangup handler clears state. Collapse the transfer-
    // panel UI now (visual only).
    setTransferCall(null);
  }, []);

  // Warm transfer — CANCEL.
  //
  // The consult is server-originated, so the SDK can't tear it down
  // by itself — POST /api/telnyx/warm-transfer/cancel which hangs up
  // repConsultCcid server-side. Telnyx then drops the bridged target
  // leg automatically. Client unholds the original call so the rep
  // resumes talking to the customer.
  const warmTransferCancel = useCallback(async () => {
    const repConsultCcid =
      transferCallRef.current?.telnyxIDs?.telnyxCallControlId;

    // Best-effort server-side hangup of the consult.
    if (repConsultCcid) {
      try {
        await fetch("/api/telnyx/warm-transfer/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repConsultCcid }),
        });
      } catch (err) {
        console.warn("[warm] cancel POST threw (continuing):", err);
      }
    }

    // Tear down the SDK side too — Telnyx's BYE will arrive but a
    // direct hangup is faster for UI snap-back.
    if (transferCallRef.current) {
      try {
        transferCallRef.current.hangup();
      } catch {}
      transferCallRef.current = null;
      transferTargetNumberRef.current = null;
      setTransferCall(null);
    }

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
    markOutboundDialExpected,
    clearOutboundDialExpected,
  };
}
