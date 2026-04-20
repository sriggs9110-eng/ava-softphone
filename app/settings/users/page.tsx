"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Users, Phone, ListTree } from "lucide-react";
import Link from "next/link";
import UsersTab from "./users-tab";
import PhoneNumbersTab from "./phone-numbers-tab";
import RingGroupsTab from "./ring-groups-tab";

type Tab = "users" | "phone-numbers" | "ring-groups";

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "users", label: "Users", icon: Users },
  { id: "phone-numbers", label: "Phone Numbers", icon: Phone },
  { id: "ring-groups", label: "Ring Groups", icon: ListTree },
];

export default function AdminSettingsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("users");

  useEffect(() => {
    if (!authLoading && !isAdmin) router.push("/");
  }, [authLoading, isAdmin, router]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-slate" />
      </div>
    );
  }
  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-cream pepper-gradients">
      <div className="relative z-[1] max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link
            href="/"
            className="w-10 h-10 rounded-[14px] bg-paper border-[2.5px] border-navy flex items-center justify-center text-navy shadow-pop-sm shadow-pop-hover"
          >
            <ArrowLeft size={16} />
          </Link>
          <h1 className="text-3xl font-semibold text-navy font-display">
            Admin settings
          </h1>
        </div>
        <p className="text-[12px] text-slate mb-6 uppercase tracking-[0.5px] font-bold ml-13">
          Manage users, phone numbers, and ring groups
        </p>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b-2 border-navy">
          {TABS.map((t) => {
            const active = tab === t.id;
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
          {tab === "users" && <UsersTab />}
          {tab === "phone-numbers" && <PhoneNumbersTab />}
          {tab === "ring-groups" && <RingGroupsTab />}
        </div>
      </div>
    </div>
  );
}
