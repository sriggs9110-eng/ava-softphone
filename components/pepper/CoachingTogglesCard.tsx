"use client";

import { useCallback, useEffect, useState } from "react";
import type { CoachingPrefs } from "@/lib/auth-context";

type ToggleKey = keyof CoachingPrefs;

interface ToggleDef {
  key: ToggleKey;
  title: string;
  description?: string;
  experimental?: boolean;
}

const TOGGLES: ToggleDef[] = [
  {
    key: "live_cards",
    title: "Live coaching cards",
    description: "Pepper pops up during calls with tips and reminders.",
  },
  {
    key: "sound_fx",
    title: "Sound effects",
    description: "Little chimes on connect, mute, and deal won.",
  },
  {
    key: "celebrations",
    title: "Celebration animation",
    description: "Confetti when you close a deal. You earned it.",
  },
  {
    key: "auto_whisper",
    title: "Auto-whisper scripts",
    description: "Pepper reads rebuttals into your headset during objections.",
    experimental: true,
  },
];

const DEFAULTS: CoachingPrefs = {
  live_cards: true,
  sound_fx: true,
  celebrations: true,
  auto_whisper: false,
};

interface Props {
  initialPrefs?: CoachingPrefs | null;
}

export default function CoachingTogglesCard({ initialPrefs }: Props) {
  const [prefs, setPrefs] = useState<CoachingPrefs>(initialPrefs ?? DEFAULTS);
  const [saving, setSaving] = useState<ToggleKey | null>(null);

  // If the initial prefs arrive after mount (auth context still loading),
  // sync once.
  useEffect(() => {
    if (initialPrefs) setPrefs({ ...DEFAULTS, ...initialPrefs });
  }, [initialPrefs]);

  const handleToggle = useCallback(
    async (key: ToggleKey, value: boolean) => {
      const previous = prefs;
      setPrefs({ ...prefs, [key]: value });
      setSaving(key);

      const res = await fetch("/api/user/coaching-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });

      if (!res.ok) {
        console.error("[coaching-prefs] save failed");
        setPrefs(previous);
      }
      setSaving(null);
    },
    [prefs]
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
              on={prefs[t.key]}
              onChange={(on) => handleToggle(t.key, on)}
              disabled={saving === t.key}
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
  disabled,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative shrink-0 w-12 h-[26px] rounded-full border-[2px] border-navy transition-colors disabled:opacity-60 ${
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
