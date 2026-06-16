"use client";

import Link from "next/link";

export default function LeagueError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <div className="flex flex-col gap-4 text-center max-w-md">
        <p className="text-sm uppercase tracking-widest" style={{ color: "#FFD700" }}>Something went wrong</p>
        <p className="text-sm text-zinc-400">{error.message ?? "Could not load this league."}</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="rounded-md px-4 py-2 text-sm font-semibold"
            style={{ background: "#0057FF", color: "#f4f4f8" }}
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="rounded-md border px-4 py-2 text-sm font-semibold"
            style={{ borderColor: "#2a2a40", color: "#f4f4f8" }}
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
