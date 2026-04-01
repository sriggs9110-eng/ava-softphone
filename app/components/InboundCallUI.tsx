"use client";

interface InboundCallUIProps {
  callerNumber: string;
  onAccept: () => void;
  onReject: () => void;
}

export default function InboundCallUI({
  callerNumber,
  onAccept,
  onReject,
}: InboundCallUIProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-8 p-8">
        {/* Ringing animation */}
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-green/20 flex items-center justify-center">
            <div className="absolute inset-0 w-24 h-24 rounded-full bg-green/10 animate-pulse-ring" />
            <svg
              className="animate-ring-shake"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
            </svg>
          </div>
        </div>

        {/* Caller info */}
        <div className="text-center">
          <p className="text-sm uppercase tracking-wide text-muted mb-2">
            Incoming Call
          </p>
          <p className="text-3xl font-light text-foreground">{callerNumber}</p>
        </div>

        {/* Accept / Reject buttons */}
        <div className="flex items-center gap-12">
          <button
            onClick={onReject}
            className="w-16 h-16 rounded-full bg-red hover:bg-red/90 flex items-center justify-center transition-all active:scale-95"
            aria-label="Decline"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 010-1.36C3.69 8.68 7.61 7 12 7s8.31 1.68 11.71 4.72c.18.18.29.44.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 00-2.67-1.85.996.996 0 01-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
            </svg>
          </button>
          <button
            onClick={onAccept}
            className="w-16 h-16 rounded-full bg-green hover:bg-green/90 flex items-center justify-center transition-all active:scale-95"
            aria-label="Accept"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
