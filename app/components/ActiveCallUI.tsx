"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Mic,
  MicOff,
  Pause,
  Play,
  Grid3X3,
  ArrowRightLeft,
  Voicemail,
  UserPlus,
} from "lucide-react";
import { ActiveCallInfo } from "@/app/lib/types";
import PepperMascot, { PepperState } from "@/components/pepper/PepperMascot";

interface ActiveCallUIProps {
  call: ActiveCallInfo;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onDTMF: (digit: string) => void;
  onTransfer: () => void;
  onVoicemailDrop: () => void;
}

const DTMF_KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
];

export default function ActiveCallUI({
  call,
  onHangup,
  onToggleMute,
  onToggleHold,
  onDTMF,
  onTransfer,
  onVoicemailDrop,
}: ActiveCallUIProps) {
  const [elapsed, setElapsed] = useState(0);
  const [showKeypad, setShowKeypad] = useState(false);
  const [dtmfDigits, setDtmfDigits] = useState("");
  const [dtmfFlash, setDtmfFlash] = useState<string | null>(null);

  useEffect(() => {
    if (call.status !== "active" || !call.startTime) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - call.startTime!) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [call.status, call.startTime]);

  const formatDuration = useCallback((secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, []);

  const handleDTMF = useCallback(
    (digit: string) => {
      onDTMF(digit);
      setDtmfDigits((prev) => prev + digit);
      setDtmfFlash(digit);
      setTimeout(() => setDtmfFlash(null), 300);
    },
    [onDTMF]
  );

  const statusLabel =
    call.status === "dialing"
      ? "Dialing..."
      : call.status === "ringing"
      ? "Ringing..."
      : call.status === "held"
      ? "On Hold"
      : call.status === "active"
      ? formatDuration(elapsed)
      : call.status;

  const pepperState: PepperState =
    call.status === "dialing" || call.status === "ringing"
      ? "thinking"
      : call.status === "held"
      ? "listening"
      : "listening";

  return (
    <div className="flex flex-col lg:flex-row items-center lg:items-start justify-center gap-6 lg:gap-10 w-full py-8 animate-slide-up relative">
      {/* Main call panel */}
      <div className="flex flex-col items-center gap-7 w-full max-w-[380px]">
      {/* Status indicator */}
      {call.status === "active" && (
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-leaf border-2 border-navy shadow-pop-sm">
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-full bg-white border border-navy" />
            <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-white animate-pulse-ring" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-white">
            Connected
          </span>
        </div>
      )}

      {call.status === "held" && (
        <div className="px-3 py-1 rounded-full bg-banana border-2 border-navy shadow-pop-sm">
          <span className="text-[11px] font-bold uppercase tracking-wider text-navy">
            On Hold
          </span>
        </div>
      )}

      {(call.status === "dialing" || call.status === "ringing") && (
        <div className="px-3 py-1 rounded-full bg-banana border-2 border-navy shadow-pop-sm">
          <span className="text-[11px] font-bold uppercase tracking-wider text-navy">
            {call.status === "dialing" ? "Dialing" : "Ringing"}
          </span>
        </div>
      )}

      {/* Number */}
      <div className="text-center">
        <p className="text-[32px] font-semibold text-navy tracking-[0.5px] font-display">
          {call.number}
        </p>
        <p className="text-[11px] text-slate mt-1 uppercase tracking-[0.5px] font-bold">
          {call.direction === "inbound" ? "Incoming Call" : "Outgoing Call"}
        </p>
      </div>

      {/* Timer */}
      <p className="text-[48px] font-bold text-navy tabular-nums font-display">
        {statusLabel}
      </p>

      {/* Row 1: Mute, Hold, Keypad */}
      <div className="flex items-center gap-4">
        <ActionBtn
          icon={call.isMuted ? <MicOff size={18} /> : <Mic size={18} />}
          label={call.isMuted ? "Unmute" : "Mute"}
          active={call.isMuted}
          activeColor="banana"
          onClick={onToggleMute}
        />
        <ActionBtn
          icon={call.isHeld ? <Play size={18} /> : <Pause size={18} />}
          label={call.isHeld ? "Resume" : "Hold"}
          active={call.isHeld}
          activeColor="banana"
          onClick={onToggleHold}
        />
        <ActionBtn
          icon={<Grid3X3 size={18} />}
          label="Keypad"
          active={showKeypad}
          onClick={() => {
            setShowKeypad(!showKeypad);
            if (!showKeypad) setDtmfDigits("");
          }}
        />
      </div>

      {/* Row 2: Transfer, VM Drop, Add Call */}
      <div className="flex items-center gap-4">
        <ActionBtn
          icon={<ArrowRightLeft size={18} />}
          label="Transfer"
          onClick={onTransfer}
        />
        <ActionBtn
          icon={<Voicemail size={18} />}
          label="VM Drop"
          onClick={onVoicemailDrop}
        />
        <ActionBtn
          icon={<UserPlus size={18} />}
          label="Add Call"
          onClick={() => {}}
        />
      </div>

      {/* End Call */}
      <button
        onClick={onHangup}
        className="w-16 h-16 rounded-full bg-coral border-[2.5px] border-navy flex items-center justify-center transition-all duration-150 active:scale-95 mt-4 shadow-pop-md shadow-pop-hover"
        aria-label="End Call"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="white">
          <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 010-1.36C3.69 8.68 7.61 7 12 7s8.31 1.68 11.71 4.72c.18.18.29.44.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 00-2.67-1.85.996.996 0 01-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
        </svg>
      </button>

      {/* Calling from */}
      <p className="text-[12px] text-slate">
        Calling from: {process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER || "Not set"}
      </p>
      </div>

      {/* Right rail — Pepper coach panel */}
      <aside className="w-full lg:w-[280px] shrink-0">
        <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md flex flex-col items-center text-center">
          <PepperMascot state={pepperState} size="md" />
          <p className="mt-3 text-[15px] font-semibold text-navy font-display">
            Pepper&apos;s listening
          </p>
          <p className="mt-1 text-[13px] text-slate font-accent text-lg leading-tight">
            I&rsquo;ll jump in if you need me.
          </p>
        </div>
      </aside>

      {/* DTMF Keypad Overlay */}
      {showKeypad && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-navy/60 backdrop-blur-sm"
          onClick={() => setShowKeypad(false)}
        >
          <div
            className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 w-full max-w-[280px] animate-slide-up shadow-pop-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Digit display */}
            <div className="text-center mb-4 h-8 relative">
              {dtmfDigits && (
                <p className="text-[22px] font-semibold text-navy tracking-[2px] tabular-nums font-display">
                  {dtmfDigits}
                </p>
              )}
              {dtmfFlash && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[56px] font-bold text-banana opacity-70 pointer-events-none animate-fade-in font-display">
                  {dtmfFlash}
                </div>
              )}
            </div>

            {/* Keys */}
            <div className="grid grid-cols-3 gap-3">
              {DTMF_KEYS.flat().map((key) => (
                <button
                  key={key}
                  onClick={() => handleDTMF(key)}
                  className="w-14 h-14 mx-auto rounded-full bg-cream-2 border-2 border-navy active:scale-95 text-xl font-semibold text-navy transition-all duration-100 shadow-pop-sm shadow-pop-hover font-display"
                >
                  {key}
                </button>
              ))}
            </div>

            {/* Close */}
            <button
              onClick={() => setShowKeypad(false)}
              className="w-full mt-4 py-2.5 rounded-full bg-paper border-2 border-navy text-navy text-sm font-semibold transition-colors shadow-pop-sm shadow-pop-hover"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  active,
  activeColor = "banana",
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  activeColor?: "banana" | "coral";
  onClick: () => void;
}) {
  const activeBg =
    activeColor === "coral"
      ? "bg-coral text-white"
      : "bg-banana text-navy";

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1.5 w-[72px] py-3 rounded-[14px] border-[2.5px] border-navy transition-all duration-150 min-h-[56px] shadow-pop-sm shadow-pop-hover ${
        active ? activeBg : "bg-paper text-navy"
      }`}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-[0.5px]">
        {label}
      </span>
    </button>
  );
}
