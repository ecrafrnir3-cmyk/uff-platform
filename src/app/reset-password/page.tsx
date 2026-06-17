"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      router.push("/dashboard");
      router.refresh();
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
          New password
        </h1>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-xs uppercase tracking-wide text-zinc-400">
              New password
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

          <div className="flex flex-col gap-1">
            <label htmlFor="confirm" className="text-xs uppercase tracking-wide text-zinc-400">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
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
            {loading ? "Saving..." : "Set new password"}
          </button>
        </form>
      </div>
    </div>
  );
}
