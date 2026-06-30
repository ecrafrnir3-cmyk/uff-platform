"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

interface Player {
  player_id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  injury_status: string | null;
  owner_team: string | null;
  owner_member_id: string | null;
  is_mine: boolean;
}

const INJURY_CONFIG: Record<string, { label: string; color: string }> = {
  "Out":          { label: "OUT",  color: "#ff6b6b" },
  "Doubtful":     { label: "D",    color: "#ff8a8a" },
  "Questionable": { label: "Q",    color: "#FFD700" },
  "Probable":     { label: "P",    color: "#3DDC84" },
  "IR":           { label: "IR",   color: "#8888aa" },
};

const POS_COLORS: Record<string, string> = {
  QB: "#FF6B35", RB: "#3DDC84", WR: "#0057FF", TE: "#FFD700",
  K: "#8888aa", DEF: "#CC0000", DST: "#CC0000",
};

export default function PlayerSearch({ leagueId }: { leagueId: string }) {
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setPlayers([]);
      setSearched(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/player-search?q=${encodeURIComponent(query.trim())}&league_id=${leagueId}`
        );
        const data = await res.json();
        setPlayers(data.players ?? []);
        setSearched(true);
      } catch {
        setPlayers([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, leagueId]);

  return (
    <div className="flex flex-col gap-4">
      {/* Search input */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: "#6b6b8a" }}>
          🔍
        </span>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search any player by name…"
          autoFocus
          className="w-full rounded-lg py-3 pl-9 pr-4 text-sm"
          style={{
            background: "#13132b",
            border: "1px solid #2a2a40",
            color: "#f4f4f8",
            outline: "none",
          }}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs animate-pulse" style={{ color: "#6b6b8a" }}>
            Searching…
          </span>
        )}
      </div>

      {/* Results */}
      {searched && !loading && players.length === 0 && (
        <p className="text-sm text-center py-8" style={{ color: "#6b6b8a" }}>
          No players found for &ldquo;{query}&rdquo;
        </p>
      )}

      {players.length > 0 && (
        <div className="flex flex-col gap-1">
          {players.map(p => {
            const posColor = POS_COLORS[p.position?.toUpperCase() ?? ""] ?? "#8888aa";
            const injury = p.injury_status ? INJURY_CONFIG[p.injury_status] : null;

            return (
              <div
                key={p.player_id}
                className="flex items-center gap-3 rounded-lg px-4 py-3"
                style={{ background: "#13132b", border: "1px solid #2a2a40" }}
              >
                {/* Position badge */}
                <span
                  className="shrink-0 w-9 text-center rounded text-xs font-bold uppercase py-0.5"
                  style={{ background: `${posColor}22`, color: posColor }}
                >
                  {p.position ?? "?"}
                </span>

                {/* Name + team */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "#f4f4f8" }}>
                    {p.full_name}
                  </p>
                  <p className="text-xs" style={{ color: "#8888aa" }}>
                    {p.team ?? "Free Agent"}
                  </p>
                </div>

                {/* Injury badge */}
                {injury && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs font-bold"
                    style={{ color: injury.color, background: `${injury.color}22` }}
                  >
                    {injury.label}
                  </span>
                )}

                {/* Ownership */}
                {p.owner_team ? (
                  <span
                    className="shrink-0 rounded px-2 py-0.5 text-xs font-medium"
                    style={
                      p.is_mine
                        ? { color: "#3DDC84", background: "rgba(61,220,132,0.1)", border: "1px solid rgba(61,220,132,0.25)" }
                        : { color: "#d4d4e8", background: "rgba(42,42,64,0.8)", border: "1px solid #2a2a40" }
                    }
                  >
                    {p.is_mine ? "✓ My Roster" : p.owner_team}
                  </span>
                ) : (
                  <Link
                    href={`/dashboard/league/${leagueId}/free-agents`}
                    className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-80"
                    style={{ color: "#0057FF", background: "rgba(0,87,255,0.1)", border: "1px solid rgba(0,87,255,0.25)" }}
                  >
                    Free Agent →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!searched && query.length === 0 && (
        <p className="text-sm text-center py-12" style={{ color: "#6b6b8a" }}>
          Type at least 2 characters to search
        </p>
      )}
    </div>
  );
}
