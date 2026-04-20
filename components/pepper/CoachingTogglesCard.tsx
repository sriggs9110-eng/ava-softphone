"use client";

import { useState } from "react";

type ToggleKey = "liveCards" | "soundEffects" | "celebration" | "autoWhisper";

interface ToggleDef {
  key: ToggleKey;
  title: string;
  description?: string;
  experimental?: boolean;
  defaultOn: boolean;
}

const TOGGLES: ToggleDef[] = [
  {
    key: "liveCards",
    title: "Live coaching cards",
    description: "Pepper pops up during calls with tips and reminders.",
    defaultOn: true,
  },
  {
    key: "soundEffects",
    title: "Sound effects",
    description: "Little chimes on connect, mute, and deal won.",
    defaultOn: true,
  },
  {
    key: "celebration",
    title: "Celebration animation",
    description: "Confetti when you close a deal. You earned it.",
    defaultOn: true,
  },
  {
    key: "autoWhisper",
    title: "Auto-whisper scripts",
    description: "Pepper reads rebuttals into your headset during objections.",
    experimental: true,
    defaultOn: false,
  },
];

export default function CoachingTogglesCard() {
  const [state, setState] = useState<Record<ToggleKey, boolean>>(() =>
    TOGGLES.reduce(
      (acc, t) => ({ ...acc, [t.key]: t.defaultOn }),
      {} as Record<ToggleKey, boolean>
    )
  );

  return (
    <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-6 shadow-pop-md">
      <h3 className="text-xl font-semibold text-navy font-display mb-1">
        Live coaching
      </h3>
      <p className="text-[13px] text-navy-2 mb-5">
        What Pepper does while you&rsquo;re on a call.
      </p>

      <div className="divide-y-2 divide-navy/10">
        {TOGGLES.map((t) => (
          <div
            key={t.key}
            className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-semibold text-navy">{t.title}</p>
                {t.experimental && (
                  <span className="px-2 py-0.5 rounded-full bg-sky border-[1.5px] border-navy text-[10px] font-bold uppercase tracking-wider text-navy">
                    Experimental
                  </span>
                )}
              </div>
              {t.description && (
                <p className="text-[12px] text-slate mt-0.5">{t.description}</p>
              )}
            </div>
            <PillToggle
              on={state[t.key]}
              onChange={(on) => setState((s) => ({ ...s, [t.key]: on }))}
              label={t.title}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PillToggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative shrink-0 w-12 h-[26px] rounded-full border-[2px] border-navy transition-colors ${
        on ? "bg-leaf" : "bg-paper"
      }`}
    >
      <span
        className={`absolute top-[1px] w-[18px] h-[18px] rounded-full border-[1.5px] border-navy transition-all ${
          on ? "left-[26px] bg-paper" : "left-[1px] bg-banana"
        }`}
      />
    </button>
  );
}
