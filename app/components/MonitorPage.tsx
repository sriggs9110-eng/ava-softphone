"use client";

import { useState, useEffect, useCallback } from "react";
import { Headphones, MessageSquare, Users, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface AgentRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
}

const STATUS_CONFIG: Record<
  string,
  { dot: string; bg: string; text: string; label: string }
> = {
  available: {
    dot: "bg-green",
    bg: "bg-green/10 border-green/20",
    text: "text-green",
    label: "Available",
  },
  on_call: {
    dot: "bg-amber",
    bg: "bg-amber/10 border-amber/20",
    text: "text-amber",
    label: "On Call",
  },
  after_call_work: {
    dot: "bg-text-tertiary",
    bg: "bg-text-tertiary/10 border-text-tertiary/20",
    text: "text-text-tertiary",
    label: "After Call Work",
  },
  dnd: {
    dot: "bg-red",
    bg: "bg-red/10 border-red/20",
    text: "text-red",
    label: "DND",
  },
  offline: {
    dot: "bg-text-tertiary/40",
    bg: "bg-text-tertiary/5 border-text-tertiary/10",
    text: "text-text-tertiary",
    label: "Offline",
  },
};

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-accent/15 text-accent border-accent/30",
  manager: "bg-green/15 text-green border-green/30",
  agent: "bg-text-tertiary/15 text-text-tertiary border-text-tertiary/30",
};

export default function MonitorPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchAgents = useCallback(async () => {
    const { data } = await supabase
      .from("softphone_users")
      .select("id, full_name, email, role, status")
      .order("full_name");

    if (data) {
      setAgents(data as AgentRow[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  const handleMonitor = useCallback(
    async (callControlId: string, mode: "listen" | "whisper" | "barge") => {
      await fetch("/api/telnyx/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_control_id: callControlId, mode }),
      });
    },
    []
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  const onlineAgents = agents.filter((a) => a.status !== "offline");
  const activeCount = agents.filter((a) => a.status === "on_call").length;

  return (
    <div className="w-full animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-[12px] text-text-tertiary uppercase tracking-wider font-medium">
          Active Agents:
        </span>
        <span className="text-sm font-semibold text-text-primary">
          {activeCount} on call
        </span>
        <span className="text-[12px] text-text-tertiary">
          / {onlineAgents.length} online / {agents.length} total
        </span>
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
          <Users size={40} className="mb-3 opacity-30" />
          <p className="text-sm">No agents found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => {
            const config = STATUS_CONFIG[agent.status] || STATUS_CONFIG.offline;
            return (
              <div
                key={agent.id}
                className={`bg-bg-surface border border-border-subtle rounded-xl p-5 ${
                  agent.status === "offline" ? "opacity-50" : ""
                }`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-semibold relative ${
                        agent.role === "admin"
                          ? "bg-accent/15 text-accent"
                          : agent.role === "manager"
                          ? "bg-green/15 text-green"
                          : "bg-bg-elevated text-text-secondary"
                      }`}
                    >
                      {agent.full_name.charAt(0).toUpperCase()}
                      <div
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${config.dot} border-2 border-bg-surface`}
                      />
                    </div>
                    <div>
                      <p className="text-[14px] font-medium text-text-primary">
                        {agent.full_name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider ${config.bg} ${config.text}`}
                        >
                          <div className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
                          {config.label}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full border text-[9px] font-semibold uppercase tracking-wider ${
                            ROLE_BADGE[agent.role] || ROLE_BADGE.agent
                          }`}
                        >
                          {agent.role}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Monitor actions for on-call agents */}
                {agent.status === "on_call" && (
                  <div className="flex gap-2">
                    <MonitorBtn
                      icon={<Headphones size={14} />}
                      label="Listen"
                      onClick={() => handleMonitor(agent.id, "listen")}
                    />
                    <MonitorBtn
                      icon={<MessageSquare size={14} />}
                      label="Whisper"
                      onClick={() => handleMonitor(agent.id, "whisper")}
                    />
                    <MonitorBtn
                      icon={<Users size={14} />}
                      label="Barge"
                      onClick={() => handleMonitor(agent.id, "barge")}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MonitorBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-lg bg-bg-elevated border border-border-subtle hover:bg-bg-hover hover:border-border text-text-secondary transition-all duration-150 min-h-[44px]"
    >
      {icon}
      <span className="text-[10px] font-medium uppercase tracking-wider">
        {label}
      </span>
    </button>
  );
}
