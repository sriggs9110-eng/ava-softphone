"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useTelnyxClient, CallEndInfo } from "@/app/hooks/useTelnyxClient";
import { insertCallLog } from "@/lib/call-logs";
import { createClient } from "@/lib/supabase/client";
import DialPad from "@/app/components/DialPad";
import ActiveCallUI from "@/app/components/ActiveCallUI";
import MicError from "@/app/components/MicError";
import PepperMascot from "@/components/pepper/PepperMascot";
import { Loader2, X, ExternalLink } from "lucide-react";

export default function DialPopupPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <DialPopupInner />
    </Suspense>
  );
}

function PageLoader() {
  return (
    <div className="min-h-screen bg-cream flex items-center justify-center">
      <Loader2 size={24} className="animate-spin text-slate" />
    </div>
  );
}

function DialPopupInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const number = searchParams.get("number") || "";
  const contactName = searchParams.get("name") || "";
  const company = searchParams.get("company") || "";
  const externalId = searchParams.get("external_id") || "";
  const returnUrl = searchParams.get("return_url") || "";

  const activeCallLogIdRef = useRef<string | null>(null);
  const currentExternalIdRef = useRef<string>(externalId);
  currentExternalIdRef.current = externalId;
  const postedStartRef = useRef(false);

  // Bounce to /login with next= if unauthenticated.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const here = `/dial${typeof window !== "undefined" ? window.location.search : ""}`;
      router.replace(`/login?next=${encodeURIComponent(here)}`);
    }
  }, [user, authLoading, router]);

  const postToOpener = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      try {
        if (typeof window === "undefined") return;
        if (!window.opener) return;
        window.opener.postMessage({ type, payload }, "*");
      } catch (err) {
        console.error("[dial] postMessage failed:", err);
      }
    },
    []
  );

  const handleCallEnd = useCallback(
    (info: CallEndInfo) => {
      const logId = activeCallLogIdRef.current;
      activeCallLogIdRef.current = null;
      postToOpener("pepper:call_ended", {
        external_id: currentExternalIdRef.current || null,
        call_log_id: logId,
        duration_seconds: info.duration,
        recording_url: null, // webhook populates this later
        disposition: info.status,
        ai_score: null,
        ai_summary: null,
        transcript_url: null,
        phone_number: info.number,
      });
    },
    [postToOpener]
  );

  const {
    connectionStatus,
    activeCall,
    micError,
    agentStatus,
    acwCountdown: _acw,
    qualityLevel: _q,
    latency: _l,
    packetLoss: _p,
    audioRef,
    makeCall,
    hangup,
    toggleMute,
    toggleHold,
    sendDTMF,
  } = useTelnyxClient(handleCallEnd);

  // pepper:call_started — fire once when the call actually goes active.
  useEffect(() => {
    if (activeCall?.status === "active" && !postedStartRef.current) {
      postedStartRef.current = true;
      postToOpener("pepper:call_started", {
        external_id: externalId || null,
        call_log_id: activeCallLogIdRef.current,
        phone_number: activeCall.number,
      });
    }
    if (!activeCall) {
      postedStartRef.current = false;
    }
  }, [activeCall, externalId, postToOpener]);

  // pepper:recording_ready — subscribe to Supabase Realtime on the call_logs
  // row for this call and push an event when recording_url appears.
  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!activeCallLogIdRef.current || !user) return;
    const logId = activeCallLogIdRef.current;
    const channel = supabase
      .channel(`call_log:${logId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_logs",
          filter: `id=eq.${logId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row?.recording_url) {
            postToOpener("pepper:recording_ready", {
              external_id: currentExternalIdRef.current || null,
              call_log_id: logId,
              recording_url: row.recording_url,
              ai_score: row.ai_score ?? null,
              ai_summary: row.ai_summary ?? null,
              transcript_url: null,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeCall, user, supabase, postToOpener]);

  // Wrap makeCall to also persist the log row (mirrors page.tsx behaviour).
  const handleMakeCall = useCallback(
    async (n: string) => {
      const ccid = await makeCall(n);
      if (user) {
        const log = await insertCallLog({
          user_id: user.id,
          direction: "outbound",
          phone_number: n,
          status: "initiated",
          call_control_id: ccid,
          external_id: externalId || null,
        });
        if (log) activeCallLogIdRef.current = log.id;
      }
    },
    [makeCall, user]
  );

  // Auto-dial: when enabled per user pref AND a number was provided, dial
  // 500ms after Telnyx reports connected. Never auto-dial during auth load.
  const [autoDialed, setAutoDialed] = useState(false);
  useEffect(() => {
    if (autoDialed) return;
    if (!user) return;
    if (!number) return;
    if (!user.auto_dial_popup) return;
    if (connectionStatus !== "connected") return;

    const t = setTimeout(() => {
      setAutoDialed(true);
      handleMakeCall(number);
    }, 500);
    return () => clearTimeout(t);
  }, [autoDialed, user, number, connectionStatus, handleMakeCall]);

  if (authLoading || !user) {
    return <PageLoader />;
  }

  return (
    <div className="min-h-screen w-full bg-cream pepper-gradients flex flex-col">
      <audio ref={audioRef} id="remote-audio" autoPlay playsInline />
      {micError && <MicError message={micError} />}

      {/* Compact header: close button + Pepper wordmark */}
      <header className="flex items-center justify-between px-4 py-3 border-b-[2.5px] border-navy bg-paper">
        <div className="flex items-center gap-2">
          <PepperMascot size="xs" state="listening" />
          <span className="text-navy font-display font-semibold text-sm">
            Pepper
          </span>
        </div>
        <div className="flex items-center gap-2">
          {returnUrl && (
            <a
              href={returnUrl}
              target="_top"
              className="text-[11px] font-semibold text-navy underline underline-offset-2 decoration-coral decoration-2 inline-flex items-center gap-1"
            >
              Return <ExternalLink size={11} />
            </a>
          )}
          <button
            onClick={() => {
              if (activeCall) hangup();
              window.close();
            }}
            aria-label="Close"
            className="w-8 h-8 rounded-full border-2 border-navy bg-paper flex items-center justify-center text-navy hover:bg-coral hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {/* Contact card */}
      <section className="px-5 pt-5">
        <div className="bg-banana border-[2.5px] border-navy rounded-[18px] p-4 shadow-pop-md">
          {contactName ? (
            <>
              <p className="text-[11px] uppercase tracking-[0.5px] font-bold text-navy/70">
                Calling
              </p>
              <p className="text-xl font-semibold text-navy font-display leading-tight">
                {contactName}
              </p>
              {company && (
                <p className="text-[13px] text-navy-2 font-medium mt-0.5">
                  {company}
                </p>
              )}
              <p className="text-[13px] text-navy-2 tabular-nums mt-1">
                {number}
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-[0.5px] font-bold text-navy/70">
                Calling
              </p>
              <p className="text-xl font-semibold text-navy font-display tabular-nums">
                {number || "No number"}
              </p>
            </>
          )}
          {externalId && (
            <p className="text-[10px] text-navy/60 mt-2 font-mono">
              ref: {externalId}
            </p>
          )}
        </div>
      </section>

      {/* Call surface */}
      <main className="flex-1 flex flex-col px-5 py-5 relative z-[1]">
        {activeCall ? (
          <ActiveCallUI
            call={activeCall}
            onHangup={hangup}
            onToggleMute={toggleMute}
            onToggleHold={toggleHold}
            onDTMF={sendDTMF}
            onTransfer={() => {}}
            onVoicemailDrop={() => {}}
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            {number && !user.auto_dial_popup && (
              <button
                onClick={() => handleMakeCall(number)}
                disabled={
                  connectionStatus !== "connected" || agentStatus === "dnd"
                }
                className="w-full py-3 rounded-full bg-leaf border-[2.5px] border-navy text-white text-sm font-bold transition-all min-h-[48px] shadow-pop-md shadow-pop-hover disabled:opacity-40"
              >
                {connectionStatus === "connected"
                  ? `Call ${contactName || number}`
                  : connectionStatus === "connecting"
                  ? "Connecting…"
                  : "Offline"}
              </button>
            )}
            <DialPad
              initialNumber={number || undefined}
              onCall={handleMakeCall}
              recentNumbers={[]}
              disabled={
                connectionStatus !== "connected" || agentStatus === "dnd"
              }
            />
          </div>
        )}
      </main>

      {/* Footer: connection hint */}
      <footer className="px-5 pb-3 text-center">
        <p className="text-[11px] text-slate">
          {connectionStatus === "connected"
            ? "Ready"
            : connectionStatus === "connecting"
            ? "Connecting to Telnyx…"
            : "Disconnected"}
        </p>
      </footer>
    </div>
  );
}
