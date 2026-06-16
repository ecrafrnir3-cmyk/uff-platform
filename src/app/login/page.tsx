"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "sign-in" | "sign-up";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Read ?error= from URL (set by auth callback on failure)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    if (urlError) setError(decodeURIComponent(urlError));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      if (mode === "sign-up") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (signUpError) throw signUpError;

        if (data.session) {
          // Email confirmation disabled — session is live immediately.
          router.push("/dashboard");
          router.refresh();
        } else {
          setInfo("Check your email to confirm your account, then sign in.");
          setMode("sign-in");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;

        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-6 py-12"
      style={{ background: "#0d0d1a", color: "#f4f4f8" }}
    >
      <div className="w-full max-w-sm">
        <p className="text-center text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
          Ultimate Fantasy Football
        </p>
        <h1
          className="mt-2 text-center text-3xl"
          style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}
        >
          {mode === "sign-in" ? "Sign in" : "Create your account"}
        </h1>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          {mode === "sign-up" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="displayName" className="text-xs uppercase tracking-wide text-zinc-400">
                Display name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Commissioner Nate"
                className="rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-xs uppercase tracking-wide text-zinc-400">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-xs uppercase tracking-wide text-zinc-400">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
            />
          </div>

          {mode === "sign-in" && (
            <div className="flex justify-end -mt-2">
              <Link href="/forgot-password" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                Forgot password?
              </Link>
            </div>
          )}

          {error && (
            <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}>
              {error}
            </p>
          )}
          {info && (
            <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#FFD700", color: "#FFD700", background: "#1a160e" }}>
              {info}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ background: "#0057FF", color: "#f4f4f8" }}
          >
            {loading ? "Working..." : mode === "sign-in" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-400">
          {mode === "sign-in" ? (
            <>
              Need an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("sign-up");
                  setError(null);
                  setInfo(null);
                }}
                className="underline"
                style={{ color: "#0057FF" }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("sign-in");
                  setError(null);
                  setInfo(null);
                }}
                className="underline"
                style={{ color: "#0057FF" }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
