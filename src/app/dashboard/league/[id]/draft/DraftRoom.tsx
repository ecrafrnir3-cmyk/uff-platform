"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { makeDraftPick, assignPowerToPick, assignVampireBite, swapForesightCoin, executeHeist, restoreHeistOrder, revealNextPower } from "./actions";
import { addToQueue, removeFromQueue, saveQueueOrder, executeAutodraft } from "./queue-actions";
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

interface QueueItem {
  id: string;
  player_id: string;
  position: number;
  players: { full_name: string; position: string | null; team: string | null } | null;
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

type PowerResultType = "applied" | "fizzled" | "meta" | "error" | "blocked";

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
          <p className="mt-1 text-sm text-white">
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
            <p className="py-4 text-center text-sm text-white">No players match.</p>
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
                  <p className="text-xs text-white">
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
            style={{ background: "#1c1c2b", color: "#f4f4f8" }}
          >
            Skip
          </button>
        </div>
        <p className="mt-2 text-center text-xs" style={{ color: "#f4f4f8" }}>
          Skipping forfeits your Vampire Bite permanently.
        </p>
      </div>
    </div>
  );
}

// ---- Foresight Coin modal ----------------------------------------------------
function ForesightCoinModal({
  currentRound,
  myPowers,
  onSelect,
  submitting,
}: {
  currentRound: number;
  myPowers: PowerRow[];
  onSelect: (swapWithRound: number) => void; // currentRound = keep current
  submitting: boolean;
}) {
  const [selectedRound, setSelectedRound] = useState<number>(currentRound);

  const options = [currentRound, currentRound + 1, currentRound + 2]
    .map((r) => ({ round: r, power: myPowers.find((p) => p.round === r)?.draft_powers ?? null }))
    .filter((o) => o.power !== null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)" }}>
      <div
        className="relative mx-4 flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border p-6"
        style={{ background: "#0d0d1a", borderColor: "#FFD700" }}
      >
        <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "#FFD700" }}>Foresight Coin</p>
        <h2 className="mt-1 text-xl font-bold" style={{ color: "#f4f4f8" }}>Choose your power</h2>
        <p className="mt-1 mb-4 text-sm" style={{ color: "#f4f4f8" }}>
          Keep Round {currentRound}&apos;s power or swap it with a future round.
          The powers swap — you don&apos;t lose any.
        </p>

        <div className="flex flex-col gap-2">
          {options.map(({ round, power }) => {
            const isSelected = selectedRound === round;
            const isCurrent = round === currentRound;
            return (
              <button
                key={round}
                onClick={() => setSelectedRound(round)}
                className="rounded-lg border px-4 py-3 text-left transition"
                style={{
                  borderColor: isSelected ? "#FFD700" : "#2a2a40",
                  background: isSelected ? "rgba(255,215,0,0.08)" : "#15151f",
                }}
              >
                <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: "#FFD700" }}>
                  Round {round}{isCurrent ? " · current" : ""}
                </p>
                <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>{power?.name ?? "Unknown"}</p>
                <p className="text-xs mt-0.5" style={{ color: "#f4f4f8" }}>{power?.description ?? ""}</p>
                {power?.tied_position && power.tied_position !== "ANY" && (
                  <p className="mt-1 text-xs font-semibold" style={{ color: "#FFD700" }}>
                    {power.tied_position} only
                  </p>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => onSelect(selectedRound)}
          disabled={submitting}
          className="mt-4 w-full rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
          style={{ background: "#FFD700", color: "#0d0d1a" }}
        >
          {submitting
            ? "Applying..."
            : selectedRound === currentRound
            ? "Keep current power"
            : `Swap — take Round ${selectedRound}'s power`}
        </button>
        <p className="mt-2 text-center text-xs" style={{ color: "#f4f4f8" }}>
          You must choose before your next pick.
        </p>
      </div>
    </div>
  );
}


// ---- Draft Heist modal -------------------------------------------------------
function HeistModal({
  members,
  myMemberId,
  memberMap,
  pickedThisRound,
  onSelect,
  onSkip,
  submitting,
}: {
  members: Member[];
  myMemberId: string;
  memberMap: Record<string, Member>;
  pickedThisRound: Set<string>;
  onSelect: (targetMemberId: string) => void;
  onSkip: () => void;
  submitting: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // Only allow targeting managers who haven't picked yet this round.
  // Swapping with an already-picked manager would let them pick twice and skip the heist holder.
  const targets = members.filter((m) => m.id !== myMemberId && !pickedThisRound.has(m.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)" }}>
      <div
        className="relative mx-4 flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border p-6"
        style={{ background: "#0d0d1a", borderColor: "#CC0000" }}
      >
        <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "#CC0000" }}>Draft Heist</p>
        <h2 className="mt-1 text-xl font-bold" style={{ color: "#f4f4f8" }}>Steal a pick slot</h2>
        <p className="mt-1 mb-4 text-sm text-white">
          Choose a manager to swap draft positions with for this round only.
        </p>
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[40vh] pr-1">
          {targets.length === 0 && (
            <p className="py-4 text-center text-sm" style={{ color: "#f4f4f8" }}>
              All other managers have already picked this round — no valid targets.
            </p>
          )}
          {targets.map((m) => {
            const isSelected = selected === m.id;
            const factionColor = m.faction === "hero" ? "#0057FF" : m.faction === "villain" ? "#CC0000" : "#f4f4f8";
            return (
              <button
                key={m.id}
                onClick={() => setSelected(m.id)}
                className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition"
                style={{ borderColor: isSelected ? "#CC0000" : "#2a2a40", background: isSelected ? "rgba(204,0,0,0.12)" : "#15151f" }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>{m.team_name}</p>
                  <p className="text-xs" style={{ color: factionColor }}>
                    {m.faction ?? "Unassigned"} · {m.profiles?.display_name ?? m.profiles?.username ?? ""}
                  </p>
                </div>
                {isSelected && <span className="ml-2 shrink-0 text-xs font-bold" style={{ color: "#CC0000" }}>TARGET</span>}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => selected && onSelect(selected)}
            disabled={!selected || submitting}
            className="flex-1 rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: "#CC0000", color: "#f4f4f8" }}
          >
            {submitting ? "Executing..." : selected ? `Steal ${memberMap[selected]?.team_name ?? ""}'s slot` : "Select a target"}
          </button>
          <button onClick={onSkip} disabled={submitting} className="rounded-md px-4 py-2.5 text-sm disabled:opacity-40" style={{ background: "#1c1c2b", color: "#f4f4f8" }}>
            Skip
          </button>
        </div>
        <p className="mt-2 text-center text-xs" style={{ color: "#f4f4f8" }}>Skipping forfeits Draft Heist for this round.</p>
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
  activeDraftOrder,
}: {
  picks: Pick[];
  league: League;
  memberMap: Record<string, Member>;
  myMemberId: string;
  currentPickNo: number;
  isDraftComplete: boolean;
  activeDraftOrder: string[];
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
        <span className="text-sm text-white">
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
                className="border px-2 py-2 text-left font-normal text-white"
                style={{ borderColor: "#2a2a40", minWidth: "36px" }}
              >
                Rd
              </th>
              {activeDraftOrder.map((memberId, idx) => {
                const m = memberMap[memberId];
                const isMe = memberId === myMemberId;
                return (
                  <th
                    key={memberId}
                    className="border px-2 py-2 text-left"
                    style={{
                      borderColor: "#2a2a40",
                      color: isMe ? "#0057FF" : "#f4f4f8",
                      minWidth: "88px",
                      maxWidth: "110px",
                      fontWeight: isMe ? 700 : 500,
                    }}
                  >
                    <span className="block truncate" title={m?.team_name ?? `Team ${idx + 1}`}>
                      {m?.team_name ?? `T${idx + 1}`}
                    </span>
                    <span className="block font-normal" style={{ fontSize: "9px", color: "#f4f4f8" }}>
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
                    className="border px-2 py-1 text-white"
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
                    const posColor = POS_COLORS[pos] ?? "#f4f4f8";

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
                              style={{ color: isMe ? "#8ab4ff" : "#f4f4f8" }}
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
          <p className="text-sm text-white">
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
                    <span className="ml-2 text-xs text-white">(you)</span>
                  )}
                </p>
                <p className="text-xs text-white">
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
                <span className="text-xs" style={{ color: "#f4f4f8" }}>No faction</span>
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
                <p className="text-sm text-white">
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
              <p className="text-sm text-white">
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
            <p className="text-sm text-white">
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
  const [showForesightModal, setShowForesightModal] = useState(false);
  const [foresightSubmitting, setForesightSubmitting] = useState(false);
  const [foresightPickedRound, setForesightPickedRound] = useState<number>(0);
  const [myPowersState, setMyPowersState] = useState<PowerRow[]>(myPowers);
  // Draft Heist
  const [showHeistModal, setShowHeistModal] = useState(false);
  const [heistSubmitting, setHeistSubmitting] = useState(false);
  const [heistUsedRound, setHeistUsedRound] = useState<number | null>(null);
  const [draftOrderState, setDraftOrderState] = useState<string[]>(league.draft_order);
  const [heistOriginalOrder, setHeistOriginalOrder] = useState<string[] | null>(null);
  // Telepathy
  const [telepathyReveal, setTelepathyReveal] = useState<{ powerName: string | null; cloaked: boolean } | null>(null);
  // Draft Queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [autodraftSubmitting, setAutodraftSubmitting] = useState(false);

  // ---- Pre-return derived state (must be here so effects can use them) ------
  const totalPicksEarly = league.max_teams * league.draft_rounds;
  const isDraftComplete = draftStatus === "completed" || picks.length >= totalPicksEarly;
  const currentPickNo = picks.length + 1;
  const currentRound = Math.ceil(currentPickNo / league.max_teams);
  const activeDraftOrder = draftOrderState;
  const slot = snakeDraftSlot(currentPickNo, league.max_teams);
  const currentMemberId = isDraftComplete ? null : (activeDraftOrder[slot - 1] ?? null);
  const isMyTurn = !isDraftComplete && currentMemberId === myMemberId;
  const currentMember = members.find((m) => m.id === currentMemberId);
  const myPowerThisRound = myPowersState.find((p) => p.round === currentRound);

  // ---- fetchPicks (used in effect below) -------------------------------------
  const fetchPicks = useCallback(async () => {
    const { data } = await supabase
      .from("uff_draft_picks")
      .select("id, round, pick_no, member_id, player_id, picked_at, players(full_name, position, team)")
      .eq("league_id", leagueId)
      .order("pick_no", { ascending: true });
    if (data) setPicks(data as unknown as Pick[]);

    // Also sync draft_order and heist_state so ALL clients see heist swaps
    const { data: leagueRow } = await supabase
      .from("uff_leagues")
      .select("draft_status, draft_order, heist_state")
      .eq("id", leagueId)
      .maybeSingle();
    if (leagueRow) {
      setDraftStatus(leagueRow.draft_status);
      // Always trust DB draft_order (swapped during heist, restored after)
      if (leagueRow.draft_order) {
        setDraftOrderState(leagueRow.draft_order as string[]);
      }
      // Sync heist tracking state so restore effect works on all clients
      const hs = leagueRow.heist_state as { round: number; memberA: string; memberB: string; originalOrder: string[] } | null;
      if (hs) {
        setHeistUsedRound(hs.round);
        setHeistOriginalOrder(hs.originalOrder);
      } else {
        // Heist cleared in DB — clear client state too (handles cross-client restore)
        setHeistOriginalOrder(null);
      }
    }
  }, [leagueId]);

  // ---- fetchQueue ------------------------------------------------------------
  const fetchQueue = useCallback(async () => {
    const { data } = await supabase
      .from("draft_queue")
      .select("id, player_id, position, players(full_name, position, team)")
      .eq("league_id", leagueId)
      .eq("member_id", myMemberId)
      .order("position", { ascending: true });
    if (data) setQueue(data as unknown as QueueItem[]);
  }, [leagueId, myMemberId]);

  // ---- All effects (must be before any conditional returns) ------------------
  useEffect(() => {
    if (isDraftComplete) return; // stop polling once draft is done
    const interval = setInterval(fetchPicks, 5000);
    return () => clearInterval(interval);
  }, [fetchPicks, isDraftComplete]);

  // Restore heist order when round advances
  useEffect(() => {
    if (!heistOriginalOrder) return;
    if (currentRound > (heistUsedRound ?? 0) && !isDraftComplete) {
      restoreHeistOrder({ leagueId, originalOrder: heistOriginalOrder }).then(() => {
        setDraftOrderState(heistOriginalOrder);
        setHeistOriginalOrder(null);
        setHeistUsedRound(null);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRound, heistOriginalOrder, heistUsedRound, isDraftComplete]);

  // Show Draft Heist modal on our turn
  useEffect(() => {
    if (isMyTurn && myPowerThisRound?.draft_powers?.name === "Draft Heist" && heistUsedRound !== currentRound && !showHeistModal) {
      setShowHeistModal(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, myPowerThisRound?.draft_powers?.name, currentRound]);

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

  // Load queue on mount (and whenever myMemberId changes)
  useEffect(() => {
    if (draftStatus !== "not_started") fetchQueue();
  }, [fetchQueue, draftStatus]);

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

  // ---- Derived state (remaining) -------------------------------------------
  const totalPicks = totalPicksEarly; // already computed above
  const memberMap = Object.fromEntries(members.map((m) => [m.id, m]));
  const pickedIds = new Set(picks.map((p) => p.player_id));
  const availablePlayers = players.filter((p) => !pickedIds.has(p.id));
  const queuedIds = new Set(queue.map((q) => q.player_id));

  // ---- Queue handlers --------------------------------------------------------
  async function handleAddToQueue(player: Player) {
    const newItem: QueueItem = {
      id: "temp-" + player.id,
      player_id: player.id,
      position: queue.length,
      players: { full_name: player.full_name, position: player.position, team: player.team },
    };
    setQueue((prev) => [...prev, newItem]);
    const result = await addToQueue(leagueId, player.id);
    if (result.error) {
      setQueue((prev) => prev.filter((q) => q.player_id !== player.id));
      setError(result.error);
    }
  }

  async function handleRemoveFromQueue(playerId: string) {
    setQueue((prev) => prev.filter((q) => q.player_id !== playerId));
    const result = await removeFromQueue(leagueId, playerId);
    if (result.error) {
      fetchQueue();
      setError(result.error);
    }
  }

  function handleMoveUp(playerId: string) {
    setQueue((prev) => {
      const idx = prev.findIndex((q) => q.player_id === playerId);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      saveQueueOrder(leagueId, next.map((q) => q.player_id));
      return next;
    });
  }

  function handleMoveDown(playerId: string) {
    setQueue((prev) => {
      const idx = prev.findIndex((q) => q.player_id === playerId);
      if (idx === -1 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      saveQueueOrder(leagueId, next.map((q) => q.player_id));
      return next;
    });
  }

  async function handleAutodraft() {
    setError(null);
    setPowerResult(null);
    setAutodraftSubmitting(true);
    setSubmitting(true);
    try {
      const result = await executeAutodraft(leagueId);
      if (result.error) {
        setError(result.error);
      } else if (result.player) {
        const pickedPlayer = result.player;
        const pickedRound = currentRound;
        setSuccess(`Autodraft: ${pickedPlayer.full_name} selected!`);
        setQueue((prev) => prev.filter((q) => q.player_id !== pickedPlayer.id));
        await fetchPicks();
        setTimeout(() => setSuccess(null), 4000);

        // Powers — skip interactive ones (they need manual activation)
        if (myPowerThisRound?.draft_powers) {
          const dp = myPowerThisRound.draft_powers;
          const interactivePowers = ["Vampire Bite", "Foresight Coin", "Draft Heist"];
          if (interactivePowers.includes(dp.name)) {
            setPowerResult({
              type: "fizzled",
              message: `Autodraft used — ${dp.name} requires manual activation and was forfeited this round.`,
            });
            setTimeout(() => setPowerResult(null), 8000);
          } else {
            const pr = await assignPowerToPick({
              leagueId,
              playerId: pickedPlayer.id,
              playerPosition: pickedPlayer.position ?? "",
              powerName: dp.name,
              powerCategory: dp.category ?? "",
              powerTiedPosition: dp.tied_position,
              round: pickedRound,
            });
            setPowerResult({ type: pr.result as PowerResultType, message: pr.message });
            setTimeout(() => setPowerResult(null), 6000);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Autodraft failed.");
    } finally {
      setAutodraftSubmitting(false);
      setSubmitting(false);
    }
  }

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
        const pickedRound = currentRound; // capture before fetchPicks advances the round
        await fetchPicks();
        setTimeout(() => setSuccess(null), 4000);

        // Foresight Coin: show swap modal instead of normal power flow
        if (myPowerThisRound?.draft_powers?.name === "Foresight Coin") {
          const hasPeek = myPowersState.some((p) => p.round > pickedRound && p.round <= pickedRound + 2);
          if (hasPeek) {
            setForesightPickedRound(pickedRound);
            setShowForesightModal(true);
            return;
          }
          // No future rounds to peek — just show meta banner
          setPowerResult({ type: "meta", message: "Foresight Coin — no future rounds available to peek." });
          setTimeout(() => setPowerResult(null), 5000);
          return;
        }

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
          } else if (pr.result === "meta" && dp.name === "Telepathy") {
            const nextPickNo = picks.length + 2;
            const nextRoundCheck = Math.ceil(nextPickNo / league.max_teams);
            if (nextRoundCheck === currentRound) {
              const nextSlot = snakeDraftSlot(nextPickNo, league.max_teams);
              const nextMemberId = activeDraftOrder[nextSlot - 1] ?? null;
              if (nextMemberId && nextMemberId !== myMemberId) {
                const reveal = await revealNextPower({ leagueId, nextMemberId, currentRound });
                setTelepathyReveal(reveal);
                setTimeout(() => setTelepathyReveal(null), 10000);
              }
            }
            const inSameRound = Math.ceil((picks.length + 2) / league.max_teams) === currentRound;
            setPowerResult({
              type: "meta",
              message: inSameRound
                ? "Telepathy activated — see the reveal below."
                : "Telepathy activated — you're the last pick of this round, nothing to reveal.",
            });
            setTimeout(() => setPowerResult(null), 6000);
          } else if (pr.result === "meta" && dp.name === "Cloak") {
            setPowerResult({ type: "meta", message: "Cloak activated — your power is hidden from Telepathy this round." });
            setTimeout(() => setPowerResult(null), 6000);
          } else if (pr.result === "meta" && (dp.name === "Draft Heist" || dp.name === "Hero's Shield")) {
            // Draft Heist is handled pre-pick via HeistModal; Hero's Shield is passive.
            // Both return "meta" from assignPowerToPick — suppress the auto-applied banner.
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

  // ---- Foresight Coin handler ------------------------------------------------
  async function handleForesightCoin(swapWithRound: number) {
    setForesightSubmitting(true);

    if (swapWithRound !== foresightPickedRound) {
      const result = await swapForesightCoin({ leagueId, currentRound: foresightPickedRound, swapWithRound });
      if (result.error) {
        setError(result.error);
      } else {
        const swappedPowerName = myPowersState.find((p) => p.round === swapWithRound)?.draft_powers?.name ?? "Unknown";
        // Swap locally so sidebar updates immediately
        setMyPowersState((prev) => {
          const next = prev.map((p) => ({ ...p }));
          const currIdx = next.findIndex((p) => p.round === currentRound);
          const swapIdx = next.findIndex((p) => p.round === swapWithRound);
          if (currIdx !== -1 && swapIdx !== -1) {
            const tmp = next[currIdx].draft_powers;
            next[currIdx] = { ...next[currIdx], draft_powers: next[swapIdx].draft_powers };
            next[swapIdx] = { ...next[swapIdx], draft_powers: tmp };
          }
          return next;
        });
        setPowerResult({ type: "applied", message: `Foresight Coin — swapped to Round ${swapWithRound}'s power: ${swappedPowerName}!` });
        setTimeout(() => setPowerResult(null), 6000);
      }
    } else {
      const keptName = myPowersState.find((p) => p.round === foresightPickedRound)?.draft_powers?.name ?? "your power";
      setPowerResult({ type: "meta", message: `Foresight Coin — kept ${keptName} for this round.` });
      setTimeout(() => setPowerResult(null), 5000);
    }

    setForesightSubmitting(false);
    setShowForesightModal(false);
  }

  function powerBannerStyle(type: PowerResultType): React.CSSProperties {
    if (type === "applied")  return { borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" };
    if (type === "fizzled")  return { borderColor: "#FFD700", color: "#FFD700", background: "#1a190a" };
    if (type === "meta")     return { borderColor: "#0057FF", color: "#8ab4ff", background: "#0a0e1a" };
    if (type === "blocked")  return { borderColor: "#FFD700", color: "#FFD700", background: "#1a190a" };
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
      {showForesightModal && (
        <ForesightCoinModal
          currentRound={foresightPickedRound}
          myPowers={myPowersState}
          onSelect={handleForesightCoin}
          submitting={foresightSubmitting}
        />
      )}
      {showHeistModal && (
        <HeistModal
          members={members}
          myMemberId={myMemberId}
          memberMap={memberMap}
          pickedThisRound={new Set(picks.filter((p) => p.round === currentRound).map((p) => p.member_id))}
          onSelect={async (targetMemberId) => {
            setHeistSubmitting(true);
            const result = await executeHeist({
              leagueId,
              targetMemberId,
              currentRound,
              currentDraftOrder: activeDraftOrder,
              myMemberId,
            });
            setHeistSubmitting(false);
            setShowHeistModal(false);
            setHeistUsedRound(currentRound);
            if (result.error) {
              setError(result.error);
            } else if (result.blocked) {
              setPowerResult({ type: "blocked", message: `Draft Heist blocked! ${result.blockerTeam ?? "That team"} has Hero\'s Shield this round.` });
              setTimeout(() => setPowerResult(null), 8000);
            } else {
              const targetTeam = memberMap[targetMemberId]?.team_name ?? "target";
              const newOrder = [...activeDraftOrder];
              const myIdx = newOrder.indexOf(myMemberId);
              const tIdx = newOrder.indexOf(targetMemberId);
              if (myIdx !== -1 && tIdx !== -1) { newOrder[myIdx] = targetMemberId; newOrder[tIdx] = myMemberId; }
              setHeistOriginalOrder(activeDraftOrder);
              setDraftOrderState(newOrder);
              setPowerResult({ type: "applied", message: `Draft Heist executed — swapped positions with ${targetTeam} for this round!` });
              setTimeout(() => setPowerResult(null), 8000);
            }
          }}
          onSkip={() => {
            setShowHeistModal(false);
            setHeistUsedRound(currentRound);
            setPowerResult({ type: "fizzled", message: "Draft Heist skipped — power forfeited for this round." });
            setTimeout(() => setPowerResult(null), 5000);
          }}
          submitting={heistSubmitting}
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
          <p className="text-sm text-white">
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
                    <p className="text-xs uppercase tracking-wide text-white mb-0.5">Your power this round</p>
                    <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>
                      {myPowerThisRound.draft_powers.name}
                      {myPowerThisRound.draft_powers.tied_position &&
                        myPowerThisRound.draft_powers.tied_position !== "ANY" && (
                          <span
                            className="ml-2 rounded px-1.5 py-0.5 text-xs font-normal"
                            style={{ background: "#1c1c2b", color: "#f4f4f8" }}
                          >
                            {myPowerThisRound.draft_powers.tied_position} only
                          </span>
                        )}
                    </p>
                    <p className="mt-0.5 text-xs text-white">
                      {myPowerThisRound.draft_powers.description}
                    </p>
                    {myPowerThisRound.draft_powers.name === "Hero's Shield" && (
                      <p className="mt-1.5 text-xs font-semibold" style={{ color: "#0057FF" }}>
                        🛡 Your pick slot is shielded against Draft Heist this round.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-white">
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
            {powerResult.type === "applied" ? "Power applied — " : powerResult.type === "fizzled" ? "Fizzled — " : ""}
            {powerResult.message}
          </p>
        )}
        {telepathyReveal && (
          <div className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: "#0057FF", background: "#0a0e1a" }}>
            <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "#0057FF" }}>
              🧠 Telepathy — Next Manager&rsquo;s Power
            </p>
            {telepathyReveal.cloaked ? (
              <p className="font-semibold" style={{ color: "#f4f4f8" }}>
                Power is cloaked — Cloak is active on the next manager.
              </p>
            ) : telepathyReveal.powerName ? (
              <p className="font-semibold" style={{ color: "#f4f4f8" }}>
                {telepathyReveal.powerName}
              </p>
            ) : (
              <p style={{ color: "#f4f4f8" }}>No power assigned for this round.</p>
            )}
          </div>
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
                      color: posFilter === pos ? "#f4f4f8" : "#f4f4f8",
                    }}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1 max-h-[520px] overflow-y-auto pr-1">
              {(search.trim().length > 0 || posFilter !== "ALL") && availablePlayers.length === 0 && (
                <p className="py-8 text-center text-sm text-white">No available players match.</p>
              )}
              {availablePlayers.map((p) => {
                const inQueue = queuedIds.has(p.id);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                    style={{ borderColor: "#2a2a40" }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => inQueue ? handleRemoveFromQueue(p.id) : handleAddToQueue(p)}
                              title={inQueue ? "Remove from queue" : "Add to queue"}
                        className="shrink-0 text-base leading-none transition-colors"
                        style={{ color: inQueue ? "#FFD700" : "#2a2a40" }}
                      >
                        &#9733;
                      </button>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{p.full_name}</p>
                        <p className="text-xs text-white">
                          {p.position ?? "?"} - {p.team ?? "FA"}
                          {p.status && p.status !== "Active" ? ` - ${p.status}` : ""}
                        </p>
                      </div>
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
                );
              })}
            </div>
          </section>

          {/* Right: queue + draft order + my powers */}
          <aside className="flex flex-col gap-5">

            {/* Queue */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#FFD700" }}>
                  Queue {queue.length > 0 && <span className="ml-1 text-xs font-normal" style={{ color: "#f4f4f8" }}>({queue.length})</span>}
                </h3>
                {isMyTurn && !isDraftComplete && queue.filter((q) => !pickedIds.has(q.player_id)).length > 0 && (
                  <button
                    onClick={handleAutodraft}
                    disabled={autodraftSubmitting || submitting}
                    className="rounded px-2.5 py-1 text-xs font-bold disabled:opacity-40 transition-opacity"
                    style={{ background: "#FFD700", color: "#0d0d1a" }}
                  >
                    {autodraftSubmitting ? "Picking..." : "Autodraft"}
                  </button>
                )}
              </div>
              {queue.length === 0 ? (
                <p className="text-xs" style={{ color: "#f4f4f8" }}>
                  Star players to add them to your queue.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {queue.map((item, idx) => {
                    const isDrafted = pickedIds.has(item.player_id);
                    return (
                      <div
                        key={item.player_id}
                        className="flex items-center gap-1 rounded border px-2 py-1.5"
                        style={{
                          borderColor: isDrafted ? "#1a1a2e" : "#2a2a40",
                          background: isDrafted ? "rgba(255,255,255,0.02)" : "transparent",
                          opacity: isDrafted ? 0.45 : 1,
                        }}
                      >
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            onClick={() => handleMoveUp(item.player_id)}
                            disabled={idx === 0 || isDrafted}
                            className="text-xs leading-none disabled:opacity-25"
                            style={{ color: "#f4f4f8" }}
                          >
                            &#9650;
                          </button>
                          <button
                            onClick={() => handleMoveDown(item.player_id)}
                            disabled={idx === queue.length - 1 || isDrafted}
                            className="text-xs leading-none disabled:opacity-25"
                            style={{ color: "#f4f4f8" }}
                          >
                            &#9660;
                          </button>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: "#f4f4f8" }}>
                            {item.players?.full_name ?? item.player_id}
                          </p>
                          <p className="text-xs" style={{ color: isDrafted ? "#CC0000" : "#f4f4f8" }}>
                            {item.players?.position ?? "?"} &middot; {item.players?.team ?? "FA"}
                            {isDrafted && " · Drafted"}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemoveFromQueue(item.player_id)}
                          className="ml-1 shrink-0 text-xs leading-none"
                          style={{ color: "#CC0000" }}
                          title="Remove from queue"
                        >
                          &times;
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="border-t pt-4 flex flex-col gap-2" style={{ borderColor: "#2a2a40" }}>
              <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#FFD700" }}>
                Draft Order
              </h3>
              {activeDraftOrder.map((memberId, idx) => {
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
                    <span className="w-5 text-right text-xs" style={{ color: "#f4f4f8" }}>{idx + 1}.</span>
                    <span
                      style={{
                        color: memberId === myMemberId ? "#8ab4ff" : "#f4f4f8",
                        fontWeight: isPickingNow ? 600 : 400,
                      }}
                    >
                      {m?.team_name ?? memberId}
                      {memberId === myMemberId && (
                        <span className="ml-1 text-xs text-white">(you)</span>
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
              {myPowersState.length === 0 && (
                <p className="text-xs" style={{ color: "#f4f4f8" }}>No power assignments found.</p>
              )}
              {myPowersState.map((pw) => {
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
                    <p className="text-xs text-white">
                      Rd {pw.round}
                      {isCurr && (
                        <span className="ml-1 font-bold" style={{ color: "#FFD700" }}>
                          NOW
                        </span>
                      )}
                    </p>
                    <p className="text-xs font-semibold" style={{ color: "#f4f4f8" }}>
                      {dp?.name ?? "Unknown"}
                    </p>
                    {isCurr && dp?.name === "Hero's Shield" && (
                      <p className="mt-0.5 text-xs" style={{ color: "#0057FF" }}>&nbsp;Shielded</p>
                    )}
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
          activeDraftOrder={activeDraftOrder}
        />

      </div>
    </div>
  );
}
