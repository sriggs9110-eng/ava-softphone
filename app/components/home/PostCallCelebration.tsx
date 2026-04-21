"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import PepperMascot from "@/components/pepper/PepperMascot";

interface Props {
  callLogId: string;
  onDismiss: () => void;
}

export default function PostCallCelebration({ callLogId, onDismiss }: Props) {
  const [score, setScore] = useState<number | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [displayedScore, setDisplayedScore] = useState(0);

  // Poll the call_logs row for up to 30s waiting for a score/tip to land.
  useEffect(() => {
    let cancelled = false;
    let pollCount = 0;
    const tick = async () => {
      pollCount += 1;
      try {
        const res = await fetch("/api/home/dashboard");
        if (!res.ok) return;
        const body = await res.json();
        const match = body.recent_activity?.find(
          (a: { id: string; ai_score: number | null; ai_summary_preview: string | null }) =>
            a.id === callLogId
        );
        if (!cancelled && match) {
          if (typeof match.ai_score === "number" && score === null) {
            setScore(match.ai_score);
          }
          if (match.ai_summary_preview && !tip) {
            setTip(match.ai_summary_preview);
          }
        }
      } catch {
        // ignore
      }
      // Stop polling after ~30s (5s * 6)
      if (!cancelled && pollCount < 6 && (score === null || tip === null)) {
        setTimeout(tick, 5000);
      }
    };
    setTimeout(tick, 5000);
    return () => {
      cancelled = true;
    };
  }, [callLogId, score, tip]);

  // Animate the big score up from 0 over ~800ms when it arrives.
  useEffect(() => {
    if (score === null) return;
    const target = score;
    const start = performance.now();
    const duration = 800;
    let raf = 0;
    const step = (t: number) => {
      const progress = Math.min(1, (t - start) / duration);
      setDisplayedScore(progress * target);
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  // Auto-dismiss 30s after mount regardless of whether score landed.
  useEffect(() => {
    const t = setTimeout(onDismiss, 30_000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="relative bg-paper border-[2.5px] border-navy rounded-[18px] p-6 shadow-pop-lg max-w-md mx-auto animate-slide-up">
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute top-3 right-3 w-8 h-8 rounded-full border-2 border-navy bg-paper text-navy flex items-center justify-center hover:bg-cream-2 transition-colors"
      >
        <X size={14} />
      </button>
      <div className="flex flex-col items-center text-center">
        <PepperMascot
          size="md"
          state={score !== null && score >= 8 ? "hype" : "thinking"}
        />
        <h3 className="mt-3 text-xl font-semibold text-navy font-display">
          That one&rsquo;s in the books!
        </h3>
        {score !== null ? (
          <p className="mt-2 text-[48px] font-bold text-navy tabular-nums leading-none font-display">
            {displayedScore.toFixed(1)}
            <span className="text-[18px] font-semibold text-navy-2">/10</span>
          </p>
        ) : (
          <p className="mt-2 text-[14px] text-slate font-accent text-lg">
            Pepper&rsquo;s chewing on it…
          </p>
        )}
        {tip && (
          <div className="mt-4 w-full bg-cream-2 border-2 border-navy rounded-[12px] p-3 text-left">
            <p className="text-[10px] font-bold text-navy uppercase tracking-wider mb-1">
              Pepper noticed
            </p>
            <p className="text-[13px] text-navy leading-snug">{tip}</p>
          </div>
        )}
        <button
          onClick={onDismiss}
          className="mt-4 px-4 py-2 rounded-full bg-banana border-[2.5px] border-navy text-navy text-sm font-bold shadow-pop-sm shadow-pop-hover"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
