"use client";

import { useState, useCallback } from "react";
import { ActiveCallInfo } from "@/app/lib/types";

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
];

interface TransferUIProps {
  originalCall: ActiveCallInfo;
  transferCall: ActiveCallInfo | null;
  onDial: (number: string) => void;
  onComplete: () => void;
  onCancel: () => void;
  onConference: () => void;
}

export default function TransferUI({
  originalCall,
  transferCall,
  onDial,
  onComplete,
  onCancel,
  onConference,
}: TransferUIProps) {
  const [number, setNumber] = useState("+1");

  const handleKey = useCallback((key: string) => {
    setNumber((prev) => prev + key);
  }, []);

  const handleBackspace = useCallback(() => {
    setNumber((prev) => (prev.length > 2 ? prev.slice(0, -1) : "+1"));
  }, []);

  const handleDial = useCallback(() => {
    if (number.length > 2) {
      onDial(number);
    }
  }, [number, onDial]);

  // Phase 1: Dialing transfer target
  if (!transferCall || transferCall.status === "dialing") {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg-app/95 backdrop-blur-md">
        <div className="flex flex-col items-center gap-5 w-full max-w-sm p-6 animate-slide-up">
          {/* Original call info */}
          <div className="w-full bg-bg-surface border border-border-subtle rounded-xl p-4 text-center">
            <p className="text-[11px] text-text-tertiary uppercase tracking-[0.5px] font-medium">
              Transfer from
            </p>
            <p className="text-lg font-semibold text-text-primary mt-1">
              {originalCall.number}
            </p>
            <span className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full bg-amber/10 border border-amber/20">
              <div className="w-1.5 h-1.5 rounded-full bg-amber" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-amber">
                On Hold
              </span>
            </span>
          </div>

          {!transferCall && (
            <>
              <input
                type="tel"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                className="w-full text-center text-xl font-semibold tracking-wide bg-bg-elevated border border-border-subtle rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
                placeholder="Transfer to..."
                autoFocus
              />

              <div className="grid grid-cols-3 gap-3 w-full max-w-[240px]">
                {KEYS.flat().map((key) => (
                  <button
                    key={key}
                    onClick={() => handleKey(key)}
                    className="w-14 h-14 mx-auto rounded-full bg-bg-elevated hover:bg-bg-hover active:scale-95 text-lg font-semibold text-text-primary transition-all duration-150"
                  >
                    {key}
                  </button>
                ))}
              </div>

              <div className="flex gap-3 w-full mt-2">
                <button
                  onClick={onCancel}
                  className="flex-1 py-3 rounded-lg bg-bg-elevated hover:bg-bg-hover text-text-secondary text-sm font-semibold transition-all duration-150 min-h-[44px] hover:-translate-y-px"
                >
                  Cancel
                </button>
                {number.length > 2 && (
                  <button
                    onClick={handleDial}
                    className="flex-1 py-3 rounded-lg bg-green hover:bg-green/90 text-white text-sm font-semibold transition-all duration-150 min-h-[44px] hover:-translate-y-px"
                  >
                    Call
                  </button>
                )}
                <button
                  onClick={handleBackspace}
                  className="py-3 px-4 rounded-lg bg-bg-elevated hover:bg-bg-hover text-text-tertiary transition-all duration-150 min-h-[44px]"
                  aria-label="Backspace"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                    <line x1="18" y1="9" x2="12" y2="15" />
                    <line x1="12" y1="9" x2="18" y2="15" />
                  </svg>
                </button>
              </div>
            </>
          )}

          {transferCall && transferCall.status === "dialing" && (
            <div className="text-center animate-fade-in">
              <p className="text-text-tertiary text-[12px] uppercase tracking-[0.5px] font-medium">
                Calling transfer target
              </p>
              <p className="text-2xl font-bold text-text-primary mt-3">
                {transferCall.number}
              </p>
              <button
                onClick={onCancel}
                className="mt-6 px-6 py-3 rounded-lg bg-red hover:bg-red/90 text-white text-sm font-semibold transition-all duration-150 min-h-[44px]"
              >
                Cancel Transfer
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Phase 2: Transfer target connected
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg-app/95 backdrop-blur-md">
      <div className="flex flex-col items-center gap-6 w-full max-w-sm p-6 animate-slide-up">
        <p className="text-[12px] text-text-tertiary uppercase tracking-[0.5px] font-medium">
          Transfer in progress
        </p>

        <div className="flex w-full gap-3">
          <div className="flex-1 bg-bg-surface border border-border-subtle rounded-xl p-4 text-center">
            <p className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium mb-2">
              Original
            </p>
            <p className="text-sm font-semibold text-text-primary">
              {originalCall.number}
            </p>
            <span className="inline-flex items-center gap-1 mt-2">
              <div className="w-1.5 h-1.5 rounded-full bg-amber" />
              <span className="text-[10px] text-amber font-medium">Held</span>
            </span>
          </div>
          <div className="flex-1 bg-bg-surface border border-border-subtle rounded-xl p-4 text-center">
            <p className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium mb-2">
              Transfer
            </p>
            <p className="text-sm font-semibold text-text-primary">
              {transferCall.number}
            </p>
            <span className="inline-flex items-center gap-1 mt-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green" />
              <span className="text-[10px] text-green font-medium">Active</span>
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 w-full">
          <button
            onClick={onComplete}
            className="w-full py-3 rounded-lg bg-green hover:bg-green/90 text-white text-sm font-semibold transition-all duration-150 min-h-[44px] hover:-translate-y-px"
          >
            Complete Transfer
          </button>
          <button
            onClick={onConference}
            className="w-full py-3 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all duration-150 min-h-[44px] hover:-translate-y-px"
          >
            Conference (Merge All)
          </button>
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-lg bg-bg-elevated hover:bg-bg-hover text-text-secondary text-sm font-semibold transition-all duration-150 min-h-[44px] hover:-translate-y-px"
          >
            Cancel Transfer
          </button>
        </div>
      </div>
    </div>
  );
}
