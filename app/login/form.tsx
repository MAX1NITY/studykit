"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Notice } from "@/components/chrome";

type Mode = "signin" | "signup";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/kits";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCheckEmail(false);

    const supabase = createClient();

    if (mode === "signup") {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setBusy(false);
        return;
      }

      // With email confirmation switched off, sign-up returns a session and
      // we go straight in. With it on, there is no session yet.
      if (data.session) {
        router.replace(next);
        router.refresh();
        return;
      }

      setCheckEmail(true);
      setBusy(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setBusy(false);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-10 space-y-5">
      <div>
        <label htmlFor="email" className="text-[13px] text-mute">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="writeline mt-1 py-1.5 text-[15px]"
        />
      </div>

      <div>
        <label htmlFor="password" className="text-[13px] text-mute">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="writeline mt-1 py-1.5 text-[15px]"
        />
        {mode === "signup" ? (
          <p className="mt-1.5 text-[13px] text-mute">At least 8 characters.</p>
        ) : null}
      </div>

      {error ? <Notice title={error} /> : null}

      {checkEmail ? (
        <Notice
          tone="brass"
          title="Confirm your email to finish"
          hint="We sent you a link. Open it, then sign in here."
        />
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-sm bg-ink py-2.5 text-[15px] font-medium text-bg disabled:opacity-50"
      >
        {busy
          ? "One moment"
          : mode === "signup"
            ? "Create account"
            : "Sign in"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
          setCheckEmail(false);
        }}
        className="text-[13px] text-mute underline underline-offset-2"
      >
        {mode === "signin"
          ? "No account yet? Create one"
          : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
