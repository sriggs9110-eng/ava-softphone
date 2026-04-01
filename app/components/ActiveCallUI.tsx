"use client";

import { useEffect, useState, useCallback } from "react";
import { ActiveCallInfo } from "@/app/lib/types";

interface ActiveCallUIProps {
  call: ActiveCallInfo;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onDTMF: (digit: string) => void;
  onTransfer: () => void;
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
    const m = Math.floor(secs / 60)
      .toString()
      .padStart(2, "0");
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
    <div className="flex flex-col items-center gap-6 w-full max-w-xs mx-auto py-8">
      {/* Connected indicator */}
      {call.status === "active" && (
        <div className="relative">
          <div className="w-3 h-3 rounded-full bg-green" />
          <div className="absolute inset-0 w-3 h-3 rounded-full bg-green animate-pulse-ring" />
        </div>
      )}

      {/* Number display */}
      <div className="text-center">
        <p className="text-2xl font-light text-foreground">{call.number}</p>
        <p className="text-sm text-muted mt-1 uppercase tracking-wide">
          {call.direction === "inbound" ? "Incoming" : "Outgoing"}
        </p>
      </div>

      {/* Status / Timer */}
      <p className="text-3xl font-light text-foreground tabular-nums">
        {statusLabel}
      </p>

      {/* DTMF Keypad */}
      {showKeypad && (
        <div className="grid grid-cols-3 gap-2 w-full">
          {DTMF_KEYS.flat().map((key) => (
            <button
              key={key}
              onClick={() => onDTMF(key)}
              className="h-12 rounded-lg bg-card hover:bg-card-hover active:bg-border text-lg font-medium text-foreground transition-colors"
            >
              {key}
            </button>
          ))}
        </div>
      )}

      {/* Action Buttons Row 1 */}
      <div className="flex items-center gap-4">
        <ActionButton
          icon={call.isMuted ? "mic-off" : "mic"}
          label={call.isMuted ? "Unmute" : "Mute"}
          active={call.isMuted}
          onClick={onToggleMute}
        />
        <ActionButton
          icon="pause"
          label={call.isHeld ? "Resume" : "Hold"}
          active={call.isHeld}
          onClick={onToggleHold}
        />
        <ActionButton
          icon="grid"
          label="Keypad"
          active={showKeypad}
          onClick={() => setShowKeypad(!showKeypad)}
        />
      </div>

      {/* Action Buttons Row 2 */}
      <div className="flex items-center gap-4">
        <ActionButton icon="shuffle" label="Transfer" onClick={onTransfer} />
      </div>

      {/* Hangup Button */}
      <button
        onClick={onHangup}
        className="w-16 h-16 rounded-full bg-red hover:bg-red/90 flex items-center justify-center transition-all active:scale-95 mt-4"
        aria-label="End Call"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
          <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 010-1.36C3.69 8.68 7.61 7 12 7s8.31 1.68 11.71 4.72c.18.18.29.44.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 00-2.67-1.85.996.996 0 01-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
        </svg>
      </button>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  const iconSvg = {
    mic: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
        <path d="M19 10v2a7 7 0 01-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
    "mic-off": (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
        <path d="M17 16.95A7 7 0 015 12v-2m14 0v2c0 .98-.2 1.92-.57 2.78" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
    pause: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="4" width="4" height="16" />
        <rect x="14" y="4" width="4" height="16" />
      </svg>
    ),
    grid: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
    shuffle: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 3 21 3 21 8" />
        <line x1="4" y1="20" x2="21" y2="3" />
        <polyline points="21 16 21 21 16 21" />
        <line x1="15" y1="15" x2="21" y2="21" />
        <line x1="4" y1="4" x2="9" y2="9" />
      </svg>
    ),
  }[icon];

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-3 rounded-xl transition-colors ${
        active
          ? "bg-coral text-white"
          : "bg-card hover:bg-card-hover text-foreground"
      }`}
    >
      {iconSvg}
      <span className="text-[10px] uppercase tracking-wide">{label}</span>
    </button>
  );
}
