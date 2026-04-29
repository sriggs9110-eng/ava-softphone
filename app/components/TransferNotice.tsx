"use client";

// Informational banner for transfer outcomes (e.g., "destination didn't
// pick up — call still active"). Distinct from MicError both visually
// and semantically: this is an info/status nudge, not a hard error.
// Auto-dismisses after 8s; the rep can also click to dismiss earlier.
//
// Usage: rendered when useTelnyxClient's `transferNotice` is non-null.
// Server-side broadcasts via Supabase Realtime on event=blind_xfer_failed
// (see app/api/telnyx/webhook/route.ts). The client listener in
// useTelnyxClient subscribes to user:<userId> on mount.

import { useEffect } from "react";

export default function TransferNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-amber/90 backdrop-blur-sm text-white px-5 py-3 rounded-xl text-sm font-medium shadow-2xl max-w-sm animate-slide-up cursor-pointer"
      onClick={onDismiss}
      role="status"
      aria-live="polite"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      {message}
    </div>
  );
}
