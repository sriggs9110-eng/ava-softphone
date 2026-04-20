"use client";

import CoachingTogglesCard from "@/components/pepper/CoachingTogglesCard";
import type { SoftphoneUser } from "@/lib/auth-context";

interface Props {
  user: SoftphoneUser;
}

export default function CoachingTab({ user }: Props) {
  return (
    <div className="space-y-5">
      <CoachingTogglesCard initialPrefs={user.coaching_prefs ?? null} />
    </div>
  );
}
