import { NextResponse } from "next/server";

// In-memory agent store (resets on server restart)
// In production, this would be backed by a database
interface AgentSession {
  id: string;
  label: string;
  status: "available" | "on-call" | "after-call-work" | "dnd";
  currentCall?: {
    number: string;
    startTime: number;
    callControlId: string;
  };
}

const agents = new Map<string, AgentSession>();

// Seed with the current user on first request
function ensureDefaultAgent() {
  if (agents.size === 0) {
    agents.set("default", {
      id: "default",
      label: process.env.TELNYX_SIP_USERNAME || "Agent 1",
      status: "available",
    });
  }
}

export async function GET() {
  ensureDefaultAgent();

  const agentList = Array.from(agents.values()).map((a) => ({
    id: a.id,
    label: a.label,
    status: a.status,
    currentCall: a.currentCall
      ? {
          number: a.currentCall.number,
          duration: Math.floor(
            (Date.now() - a.currentCall.startTime) / 1000
          ),
          callControlId: a.currentCall.callControlId,
        }
      : undefined,
  }));

  return NextResponse.json(agentList);
}
