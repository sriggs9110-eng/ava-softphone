"use client";

import PepperSpiceCard from "@/components/pepper/PepperSpiceCard";
import type { SoftphoneUser } from "@/lib/auth-context";

interface Props {
  user: SoftphoneUser;
}

export default function YourPepperTab({ user }: Props) {
  const outbound = process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER || "Not configured";

  return (
    <div className="space-y-5">
      <PepperSpiceCard
        userId={user.id}
        initialSpice={user.pepper_spice ?? "medium"}
      />

      <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
        <h3 className="text-base font-semibold text-navy font-display mb-2">
          Outbound Number
        </h3>
        <p className="text-[14px] text-navy-2 tabular-nums">{outbound}</p>
      </div>

      <div className="bg-cream-2 border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
        <h3 className="text-base font-semibold text-navy font-display mb-1">
          Version
        </h3>
        <p className="text-[12px] text-slate">Pepper v0.6.0</p>
      </div>
    </div>
  );
}
