"use client";
import { useState } from "react";

export default function StartSitAdvisor({ leagueId }: { leagueId: string }) {
  const [state, setState] = useState<{ advice?: string; loading: boolean; error?: string }>({
    loading: false,
  });

  async function getAdvice() {
    setState({ loading: true });
    try {
      const res = await fetch("/api/start-sit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ league_id: leagueId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setState({ loading: false, advice: data.advice });
    } catch (err) {
      setState({ loading: false, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  if (state.advice) {
    return (
      <div
        className="rounded-xl border px-5 py-4 flex flex-col gap-3"
        style={{ borderColor: "#3DDC8433", background: "rgba(61,220,132,0.04)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🧠</span>
            <span className="text-sm font-bold uppercase tracking-wide" style={{ color: "#3DDC84" }}>
              Start/Sit Advisor
            </span>
          </div>
          <button
            onClick={() => setState({ loading: false })}
            className="text-xs"
            style={{ color: "#8888aa" }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: "#d4d4e8" }}>
          {state.advice}
        </p>
        <button
          onClick={getAdvice}
          disabled={state.loading}
          className="self-start text-xs underline disabled:opacity-50"
          style={{ color: "#3DDC84" }}
        >
          Refresh advice
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border px-5 py-4 flex items-center justify-between gap-3"
      style={{ borderColor: "#2a2a40" }}
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>
          🧠 Start/Sit Advisor
        </p>
        <p className="text-xs" style={{ color: "#8888aa" }}>
          AI lineup recommendations for this week
        </p>
        {state.error && (
          <p className="text-xs mt-0.5" style={{ color: "#ff8a8a" }}>
            {state.error}
          </p>
        )}
      </div>
      <button
        onClick={getAdvice}
        disabled={state.loading}
        className="shrink-0 rounded-md px-4 py-2 text-sm font-semibold transition hover:opacity-80 disabled:opacity-50"
        style={{ background: "#3DDC84", color: "#0d0d1a" }}
      >
        {state.loading ? "Analyzing…" : "Get Advice"}
      </button>
    </div>
  );
}
