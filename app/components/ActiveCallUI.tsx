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

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-[380px] mx-auto py-8 animate-slide-up">
      {/* Status indicator */}
      {call.status === "active" && (
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-full bg-green" />
            <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-green animate-pulse-ring" />
          </div>
          <span className="text-[11px] font-medium uppercase tracking-wider text-green">
            Connected
          </span>
        </div>
      )}

      {call.status === "held" && (
        <div className="px-3 py-1 rounded-full bg-amber/15 border border-amber/30">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-amber">
            On Hold
          </span>
        </div>
      )}

      {(call.status === "dialing" || call.status === "ringing") && (
        <div className="px-3 py-1 rounded-full bg-accent/15 border border-accent/30">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-accent">
            {call.status === "dialing" ? "Dialing" : "Ringing"}
          </span>
        </div>
      )}

      {/* Number */}
      <div className="text-center">
        <p className="text-[28px] font-semibold text-text-primary tracking-[1px]">
          {call.number}
        </p>
        <p className="text-[12px] text-text-tertiary mt-1 uppercase tracking-[0.5px] font-medium">
          {call.direction === "inbound" ? "Incoming Call" : "Outgoing Call"}
        </p>
      </div>

      {/* Timer */}
      <p className="text-[36px] font-bold text-text-primary tabular-nums">
        {statusLabel}
      </p>

      {/* DTMF Keypad */}
      {showKeypad && (
        <div className="grid grid-cols-3 gap-3 w-full max-w-[240px] animate-fade-in">
          {DTMF_KEYS.flat().map((key) => (
            <button
              key={key}
              onClick={() => onDTMF(key)}
              className="w-14 h-14 mx-auto rounded-full bg-bg-elevated hover:bg-bg-hover active:scale-95 text-xl font-semibold text-text-primary transition-all duration-150"
            >
              {key}
            </button>
          ))}
        </div>
      )}

      {/* Row 1: Mute, Hold, Keypad */}
      <div className="flex items-center gap-4">
        <ActionBtn
          icon={call.isMuted ? <MicOff size={18} /> : <Mic size={18} />}
          label={call.isMuted ? "Unmute" : "Mute"}
          active={call.isMuted}
          activeColor="accent"
          onClick={onToggleMute}
        />
        <ActionBtn
          icon={call.isHeld ? <Play size={18} /> : <Pause size={18} />}
          label={call.isHeld ? "Resume" : "Hold"}
          active={call.isHeld}
          activeColor="amber"
          onClick={onToggleHold}
        />
        <ActionBtn
          icon={<Grid3X3 size={18} />}
          label="Keypad"
          active={showKeypad}
          onClick={() => setShowKeypad(!showKeypad)}
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
        className="w-14 h-14 rounded-full bg-red hover:bg-red/90 flex items-center justify-center transition-all duration-150 active:scale-95 mt-4"
        aria-label="End Call"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
          <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 010-1.36C3.69 8.68 7.61 7 12 7s8.31 1.68 11.71 4.72c.18.18.29.44.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 00-2.67-1.85.996.996 0 01-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
        </svg>
      </button>

      {/* Calling from */}
      <p className="text-[12px] text-text-tertiary">
        Calling from: {process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER || "Not set"}
      </p>
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  active,
  activeColor = "accent",
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  activeColor?: "accent" | "amber";
  onClick: () => void;
}) {
  const activeBg =
    activeColor === "amber"
      ? "bg-amber text-bg-app"
      : "bg-accent text-text-on-accent";

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 w-16 py-3 rounded-xl transition-all duration-150 hover:-translate-y-px min-h-[44px] ${
        active ? activeBg : "bg-bg-elevated hover:bg-bg-hover text-text-secondary"
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium uppercase tracking-[0.5px]">
        {label}
      </span>
    </button>
  );
}
