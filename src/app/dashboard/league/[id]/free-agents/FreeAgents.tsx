"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { addPlayer } from "../player-actions";

const supabase = createClient();

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

interface Player {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  status: string | null;
  adp: number | null;
}

function statusColor(status: string | null) {
  if (!status || status === "Active") return null;
  if (status === "Injured Reserve") return "#CC0000";
  if (status === "Questionable") return "#FFD700";
  if (status === "Doubtful" || status === "Out") return "#ff8a8a";
  return "#8a8a9a";
}

export default function FreeAgents({
  leagueId,
  rosteredIds,
  projMap,
  hasProjections,
  rosterFull,
  maxActive,
}: {
  leagueId: string;
  rosteredIds: string[];
  projMap: Record<string, number>;
  hasProjections: boolean;
  rosterFull: boolean;
  maxActive: number;
}) {
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [players, setPlayers] = useState<Player[]>([]);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const rosteredSet = new Set(rosteredIds);

  useEffect(() => {
    const fetchPlayers = async () => {
      const hasSearch = search.trim().length >= 2;
      const hasPos = posFilter !== "ALL";

      let q = supabase
        .from("players")
        .select("id, full_name, position, team, status, adp")
        .not("position", "is", null)
        .not("position", "eq", "");

      if (hasSearch) q = q.ilike("full_name", `%${search.trim()}%`);
      if (hasPos) q = q.eq("position", posFilter);

      const { data } = await q.order("adp", { ascending: true, nullsFirst: false }).limit(150);
      if (data) {
        // Filter out rostered, then sort by projected pts (if available) else ADP
        const free = (data as Player[]).filter((p) => !rosteredSet.has(p.id));
        if (hasProjections) {
          free.sort((a, b) => (projMap[b.id] ?? 0) - (projMap[a.id] ?? 0));
        }
        setPlayers(free);
      }
    };

    const timer = setTimeout(fetchPlayers, search ? 300 : 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, posFilter]);

  async function handleAdd(playerId: string) {
    setSubmitting(playerId);
    const fd = new FormData();
    fd.append("leagueId", leagueId);
    fd.append("playerId", playerId);
    await addPlayer(fd);
    setSubmitting(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search + filter */}
      <div className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
        />
        <div className="flex flex-wrap gap-1">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              onClick={() => setPosFilter(pos)}
              className="rounded px-3 py-1.5 text-xs font-semibold"
              style={{
                background: posFilter === pos ? "#0057FF" : "#1c1c2b",
                color: posFilter === pos ? "#f4f4f8" : "#8a8a9a",
              }}
            >
              {pos}
            </button>
          ))}
        </div>
        {hasProjections && (
          <p className="text-xs" style={{ color: "#8a8a9a" }}>Ranked by projected points · Week {new Date().toLocaleDateString()}</p>
        )}
        {!hasProjections && (
          <p className="text-xs" style={{ color: "#8a8a9a" }}>Ranked by ADP · Projections available once the season starts</p>
        )}
      </div>

      {rosterFull && (
        <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#FFD700", color: "#FFD700", background: "#1a1500" }}>
          Your active roster is full ({maxActive} players). Drop someone before adding.
        </p>
      )}

      {/* Player list */}
      <div className="flex flex-col gap-1">
        {players.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-500">
            {search.trim().length > 0 || posFilter !== "ALL"
              ? "No available free agents match your search."
              : "Loading free agents…"}
          </p>
        )}

        {players.map((p, idx) => {
          const proj = projMap[p.id];
          const sColor = statusColor(p.status);
          return (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              style={{ borderColor: "#2a2a40" }}
            >
              {/* Rank */}
              <span className="w-6 text-right text-xs shrink-0" style={{ color: "#8a8a9a" }}>{idx + 1}</span>

              {/* Player info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{p.full_name}</p>
                <p className="text-xs text-zinc-500">
                  {p.position ?? "?"} &middot; {p.team ?? "FA"}
                  {p.status && p.status !== "Active" && (
                    <span className="ml-1 font-semibold" style={{ color: sColor ?? undefined }}>
                      · {p.status}
                    </span>
                  )}
                </p>
              </div>

              {/* Projected pts */}
              {hasProjections && (
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums" style={{ color: proj ? "#f4f4f8" : "#8a8a9a" }}>
                    {proj != null ? proj.toFixed(1) : "—"}
                  </p>
                  <p className="text-xs" style={{ color: "#8a8a9a" }}>proj</p>
                </div>
              )}

              {/* Add button */}
              <form action={addPlayer}>
                <input type="hidden" name="leagueId" value={leagueId} />
                <input type="hidden" name="playerId" value={p.id} />
                <button
                  type="submit"
                  disabled={rosterFull || submitting === p.id}
                  onClick={(e) => {
                    e.preventDefault();
                    handleAdd(p.id);
                  }}
                  className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                  style={{ background: "#0057FF", color: "#f4f4f8" }}
                >
                  {submitting === p.id ? "…" : "Add"}
                </button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
