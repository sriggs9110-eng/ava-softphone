"use client";

import {
  Phone,
  Clock,
  Users,
  BarChart3,
  FileText,
  Settings,
} from "lucide-react";
import { AgentStatus, ConnectionStatus } from "@/app/lib/types";

export type NavPage =
  | "phone"
  | "history"
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
}

const NAV_ITEMS: { page: NavPage; icon: typeof Phone; label: string }[] = [
  { page: "phone", icon: Phone, label: "Phone" },
  { page: "history", icon: Clock, label: "History" },
  { page: "monitor", icon: Users, label: "Monitor" },
  { page: "reports", icon: BarChart3, label: "Reports" },
  { page: "transcripts", icon: FileText, label: "Transcripts" },
];

const STATUS_COLORS: Record<AgentStatus, string> = {
  available: "bg-green",
  "on-call": "bg-amber",
  "after-call-work": "bg-text-tertiary",
  dnd: "bg-red",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  available: "Available",
  "on-call": "On Call",
  "after-call-work": "After Call Work",
  dnd: "Do Not Disturb",
};

export default function Sidebar({
  activePage,
  onNavigate,
  connectionStatus,
  agentStatus,
  onAgentStatusChange,
  acwCountdown,
}: SidebarProps) {
  return (
    <nav className="w-[72px] bg-bg-surface border-r border-border-subtle flex flex-col items-center py-5 gap-1.5 shrink-0">
      {/* Logo */}
      <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-5">
        <span className="text-text-on-accent font-bold text-lg">A</span>
      </div>

      {/* Nav Items */}
      {NAV_ITEMS.map(({ page, icon: Icon, label }) => (
        <button
          key={page}
          onClick={() => onNavigate(page)}
          className={`group relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 ${
            activePage === page
              ? "bg-accent text-text-on-accent"
              : "text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated"
          }`}
        >
          <Icon size={20} />
          {page === "phone" && agentStatus === "dnd" && (
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red border-2 border-bg-surface" />
          )}
          <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-bg-elevated border border-border-subtle rounded-lg text-[11px] text-text-secondary whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
            {label}
          </div>
        </button>
      ))}

      {/* Divider */}
      <div className="w-6 h-px bg-border-subtle my-2" />

      {/* Settings */}
      <button
        onClick={() => onNavigate("settings")}
        className={`group relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 ${
          activePage === "settings"
            ? "bg-accent text-text-on-accent"
            : "text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated"
        }`}
      >
        <Settings size={20} />
        <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-bg-elevated border border-border-subtle rounded-lg text-[11px] text-text-secondary whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
          Settings
        </div>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Agent Status */}
      <div className="group relative">
        <button className="w-10 h-10 rounded-full flex items-center justify-center relative">
          <div className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center text-[11px] font-semibold text-text-secondary">
            SR
          </div>
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${STATUS_COLORS[agentStatus]} border-2 border-bg-surface`}
          />
        </button>
        {/* Dropdown */}
        <div className="absolute left-full bottom-0 ml-3 bg-bg-surface border border-border-subtle rounded-xl overflow-hidden opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 w-48 shadow-2xl">
          <div className="px-3 py-2 border-b border-border-subtle">
            <p className="text-[10px] text-text-tertiary uppercase tracking-wider font-medium">
              Status
            </p>
            {acwCountdown !== null && (
              <p className="text-[11px] text-amber mt-0.5">
                ACW: {acwCountdown}s remaining
              </p>
            )}
          </div>
          {(["available", "dnd"] as AgentStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => onAgentStatusChange(s)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition-colors ${
                agentStatus === s
                  ? "bg-bg-elevated text-text-primary"
                  : "text-text-secondary hover:bg-bg-hover"
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[s]}`} />
              {STATUS_LABELS[s]}
            </button>
          ))}
          {(agentStatus === "on-call" || agentStatus === "after-call-work") && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-text-tertiary">
              <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[agentStatus]}`} />
              {STATUS_LABELS[agentStatus]}
              <span className="text-[10px] ml-auto">(auto)</span>
            </div>
          )}
        </div>
      </div>

      {/* Connection Status */}
      <div className="group relative flex items-center justify-center w-10 h-10 mt-1">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            connectionStatus === "connected"
              ? "bg-green"
              : connectionStatus === "connecting"
              ? "bg-amber animate-pulse"
              : "bg-red"
          }`}
        />
        <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-bg-elevated border border-border-subtle rounded-lg text-[11px] text-text-secondary whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
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
