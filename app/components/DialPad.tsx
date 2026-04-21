"use client";

import { useCallback, useEffect, useState } from "react";

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
  initialNumber?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export default function DialPad({
  onCall,
  recentNumbers,
  disabled,
  initialNumber,
  inputRef,
}: DialPadProps) {
  const [number, setNumber] = useState(initialNumber || "+1");
  const [showRecents, setShowRecents] = useState(false);

  // Sync when the parent pushes a new initialNumber (e.g. "Recently dialed"
  // chip pick or post-voicemail call-back). Only updates if the incoming
  // value is a real number — blank resets are ignored to preserve user typing.
  useEffect(() => {
    if (initialNumber && initialNumber !== number) {
      setNumber(initialNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNumber]);

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
    <div className="flex flex-col items-center gap-5 w-full max-w-[380px] mx-auto animate-fade-in">
      {/* Number Input */}
      <div className="relative w-full">
        <input
          ref={inputRef}
          type="tel"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onFocus={() => setShowRecents(true)}
          onBlur={() => setTimeout(() => setShowRecents(false), 200)}
          className="w-full text-center text-[30px] font-semibold tracking-[1px] bg-paper border-[2.5px] border-navy rounded-[14px] px-4 py-4 text-navy focus:outline-none focus:bg-banana/20 transition-colors shadow-pop-sm font-display"
          placeholder="+1"
        />
        {number.length > 2 && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1">
            <button
              onClick={handleBackspace}
              className="p-2 text-slate hover:text-navy transition-colors rounded-lg hover:bg-cream-2"
              aria-label="Backspace"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                <line x1="18" y1="9" x2="12" y2="15" />
                <line x1="12" y1="9" x2="18" y2="15" />
              </svg>
            </button>
            <button
              onClick={handleClear}
              className="p-2 text-slate hover:text-navy transition-colors rounded-lg hover:bg-cream-2 text-[10px] font-bold uppercase tracking-wider"
              aria-label="Clear"
            >
              CLR
            </button>
          </div>
        )}

        {/* Recent Numbers Dropdown */}
        {showRecents && recentNumbers.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-paper border-[2.5px] border-navy rounded-[14px] overflow-hidden z-10 shadow-pop-md animate-fade-in">
            {recentNumbers.slice(0, 5).map((num, i) => (
              <button
                key={i}
                onMouseDown={() => handleRecentSelect(num)}
                className="w-full text-left px-4 py-3 text-sm text-navy hover:bg-cream-2 transition-colors border-b-2 border-navy/10 last:border-b-0"
              >
                {num}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Number Pad */}
      <div className="grid grid-cols-3 gap-4 w-full px-4">
        {KEYS.flat().map((key) => (
          <button
            key={key}
            onClick={() => handleKey(key)}
            className="flex flex-col items-center justify-center w-16 h-16 mx-auto rounded-full bg-paper border-[2.5px] border-navy active:scale-95 transition-all duration-150 select-none shadow-pop-sm shadow-pop-hover"
          >
            <span className="text-[30px] font-semibold text-navy leading-none font-display">
              {key}
            </span>
            {SUB_LABELS[key] && (
              <span className="text-[9px] tracking-[2px] text-slate uppercase mt-0.5 font-bold">
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
        className="w-[72px] h-[72px] rounded-full bg-leaf border-[2.5px] border-navy disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-all duration-150 active:scale-95 mt-2 shadow-pop-md shadow-pop-hover"
        aria-label="Call"
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="white">
          <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
        </svg>
      </button>
    </div>
  );
}
