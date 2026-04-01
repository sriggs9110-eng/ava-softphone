export interface CallHistoryEntry {
  id: string;
  number: string;
  direction: "inbound" | "outbound";
  duration: number; // seconds
  timestamp: number; // Date.now()
  status: "completed" | "missed" | "rejected";
}

export type CallStatus =
  | "idle"
  | "dialing"
  | "ringing"
  | "active"
  | "held"
  | "transferring";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface ActiveCallInfo {
  number: string;
  direction: "inbound" | "outbound";
  status: CallStatus;
  startTime: number | null;
  isMuted: boolean;
  isHeld: boolean;
}
