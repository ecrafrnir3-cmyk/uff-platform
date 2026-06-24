"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (resetError) throw resetError;
      setSent(true);
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
          Reset password
        </h1>

        {sent ? (
          <div className="mt-8 flex flex-col gap-4 text-center">
            <p
              className="rounded-md border px-3 py-3 text-sm"
              style={{ borderColor: "#FFD700", color: "#FFD700", background: "#1a160e" }}
            >
              Check your email — we sent a reset link.
            </p>
            <Link href="/login" className="text-sm underline" style={{ color: "#0057FF" }}>
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="email" className="text-xs uppercase tracking-wide text-white">
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

            {error && (
              <p
                className="rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ background: "#0057FF", color: "#f4f4f8" }}
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>

            <p className="text-center text-sm text-white">
              <Link href="/login" className="underline" style={{ color: "#0057FF" }}>
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
