"use client";

import { useEffect, useState } from "react";
import { Play, Sparkles } from "lucide-react";
import PepperMascot, { type PepperState } from "@/components/pepper/PepperMascot";

export type PepperCornerMode = "idle" | "on_call" | "post_call";

interface PeppersPick {
  pick_id: string;
  call_log_id: string;
  rep_name: string;
  prospect_number: string;
  duration_seconds: number;
  ai_score: number | null;
  category: string;
  pepper_headline: string;
  pepper_reason: string;
}

interface Props {
  mode: PepperCornerMode;
  focusTip: string | null;
  lastCallScore?: number | null;
}

export default function PepperCorner({ mode, focusTip, lastCallScore }: Props) {
  const [pick, setPick] = useState<PeppersPick | null>(null);

  // Load the weekly Pepper's Pick once — it's cached server-side, so cheap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/reports/peppers-pick?period=week");
        if (!res.ok) return;
        const body = (await res.json()) as { picks: PeppersPick[] };
        if (!cancelled && body.picks.length > 0) setPick(body.picks[0]);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Celebration window: when post_call with high score, shift mascot to hype
  // briefly.
  const [hype, setHype] = useState(false);
  useEffect(() => {
    if (mode === "post_call" && lastCallScore && lastCallScore >= 8) {
      setHype(true);
      const t = setTimeout(() => setHype(false), 3000);
      return () => clearTimeout(t);
    }
    setHype(false);
  }, [mode, lastCallScore]);

  const state: PepperState =
    mode === "on_call"
      ? "listening"
      : mode === "post_call" && hype
      ? "hype"
      : mode === "post_call"
      ? "thinking"
      : "listening";

  const headline =
    mode === "on_call"
      ? "Listening in…"
      : mode === "post_call"
      ? "That one&rsquo;s in the books"
      : "Ready when you are";

  return (
    <div className="bg-paper border-[2.5px] border-navy rounded-[18px] shadow-pop-md p-5 flex flex-col items-center">
      <PepperMascot size="md" state={state} />
      <h3
        className="mt-3 text-lg font-semibold text-navy font-display text-center"
        dangerouslySetInnerHTML={{ __html: headline }}
      />

      {mode === "idle" && focusTip && (
        <p className="mt-1 text-[13px] text-navy-2 text-center leading-snug max-w-[260px]">
          {focusTip}
        </p>
      )}
      {mode === "idle" && !focusTip && (
        <p className="mt-1 text-[13px] text-slate font-accent text-lg text-center max-w-[260px] leading-snug">
          Fresh line, clear head — make the first call of the day.
        </p>
      )}

      {mode === "on_call" && (
        <p className="mt-1 text-[13px] text-slate text-center">
          I&rsquo;ll flag anything worth noticing.
        </p>
      )}
      {mode === "post_call" && typeof lastCallScore === "number" && (
        <p className="mt-1 text-[14px] text-navy text-center">
          Scored <strong className="tabular-nums">{lastCallScore.toFixed(1)}</strong>
          /10
        </p>
      )}

      {mode === "idle" && pick && (
        <div className="mt-4 w-full bg-cream-3 border-2 border-navy rounded-[14px] p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles size={12} className="text-banana-deep" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-navy">
              Pepper&rsquo;s Pick this week
            </span>
          </div>
          <p className="text-[13px] font-semibold text-navy font-display leading-snug">
            {pick.pepper_headline}
          </p>
          <p className="text-[11px] text-slate mt-1 truncate">
            {pick.rep_name} → {pick.prospect_number}
          </p>
          <a
            href={`/?log=${pick.call_log_id}`}
            className="inline-flex items-center gap-1 mt-2 px-3 py-1.5 rounded-full bg-banana border-2 border-navy text-navy text-[11px] font-bold shadow-pop-sm shadow-pop-hover"
          >
            <Play size={11} />
            Listen
          </a>
        </div>
      )}
    </div>
  );
}
