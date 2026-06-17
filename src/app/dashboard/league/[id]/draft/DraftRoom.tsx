"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { makeDraftPick, assignPowerToPick, assignVampireBite } from "./actions";
import { startDraft } from "../actions";

const supabase = createClient();

interface Player {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  status: string | null;
  adp: number | null;
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
  draft_powers: {
    id: number;
    name: string;
    category: string | null;
    description: string;
    tied_position: string | null;
  } | null;
}

type PowerResultType = "applied" | "fizzled" | "meta" | "error";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

const POS_COLORS: Record<string, string> = {
  QB: "#FF6B35",
  RB: "#3DDC84",
  WR: "#0057FF",
  TE: "#FFD700",
  K: "#a78bfa",
  DEF: "#CC0000",
};

// Pick number for a given (round, col) in a snake draft.
// col is 1-indexed draft-order position = display column index.
function pickNoForCell(round: number, col: number, maxTeams: number): number {
  const pickInRound = round % 2 === 1 ? col : maxTeams - col + 1;
  return (round - 1) * maxTeams + pickInRound;
}

// Given a pick_no, which 1-indexed column in the display grid owns it?
function snakeDraftSlot(pickNo: number, maxTeams: number): number {
  const round = Math.ceil(pickNo / maxTeams);
  const posInRound = pickNo - (round - 1) * maxTeams;
  return round % 2 === 1 ? posInRound : maxTeams - posInRound + 1;
}

function lastName(fullName: string): string {
  const parts = fullName.trim().split(" ");
  return parts[parts.length - 1] ?? fullName;
}

// ---- Vampire Bite modal -------------------------------------------------------
function VampireBiteModal({
  picks,
  memberMap,
  onSelect,
  onSkip,
  submitting,
}: {
  picks: Pick[];
  memberMap: Record<string, Member>;
  onSelect: (playerId: string) => void;
  onSkip: () => void;
  submitting: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  const filteredPicks = picks.filter((p) => {
    if (!p.players) return false;
    if (!search.trim()) return true;
    return p.players.full_name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)" }}>
      <div
        className="relative mx-4 flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border p-6"
        style={{ background: "#0d0d1a", borderColor: "#CC0000" }}
      >
        <div className="mb-4">
          <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "#CC0000" }}>
            Vampire Bite
          </p>
          <h2 className="mt-1 text-xl font-bold" style={{ color: "#f4f4f8" }}>
            Choose your target
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            10% of their weekly score drains to you every week, all season.
          </p>
        </div>

        <input
          type="text"
          placeholder="Search drafted players..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-3 w-full rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
        />

        <div className="min-h-0 max-h-[40vh] flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
          {filteredPicks.length === 0 && (
            <p className="py-4 text-center text-sm text-zinc-500">No players match.</p>
          )}
          {filteredPicks.map((pick) => {
            const isSelected = selected?.id === pick.player_id;
            const owner = memberMap[pick.member_id];
            return (
              <button
                key={pick.id}
                onClick={() => setSelected({ id: pick.player_id, name: pick.players?.full_name ?? "" })}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-left transition"
                style={{
                  borderColor: isSelected ? "#CC0000" : "#2a2a40",
                  background: isSelected ? "rgba(204,0,0,0.12)" : "#15151f",
                }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>
                    {pick.players?.full_name ?? pick.player_id}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {pick.players?.position ?? "?"} - {pick.players?.team ?? "FA"} - {owner?.team_name ?? "?"}
                  </p>
                </div>
                {isSelected && (
                  <span className="ml-2 shrink-0 text-xs font-bold" style={{ color: "#CC0000" }}>
                    LOCKED
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex gap-3">
          <button
            onClick={() => selected && onSelect(selected.id)}
            disabled={!selected || submitting}
            className="flex-1 rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: "#CC0000", color: "#f4f4f8" }}
          >
            {submitting ? "Biting..." : selected ? `Bite ${selected.name.split(" ")[0]}` : "Select a target"}
          </button>
          <button
            onClick={onSkip}
            disabled={submitting}
            className="rounded-md px-4 py-2.5 text-sm disabled:opacity-40"
            style={{ background: "#1c1c2b", color: "#8a8a9a" }}
          >
            Skip
          </button>
        </div>
        <p className="mt-2 text-center text-xs" style={{ color: "#8a8a9a" }}>
          Skipping forfeits your Vampire Bite permanently.
        </p>
      </div>
    </div>
  );
}

// ---- Full 2-D draft board ----------------------------------------------------
function DraftBoardGrid({
  picks,
  league,
  memberMap,
  myMemberId,
  currentPickNo,
  isDraftComplete,
}: {
  picks: Pick[];
  league: League;
  memberMap: Record<string, Member>;
  myMemberId: string;
  currentPickNo: number;
  isDraftComplete: boolean;
}) {
  const pickByNo: Record<number, Pick> = {};
  for (const p of picks) pickByNo[p.pick_no] = p;
  const totalPicks = league.max_teams * league.draft_rounds;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
          Draft Board
        </h2>
        <span className="text-sm text-zinc-500">
          {picks.length} / {totalPicks} picks
          {isDraftComplete && " -- Final"}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "#2a2a40" }}>
        <table
          className="border-collapse"
          style={{ minWidth: `${48 + league.max_teams * 96}px`, fontSize: "11px" }}
        >
          <thead>
            <tr style={{ background: "#15151f" }}>
              <th
                className="border px-2 py-2 text-left font-normal text-zinc-500"
                style={{ borderColor: "#2a2a40", minWidth: "36px" }}
              >
                Rd
              </th>
              {league.draft_order.map((memberId, idx) => {
                const m = memberMap[memberId];
                const isMe = memberId === myMemberId;
                return (
                  <th
                    key={memberId}
                    className="border px-2 py-2 text-left"
                    style={{
                      borderColor: "#2a2a40",
                      color: isMe ? "#0057FF" : "#c4c4d0",
                      minWidth: "88px",
                      maxWidth: "110px",
                      fontWeight: isMe ? 700 : 500,
                    }}
                  >
                    <span className="block truncate" title={m?.team_name ?? `Team ${idx + 1}`}>
                      {m?.team_name ?? `T${idx + 1}`}
                    </span>
                    <span className="block font-normal" style={{ fontSize: "9px", color: "#8a8a9a" }}>
                      Pick {idx + 1}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: league.draft_rounds }, (_, ri) => {
              const round = ri + 1;
              const isEven = round % 2 === 0;
              const rowBg = ri % 2 === 0 ? "#0d0d1a" : "#0f0f1e";
              return (
                <tr key={round}>
                  <td
                    className="border px-2 py-1 text-zinc-500"
                    style={{ borderColor: "#2a2a40", background: rowBg, whiteSpace: "nowrap" }}
                  >
                    {round}
                    <span className="ml-0.5 opacity-30" style={{ fontSize: "9px" }}>
                      {isEven ? "<" : ">"}
                    </span>
                  </td>
                  {Array.from({ length: league.max_teams }, (_, ci) => {
                    const col = ci + 1;
                    const pickNo = pickNoForCell(round, col, league.max_teams);
                    const pick = pickByNo[pickNo];
                    const isCurrent = !isDraftComplete && pickNo === currentPickNo;
                    const isMe = pick?.member_id === myMemberId;

                    let bg = rowBg;
                    let borderC = "#2a2a40";
                    if (isCurrent) {
                      bg = "rgba(255,215,0,0.12)";
                      borderC = "#FFD700";
                    } else if (isMe && pick) {
                      bg = "rgba(0,87,255,0.1)";
                    }

                    const pos = pick?.players?.position ?? "";
                    const posColor = POS_COLORS[pos] ?? "#8a8a9a";

                    return (
                      <td
                        key={ci}
                        className="border px-2 py-1.5 align-top"
                        style={{ borderColor: borderC, background: bg, maxWidth: "110px" }}
                      >
                        {pick ? (
                          <div>
                            <p
                              className="truncate font-semibold leading-tight"
                              style={{ color: isMe ? "#8ab4ff" : "#e0e0ea" }}
                              title={pick.players?.full_name ?? ""}
                            >
                              {lastName(pick.players?.full_name ?? "?")}
                            </p>
                            <p style={{ color: posColor, fontSize: "9px", marginTop: "1px" }}>
                              {pos} {pick.players?.team ? `- ${pick.players.team}` : ""}
                            </p>
                          </div>
                        ) : isCurrent ? (
                          <p
                            className="font-bold uppercase"
                            style={{ color: "#FFD700", fontSize: "9px", letterSpacing: "0.05em" }}
                          >
                            On Clock
                          </p>
                        ) : pickNo <= totalPicks ? (
                          <p style={{ color: "#2a2a40", fontSize: "9px" }}>{pickNo}</p>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- Pre-draft lobby ---------------------------------------------------------
function PreDraftLobby({
  league,
  members,
  myMemberId,
  isCommissioner,
}: {
  league: League;
  members: Member[];
  myMemberId: string;
  isCommissioner: boolean;
}) {
  const allFactionsSet = members.every((m) => m.faction !== null);
  const unassigned = members.filter((m) => m.faction === null).length;

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <div className="mx-auto max-w-2xl flex flex-col gap-8">
        <header className="flex flex-col gap-1">
          <Link href={`/dashboard/league/${league.id}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league.name}
          </Link>
          <p className="text-xs uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            Ultimate Fantasy Football
          </p>
          <h1 className="text-3xl font-bold" style={{ color: "#0057FF" }}>
            Draft Lobby
          </h1>
          <p className="text-sm text-zinc-400">
            {members.length} / {league.max_teams} managers
          </p>
        </header>

        <div className="flex flex-col gap-2">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-lg border px-4 py-3"
              style={{
                borderColor: m.id === myMemberId ? "#0057FF" : "#2a2a40",
                background: m.id === myMemberId ? "rgba(0,87,255,0.06)" : "#15151f",
              }}
            >
              <div>
                <p className="font-semibold" style={{ color: "#f4f4f8" }}>
                  {m.team_name}
                  {m.id === myMemberId && (
                    <span className="ml-2 text-xs text-zinc-500">(you)</span>
                  )}
                </p>
                <p className="text-xs text-zinc-500">
                  {m.profiles?.display_name ?? m.profiles?.username ?? "Unknown"}
                </p>
              </div>
              {m.faction ? (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
                  style={{
                    background: m.faction === "hero" ? "rgba(0,87,255,0.15)" : "rgba(204,0,0,0.15)",
                    color: m.faction === "hero" ? "#0057FF" : "#CC0000",
                  }}
                >
                  {m.faction}
                </span>
              ) : (
                <span className="text-xs" style={{ color: "#8a8a9a" }}>No faction</span>
              )}
            </div>
          ))}
        </div>

        {isCommissioner ? (
          <div
            className="flex flex-col gap-3 rounded-lg border p-5"
            style={{ borderColor: allFactionsSet ? "#FFD700" : "#2a2a40" }}
          >
            <h2 className="font-semibold" style={{ color: "#FFD700" }}>
              Commissioner Controls
            </h2>
            {allFactionsSet ? (
              <>
                <p className="text-sm text-zinc-400">
                  All managers have factions. Ready to start the draft.
                </p>
                <form action={startDraft}>
                  <input type="hidden" name="leagueId" value={league.id} />
                  <button
                    type="submit"
                    className="rounded-md px-5 py-2.5 text-sm font-bold"
                    style={{ background: "#FFD700", color: "#0d0d1a" }}
                  >
                    Start Draft
                  </button>
                </form>
              </>
            ) : (
              <p className="text-sm text-zinc-400">
                {unassigned} manager{unassigned !== 1 ? "s" : ""} still need
                {unassigned === 1 ? "s" : ""} a faction.
                Go back to the league page to randomize.
              </p>
            )}
          </div>
        ) : (
          <div
            className="rounded-lg border px-5 py-4 text-center"
            style={{ borderColor: "#2a2a40", background: "#15151f" }}
          >
            <p className="text-sm text-zinc-400">
              Waiting for the commissioner to start the draft...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Main DraftRoom component ------------------------------------------------
export default function DraftRoom({
  league,
  members,
  myMemberId,
  isCommissioner,
  initialPicks,
  myPowers,
}: {
  league: League;
  members: Member[];
  myMemberId: string;
  isCommissioner: boolean;
  initialPicks: Pick[];
  myPowers: PowerRow[];
}) {
  const leagueId = league.id;

  // ---- All state (must be declared before any early returns) -----------------
  const [picks, setPicks] = useState<Pick[]>(initialPicks);
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState(league.draft_status);
  const [powerResult, setPowerResult] = useState<{ type: PowerResultType; message: string } | null>(null);
  const [showVampireBiteModal, setShowVampireBiteModal] = useState(false);
  const [vampireSubmitting, setVampireSubmitting] = useState(false);

  // ---- isDraftComplete (computed early so effects can guard on it) -----------
  const totalPicksEarly = league.max_teams * league.draft_rounds;
  const isDraftComplete = draftStatus === "completed" || picks.length >= totalPicksEarly;

  // ---- fetchPicks (used in effect below) -------------------------------------
  const fetchPicks = useCallback(async () => {
    const { data } = await supabase
      .from("uff_draft_picks")
      .select("id, round, pick_no, member_id, player_id, picked_at, players(full_name, position, team)")
      .eq("league_id", leagueId)
      .order("pick_no", { ascending: true });
    if (data) setPicks(data as unknown as Pick[]);

    const { data: leagueRow } = await supabase
      .from("uff_leagues")
      .select("draft_status")
      .eq("id", leagueId)
      .maybeSingle();
    if (leagueRow) setDraftStatus(leagueRow.draft_status);
  }, [leagueId]);

  // ---- All effects (must be before any conditional returns) ------------------
  useEffect(() => {
    if (isDraftComplete) return; // stop polling once draft is done
    const interval = setInterval(fetchPicks, 5000);
    return () => clearInterval(interval);
  }, [fetchPicks, isDraftComplete]);

  useEffect(() => {
    const fetchPlayers = async () => {
      const hasSearch = search.trim().length >= 2;
      const hasPos = posFilter !== "ALL";

      let q = supabase
        .from("players")
        .select("id, full_name, position, team, status, adp")
        .not("position", "is", null);

      if (hasSearch) q = q.ilike("full_name", `%${search.trim()}%`);
      if (hasPos) q = q.eq("position", posFilter);

      // Default (ALL + no search): show top 60 by ADP
      const { data } = await q.order("adp", { ascending: true, nullsFirst: false }).limit(60);
      setPlayers((data as Player[]) ?? []);
    };

    const timer = setTimeout(fetchPlayers, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, posFilter]);

  // ---- Early return: pre-draft lobby -----------------------------------------
  if (draftStatus === "not_started") {
    return (
      <PreDraftLobby
        league={league}
        members={members}
        myMemberId={myMemberId}
        isCommissioner={isCommissioner}
      />
    );
  }

  // ---- Derived state ---------------------------------------------------------
  const totalPicks = totalPicksEarly; // already computed above
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

  // ---- Pick handler ----------------------------------------------------------
  async function handlePick(playerId: string, playerPosition: string) {
    setError(null);
    setPowerResult(null);
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
        setTimeout(() => setSuccess(null), 4000);

        if (myPowerThisRound?.draft_powers) {
          const dp = myPowerThisRound.draft_powers;
          const pr = await assignPowerToPick({
            leagueId,
            playerId,
            playerPosition,
            powerName: dp.name,
            powerCategory: dp.category ?? "",
            powerTiedPosition: dp.tied_position,
            round: currentRound,
          });

          if (pr.result === "vampire_bite") {
            setShowVampireBiteModal(true);
          } else {
            setPowerResult({ type: pr.result as PowerResultType, message: pr.message });
            setTimeout(() => setPowerResult(null), 6000);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Vampire Bite handler --------------------------------------------------
  async function handleVampireBite(targetPlayerId: string) {
    setVampireSubmitting(true);
    const result = await assignVampireBite({ leagueId, targetPlayerId, round: currentRound });
    setVampireSubmitting(false);
    setShowVampireBiteModal(false);
    if (result.error) {
      setError(result.error);
    } else {
      setPowerResult({ type: "applied", message: "Vampire Bite locked in -- 10% of their weekly score is yours all season." });
      setTimeout(() => setPowerResult(null), 6000);
    }
  }

  function powerBannerStyle(type: PowerResultType): React.CSSProperties {
    if (type === "applied")  return { borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" };
    if (type === "fizzled")  return { borderColor: "#FFD700", color: "#FFD700", background: "#1a190a" };
    if (type === "meta")     return { borderColor: "#0057FF", color: "#8ab4ff", background: "#0a0e1a" };
    return { borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" };
  }

  // ---- Render ----------------------------------------------------------------
  return (
    <div className="min-h-screen px-4 py-8 sm:px-8" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      {showVampireBiteModal && (
        <VampireBiteModal
          picks={picks}
          memberMap={memberMap}
          onSelect={handleVampireBite}
          onSkip={() => {
            setShowVampireBiteModal(false);
            setPowerResult({ type: "fizzled", message: "Vampire Bite skipped -- power forfeited." });
            setTimeout(() => setPowerResult(null), 5000);
          }}
          submitting={vampireSubmitting}
        />
      )}

      <div className="mx-auto max-w-6xl flex flex-col gap-6">

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
              ? `Draft complete -- all ${totalPicks} picks locked in.`
              : `Round ${currentRound} of ${league.draft_rounds} - Pick ${picks.length + 1} of ${totalPicks}`}
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
              <div className="flex flex-col gap-2">
                <p className="font-semibold" style={{ color: "#FFD700" }}>
                  It&rsquo;s your turn -- pick now!
                </p>
                {myPowerThisRound?.draft_powers && (
                  <div className="rounded-md border px-3 py-2" style={{ borderColor: "#2a2a40", background: "#0d0d1a" }}>
                    <p className="text-xs uppercase tracking-wide text-zinc-500 mb-0.5">Your power this round</p>
                    <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>
                      {myPowerThisRound.draft_powers.name}
                      {myPowerThisRound.draft_powers.tied_position &&
                        myPowerThisRound.draft_powers.tied_position !== "ANY" && (
                          <span
                            className="ml-2 rounded px-1.5 py-0.5 text-xs font-normal"
                            style={{ background: "#1c1c2b", color: "#8a8a9a" }}
                          >
                            {myPowerThisRound.draft_powers.tied_position} only
                          </span>
                        )}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {myPowerThisRound.draft_powers.description}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">
                Waiting on{" "}
                <span className="font-semibold" style={{ color: "#f4f4f8" }}>
                  {currentMember?.team_name ?? "another manager"}
                </span>{" "}
                to pick...
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

        {/* Banners */}
        {error && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}>
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}>
            {success}
          </p>
        )}
        {powerResult && (
          <p className="rounded-md border px-3 py-2 text-sm font-semibold" style={powerBannerStyle(powerResult.type)}>
            {powerResult.type === "applied" ? "Power applied -- " : powerResult.type === "fizzled" ? "Fizzled -- " : ""}
            {powerResult.message}
          </p>
        )}

        {/* Two-column: available players + sidebar */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">

          {/* Left: available players */}
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
              Available Players
            </h2>
            <div className="flex flex-col gap-2">
              <input
                type="text"
                placeholder="Search by name..."
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
            <div className="flex flex-col gap-1 max-h-[520px] overflow-y-auto pr-1">
              {(search.trim().length > 0 || posFilter !== "ALL") && availablePlayers.length === 0 && (
                <p className="py-8 text-center text-sm text-zinc-500">No available players match.</p>
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
                      {p.position ?? "?"} - {p.team ?? "FA"}
                      {p.status && p.status !== "Active" ? ` - ${p.status}` : ""}
                    </p>
                  </div>
                  {isMyTurn && (
                    <button
                      onClick={() => handlePick(p.id, p.position ?? "")}
                      disabled={submitting}
                      className="ml-3 shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                      style={{ background: "#0057FF", color: "#f4f4f8" }}
                    >
                      {submitting ? "..." : "Draft"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Right: draft order + my powers */}
          <aside className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#FFD700" }}>
                Draft Order
              </h3>
              {league.draft_order.map((memberId, idx) => {
                const m = memberMap[memberId];
                const isPickingNow = !isDraftComplete && memberId === currentMemberId;
                return (
                  <div
                    key={memberId}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm"
                    style={{
                      background: isPickingNow ? "rgba(255,215,0,0.08)" : "transparent",
                      border: isPickingNow ? "1px solid rgba(255,215,0,0.3)" : "1px solid transparent",
                    }}
                  >
                    <span className="w-5 text-right text-xs" style={{ color: "#8a8a9a" }}>{idx + 1}.</span>
                    <span
                      style={{
                        color: memberId === myMemberId ? "#8ab4ff" : "#f4f4f8",
                        fontWeight: isPickingNow ? 600 : 400,
                      }}
                    >
                      {m?.team_name ?? memberId}
                      {memberId === myMemberId && (
                        <span className="ml-1 text-xs text-zinc-500">(you)</span>
                      )}
                    </span>
                    {isPickingNow && (
                      <span className="ml-auto text-xs font-bold" style={{ color: "#FFD700" }}>
                        PICKING
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 border-t pt-4" style={{ borderColor: "#2a2a40" }}>
              <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#FFD700" }}>
                My Powers
              </h3>
              {myPowers.length === 0 && (
                <p className="text-xs" style={{ color: "#8a8a9a" }}>No power assignments found.</p>
              )}
              {myPowers.map((pw) => {
                const dp = pw.draft_powers;
                const isPast = pw.round < currentRound;
                const isCurr = pw.round === currentRound;
                return (
                  <div
                    key={pw.round}
                    className="rounded border px-2.5 py-2"
                    style={{
                      borderColor: isCurr ? "#FFD700" : "#2a2a40",
                      background: isCurr ? "rgba(255,215,0,0.05)" : "transparent",
                      opacity: isPast ? 0.45 : 1,
                    }}
                  >
                    <p className="text-xs text-zinc-500">
                      Rd {pw.round}
                      {isCurr && (
                        <span className="ml-1 font-bold" style={{ color: "#FFD700" }}>
                          NOW
                        </span>
                      )}
                    </p>
                    <p className="text-xs font-semibold" style={{ color: isCurr ? "#f4f4f8" : "#c4c4d0" }}>
                      {dp?.name ?? "Unknown"}
                    </p>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>

        {/* Full draft board grid */}
        <DraftBoardGrid
          picks={picks}
          league={league}
          memberMap={memberMap}
          myMemberId={myMemberId}
          currentPickNo={currentPickNo}
          isDraftComplete={isDraftComplete}
        />

      </div>
    </div>
  );
}
