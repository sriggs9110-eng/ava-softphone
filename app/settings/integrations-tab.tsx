"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { SoftphoneUser } from "@/lib/auth-context";

interface Props {
  user: SoftphoneUser;
}

interface Prefs {
  signal_webhook_url: string | null;
  auto_dial_popup: boolean;
  auto_analyze_calls: boolean;
  weekly_digest_enabled: boolean;
  daily_summary_enabled: boolean;
}

export default function IntegrationsTab({ user }: Props) {
  const isManager = user.role === "manager" || user.role === "admin";
  const [prefs, setPrefs] = useState<Prefs>({
    signal_webhook_url: user.signal_webhook_url ?? null,
    auto_dial_popup: user.auto_dial_popup ?? false,
    auto_analyze_calls: user.auto_analyze_calls ?? true,
    weekly_digest_enabled: true,
    daily_summary_enabled: false,
  });
  const [webhookInput, setWebhookInput] = useState<string>(
    user.signal_webhook_url ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from server once — handles the case where auth-context fell back
  // to the core columns and doesn't have these fields populated.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/user/integration-prefs");
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as Prefs;
      setPrefs(data);
      setWebhookInput(data.signal_webhook_url ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    async (patch: Partial<Prefs>) => {
      setSaving(true);
      setError(null);
      const res = await fetch("/api/user/integration-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setSaving(false);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Failed to save");
        return false;
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      return true;
    },
    []
  );

  const saveWebhook = async () => {
    const normalized = webhookInput.trim();
    const ok = await save({ signal_webhook_url: normalized || null });
    if (ok) {
      setPrefs((p) => ({ ...p, signal_webhook_url: normalized || null }));
    }
  };

  const toggle = async (
    key:
      | "auto_dial_popup"
      | "auto_analyze_calls"
      | "weekly_digest_enabled"
      | "daily_summary_enabled"
  ) => {
    const next = !prefs[key];
    setPrefs((p) => ({ ...p, [key]: next }));
    const ok = await save({ [key]: next });
    if (!ok) setPrefs((p) => ({ ...p, [key]: !next }));
  };

  return (
    <div className="space-y-5">
      <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-6 shadow-pop-md">
        <h3 className="text-xl font-semibold text-navy font-display mb-1">
          External CRM integration
        </h3>
        <p className="text-[13px] text-navy-2 mb-5">
          Pepper can open from Signal (or any CRM) as a pop-up dialer and post
          results back when calls complete.
        </p>

        <label className="block text-[11px] text-navy uppercase tracking-wider font-bold mb-1.5">
          Signal webhook URL
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={webhookInput}
            onChange={(e) => setWebhookInput(e.target.value)}
            placeholder="https://signal.example.com/pepper/callbacks"
            className="flex-1 px-4 py-2.5 text-sm bg-cream-3 border-2 border-navy rounded-[10px] text-navy placeholder:text-slate-2 focus:outline-none focus:bg-banana/20"
          />
          <button
            onClick={saveWebhook}
            disabled={saving || webhookInput.trim() === (prefs.signal_webhook_url ?? "")}
            className="px-4 py-2.5 rounded-full bg-banana border-[2.5px] border-navy text-navy text-sm font-bold disabled:opacity-40 shadow-pop-sm shadow-pop-hover flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Save
          </button>
        </div>
        {prefs.signal_webhook_url && (
          <p className="text-[11px] text-slate mt-2">
            Pepper will POST call summaries to this URL after AI analysis
            completes.
          </p>
        )}
        {savedFlash && (
          <p className="text-[12px] text-leaf-dark mt-2 font-semibold">
            Saved.
          </p>
        )}
        {error && (
          <p className="text-[12px] text-coral-deep mt-2 font-semibold">
            {error}
          </p>
        )}

        <div className="mt-5 divide-y-2 divide-navy/10">
          <PrefRow
            title="Auto-dial when pop-up opens"
            description="When Signal opens the Pepper pop-up with a phone number, start the call automatically after 500ms. Default off — gives you a beat to read the contact card."
            on={prefs.auto_dial_popup}
            onChange={() => toggle("auto_dial_popup")}
          />
          <PrefRow
            title="Auto-analyze calls"
            description="Run Whisper transcription and AI scoring automatically when a recording lands. Skip if you prefer to analyze manually."
            on={prefs.auto_analyze_calls}
            onChange={() => toggle("auto_analyze_calls")}
          />
        </div>
      </div>

      {isManager && (
        <div className="bg-paper border-[2.5px] border-navy rounded-[18px] p-6 shadow-pop-md">
          <h3 className="text-xl font-semibold text-navy font-display mb-1">
            Email preferences
          </h3>
          <p className="text-[13px] text-navy-2 mb-5">
            Pepper can email you a Monday morning briefing with team highlights
            and picks.
          </p>
          <div className="divide-y-2 divide-navy/10">
            <PrefRow
              title="Weekly manager digest"
              description="Mondays at 9am CT. Team call volume, answer rate, Pepper's Pick, and a coaching opportunity."
              on={prefs.weekly_digest_enabled}
              onChange={() => toggle("weekly_digest_enabled")}
            />
            <PrefRow
              title="Daily personal summary"
              description="Every morning: your calls from yesterday with a short coach's note."
              on={prefs.daily_summary_enabled}
              onChange={() => toggle("daily_summary_enabled")}
              comingSoon
            />
          </div>
        </div>
      )}

      <div className="bg-cream-2 border-[2.5px] border-navy rounded-[18px] p-5 shadow-pop-md">
        <h4 className="text-base font-semibold text-navy font-display mb-1">
          Pop-up URL shape
        </h4>
        <p className="text-[12px] text-navy-2 mb-2">
          Open this URL in a 440×720 window to launch Pepper with context:
        </p>
        <pre className="text-[11px] font-mono bg-paper border-2 border-navy rounded-[10px] p-3 overflow-x-auto text-navy">
{`https://trypepper.com/dial
  ?number=+1...
  &name=Maria+Jimenez
  &company=Willow+Creek
  &external_id=prospect_123
  &return_url=https://signal.app`}
        </pre>
      </div>
    </div>
  );
}

function PrefRow({
  title,
  description,
  on,
  onChange,
  comingSoon,
}: {
  title: string;
  description: string;
  on: boolean;
  onChange: () => void;
  comingSoon?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-semibold text-navy">{title}</p>
          {comingSoon && (
            <span className="px-2 py-0.5 rounded-full bg-sky border-[1.5px] border-navy text-[10px] font-bold uppercase tracking-wider text-navy">
              Coming soon
            </span>
          )}
        </div>
        <p className="text-[12px] text-slate mt-0.5">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={title}
        onClick={comingSoon ? undefined : onChange}
        disabled={comingSoon}
        className={`relative shrink-0 w-12 h-[26px] rounded-full border-[2px] border-navy transition-colors ${
          comingSoon ? "opacity-40 cursor-not-allowed" : ""
        } ${on ? "bg-leaf" : "bg-paper"}`}
      >
        <span
          className={`absolute top-[1px] w-[18px] h-[18px] rounded-full border-[1.5px] border-navy transition-all ${
            on ? "left-[26px] bg-paper" : "left-[1px] bg-banana"
          }`}
        />
      </button>
    </div>
  );
}
