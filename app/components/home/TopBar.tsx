"use client";

import PepperMascot from "@/components/pepper/PepperMascot";

interface Props {
  firstName: string;
}

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Warm greeting strip above the three-column grid. Stats moved to their
 * own row (see DayStats) in round 2, so this is now greeting-only and can
 * breathe a little larger.
 */
export default function TopBar({ firstName }: Props) {
  const greeting = greetingFor(new Date().getHours());
  return (
    <div className="w-full bg-cream-2 border-b-2 border-navy">
      <div className="flex items-center gap-3 px-6 py-4 min-h-[72px]">
        <PepperMascot size="xs" state="listening" />
        <h1 className="text-[1.75rem] leading-tight font-semibold text-navy font-display tracking-tight truncate">
          {greeting}, {firstName}
        </h1>
      </div>
    </div>
  );
}
