"use client";

import { useState } from "react";

interface VetoAnalyzerProps {
  leagueId: string;
  tradeId: string;
}

interface AnalysisState {
  analysis?: string;
  verdict?: "APPROVE" | "VETO" | null;
  loading: boolean;
  error?: string;
}

export default function VetoAnalyzer({ leagueId, tradeId }: VetoAnalyzerProps) {
  const [state, setState] = useState<AnalysisState>({ loading: false });

  async function analyze() {
    setState({ loading: true });
    try {
      const res = await fetch("/api/trade-veto-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: leagueId, trade_id: tradeId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ loading: false, error: data.error ?? "Oracle failed" });
        return;
      }
      setState({ loading: false, analysis: data.analysis, verdict: data.verdict });
    } catch {
      setState({ loading: false, error: "Could not reach Oracle" });
    }
  }

  if (!state.analysis && !state.loading && !state.error) {
    return (
      <button
        onClick={analyze}
        className="rounded px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
        style={{ background: "rgba(255,215,0,0.1)", color: "#FFD700", border: "1px solid rgba(255,215,0,0.3)" }}
      >
        🔮 Oracle Analysis
      </button>
    );
  }

  if (state.loading) {
    return (
      <span className="text-xs animate-pulse" style={{ color: "#FFD700" }}>
        🔮 Consulting the Oracle…
      </span>
    );
  }

  if (state.error) {
    return (
      <span className="text-xs" style={{ color: "#CC0000" }}>
        ⚠ {state.error}
      </span>
    );
  }

  const verdictColor = state.verdict === "APPROVE" ? "#3DDC84" : state.verdict === "VETO" ? "#CC0000" : "#FFD700";

  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-1.5"
      style={{ background: "rgba(255,215,0,0.04)", border: "1px solid rgba(255,215,0,0.15)" }}
    >
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#FFD700" }}>🔮 Oracle Analysis</p>
      <p className="text-xs leading-relaxed" style={{ color: "#d4d4e8" }}>
        {(state.analysis?.split(/VERDICT:/)[0] ?? "").trim()}
      </p>
      {state.verdict && (
        <p className="text-xs font-bold mt-0.5" style={{ color: verdictColor }}>
          {state.verdict === "APPROVE" ? "✓" : "✗"} VERDICT: {state.verdict}
        </p>
      )}
      <button
        onClick={() => setState({ loading: false })}
        className="self-start text-xs underline mt-0.5"
        style={{ color: "#6b6b8a" }}
      >
        Dismiss
      </button>
    </div>
  );
}
