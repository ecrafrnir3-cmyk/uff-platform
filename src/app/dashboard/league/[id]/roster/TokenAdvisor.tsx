"use client";

import { useState } from "react";

export default function TokenAdvisor({
  tokenName,
  leagueId,
  week,
}: {
  tokenName: string;
  leagueId: string;
  week: number;
}) {
  const [state, setState] = useState<{
    advice?: string;
    loading: boolean;
    error?: string;
  }>({ loading: false });

  async function getAdvice() {
    setState({ loading: true });
    try {
      const res = await fetch("/api/token-advisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ league_id: leagueId, week }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to get advice");
      setState({ loading: false, advice: data.advice });
    } catch (err) {
      setState({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  if (state.advice) {
    return (
      <div
        className="mt-3 rounded-xl border px-4 py-3"
        style={{ borderColor: "#FFD70033", background: "rgba(255,215,0,0.04)" }}
      >
        <p
          className="mb-1.5 text-xs font-semibold uppercase tracking-widest"
          style={{ color: "#FFD700" }}
        >
          🧠 Oracle Strategy — {tokenName}
        </p>
        <p
          className="text-sm leading-relaxed"
          style={{ color: "#d4d4e8" }}
        >
          {state.advice}
        </p>
        <button
          onClick={() => setState({ loading: false })}
          className="mt-2 text-xs underline"
          style={{ color: "#f4f4f8" }}
        >
          Reset
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {state.error && (
        <p className="text-xs" style={{ color: "#ff8a8a" }}>
          {state.error}
        </p>
      )}
      {state.loading ? (
        <p className="text-xs" style={{ color: "#FFD700" }}>
          🧠 The Oracle weighs your options…
        </p>
      ) : (
        <button
          onClick={getAdvice}
          className="self-start rounded-full px-4 py-1.5 text-xs font-semibold transition hover:opacity-80"
          style={{
            background: "rgba(255,215,0,0.1)",
            color: "#FFD700",
            border: "1px solid #FFD70033",
          }}
        >
          🧠 Get Oracle Strategy
        </button>
      )}
    </div>
  );
}
