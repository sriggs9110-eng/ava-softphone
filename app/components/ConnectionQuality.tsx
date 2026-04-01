"use client";

export type QualityLevel = "good" | "degraded" | "poor" | "unknown";

interface ConnectionQualityProps {
  level: QualityLevel;
  latency: number | null;
  packetLoss: number | null;
}

export default function ConnectionQuality({
  level,
  latency,
  packetLoss,
}: ConnectionQualityProps) {
  const bars = level === "good" ? 4 : level === "degraded" ? 2 : level === "poor" ? 1 : 0;
  const color =
    level === "good"
      ? "bg-green"
      : level === "degraded"
      ? "bg-amber"
      : level === "poor"
      ? "bg-red"
      : "bg-text-tertiary";

  return (
    <div className="group relative flex items-center justify-center w-10 h-10">
      <div className="flex items-end gap-[2px] h-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`w-[3px] rounded-full transition-all ${
              i <= bars ? color : "bg-border-subtle"
            }`}
            style={{ height: `${25 + i * 18.75}%` }}
          />
        ))}
      </div>
      <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-bg-elevated border border-border-subtle rounded-lg text-[11px] text-text-secondary whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
        {level === "unknown" ? (
          "No call active"
        ) : (
          <>
            Latency: {latency !== null ? `${latency}ms` : "—"}
            <br />
            Packet loss: {packetLoss !== null ? `${packetLoss.toFixed(1)}%` : "—"}
          </>
        )}
      </div>
    </div>
  );
}
