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
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/95 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4 w-full max-w-xs p-6">
          <div className="text-center mb-2">
            <p className="text-sm text-muted uppercase tracking-wide">
              Transfer from
            </p>
            <p className="text-lg text-foreground">{originalCall.number}</p>
            <p className="text-xs text-coral mt-1">On Hold</p>
          </div>

          {!transferCall && (
            <>
              <input
                type="tel"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                className="w-full text-center text-xl font-light bg-card border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-coral transition-colors"
                placeholder="Transfer to..."
                autoFocus
              />

              <div className="grid grid-cols-3 gap-2 w-full">
                {KEYS.flat().map((key) => (
                  <button
                    key={key}
                    onClick={() => handleKey(key)}
                    className="h-12 rounded-lg bg-card hover:bg-card-hover active:bg-border text-lg font-medium text-foreground transition-colors"
                  >
                    {key}
                  </button>
                ))}
              </div>

              <div className="flex gap-3 w-full mt-2">
                <button
                  onClick={onCancel}
                  className="flex-1 py-3 rounded-xl bg-card hover:bg-card-hover text-foreground text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                {number.length > 2 && (
                  <button
                    onClick={handleDial}
                    className="flex-1 py-3 rounded-xl bg-green hover:bg-green/90 text-white text-sm font-medium transition-colors"
                  >
                    Call
                  </button>
                )}
                <button
                  onClick={handleBackspace}
                  className="py-3 px-4 rounded-xl bg-card hover:bg-card-hover text-muted transition-colors"
                  aria-label="Backspace"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                    <line x1="18" y1="9" x2="12" y2="15" />
                    <line x1="12" y1="9" x2="18" y2="15" />
                  </svg>
                </button>
              </div>
            </>
          )}

          {transferCall && transferCall.status === "dialing" && (
            <div className="text-center">
              <p className="text-muted text-sm">Calling transfer target...</p>
              <p className="text-xl text-foreground mt-2">
                {transferCall.number}
              </p>
              <button
                onClick={onCancel}
                className="mt-6 px-6 py-3 rounded-xl bg-red hover:bg-red/90 text-white text-sm font-medium transition-colors"
              >
                Cancel Transfer
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Phase 2: Transfer target connected — show complete/cancel/conference
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6 w-full max-w-xs p-6">
        <div className="text-center">
          <p className="text-sm text-muted uppercase tracking-wide">
            Transfer in progress
          </p>
        </div>

        <div className="flex w-full gap-4">
          <div className="flex-1 bg-card rounded-xl p-4 text-center">
            <p className="text-xs text-muted mb-1">Original</p>
            <p className="text-sm text-foreground">{originalCall.number}</p>
            <p className="text-xs text-coral mt-1">On Hold</p>
          </div>
          <div className="flex-1 bg-card rounded-xl p-4 text-center">
            <p className="text-xs text-muted mb-1">Transfer</p>
            <p className="text-sm text-foreground">{transferCall.number}</p>
            <p className="text-xs text-green mt-1">Connected</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 w-full">
          <button
            onClick={onComplete}
            className="w-full py-3 rounded-xl bg-green hover:bg-green/90 text-white text-sm font-medium transition-colors"
          >
            Complete Transfer
          </button>
          <button
            onClick={onConference}
            className="w-full py-3 rounded-xl bg-coral hover:bg-coral-hover text-white text-sm font-medium transition-colors"
          >
            Conference (Merge All)
          </button>
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-xl bg-card hover:bg-card-hover text-foreground text-sm font-medium transition-colors"
          >
            Cancel Transfer
          </button>
        </div>
      </div>
    </div>
  );
}
