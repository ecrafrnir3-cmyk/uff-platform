"use client";

import { useState, useEffect } from "react";

interface TrendingPlayer {
  player_id: string;
  count: number;
  full_name: string;
  position: string | null;
  team: string | null;
  injury_status: string | null;
}

const INJURY_COLORS: Record<string, { label: string; color: string }> = {
  Out:          { label: "OUT", color: "#ff6b6b" },
  Doubtful:     { label: "D",   color: "#ff8a8a" },
  Questionable: { label: "Q",   color: "#FFD700" },
  Probable:     { label: "P",   color: "#3DDC84" },
  IR:           { label: "IR",  color: "#8888aa" },
};

export default function TrendingPlayers({ leagueId }: { leagueId: string }) {
  const [tab, setTab]       = useState<"add" | "drop">("add");
  const [players, setPlayers] = useState<TrendingPlayer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/trending?type=${tab}&hours=24&limit=15`)
      .then((r) => r.json())
      .then((data) => { setPlayers(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [tab]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "#2a2a40" }}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#FFD700" }}>
          Trending (24h)
        </h3>
        <div className="flex rounded-md overflow-hidden border" style={{ borderColor: "#2a2a40" }}>
          {(["add", "drop"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1 text-xs font-semibold transition"
              style={{
                background: tab === t ? (t === "add" ? "#0057FF" : "#CC0000") : "#15151f",
                color: "#f4f4f8",
              }}
            >
              {t === "add" ? "📈 Adds" : "📉 Drops"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-white py-2">Loading…</p>
      ) : players.length === 0 ? (
        <p className="text-xs text-white py-2">No trending data available right now.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {players.map((p, i) => {
            const injury = p.injury_status ? INJURY_COLORS[p.injury_status] : null;
            return (
              <div key={p.player_id} className="flex items-center gap-2 py-1 border-b last:border-0"
                style={{ borderColor: "#1c1c2b" }}>
                <span className="text-xs tabular-nums w-4 text-right shrink-0" style={{ color: "#8888aa" }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold truncate" style={{ color: "#f4f4f8" }}>
                      {p.full_name}
                    </span>
                    {injury && (
                      <span className="text-xs font-bold" style={{ color: injury.color }}>
                        {injury.label}
                      </span>
                    )}
                  </div>
                  <span className="text-xs" style={{ color: "#8888aa" }}>
                    {p.position ?? "?"} · {p.team ?? "FA"}
                  </span>
                </div>
                <span className="text-xs font-semibold shrink-0" style={{ color: tab === "add" ? "#3DDC84" : "#CC0000" }}>
                  {p.count >= 1000 ? `${(p.count / 1000).toFixed(1)}k` : p.count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
