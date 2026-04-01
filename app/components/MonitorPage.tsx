"use client";

import { useState, useEffect, useCallback } from "react";
import { Headphones, MessageSquare, Users, Loader2 } from "lucide-react";
import { AgentInfo } from "@/app/lib/types";

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
  "on-call": {
    dot: "bg-amber",
    bg: "bg-amber/10 border-amber/20",
    text: "text-amber",
    label: "On Call",
  },
  "after-call-work": {
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
};

export default function MonitorPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/telnyx/agents");
      if (res.ok) {
        const data = await res.json();
        setAgents(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

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

  const activeCount = agents.filter((a) => a.status === "on-call").length;

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
          / {agents.length} total
        </span>
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-text-tertiary">
          <Users size={40} className="mb-3 opacity-30" />
          <p className="text-sm">No agents connected</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => {
            const config = STATUS_CONFIG[agent.status] || STATUS_CONFIG.available;
            return (
              <div
                key={agent.id}
                className="bg-bg-surface border border-border-subtle rounded-xl p-5"
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-bg-elevated flex items-center justify-center text-[13px] font-semibold text-text-secondary relative">
                      {agent.label.slice(0, 2).toUpperCase()}
                      <div
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${config.dot} border-2 border-bg-surface`}
                      />
                    </div>
                    <div>
                      <p className="text-[14px] font-medium text-text-primary">
                        {agent.label}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider ${config.bg} ${config.text}`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
                        {config.label}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Call info */}
                {agent.currentCall && (
                  <div className="mb-4 p-3 bg-bg-elevated rounded-lg">
                    <p className="text-[14px] font-medium text-text-primary tabular-nums">
                      {agent.currentCall.number}
                    </p>
                    <p className="text-[12px] text-text-tertiary mt-0.5 tabular-nums">
                      {formatDuration(agent.currentCall.duration)}
                    </p>
                  </div>
                )}

                {/* Monitor actions */}
                {agent.status === "on-call" && agent.currentCall && (
                  <div className="flex gap-2">
                    <MonitorBtn
                      icon={<Headphones size={14} />}
                      label="Listen"
                      onClick={() =>
                        handleMonitor(
                          agent.currentCall!.callControlId,
                          "listen"
                        )
                      }
                    />
                    <MonitorBtn
                      icon={<MessageSquare size={14} />}
                      label="Whisper"
                      onClick={() =>
                        handleMonitor(
                          agent.currentCall!.callControlId,
                          "whisper"
                        )
                      }
                    />
                    <MonitorBtn
                      icon={<Users size={14} />}
                      label="Barge"
                      onClick={() =>
                        handleMonitor(
                          agent.currentCall!.callControlId,
                          "barge"
                        )
                      }
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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
