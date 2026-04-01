"use client";

import { useState } from "react";

interface AfterCallWorkProps {
  countdown: number;
  onReady: () => void;
}

export default function AfterCallWork({ countdown, onReady }: AfterCallWorkProps) {
  const [notes, setNotes] = useState("");
  const progress = ((30 - countdown) / 30) * 100;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-[380px] mx-auto py-8 animate-slide-up">
      {/* Countdown ring */}
      <div className="relative w-32 h-32 flex items-center justify-center">
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 128 128">
          <circle
            cx="64"
            cy="64"
            r="56"
            fill="none"
            stroke="#282828"
            strokeWidth="6"
          />
          <circle
            cx="64"
            cy="64"
            r="56"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 56}`}
            strokeDashoffset={`${2 * Math.PI * 56 * (1 - progress / 100)}`}
            className="transition-all duration-1000 ease-linear"
          />
        </svg>
        <span className="text-[36px] font-bold text-amber tabular-nums">
          {countdown}
        </span>
      </div>

      {/* Label */}
      <div className="text-center">
        <p className="text-[12px] text-text-tertiary uppercase tracking-[0.5px] font-medium">
          After Call Work
        </p>
        <p className="text-[13px] text-text-secondary mt-1">
          Auto-available in {countdown}s
        </p>
      </div>

      {/* Notes */}
      <div className="w-full">
        <label className="text-[11px] text-text-tertiary uppercase tracking-wider font-medium block mb-2">
          Call Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Quick notes about this call..."
          className="w-full h-24 px-3 py-2.5 text-[13px] bg-bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all resize-none"
        />
      </div>

      {/* Ready button */}
      <button
        onClick={onReady}
        className="w-full py-3 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all duration-150 min-h-[44px] hover:-translate-y-px"
      >
        Ready
      </button>
    </div>
  );
}
