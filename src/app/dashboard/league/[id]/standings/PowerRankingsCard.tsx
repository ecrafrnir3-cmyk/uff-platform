"use client";

import { useState } from "react";

interface RankingEntry {
  rank: number;
  teamRecord: string; // e.g. "Dark Matter (4-3)"
  analysis: string;
}

function parseRankings(raw: string): RankingEntry[] {
  const lines = raw.split("\n").filter((l) => l.trim().startsWith("#"));
  return lines.map((line) => {
    // Expected format: "#1. Team Name (W-L) — Analysis text."
    const rankMatch = line.match(/^#(\d+)\./);
    const rank = rankMatch ? parseInt(rankMatch[1], 10) : 0;
    // Split on first em-dash (—) or double-hyphen (--)
    const dashIdx = line.search(/\s[—–-]{1,2}\s/);
    let teamRecord = "";
    let analysis = line;
    if (dashIdx !== -1) {
      teamRecord = line.slice(0, dashIdx).replace(/^#\d+\.\s*/, "").trim();
      analysis = line.slice(dashIdx).replace(/^\s*[—–-]+\s*/, "").trim();
    } else {
      teamRecord = line.replace(/^#\d+\.\s*/, "").trim();
      analysis = "";
    }
    return { rank, teamRecord, analysis };
  }).filter((e) => e.rank > 0);
}

function rankColor(rank: number): string {
  if (rank === 1) return "#FFD700";
  if (rank === 2) return "#C0C0C0";
  if (rank === 3) return "#CD7F32";
  return "#6b6b8a";
}

export default function PowerRankingsCard({ leagueId }: { leagueId: string }) {
  const [state, setState] = useState<{
    rankings?: RankingEntry[];
    rawText?: string;
    week?: number;
    loading: boolean;
    error?: string;
  }>({ loading: false });

  async function generate() {
    setState({ loading: true });
    try {
      const res = await fetch("/api/power-rankings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: leagueId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ loading: false, error: data.error ?? "Oracle could not generate rankings" });
        return;
      }
      const parsed = parseRankings(data.rankings ?? "");
      setState({
        loading: false,
        rankings: parsed.length > 0 ? parsed : undefined,
        rawText: parsed.length === 0 ? data.rankings : undefined,
        week: data.week,
      });
    } catch {
      setState({ loading: false, error: "Network error — try again" });
    }
  }

  // ── Idle state ───────────────────────────────────────────────────────────────
  if (!state.loading && !state.rankings && !state.rawText && !state.error) {
    return (
      <div
        className="flex flex-col gap-3 rounded-xl border p-5"
        style={{ borderColor: "#0057FF33", background: "rgba(0,87,255,0.03)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">⚡</span>
          <div>
            <p className="text-sm font-bold" style={{ color: "#0057FF" }}>Power Rankings</p>
            <p className="text-xs" style={{ color: "#8888aa" }}>
              Oracle true-strength ranking — goes beyond the W/L record
            </p>
          </div>
        </div>
        <button
          onClick={generate}
          className="self-start rounded-md px-4 py-2 text-sm font-semibold transition hover:opacity-80"
          style={{ background: "rgba(0,87,255,0.15)", color: "#0057FF", border: "1px solid #0057FF44" }}
        >
          ⚡ Generate Power Rankings
        </button>
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (state.loading) {
    return (
      <div
        className="flex flex-col gap-3 rounded-xl border p-5"
        style={{ borderColor: "#0057FF33", background: "rgba(0,87,255,0.03)" }}
      >
        <p className="text-sm italic" style={{ color: "#8888aa" }}>
          ⚡ Oracle is assessing true power across the league…
        </p>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (state.error) {
    return (
      <div
        className="flex flex-col gap-3 rounded-xl border p-5"
        style={{ borderColor: "#CC000044", background: "rgba(204,0,0,0.04)" }}
      >
        <p className="text-sm" style={{ color: "#ff8a8a" }}>{state.error}</p>
        <button
          onClick={() => setState({ loading: false })}
          className="self-start text-xs underline"
          style={{ color: "#CC0000" }}
        >
          Try again
        </button>
      </div>
    );
  }

  // ── Results ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col gap-4 rounded-xl border p-5"
      style={{ borderColor: "#0057FF33", background: "rgba(0,87,255,0.03)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">⚡</span>
          <div>
            <p className="text-sm font-bold" style={{ color: "#0057FF" }}>
              Week {state.week} Power Rankings
            </p>
            <p className="text-xs" style={{ color: "#8888aa" }}>Oracle true-strength assessment</p>
          </div>
        </div>
        <button
          onClick={() => setState({ loading: false })}
          className="shrink-0 text-xs underline"
          style={{ color: "#8888aa" }}
        >
          Reset
        </button>
      </div>

      {/* Parsed ranked list */}
      {state.rankings && state.rankings.length > 0 ? (
        <div className="flex flex-col gap-2">
          {state.rankings.map((entry) => (
            <div
              key={entry.rank}
              className="flex gap-3 rounded-lg border px-4 py-3"
              style={{ borderColor: "#2a2a40", background: "#0d0d1a" }}
            >
              {/* Rank number */}
              <span
                className="w-6 shrink-0 text-center text-lg font-black tabular-nums leading-none pt-0.5"
                style={{ color: rankColor(entry.rank) }}
              >
                {entry.rank}
              </span>
              {/* Content */}
              <div className="min-w-0 flex flex-col gap-1">
                <p className="font-semibold text-sm leading-snug" style={{ color: "#f4f4f8" }}>
                  {entry.teamRecord}
                </p>
                {entry.analysis && (
                  <p className="text-xs leading-relaxed" style={{ color: "#9999bb" }}>
                    {entry.analysis}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Fallback: raw text if parsing failed */
        <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "#d4d4e8" }}>
          {state.rawText}
        </div>
      )}
    </div>
  );
}
