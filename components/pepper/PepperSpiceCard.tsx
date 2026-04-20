"use client";

import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type SpiceLevel = "mild" | "medium" | "hot";

const LEVELS: {
  value: SpiceLevel;
  label: string;
  peppers: string;
  tip: string;
}[] = [
  {
    value: "mild",
    label: "Mild",
    peppers: "🌶️",
    tip: "Hey, maybe try asking about their timeline?",
  },
  {
    value: "medium",
    label: "Medium",
    peppers: "🌶️🌶️",
    tip: "They're stalling — pin them down on a date.",
  },
  {
    value: "hot",
    label: "Hot",
    peppers: "🌶️🌶️🌶️",
    tip: "This one's cooked unless you get a commitment NOW.",
  },
];

interface Props {
  userId: string;
  initialSpice?: SpiceLevel;
}

export default function PepperSpiceCard({
  userId,
  initialSpice = "medium",
}: Props) {
  const [spice, setSpice] = useState<SpiceLevel>(initialSpice);
  const [saving, setSaving] = useState<SpiceLevel | null>(null);
  const supabase = createClient();

  useEffect(() => {
    setSpice(initialSpice);
  }, [initialSpice]);

  const handleSelect = useCallback(
    async (level: SpiceLevel) => {
      if (level === spice || saving) return;
      setSaving(level);
      const { error } = await supabase
        .from("softphone_users")
        .update({ pepper_spice: level })
        .eq("id", userId);
      if (!error) {
        setSpice(level);
      } else {
        console.error("[PepperSpice] save failed", error);
      }
      setSaving(null);
    },
    [spice, saving, supabase, userId]
  );

  return (
    <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-6 shadow-pop-md">
      <h3 className="text-xl font-semibold text-navy font-display mb-1">
        Your Pepper
      </h3>
      <p className="text-[13px] text-navy-2 mb-5">
        How spicy should Pepper be during live calls?
      </p>

      <div className="grid grid-cols-3 gap-3">
        {LEVELS.map((lvl) => {
          const selected = spice === lvl.value;
          const loading = saving === lvl.value;
          return (
            <button
              key={lvl.value}
              onClick={() => handleSelect(lvl.value)}
              disabled={loading}
              className={`relative text-left p-4 rounded-[14px] border-[2.5px] border-navy transition-all duration-150 ${
                selected
                  ? "bg-banana shadow-pop-md"
                  : "bg-paper shadow-pop-sm hover:-translate-y-0.5 hover:shadow-pop-md"
              } ${loading ? "opacity-60" : ""}`}
            >
              {selected && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-navy border-2 border-navy flex items-center justify-center">
                  <Check size={14} className="text-banana" strokeWidth={3} />
                </div>
              )}
              <div className="text-[22px] leading-none mb-2">{lvl.peppers}</div>
              <div className="text-[16px] font-semibold text-navy font-display mb-2">
                {lvl.label}
              </div>
              <p className="text-[14px] text-navy-2 font-accent leading-snug">
                &ldquo;{lvl.tip}&rdquo;
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
