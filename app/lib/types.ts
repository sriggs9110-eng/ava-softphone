export type PipelineStatus =
  | "pending"
  | "processing"
  | "complete"
  | "failed"
  | "none";

export type AiStatus = PipelineStatus | "skipped_no_transcript";

export interface CallHistoryEntry {
  id: string;
  number: string;
  direction: "inbound" | "outbound";
  duration: number;
  timestamp: number;
  status: "completed" | "missed" | "rejected" | "voicemail" | "no-answer";
  recordingUrl?: string;
  aiAnalysis?: AIAnalysis;
  transcript?: TranscriptEntry[];
  transcriptStatus?: PipelineStatus;
  transcriptError?: string | null;
  aiStatus?: AiStatus;
}

export interface AIAnalysis {
  summary: string;
  score: number;
  score_reasoning: string;
  talk_ratio: { agent: number; prospect: number };
  key_topics: string[];
  sentiment: "positive" | "negative" | "neutral";
  coaching: string[];
  highlights: string[];
}

export interface TranscriptEntry {
  speaker: "Agent" | "Prospect";
  timestamp: string;
  text: string;
}

export type CallStatus =
  | "idle"
  | "dialing"
  | "ringing"
  | "active"
  | "held"
  | "transferring";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type AgentStatus = "available" | "on-call" | "after-call-work" | "dnd";

export interface ActiveCallInfo {
  number: string;
  direction: "inbound" | "outbound";
  status: CallStatus;
  startTime: number | null;
  isMuted: boolean;
  isHeld: boolean;
  callControlId?: string;
}

export interface AgentInfo {
  id: string;
  label: string;
  status: AgentStatus;
  currentCall?: {
    number: string;
    duration: number;
    callControlId: string;
  };
}
