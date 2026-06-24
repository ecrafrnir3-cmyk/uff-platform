"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { addPlayer, addAndDropPlayer } from "../player-actions";

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

interface ActiveRosterPlayer {
  player_id: string;
  full_name: string;
  position: string | null;
}

function statusColor(status: string | null) {
  if (!status || status === "Active") return null;
  if (status === "Injured Reserve") return "#CC0000";
  if (status === "Questionable") return "#FFD700";
  if (status === "Doubtful" || status === "Out") return "#ff8a8a";
  return "#f4f4f8";
}

const POS_COLOR: Record<string, string> = {
  QB: "#0057FF", RB: "#3DDC84", WR: "#FFD700",
  TE: "#FF6B35", K: "#f4f4f8", DEF: "#CC0000", DST: "#CC0000",
};

export default function FreeAgents({
  leagueId,
  rosteredIds,
  projMap,
  hasProjections,
  rosterFull,
  maxActive,
  week,
  myActiveRoster,
}: {
  leagueId: string;
  rosteredIds: string[];
  projMap: Record<string, number>;
  hasProjections: boolean;
  rosterFull: boolean;
  maxActive: number;
  week: number;
  myActiveRoster: ActiveRosterPlayer[];
}) {
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [players, setPlayers] = useState<Player[]>([]);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [dropPlayerId, setDropPlayerId] = useState<string>("");

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
    if (rosterFull) {
      if (!dropPlayerId) {
        setSubmitting(null);
        return;
      }
      fd.append("addPlayerId", playerId);
      fd.append("dropPlayerId", dropPlayerId);
      await addAndDropPlayer(fd);
    } else {
      fd.append("playerId", playerId);
      await addPlayer(fd);
    }
    setSubmitting(null);
  }

  const dropDisabled = rosterFull && !dropPlayerId;

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
                color: posFilter === pos ? "#f4f4f8" : "#f4f4f8",
              }}
            >
              {pos}
            </button>
          ))}
        </div>
        {hasProjections && (
          <p className="text-xs" style={{ color: "#f4f4f8" }}>Ranked by projected points · Week {week}</p>
        )}
        {!hasProjections && (
          <p className="text-xs" style={{ color: "#f4f4f8" }}>Ranked by ADP · Projections available once the season starts</p>
        )}
      </div>

      {/* Drop-to-add selector — shown when roster is full */}
      {rosterFull && (
        <div
          className="rounded-lg border p-4 flex flex-col gap-3"
          style={{ borderColor: "#FFD700", background: "#1a1500" }}
        >
          <p className="text-sm font-semibold" style={{ color: "#FFD700" }}>
            Roster full ({maxActive} players) — select a player to drop, then click Add next to your pickup.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase tracking-wide" style={{ color: "#f4f4f8" }}>
              Drop
            </label>
            <select
              value={dropPlayerId}
              onChange={(e) => setDropPlayerId(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm w-full"
              style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
            >
              <option value="">— Choose a player to drop —</option>
              {myActiveRoster.map((rp) => {
                const pos = (rp.position ?? "?").toUpperCase();
                const color = POS_COLOR[pos] ?? "#f4f4f8";
                return (
                  <option key={rp.player_id} value={rp.player_id}>
                    [{pos}] {rp.full_name}
                  </option>
                );
              })}
            </select>
            {dropPlayerId && (
              <p className="text-xs" style={{ color: "#f4f4f8" }}>
                {myActiveRoster.find((r) => r.player_id === dropPlayerId)?.full_name} will be released when you click Add.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Player list */}
      <div className="flex flex-col gap-1">
        {players.length === 0 && (
          <p className="py-8 text-center text-sm text-white">
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
              <span className="w-6 text-right text-xs shrink-0" style={{ color: "#f4f4f8" }}>{idx + 1}</span>

              {/* Player info */}
              {p.position !== "DEF" && p.position !== "DST" && (
                <img
                  src={`https://sleepercdn.com/content/nfl/players/thumb/${p.id}.jpg`}
                  alt=""
                  width={32} height={32}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                  style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, width: 32, height: 32, background: "#1c1c2b" }}
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{p.full_name}</p>
                <p className="text-xs text-white">
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
                  <p className="text-sm font-semibold tabular-nums" style={{ color: proj ? "#f4f4f8" : "#f4f4f8" }}>
                    {proj != null ? proj.toFixed(1) : "—"}
                  </p>
                  <p className="text-xs" style={{ color: "#f4f4f8" }}>proj</p>
                </div>
              )}

              {/* Add / Add & Drop button */}
              <button
                disabled={dropDisabled || submitting === p.id}
                onClick={() => handleAdd(p.id)}
                className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                style={{ background: rosterFull ? "#CC0000" : "#0057FF", color: "#f4f4f8" }}
                title={rosterFull && !dropPlayerId ? "Select a player to drop first" : undefined}
              >
                {submitting === p.id ? "…" : rosterFull ? "Add & Drop" : "Add"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
