"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TOKEN_NAMES } from "@/lib/token-names";

type BreakdownPlayer = { player_id: string; name: string; pos: string; team: string; points: number };
type BreakdownData = {
  hasData: boolean;
  a: { team_name: string; players: BreakdownPlayer[] };
  b: { team_name: string; players: BreakdownPlayer[] };
};

const supabase = createClient();

const HERO_COLOR = "#0057FF";
const VILLAIN_COLOR = "#CC0000";

interface MatchupRow {
  id: string;
  matchup_id: number;
  week: number;
  member_id: string;
  points: number;
  projected: number | null;
  token_bonus: number;
  is_complete: boolean;
  oracle_recap: string | null;
  median_win: boolean | null;
  league_members: { team_name: string; faction: "hero" | "villain" | null } | null;
}

type MatchupPair = MatchupRow[];

function factionColor(faction: "hero" | "villain" | null) {
  if (faction === "hero") return HERO_COLOR;
  if (faction === "villain") return VILLAIN_COLOR;
  return "#f4f4f8";
}

function ScoreCard({
  row,
  isMe,
  isWinner,
  token,
  medianScoring,
}: {
  row: MatchupRow;
  isMe: boolean;
  isWinner: boolean;
  token?: { tokenId: number; status: string };
  medianScoring?: boolean;
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
        {row.league_members?.faction ?? "?"}
      </p>
      <p className="text-sm font-semibold text-center" style={{ color: isMe ? "#FFD700" : "#f4f4f8" }}>
        {row.league_members?.team_name ?? "Unknown"}
        {isMe && <span className="ml-1 text-xs font-normal text-white">(you)</span>}
      </p>
      <p
        className="text-3xl font-bold tabular-nums"
        style={{ color: isWinner ? color : "#f4f4f8" }}
      >
        {row.points.toFixed(2)}
      </p>
      {row.projected != null && !row.is_complete && (
        <p className="text-xs tabular-nums" style={{ color: "#f4f4f8" }}>
          proj {row.projected.toFixed(2)}
        </p>
      )}
      {isWinner && row.is_complete && (
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
          Winner
        </p>
      )}
      {medianScoring && row.is_complete && (
        <p
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: row.median_win ? "#3DDC84" : "#CC0000" }}
        >
          {row.median_win ? "↑ Beat Median" : "↓ Lost to Median"}
        </p>
      )}
      {token && (
        <div className="mt-1 flex flex-col items-center gap-0.5">
          <div
            className="flex items-center gap-1 rounded-full px-2 py-0.5"
            style={{
              background: token.status === "used" ? "rgba(61,220,132,0.12)" : "rgba(255,215,0,0.1)",
              border: `1px solid ${token.status === "used" ? "#3DDC84" : "#FFD700"}33`,
            }}
          >
            <span className="text-xs">⚡</span>
            <span
              className="text-xs font-semibold"
              style={{ color: token.status === "used" ? "#3DDC84" : "#FFD700" }}
            >
              {TOKEN_NAMES[token.tokenId] ?? `Token ${token.tokenId}`}
            </span>
          </div>
          {row.token_bonus > 0 && (
            <p className="text-xs tabular-nums" style={{ color: token.status === "used" ? "#3DDC84" : "#FFD700" }}>
              +{row.token_bonus.toFixed(2)} pts
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function MatchupView({
  leagueId,
  week,
  matchupPairs: initialPairs,
  myMemberId,
  tokenMap = {},
  medianScoring = false,
}: {
  leagueId: string;
  week: number;
  matchupPairs: MatchupPair[];
  myMemberId: string;
  tokenMap?: Record<string, { tokenId: number; status: string }>;
  medianScoring?: boolean;
}) {
  const [pairs, setPairs] = useState<MatchupPair[]>(initialPairs);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Preview state: matchup_id → { preview, loading, error }
  const [previewState, setPreviewState] = useState<Record<number, { preview?: string; loading: boolean; error?: string }>>({});
  // Oracle state: matchup_id → { recap, loading, error }
  const [oracleState, setOracleState] = useState<Record<number, { recap?: string; loading: boolean; error?: string }>>(() => {
    // Pre-populate from server-fetched recaps
    const init: Record<number, { recap?: string; loading: boolean; error?: string }> = {};
    for (const pair of initialPairs) {
      const first = pair[0];
      if (first?.oracle_recap) init[first.matchup_id] = { recap: first.oracle_recap, loading: false };
    }
    return init;
  });

  // Breakdown state: matchup_id → { data, loading, error }
  const [breakdownState, setBreakdownState] = useState<Record<number, { data?: BreakdownData; loading: boolean; error?: string }>>({});

  async function getBreakdown(matchup_id: number, matchupWeek: number, member_a_id: string, member_b_id: string) {
    setBreakdownState(prev => ({ ...prev, [matchup_id]: { loading: true } }));
    try {
      const res = await fetch("/api/matchup-breakdown", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ league_id: leagueId, week: matchupWeek, member_a_id, member_b_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load breakdown");
      setBreakdownState(prev => ({ ...prev, [matchup_id]: { data, loading: false } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setBreakdownState(prev => ({ ...prev, [matchup_id]: { loading: false, error: msg } }));
    }
  }

  async function getPreview(matchup_id: number) {
    setPreviewState((prev) => ({ ...prev, [matchup_id]: { loading: true } }));
    try {
      const res = await fetch("/api/matchup-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchup_id, league_id: leagueId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreviewState((prev) => ({ ...prev, [matchup_id]: { preview: data.preview, loading: false } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setPreviewState((prev) => ({ ...prev, [matchup_id]: { loading: false, error: msg } }));
    }
  }

  async function consultOracle(matchup_id: number) {
    setOracleState((prev) => ({ ...prev, [matchup_id]: { loading: true } }));
    try {
      const res = await fetch("/api/oracle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchup_id, league_id: leagueId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Oracle failed");
      setOracleState((prev) => ({ ...prev, [matchup_id]: { recap: data.recap, loading: false } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setOracleState((prev) => ({ ...prev, [matchup_id]: { loading: false, error: msg } }));
    }
  }

  useEffect(() => {
    if (initialPairs.length === 0) return; // no matchups this week — skip subscription
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
                return {
                  ...row,
                  points: payload.new.points,
                  projected: payload.new.projected ?? row.projected,
                  token_bonus: payload.new.token_bonus ?? row.token_bonus,
                  is_complete: payload.new.is_complete,
                  oracle_recap: payload.new.oracle_recap ?? row.oracle_recap,
                  median_win: payload.new.median_win ?? row.median_win,
                };
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
      <p className="rounded-lg border p-5 text-sm text-white" style={{ borderColor: "#2a2a40" }}>
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
          <p className="text-xs" style={{ color: "#f4f4f8" }}>
            Live &middot; updated {lastUpdated.toLocaleTimeString()}
          </p>
        )}
        {!lastUpdated && (
          <p className="text-xs" style={{ color: "#f4f4f8" }}>Live &middot; scores update every ~15 min during games</p>
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
                <ScoreCard row={a} isMe={a.member_id === myMemberId} isWinner={aWins} token={tokenMap[a.member_id]} medianScoring={medianScoring} />
                <div className="flex flex-col items-center justify-center px-1">
                  <span className="text-sm font-bold" style={{ color: "#f4f4f8" }}>vs</span>
                </div>
                <ScoreCard row={b} isMe={b.member_id === myMemberId} isWinner={bWins} token={tokenMap[b.member_id]} medianScoring={medianScoring} />
              </div>
              {a.is_complete && (
                <p className="mt-2 text-center text-xs" style={{ color: "#f4f4f8" }}>Final</p>
              )}
              {!a.is_complete && (() => {
                const pv = previewState[a.matchup_id];
                if (pv?.preview) {
                  return (
                    <div
                      className="mt-3 rounded-lg border px-4 py-3"
                      style={{ borderColor: "#0057FF33", background: "rgba(0,87,255,0.04)" }}
                    >
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color: "#0057FF" }}>
                        🔭 Oracle&apos;s Pre-Game Vision
                      </p>
                      <p className="text-sm leading-relaxed" style={{ color: "#d4d4e8", fontStyle: "italic" }}>
                        {pv.preview}
                      </p>
                    </div>
                  );
                }
                if (pv?.loading) {
                  return (
                    <div className="mt-3 flex items-center justify-center gap-2 py-2">
                      <span className="text-sm">🔭</span>
                      <span className="text-xs" style={{ color: "#0057FF" }}>The Oracle gazes into this week&apos;s battle…</span>
                    </div>
                  );
                }
                return (
                  <div className="mt-3 flex flex-col items-center gap-1.5">
                    {pv?.error && (
                      <p className="text-xs" style={{ color: "#ff8a8a" }}>{pv.error}</p>
                    )}
                    <button
                      onClick={() => getPreview(a.matchup_id)}
                      className="rounded-full px-4 py-1.5 text-xs font-semibold transition hover:opacity-80"
                      style={{ background: "rgba(0,87,255,0.1)", color: "#0057FF", border: "1px solid #0057FF33" }}
                    >
                      🔭 Oracle Pre-Game Preview
                    </button>
                  </div>
                );
              })()}
              {a.is_complete && (() => {
                const oracle = oracleState[a.matchup_id];
                if (oracle?.recap) {
                  return (
                    <div
                      className="mt-3 rounded-lg border px-4 py-3"
                      style={{ borderColor: "#FFD70033", background: "rgba(255,215,0,0.04)" }}
                    >
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color: "#FFD700" }}>
                        🔮 Oracle&apos;s Vision
                      </p>
                      <p className="text-sm leading-relaxed" style={{ color: "#d4d4e8", fontStyle: "italic" }}>
                        {oracle.recap}
                      </p>
                    </div>
                  );
                }
                if (oracle?.loading) {
                  return (
                    <div className="mt-3 flex items-center justify-center gap-2 py-2">
                      <span className="text-sm" style={{ color: "#FFD700" }}>🔮</span>
                      <span className="text-xs" style={{ color: "#FFD700" }}>The Oracle peers into the void…</span>
                    </div>
                  );
                }
                return (
                  <div className="mt-3 flex flex-col items-center gap-1.5">
                    {oracle?.error && (
                      <p className="text-xs" style={{ color: "#ff8a8a" }}>{oracle.error}</p>
                    )}
                    <button
                      onClick={() => consultOracle(a.matchup_id)}
                      className="rounded-full px-4 py-1.5 text-xs font-semibold transition hover:opacity-80"
                      style={{ background: "rgba(255,215,0,0.1)", color: "#FFD700", border: "1px solid #FFD70033" }}
                    >
                      🔮 Consult the Oracle
                    </button>
                  </div>
                );
              })()}

              {/* ── Score Breakdown ── */}
              {(() => {
                const bd = breakdownState[a.matchup_id];
                if (bd?.data) {
                  const noData = !bd.data.hasData || (bd.data.a.players.length === 0 && bd.data.b.players.length === 0);
                  return (
                    <div className="mt-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#8888aa" }}>
                          📊 Score Breakdown
                        </p>
                        <button
                          onClick={() => setBreakdownState(prev => ({ ...prev, [a.matchup_id]: { loading: false } }))}
                          className="text-xs"
                          style={{ color: "#8888aa" }}
                        >
                          Hide
                        </button>
                      </div>
                      {noData ? (
                        <p className="text-xs text-center py-2" style={{ color: "#8888aa" }}>
                          No lineup data available for this week.
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 rounded-lg border p-3" style={{ borderColor: "#2a2a40" }}>
                          {/* Team A */}
                          <div className="flex flex-col gap-1.5">
                            <p className="text-xs font-semibold truncate" style={{ color: factionColor(pairs.flat().find(r => r.member_id === a.member_id)?.league_members?.faction ?? null) }}>
                              {bd.data.a.team_name}
                            </p>
                            {bd.data.a.players.map(p => (
                              <div key={p.player_id} className="flex items-center gap-1.5 text-xs">
                                <span className="shrink-0 w-6 rounded text-center font-bold text-xs leading-4"
                                  style={{ background: "#1c1c2b", color: "#8888aa" }}>
                                  {p.pos}
                                </span>
                                <span className="flex-1 truncate" style={{ color: "#d4d4e8" }}>{p.name}</span>
                                <span className="shrink-0 font-bold tabular-nums" style={{ color: p.points > 0 ? "#f4f4f8" : "#8888aa" }}>
                                  {p.points.toFixed(2)}
                                </span>
                              </div>
                            ))}
                          </div>
                          {/* Team B */}
                          <div className="flex flex-col gap-1.5">
                            <p className="text-xs font-semibold truncate" style={{ color: factionColor(pairs.flat().find(r => r.member_id === b.member_id)?.league_members?.faction ?? null) }}>
                              {bd.data.b.team_name}
                            </p>
                            {bd.data.b.players.map(p => (
                              <div key={p.player_id} className="flex items-center gap-1.5 text-xs">
                                <span className="shrink-0 w-6 rounded text-center font-bold text-xs leading-4"
                                  style={{ background: "#1c1c2b", color: "#8888aa" }}>
                                  {p.pos}
                                </span>
                                <span className="flex-1 truncate" style={{ color: "#d4d4e8" }}>{p.name}</span>
                                <span className="shrink-0 font-bold tabular-nums" style={{ color: p.points > 0 ? "#f4f4f8" : "#8888aa" }}>
                                  {p.points.toFixed(2)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <div className="mt-2 flex flex-col items-center gap-1">
                    {bd?.error && <p className="text-xs" style={{ color: "#ff8a8a" }}>{bd.error}</p>}
                    <button
                      onClick={() => getBreakdown(a.matchup_id, a.week, a.member_id, b.member_id)}
                      disabled={bd?.loading}
                      className="rounded-full px-4 py-1.5 text-xs font-semibold transition hover:opacity-80 disabled:opacity-50"
                      style={{ background: "rgba(136,136,170,0.1)", color: "#8888aa", border: "1px solid #2a2a4066" }}
                    >
                      {bd?.loading ? "Loading…" : "📊 Score Breakdown"}
                    </button>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
