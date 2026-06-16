"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { makeDraftPick } from "./actions";

// Module-level singleton — avoids recreating the client on every render
const supabase = createClient();

interface Player {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  status: string | null;
}

interface Pick {
  id: string;
  round: number;
  pick_no: number;
  member_id: string;
  player_id: string;
  picked_at: string;
  players: { full_name: string; position: string | null; team: string | null } | null;
}

interface Member {
  id: string;
  team_name: string;
  faction: "hero" | "villain" | null;
  user_id: string;
  profiles: { display_name: string | null; username: string } | null;
}

interface League {
  id: string;
  name: string;
  draft_status: string;
  draft_order: string[];
  max_teams: number;
  draft_rounds: number;
}

interface PowerRow {
  round: number;
  draft_powers: { id: number; name: string; category: string | null; description: string } | null;
}

// "DEF" is the actual position value in the players table (not "DST")
const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

function snakeDraftSlot(pickNo: number, maxTeams: number): number {
  const round = Math.ceil(pickNo / maxTeams);
  const posInRound = pickNo - (round - 1) * maxTeams;
  return round % 2 === 1 ? posInRound : maxTeams - posInRound + 1;
}

export default function DraftRoom({
  league,
  members,
  myMemberId,
  initialPicks,
  myPowers,
}: {
  league: League;
  members: Member[];
  myMemberId: string;
  initialPicks: Pick[];
  myPowers: PowerRow[];
}) {
  const [picks, setPicks] = useState<Pick[]>(initialPicks);
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState(league.draft_status);
  const leagueId = league.id;

  // ── Poll for new picks every 5s ──────────────────────────────────────
  const fetchPicks = async () => {
    const { data } = await supabase
      .from("uff_draft_picks")
      .select("id, round, pick_no, member_id, player_id, picked_at, players(full_name, position, team)")
      .eq("league_id", leagueId)
      .order("pick_no", { ascending: true });
    if (data) setPicks(data as Pick[]);

    const { data: leagueRow } = await supabase
      .from("uff_leagues")
      .select("draft_status")
      .eq("id", leagueId)
      .maybeSingle();
    if (leagueRow) setDraftStatus(leagueRow.draft_status);
  };

  useEffect(() => {
    const interval = setInterval(fetchPicks, 5000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // ── Fetch players on search / position change ──────────────────────
  useEffect(() => {
    const fetchPlayers = async () => {
      const hasSearch = search.trim().length >= 2;
      const hasPos = posFilter !== "ALL";

      if (!hasSearch && !hasPos) {
        setPlayers([]);
        return;
      }

      let q = supabase
        .from("players")
        .select("id, full_name, position, team, status")
        .not("position", "is", null);

      if (hasSearch) q = q.ilike("full_name", `%${search.trim()}%`);
      if (hasPos) q = q.eq("position", posFilter);

      const { data } = await q.order("full_name").limit(60);
      setPlayers((data as Player[]) ?? []);
    };

    const timer = setTimeout(fetchPlayers, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, posFilter]);

  // ── Derived state ────────────────────────────────────────────────────
  const totalPicks = league.max_teams * league.draft_rounds;
  const isDraftComplete = draftStatus === "completed" || picks.length >= totalPicks;

  const currentPickNo = picks.length + 1;
  const currentRound = Math.ceil(currentPickNo / league.max_teams);
  const slot = snakeDraftSlot(currentPickNo, league.max_teams);
  const currentMemberId = isDraftComplete ? null : (league.draft_order[slot - 1] ?? null);
  const isMyTurn = !isDraftComplete && currentMemberId === myMemberId;
  const currentMember = members.find((m) => m.id === currentMemberId);
  const myPowerThisRound = myPowers.find((p) => p.round === currentRound);
  const memberMap = Object.fromEntries(members.map((m) => [m.id, m]));
  const pickedIds = new Set(picks.map((p) => p.player_id));
  const availablePlayers = players.filter((p) => !pickedIds.has(p.id));

  // ── Pick handler ─────────────────────────────────────────────────────
  async function handlePick(playerId: string) {
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("leagueId", leagueId);
      fd.append("playerId", playerId);
      const result = await makeDraftPick(fd);
      if (result?.error) {
        setError(result.error);
      } else {
        setSuccess("Pick submitted!");
        await fetchPicks();
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <div className="mx-auto max-w-5xl flex flex-col gap-6">

        {/* Header */}
        <header className="flex flex-col gap-1">
          <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            Ultimate Fantasy Football
          </p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            Draft Room
          </h1>
          <p className="text-sm text-zinc-400">
            {isDraftComplete
              ? `Draft complete — all ${totalPicks} picks locked in.`
              : `Round ${currentRound} of ${league.draft_rounds} · Pick ${picks.length + 1} of ${totalPicks}`}
          </p>
        </header>

        {/* Turn banner */}
        {!isDraftComplete && (
          <div
            className="rounded-lg border px-5 py-4"
            style={{
              borderColor: isMyTurn ? "#FFD700" : "#2a2a40",
              background: isMyTurn ? "rgba(255,215,0,0.07)" : "#15151f",
            }}
          >
            {isMyTurn ? (
              <div className="flex flex-col gap-1">
                <p className="font-semibold" style={{ color: "#FFD700" }}>
                  🎯 It&rsquo;s your turn — pick now!
                </p>
                {myPowerThisRound?.draft_powers && (
                  <p className="text-sm text-zinc-400">
                    Your power this round:{" "}
                    <span className="font-semibold" style={{ color: "#f4f4f8" }}>
                      {myPowerThisRound.draft_powers.name}
                    </span>
                    <span className="ml-1 text-xs" style={{ color: "#8a8a9a" }}>
                      — {myPowerThisRound.draft_powers.description}
                    </span>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">
                Waiting on{" "}
                <span className="font-semibold" style={{ color: "#f4f4f8" }}>
                  {currentMember?.team_name ?? "another manager"}
                </span>{" "}
                to pick&hellip;
              </p>
            )}
          </div>
        )}

        {isDraftComplete && (
          <div
            className="rounded-lg border px-5 py-4 text-center"
            style={{ borderColor: "#FFD700", background: "rgba(255,215,0,0.06)" }}
          >
            <p className="font-semibold" style={{ color: "#FFD700" }}>
              Draft complete! Your roster is set.
            </p>
            <Link
              href={`/dashboard/league/${leagueId}/roster`}
              className="mt-2 inline-block text-sm underline"
              style={{ color: "#0057FF" }}
            >
              View My Team &rarr;
            </Link>
          </div>
        )}

        {/* Error / success banners */}
        {error && (
          <p
            className="rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}
          >
            {error}
          </p>
        )}
        {success && (
          <p
            className="rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}
          >
            {success}
          </p>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">

          {/* Left: player search */}
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
              Available Players
            </h2>

            {/* Search + position filter */}
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
                    className="rounded px-3 py-1.5 text-xs font-semibold transition"
                    style={{
                      background: posFilter === pos ? "#0057FF" : "#1c1c2b",
                      color: posFilter === pos ? "#f4f4f8" : "#8a8a9a",
                    }}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            {/* Player list */}
            <div className="flex flex-col gap-1 max-h-[480px] overflow-y-auto pr-1">
              {search.trim().length === 0 && posFilter === "ALL" && (
                <p className="py-8 text-center text-sm text-zinc-500">
                  Search by name or select a position to browse available players.
                </p>
              )}
              {(search.trim().length > 0 || posFilter !== "ALL") && availablePlayers.length === 0 && (
                <p className="py-8 text-center text-sm text-zinc-500">No available players match your search.</p>
              )}
              {availablePlayers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                  style={{ borderColor: "#2a2a40" }}
                >
                  <div>
                    <p className="text-sm font-semibold">{p.full_name}</p>
                    <p className="text-xs text-zinc-500">
                      {p.position ?? "?"} &middot; {p.team ?? "FA"}
                      {p.status && p.status !== "Active" ? ` · ${p.status}` : ""}
                    </p>
                  </div>
                  {isMyTurn && (
                    <button
                      onClick={() => handlePick(p.id)}
                      disabled={submitting}
                      className="ml-3 shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                      style={{ background: "#0057FF", color: "#f4f4f8" }}
                    >
                      {submitting ? "…" : "Draft"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Right: draft board */}
          <aside className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
              Draft Board{" "}
              <span className="text-sm font-normal text-zinc-500">
                ({picks.length} / {totalPicks})
              </span>
            </h2>

            {/* Draft order strip */}
            <div className="flex flex-col gap-1">
              <p className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Pick order (round 1)</p>
              {league.draft_order.map((memberId, idx) => {
                const m = memberMap[memberId];
                return (
                  <div key={memberId} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-right text-xs text-zinc-600">{idx + 1}.</span>
                    <span style={{ color: memberId === myMemberId ? "#FFD700" : "#f4f4f8" }}>
                      {m?.team_name ?? memberId}
                      {memberId === myMemberId && <span className="ml-1 text-xs text-zinc-500">(you)</span>}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Recent picks */}
            <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto border-t pt-4" style={{ borderColor: "#2a2a40" }}>
              <p className="text-xs uppercase tracking-wide text-zinc-500">Recent picks</p>
              {picks.length === 0 && <p className="text-sm text-zinc-600">No picks yet.</p>}
              {[...picks].reverse().map((pick) => {
                const m = memberMap[pick.member_id];
                const isMe = pick.member_id === myMemberId;
                return (
                  <div
                    key={pick.id}
                    className="rounded-lg border px-3 py-2"
                    style={{
                      borderColor: isMe ? "#0057FF" : "#2a2a40",
                      background: isMe ? "rgba(0,87,255,0.06)" : "transparent",
                    }}
                  >
                    <p className="text-xs text-zinc-500">
                      R{pick.round} · #{pick.pick_no}
                    </p>
                    <p className="text-sm font-semibold">
                      {pick.players?.full_name ?? pick.player_id}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {pick.players?.position ?? "?"} &middot; {pick.players?.team ?? "FA"} &rarr;{" "}
                      {m?.team_name ?? "?"}
                    </p>
         