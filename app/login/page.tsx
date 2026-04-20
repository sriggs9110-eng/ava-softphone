"use client";

import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";
import PepperMascot from "@/components/pepper/PepperMascot";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  // Validate the ?next= param: must be a relative path starting with "/"
  // (protects against open-redirect attacks via ?next=https://evil.com).
  const rawNext = searchParams.get("next");
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-cream px-4 pepper-gradients overflow-hidden">
      <div className="w-full max-w-sm animate-fade-in relative z-[1]">
        {/* Pepper mascot header */}
        <div className="flex flex-col items-center mb-6">
          <PepperMascot size="lg" state="listening" className="mb-3 drop-shadow-[4px_4px_0_#1B2340]" />
          <h1 className="text-4xl font-semibold text-navy font-display tracking-tight">
            Pepper
          </h1>
          <p className="text-[13px] text-slate mt-1 font-accent text-lg">
            your AI sales coach
          </p>
        </div>

        {/* Form card */}
        <form
          onSubmit={handleSubmit}
          className="bg-paper border-[2.5px] border-navy rounded-[18px] shadow-pop-lg p-6 space-y-4"
        >
          <div>
            <label className="block text-[11px] text-navy uppercase tracking-wider font-bold mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full px-4 py-3 text-sm bg-cream-3 border-2 border-navy rounded-[10px] text-navy placeholder:text-slate-2 focus:outline-none focus:bg-banana/30 transition-colors"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="block text-[11px] text-navy uppercase tracking-wider font-bold mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 text-sm bg-cream-3 border-2 border-navy rounded-[10px] text-navy placeholder:text-slate-2 focus:outline-none focus:bg-banana/30 transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="px-3 py-2.5 rounded-[10px] bg-rose border-2 border-navy text-navy text-[13px] font-medium">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-full bg-banana border-[2.5px] border-navy text-navy text-sm font-bold transition-all disabled:opacity-50 min-h-[48px] shadow-pop-sm shadow-pop-hover"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="text-center text-[12px] text-slate mt-6">
          Contact your admin if you need an account
        </p>
      </div>
    </div>
  );
}
