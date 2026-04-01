"use client";

import { useState, useCallback } from "react";

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
];

const SUB_LABELS: Record<string, string> = {
  "1": "",
  "2": "ABC",
  "3": "DEF",
  "4": "GHI",
  "5": "JKL",
  "6": "MNO",
  "7": "PQRS",
  "8": "TUV",
  "9": "WXYZ",
  "*": "",
  "0": "+",
  "#": "",
};

interface DialPadProps {
  onCall: (number: string) => void;
  recentNumbers: string[];
  disabled?: boolean;
}

export default function DialPad({ onCall, recentNumbers, disabled }: DialPadProps) {
  const [number, setNumber] = useState("+1");
  const [showRecents, setShowRecents] = useState(false);

  const handleKey = useCallback((key: string) => {
    setNumber((prev) => prev + key);
  }, []);

  const handleBackspace = useCallback(() => {
    setNumber((prev) => (prev.length > 2 ? prev.slice(0, -1) : "+1"));
  }, []);

  const handleClear = useCallback(() => {
    setNumber("+1");
  }, []);

  const handleCall = useCallback(() => {
    if (number.length > 2 && !disabled) {
      onCall(number);
    }
  }, [number, onCall, disabled]);

  const handleRecentSelect = useCallback((num: string) => {
    setNumber(num);
    setShowRecents(false);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-xs mx-auto">
      {/* Number Input */}
      <div className="relative w-full">
        <input
          type="tel"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onFocus={() => setShowRecents(true)}
          onBlur={() => setTimeout(() => setShowRecents(false), 200)}
          className="w-full text-center text-2xl font-light bg-card border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-coral transition-colors"
          placeholder="+1"
        />
        {number.length > 2 && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
            <button
              onClick={handleBackspace}
              className="p-1.5 text-muted hover:text-foreground transition-colors"
              aria-label="Backspace"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                <line x1="18" y1="9" x2="12" y2="15" />
                <line x1="12" y1="9" x2="18" y2="15" />
              </svg>
            </button>
            <button
              onClick={handleClear}
              className="p-1.5 text-muted hover:text-foreground transition-colors text-xs"
              aria-label="Clear"
            >
              CLR
            </button>
          </div>
        )}

        {/* Recent Numbers Dropdown */}
        {showRecents && recentNumbers.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl overflow-hidden z-10 shadow-lg">
            {recentNumbers.slice(0, 5).map((num, i) => (
              <button
                key={i}
                onMouseDown={() => handleRecentSelect(num)}
                className="w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-card-hover transition-colors"
              >
                {num}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Number Pad */}
      <div className="grid grid-cols-3 gap-3 w-full">
        {KEYS.flat().map((key) => (
          <button
            key={key}
            onClick={() => handleKey(key)}
            className="flex flex-col items-center justify-center h-16 rounded-xl bg-card hover:bg-card-hover active:bg-border transition-colors select-none"
          >
            <span className="text-xl font-medium text-foreground">{key}</span>
            {SUB_LABELS[key] && (
              <span className="text-[10px] tracking-widest text-muted mt-0.5">
                {SUB_LABELS[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Call Button */}
      <button
        onClick={handleCall}
        disabled={number.length <= 2 || disabled}
        className="w-16 h-16 rounded-full bg-green hover:bg-green/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-all active:scale-95 mt-2"
        aria-label="Call"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
          <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
        </svg>
      </button>
    </div>
  );
}
