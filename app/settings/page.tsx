"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  Headphones,
  Users,
  Phone,
  ListTree,
} from "lucide-react";
import Link from "next/link";
import YourPepperTab from "./your-pepper-tab";
import CoachingTab from "./coaching-tab";
import UsersTab from "./users-tab";
import PhoneNumbersTab from "./phone-numbers-tab";
import RingGroupsTab from "./ring-groups-tab";

type Tab =
  | "your-pepper"
  | "coaching"
  | "users"
  | "phone-numbers"
  | "ring-groups";

interface TabDef {
  id: Tab;
  label: string;
  icon: typeof Users;
  adminOnly?: boolean;
}

const TABS: TabDef[] = [
  { id: "your-pepper", label: "Your Pepper", icon: Sparkles },
  { id: "coaching", label: "Coaching", icon: Headphones },
  { id: "users", label: "Users", icon: Users, adminOnly: true },
  { id: "phone-numbers", label: "Phone Numbers", icon: Phone, adminOnly: true },
  { id: "ring-groups", label: "Ring Groups", icon: ListTree, adminOnly: true },
];

export default function SettingsPage() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<Tab>("your-pepper");

  // No client-side /login redirect here — middleware already guarded the
  // route. If user is still null after loading, AuthContext synthesized a
  // minimal user (see lib/auth-context.tsx), so we wait on that rather than
  // bouncing to /login and creating a loop.
  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-slate" />
      </div>
    );
  }

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  // Guard against someone landing on an admin tab they can no longer see
  // (e.g. role was downgraded in another tab).
  const activeTab: Tab = visibleTabs.some((t) => t.id === tab)
    ? tab
    : visibleTabs[0].id;

  return (
    <div className="min-h-screen bg-cream pepper-gradients">
      <div className="relative z-[1] max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link
            href="/"
            className="w-10 h-10 rounded-[14px] bg-paper border-[2.5px] border-navy flex items-center justify-center text-navy shadow-pop-sm shadow-pop-hover"
            aria-label="Back to Pepper"
          >
            <ArrowLeft size={16} />
          </Link>
          <h1 className="text-3xl font-semibold text-navy font-display">
            Settings
          </h1>
        </div>
        <p className="text-[12px] text-slate mb-6 uppercase tracking-[0.5px] font-bold ml-[52px]">
          {isAdmin
            ? "Personal and team settings"
            : "Your Pepper preferences"}
        </p>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b-2 border-navy flex-wrap">
          {visibleTabs.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors rounded-t-[10px] border-2 border-b-0 relative -mb-[2px] ${
                  active
                    ? "bg-banana text-navy border-navy"
                    : "bg-transparent text-slate border-transparent hover:text-navy"
                }`}
              >
                <t.icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="mt-2">
          {activeTab === "your-pepper" && <YourPepperTab user={user} />}
          {activeTab === "coaching" && <CoachingTab user={user} />}
          {activeTab === "users" && isAdmin && <UsersTab />}
          {activeTab === "phone-numbers" && isAdmin && <PhoneNumbersTab />}
          {activeTab === "ring-groups" && isAdmin && <RingGroupsTab />}
        </div>
      </div>
    </div>
  );
}
