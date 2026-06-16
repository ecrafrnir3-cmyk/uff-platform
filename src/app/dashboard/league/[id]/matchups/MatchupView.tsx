"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

const HERO_COLOR = "#0057FF";
const VILLAIN_COLOR = "#CC0000";

interface MatchupRow {
  id: string;
  matchup_id: number;
  week: number;
  member_id: string;
  points: number;
  is_complete: boolean;
  league_members: { team_name: string; faction: "hero" | "villain" | null } | null;
}

type MatchupPair = MatchupRow[];

function factionColor(faction: "hero" | "villain" | null) {
  if (faction === "hero") return HERO_COLOR;
  if (faction === "villain") return VILLAIN_COLOR;
  return "#8a8a9a";
}

function ScoreCard({
  row,
  isMe,
  isWinner,
}: {
  row: MatchupRow;
  isMe: boolean;
  isWinner: boolean;
}) {
  const color = factionColor(row.league_members?.faction ?? null);
  return (
    <div
      className="flex flex-1 flex-col items-center gap-1 rounded-lg border p-4"
      style={{
        borderColor: isMe ? "#FFD700" : isWinner ? color : "#2a2a40",
        background: isMe ? "rgba(255,215,0,0.04)" : "transparent",
      }}
    >
      <p className="text-xs uppercase tracking-wide" style={{ color }}>
        {row.league_members?.faction ?? "—"}
      </p>
      <p className="text-sm font-semibold text-center" style={{ color: isMe ? "#FFD700" : "#f4f4f8" }}>
        {row.league_members?.team_name ?? "Unknown"}
        {isMe && <span className="ml-1 text-xs font-normal text-zinc-500">(you)</span>}
      </p>
      <p
        className="text-3xl font-bold tabular-nums"
        style={{ color: isWinner ? color : "#f4f4f8" }}
      >
        {row.points.toFixed(2)}
      </p>
      {isWinner && row.is_complete && (
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
          Winner
        </p>
      )}
    </div>
  );
}

export default function MatchupView({
  leagueId,
  week,
  matchupPairs: initialPairs,
  myMemberId,
}: {
  leagueId: string;
  week: number;
  matchupPairs: MatchupPair[];
  myMemberId: string;
}) {
  const [pairs, setPairs] = useState<MatchupPair[]>(initialPairs);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // ── Supabase Realtime subscription ───────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`matchups-${leagueId}-week${week}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "uff_matchups",
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          setPairs((prev) =>
            prev.map((pair) =>
              pair.map((row) => {
                if (row.id !== payload.new.id) return row;
                return { ...row, points: payload.new.points, is_complete: payload.new.is_complete };
              })
            )
          );
          setLastUpdated(new Date());
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, week]);

  if (pairs.length === 0) {
    return (
      <p className="rounded-lg border p-5 text-sm text-zinc-400" style={{ borderColor: "#2a2a40" }}>
        No matchups scheduled for Week {week}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
          Week {week}
        </h2>
        {lastUpdated && (
          <p className="text-xs text-zinc-600">
            Live · updated {lastUpdated.toLocaleTimeString()}
          </p>
        )}
        {!lastUpdated && (
          <p className="text-xs text-zinc-600">Live · scores update every ~5 min during games</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {pairs.map((pair) => {
          const [a, b] = pair;
          if (!a || !b) return null;

          const aWins = a.is_complete && a.points > b.points;
          const bWins = b.is_complete && b.points > a.points;
          const isMyMatchup = a.member_id === myMemberId || b.member_id === myMemberId;

          return (
            <div
              key={a.matchup_id}
              className="rounded-lg border p-4"
              style={{ borderColor: isMyMatchup ? "#FFD700" : "#2a2a40", background: "#0d0d1a" }}
            >
              {isMyMatchup && (
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest" style={{ color: "#FFD700" }}>
                  Your matchup
                </p>
              )}
              <div className="flex items-stretch gap-3">
                <ScoreCard row={a} isMe={a.member_id === myMemberId} isWinner={aWins} />
                <div className="flex flex-col items-center justify-center px-1">
                  <span className="text-sm font-bold text-zinc-600">vs</span>
                </div>
                <ScoreCard row={b} isMe={b.member_id === myMemberId} isWinner={bWins} />
              </div>
              {a.is_complete && (
                <p className="mt-2 text-center text-xs text-zinc-600">Final</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
