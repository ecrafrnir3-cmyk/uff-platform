"use client";

export default function DashboardError({
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
        <p className="text-sm text-zinc-400">{error.message ?? "An unexpected error occurred."}</p>
        <button
          onClick={reset}
          className="mx-auto rounded-md px-4 py-2 text-sm font-semibold"
          style={{ background: "#0057FF", color: "#f4f4f8" }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
