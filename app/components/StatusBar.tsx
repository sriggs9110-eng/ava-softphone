"use client";

import { ConnectionStatus } from "@/app/lib/types";

export default function StatusBar({ status }: { status: ConnectionStatus }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border">
      <span className="text-sm font-medium text-foreground">
        {process.env.NEXT_PUBLIC_APP_NAME || "Ava Softphone"}
      </span>
      <div className="flex items-center gap-2">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            status === "connected"
              ? "bg-green"
              : status === "connecting"
              ? "bg-yellow-500 animate-pulse"
              : "bg-red"
          }`}
        />
        <span className="text-xs text-muted capitalize">{status}</span>
      </div>
    </div>
  );
}
