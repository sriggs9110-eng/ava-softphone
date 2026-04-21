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
  PhoneOff,
} from "lucide-react";
import { ActiveCallInfo } from "@/app/lib/types";
import { formatUSPhone } from "@/lib/format-phone";

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

/**
 * Active call hero — consolidated in round 2. Single compact header card,
 * horizontal icon-row controls, prominent end-call button centered below.
 * No mascot panel here; the right-rail PepperCorner owns the listening
 * affordance during a call.
 */
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
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, "0");
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

  const prettyNumber = formatUSPhone(call.number);
  const directionLabel =
    call.direction === "inbound" ? "INBOUND" : "OUTBOUND";
  const timerText = formatDuration(elapsed);

  const statusChip =
    call.status === "active" ? (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-leaf border-2 border-navy shadow-pop-sm">
        <span className="relative w-2 h-2">
          <span className="absolute inset-0 rounded-full bg-white border border-navy" />
          <span className="absolute inset-0 rounded-full bg-white animate-pulse-ring" />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-white">
          Connected
        </span>
      </span>
    ) : call.status === "held" ? (
      <span className="px-2 py-0.5 rounded-full bg-banana border-2 border-navy shadow-pop-sm text-[10px] font-bold uppercase tracking-wider text-navy">
        On Hold
      </span>
    ) : (
      <span className="px-2 py-0.5 rounded-full bg-banana border-2 border-navy shadow-pop-sm text-[10px] font-bold uppercase tracking-wider text-navy">
        {call.status === "dialing" ? "Dialing" : "Ringing"}
      </span>
    );

  return (
    <div className="flex flex-col items-stretch gap-4 w-full max-w-[440px] mx-auto animate-fade-in">
      {/* Compact call header card */}
      <div className="bg-paper border-[2.5px] border-navy rounded-[14px] shadow-pop-md px-4 py-3">
        <div className="flex items-center justify-between">
          {statusChip}
          <span className="text-[11px] text-slate font-semibold">
            {call.isMuted ? "MUTED" : ""}
          </span>
        </div>
        <p className="mt-1 text-[2rem] leading-tight font-bold text-navy font-display tabular-nums tracking-tight">
          {prettyNumber}
        </p>
        <div className="mt-1 flex items-center justify-between text-[13px]">
          <span className="text-slate font-display italic tabular-nums">
            {directionLabel}
          </span>
          {call.status === "active" && (
            <span className="text-navy font-semibold tabular-nums font-display text-[1.5rem] leading-none">
              {timerText}
            </span>
          )}
        </div>
      </div>

      {/* Controls row — circular icon buttons, single row */}
      <div className="flex items-start justify-around gap-2">
        <IconButton
          icon={call.isMuted ? <MicOff size={18} /> : <Mic size={18} />}
          label={call.isMuted ? "Unmute" : "Mute"}
          active={call.isMuted}
          activeColor="coral"
          onClick={onToggleMute}
        />
        <IconButton
          icon={call.isHeld ? <Play size={18} /> : <Pause size={18} />}
          label={call.isHeld ? "Resume" : "Hold"}
          active={call.isHeld}
          activeColor="coral"
          onClick={onToggleHold}
        />
        <IconButton
          icon={<Grid3X3 size={18} />}
          label="Keypad"
          active={showKeypad}
          onClick={() => {
            setShowKeypad(!showKeypad);
            if (!showKeypad) setDtmfDigits("");
          }}
        />
        <IconButton
          icon={<ArrowRightLeft size={18} />}
          label="Transfer"
          onClick={onTransfer}
        />
        <IconButton
          icon={<Voicemail size={18} />}
          label="VM Drop"
          onClick={onVoicemailDrop}
        />
        <IconButton
          icon={<UserPlus size={18} />}
          label="Add"
          onClick={() => {}}
        />
      </div>

      {/* Inline DTMF keypad — expands below the controls row when Keypad
          is toggled. No more modal overlay. */}
      {showKeypad && (
        <div className="bg-cream-3 border-2 border-navy rounded-[14px] p-3 animate-fade-in">
          <div className="relative h-7 text-center mb-2">
            {dtmfDigits && (
              <p className="text-[18px] font-semibold text-navy tracking-[2px] tabular-nums font-display">
                {dtmfDigits}
              </p>
            )}
            {dtmfFlash && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[40px] font-bold text-banana opacity-70 pointer-events-none animate-fade-in font-display">
                {dtmfFlash}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {DTMF_KEYS.flat().map((key) => (
              <button
                key={key}
                onClick={() => handleDTMF(key)}
                className="w-11 h-11 mx-auto rounded-full bg-paper border-2 border-navy active:scale-95 text-base font-semibold text-navy transition-all duration-100 shadow-pop-sm shadow-pop-hover font-display"
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* End call — prominent, centered */}
      <div className="flex flex-col items-center mt-1">
        <button
          onClick={onHangup}
          className="w-[72px] h-[72px] rounded-full bg-coral border-[2.5px] border-navy flex items-center justify-center transition-all duration-150 active:scale-95 shadow-pop-md shadow-pop-hover"
          aria-label="End call"
          title="End call"
        >
          <PhoneOff size={26} strokeWidth={2.5} className="text-white" />
        </button>
        <span className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-coral-deep font-display">
          End Call
        </span>
      </div>
    </div>
  );
}

function IconButton({
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
    <div className="flex flex-col items-center gap-1 w-[60px]">
      <button
        onClick={onClick}
        className={`w-[52px] h-[52px] rounded-full border-2 border-navy shadow-pop-sm shadow-pop-hover transition-colors flex items-center justify-center ${
          active ? activeBg : "bg-paper text-navy"
        }`}
        aria-label={label}
        title={label}
      >
        {icon}
      </button>
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate font-display text-center leading-tight">
        {label}
      </span>
    </div>
  );
}
