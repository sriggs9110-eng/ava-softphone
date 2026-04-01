import { CallHistoryEntry } from "./types";

const STORAGE_KEY = "ava-softphone-call-history";
const MAX_ENTRIES = 50;

export function getCallHistory(): CallHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addCallHistoryEntry(entry: CallHistoryEntry): CallHistoryEntry[] {
  const history = getCallHistory();
  history.unshift(entry);
  const trimmed = history.slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  return trimmed;
}

export function clearCallHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
