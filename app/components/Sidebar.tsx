"use client";

import { useState, useEffect, useRef } from "react";
import {
  Phone,
  Clock,
  Users,
  BarChart3,
  FileText,
  Settings,
  LogOut,
  Voicemail,
} from "lucide-react";
import { AgentStatus, ConnectionStatus } from "@/app/lib/types";
import ConnectionQuality, { QualityLevel } from "@/app/components/ConnectionQuality";
import { ShortcutsButton } from "@/app/components/KeyboardShortcuts";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import PepperMascot from "@/components/pepper/PepperMascot";

export type NavPage =
  | "phone"
  | "history"
  | "voicemails"
  | "monitor"
  | "reports"
  | "transcripts"
  | "settings";

interface SidebarProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  connectionStatus: ConnectionStatus;
  agentStatus: AgentStatus;
  onAgentStatusChange: (status: AgentStatus) => void;
  acwCountdown: number | null;
  qualityLevel: QualityLevel;
  latency: number | null;
  packetLoss: number | null;
  onShowShortcuts: () => void;
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  available: "bg-leaf",
  "on-call": "bg-banana",
  "after-call-work": "bg-slate-2",
  dnd: "bg-coral",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  available: "Available",
  "on-call": "On Call",
  "after-call-work": "After Call Work",
  dnd: "Do Not Disturb",
};

const ROLE_BADGE_COLORS: Record<string, string> = {
  admin: "bg-banana text-navy border-navy",
  manager: "bg-leaf text-white border-navy",
  agent: "bg-cream-2 text-navy border-navy",
};

const AVATAR_COLORS: Record<string, string> = {
  admin: "bg-banana text-navy",
  manager: "bg-leaf text-white",
  agent: "bg-cream-2 text-navy",
};

export default function Sidebar({
  activePage,
  onNavigate,
  connectionStatus,
  agentStatus,
  onAgentStatusChange,
  acwCountdown,
  qualityLevel,
  latency,
  packetLoss,
  onShowShortcuts,
}: SidebarProps) {
  const { user, isManager, logout } = useAuth();

  const unreadVoicemails = useUnreadVoicemails();

  const navItems: {
    page: NavPage;
    icon: typeof Phone;
    label: string;
    badge?: number;
  }[] = [
    { page: "phone", icon: Phone, label: "Phone" },
    { page: "history", icon: Clock, label: "History" },
    {
      page: "voicemails",
      icon: Voicemail,
      label: "Voicemails",
      badge: unreadVoicemails,
    },
    // Reports is role-aware at the API level — agents see only their own stats.
    { page: "reports", icon: BarChart3, label: "Reports" },
  ];

  if (isManager) {
    navItems.push(
      { page: "monitor", icon: Users, label: "Monitor" },
      { page: "transcripts", icon: FileText, label: "Transcripts" }
    );
  }

  return (
    <nav className="w-[80px] bg-navy border-r-[2.5px] border-navy flex flex-col items-center py-5 gap-2 shrink-0 relative z-10">
      {/* Logo — banana square with tiny pepper */}
      <div
        title="Pepper"
        aria-label="Pepper"
        className="w-12 h-12 rounded-[14px] bg-banana border-[2.5px] border-navy shadow-pop-sm flex items-center justify-center mb-4"
      >
        <PepperMascot size="xs" state="listening" />
      </div>

      {/* Nav Items */}
      {navItems.map(({ page, icon: Icon, label, badge }) => {
        const active = activePage === page;
        return (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={`group relative w-12 h-12 rounded-[14px] flex items-center justify-center transition-all duration-150 ${
              active
                ? "bg-cream-2 text-navy"
                : "text-white/50 hover:text-white hover:bg-navy-2"
            }`}
          >
            {active && (
              <span
                className="absolute -left-[12px] top-1.5 bottom-1.5 w-1 rounded-r bg-coral"
                aria-hidden
              />
            )}
            <Icon size={20} strokeWidth={2.25} />
            {page === "phone" && agentStatus === "dnd" && (
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-coral border-2 border-navy" />
            )}
            {badge && badge > 0 ? (
              <span
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-coral border-2 border-navy text-white text-[10px] font-bold flex items-center justify-center px-1 tabular-nums"
                aria-label={`${badge} unread`}
              >
                {badge > 99 ? "99+" : badge}
              </span>
            ) : null}
            <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-navy border-2 border-banana rounded-lg text-[11px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
              {label}
            </div>
          </button>
        );
      })}

      {/* Divider */}
      <div className="w-6 h-px bg-white/20 my-2" />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings — visible to all roles; personal prefs live here */}
      <button
        onClick={() => onNavigate("settings")}
        title="Settings"
        aria-label="Settings"
        aria-current={activePage === "settings" ? "page" : undefined}
        className={`group relative w-12 h-12 rounded-[14px] flex items-center justify-center transition-all duration-150 ${
          activePage === "settings"
            ? "bg-cream-2 text-navy"
            : "text-white/50 hover:text-white hover:bg-navy-2"
        }`}
      >
        {activePage === "settings" && (
          <span
            className="absolute -left-[12px] top-1.5 bottom-1.5 w-1 rounded-r bg-coral"
            aria-hidden
          />
        )}
        <Settings size={20} strokeWidth={2.25} />
        <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-navy border-2 border-banana rounded-lg text-[11px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
          Settings
        </div>
      </button>

      {/* User Info + Agent Status */}
      <UserMenu
        user={user}
        agentStatus={agentStatus}
        acwCountdown={acwCountdown}
        onAgentStatusChange={onAgentStatusChange}
        logout={logout}
      />

      {/* Shortcuts */}
      <ShortcutsButton onClick={onShowShortcuts} />

      {/* Connection Quality */}
      <ConnectionQuality level={qualityLevel} latency={latency} packetLoss={packetLoss} />

      {/* Connection Status */}
      <div className="group relative flex items-center justify-center w-10 h-10 mt-1">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            connectionStatus === "connected"
              ? "bg-leaf"
              : connectionStatus === "connecting"
              ? "bg-banana animate-pulse"
              : "bg-coral"
          }`}
        />
        <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-navy border-2 border-banana rounded-lg text-[11px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
          {connectionStatus === "connected"
            ? "Connected to Telnyx"
            : connectionStatus === "connecting"
            ? "Connecting..."
            : "Disconnected"}
        </div>
      </div>
    </nav>
  );
}

function UserMenu({
  user,
  agentStatus,
  acwCountdown,
  onAgentStatusChange,
  logout,
}: {
  user: { full_name: string; role: string; email: string } | null;
  agentStatus: AgentStatus;
  acwCountdown: number | null;
  onAgentStatusChange: (status: AgentStatus) => void;
  logout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="w-10 h-10 rounded-full flex items-center justify-center relative"
      >
        <div
          className={`w-9 h-9 rounded-full border-2 border-navy flex items-center justify-center text-[12px] font-semibold ${
            AVATAR_COLORS[user?.role || "agent"]
          }`}
        >
          {user?.full_name?.charAt(0)?.toUpperCase() || "?"}
        </div>
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${STATUS_COLORS[agentStatus]} border-2 border-navy`}
        />
      </button>

      {open && (
        <div className="absolute left-full bottom-0 ml-3 bg-paper border-[2.5px] border-navy rounded-[14px] overflow-hidden z-50 w-60 shadow-pop-md animate-fade-in">
          {/* User info */}
          <div className="px-3 py-2.5 border-b-2 border-navy bg-cream-2">
            <p className="text-[13px] font-semibold text-navy truncate font-display">
              {user?.full_name || "Unknown"}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className={`px-1.5 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider ${
                  ROLE_BADGE_COLORS[user?.role || "agent"]
                }`}
              >
                {user?.role || "agent"}
              </span>
              <span className="text-[10px] text-slate truncate">
                {user?.email}
              </span>
            </div>
          </div>

          {/* Status header */}
          <div className="px-3 py-2 border-b-2 border-navy">
            <p className="text-[10px] text-slate uppercase tracking-wider font-semibold">
              Status
            </p>
            {acwCountdown !== null && (
              <p className="text-[11px] text-coral-deep mt-0.5 font-semibold">
                ACW: {acwCountdown}s remaining
              </p>
            )}
          </div>

          {/* Status options */}
          {(["available", "dnd"] as AgentStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                onAgentStatusChange(s);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition-colors border-b border-navy/10 ${
                agentStatus === s
                  ? "bg-banana text-navy font-semibold"
                  : "text-navy-2 hover:bg-cream-3"
              }`}
            >
              <div className={`w-2.5 h-2.5 rounded-full border border-navy ${STATUS_COLORS[s]}`} />
              {STATUS_LABELS[s]}
            </button>
          ))}
          {(agentStatus === "on-call" || agentStatus === "after-call-work") && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-slate border-b border-navy/10">
              <div className={`w-2.5 h-2.5 rounded-full border border-navy ${STATUS_COLORS[agentStatus]}`} />
              {STATUS_LABELS[agentStatus]}
              <span className="text-[10px] ml-auto">(auto)</span>
            </div>
          )}

          {/* Logout */}
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-navy-2 hover:text-white hover:bg-coral transition-colors font-semibold"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

// Unread voicemails badge — Supabase Realtime subscription on the voicemails
// table so the number updates without polling. On any INSERT/UPDATE we
// refetch the count (cheap: a head-count query with filter).
function useUnreadVoicemails(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();

    let cancelled = false;
    const refresh = async () => {
      const { count: c } = await supabase
        .from("voicemails")
        .select("id", { count: "exact", head: true })
        .eq("status", "new");
      if (!cancelled && typeof c === "number") setCount(c);
    };

    refresh();
    const channel = supabase
      .channel("voicemails-unread")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "voicemails" },
        () => refresh()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}
