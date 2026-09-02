"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import TrendingPlayers from "@/components/TrendingPlayers";
import { makeDraftPick, assignPowerToPick, assignVampireBite, swapForesightCoin, executeHeist, restoreHeistOrder, revealNextPower } from "./actions";
import { addToQueue, removeFromQueue, saveQueueOrder, executeAutodraft, forceAutopick, commissionerPick, getMemberPowers, commissionerVampireBite, commissionerForesightSwap, commissionerHeist } from "./queue-actions";
import { addToWatchlist, removeFromWatchlist } from "./watchlist-actions";
import { startDraft } from "../actions";

const supabase = createClient();

// What each draft power wants you to DO in the round it lands in — shown under
// each entry in the My Powers panel so a manager can plan their picks at a glance.
const POWER_HINTS: Record<string, string> = {
  "Gunslinger": "Draft a QB",
  "Berserker Rage": "Draft an RB",
  "Goal Line Hammer": "Draft an RB",
  "Red Zone Menace": "Draft a WR",
  "Reception Specialist": "Draft a WR / RB / TE",
  "Seam Buster": "Draft a TE",
  "Iron Defense": "Draft a D/ST",
  "Sniper": "Draft a K",
  "Shadow Guard": "Shields this pick from Vampire Bite",
  "Time Stone": "Injury-freeze on this pick",
  "Power Negation": "⚠ Halves this pick's score — draft a spare",
  "Vampire Bite": "Bite an opponent's player",
  "Draft Heist": "Swap draft slots with a manager",
  "Foresight Coin": "Pull a later power forward",
  "Telepathy": "Peek at the next manager's power",
  "Hero's Shield": "Auto-blocks a Heist aimed at you",
};

interface Player {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  status: string | null;
  injury_status: string | null;
  adp: number | null;
}

function InjuryBadge({ injuryStatus }: { injuryStatus: string | null }) {
  if (!injuryStatus) return null;
  const map: Record<string, { label: string; bg: string; color: string }> = {
    "Out":         { label: "OUT", bg: "rgba(204,0,0,0.18)",    color: "#ff6b6b" },
    "Doubtful":    { label: "D",   bg: "rgba(204,0,0,0.12)",    color: "#ff8a8a" },
    "Questionable":{ label: "Q",   bg: "rgba(255,215,0,0.15)",  color: "#FFD700" },
    "Probable":    { label: "P",   bg: "rgba(61,220,132,0.12)", color: "#3DDC84" },
    "IR":          { label: "IR",  bg: "rgba(136,136,170,0.15)", color: "#8888aa" },
  };
  const style = map[injuryStatus];
  if (!style) return null;
  return (
    <span style={{
      display: "inline-block", padding: "1px 5px", borderRadius: 4,
      fontSize: 10, fontWeight: 700, background: style.bg, color: style.color, flexShrink: 0,
    }}>
      {style.label}
    </span>
  );
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
  pick_clock_seconds?: number | null;
  draft_started_at?: string | null;
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
  forTeam,
}: {
  picks: Pick[];
  memberMap: Record<string, Member>;
  onSelect: (playerId: string) => void;
  onSkip: () => void;
  submitting: boolean;
  forTeam?: string;
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
          {forTeam && (
            <div className="mb-2 rounded-md px-2.5 py-1.5 text-xs font-bold" style={{ background: "#7A5CFF", color: "#f4f4f8" }}>
              ⚡ COMMISSIONER PROXY — acting for {forTeam}
            </div>
          )}
          <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "#CC0000" }}>
            Vampire Bite
          </p>
          <h2 className="mt-1 text-xl font-bold" style={{ color: "#f4f4f8" }}>
            {forTeam ? `Choose ${forTeam}'s target` : "Choose your target"}
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
  forTeam,
}: {
  currentRound: number;
  myPowers: PowerRow[];
  onSelect: (swapWithRound: number) => void; // currentRound = keep current
  submitting: boolean;
  forTeam?: string;
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
        {forTeam && (
          <div className="mb-2 rounded-md px-2.5 py-1.5 text-xs font-bold" style={{ background: "#7A5CFF", color: "#f4f4f8" }}>
            ⚡ COMMISSIONER PROXY — acting for {forTeam}
          </div>
        )}
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
  forTeam,
}: {
  members: Member[];
  myMemberId: string;
  memberMap: Record<string, Member>;
  pickedThisRound: Set<string>;
  onSelect: (targetMemberId: string) => void;
  onSkip: () => void;
  submitting: boolean;
  forTeam?: string;
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
        {forTeam && (
          <div className="mb-2 rounded-md px-2.5 py-1.5 text-xs font-bold" style={{ background: "#7A5CFF", color: "#f4f4f8" }}>
            ⚡ COMMISSIONER PROXY — acting for {forTeam}
          </div>
        )}
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
function ChecklistItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{
          background: ok ? "rgba(61,220,132,0.15)" : "rgba(204,0,0,0.15)",
          color: ok ? "#3DDC84" : "#CC0000",
          border: `1px solid ${ok ? "#3DDC84" : "#CC0000"}`,
        }}
      >
        {ok ? "✓" : "✗"}
      </span>
      <span className="text-sm" style={{ color: ok ? "#f4f4f8" : "#8888aa" }}>{label}</span>
    </div>
  );
}

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

  // ── Commissioner checklist ────────────────────────────────────────────────
  // Note: the draft order is NOT a prerequisite — start_draft randomly shuffles
  // it (Fisher-Yates) when the draft begins, so requiring a pre-set order here
  // both blocked the start and was discarded by start_draft anyway.
  const checks = {
    enoughMembers:  members.length >= 2,
    leagueFull:     members.length >= league.max_teams,
    factionsSet:    allFactionsSet,
    roundsSet:      (league.draft_rounds ?? 0) > 0,
  };
  const allChecksPassed = Object.values(checks).every(Boolean);

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

        {/* Draft Order Display */}
        {league.draft_order && league.draft_order.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
            <h2 className="font-semibold" style={{ color: "#FFD700" }}>Draft Order</h2>
            <p className="text-xs text-white mb-1">Pick 1 drafts first. Snake order — odd rounds go 1→{league.max_teams}, even rounds reverse.</p>
            <div className="flex flex-col gap-1">
              {league.draft_order.map((memberId, i) => {
                const m = members.find((x) => x.id === memberId);
                if (!m) return null;
                const isMe = m.id === myMemberId;
                return (
                  <div key={memberId} className="flex items-center gap-3 rounded-md border px-3 py-1.5"
                    style={{ borderColor: isMe ? "#0057FF" : "#2a2a40", background: isMe ? "rgba(0,87,255,0.06)" : "#15151f" }}>
                    <span className="text-sm font-bold tabular-nums w-5 text-right" style={{ color: "#FFD700" }}>{i + 1}</span>
                    <span className="flex-1 text-sm" style={{ color: isMe ? "#6fa3ff" : "#f4f4f8" }}>
                      {m.team_name}{isMe && " (you)"}
                    </span>
                    {m.faction && (
                      <span className="text-xs capitalize" style={{ color: m.faction === "hero" ? "#0057FF" : "#CC0000" }}>
                        {m.faction}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {isCommissioner && (
              <p className="text-xs mt-1" style={{ color: "#8888aa" }}>
                Change the draft order in <a href={`/dashboard/league/${league.id}/settings`} style={{ color: "#0057FF", textDecoration: "underline" }}>Settings</a>.
              </p>
            )}
          </div>
        )}

        {isCommissioner ? (
          <div
            className="flex flex-col gap-4 rounded-lg border p-5"
            style={{ borderColor: allChecksPassed ? "#FFD700" : "#2a2a40" }}
          >
            <h2 className="font-semibold" style={{ color: "#FFD700" }}>
              Commissioner Controls
            </h2>

            {/* Pre-draft checklist */}
            <div className="flex flex-col gap-2 rounded-md border px-4 py-3" style={{ borderColor: "#2a2a40", background: "#15151f" }}>
              <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "#8888aa" }}>Pre-Draft Checklist</p>
              <ChecklistItem ok={checks.enoughMembers}  label={`At least 2 managers have joined (${members.length}/${league.max_teams})`} />
              <ChecklistItem ok={checks.leagueFull}     label={`League is full (${members.length}/${league.max_teams} managers)`} />
              <ChecklistItem ok={checks.factionsSet}    label={allFactionsSet ? "All managers have factions assigned" : `${unassigned} manager${unassigned !== 1 ? "s" : ""} missing faction`} />
              <ChecklistItem ok={checks.roundsSet}      label={`Draft rounds configured (${league.draft_rounds ?? 0} rounds)`} />
              <p className="text-xs mt-1" style={{ color: "#8888aa" }}>Draft order is randomly assigned when the draft starts — no setup needed.</p>
            </div>

            {allChecksPassed ? (
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
            ) : (
              <div>
                <button
                  disabled
                  className="rounded-md px-5 py-2.5 text-sm font-bold opacity-40 cursor-not-allowed"
                  style={{ background: "#FFD700", color: "#0d0d1a" }}
                >
                  Start Draft
                </button>
                <p className="mt-2 text-xs" style={{ color: "#8888aa" }}>
                  Complete the checklist above before starting the draft.
                </p>
              </div>
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

        {/* Pre-draft scouting: trending pickups */}
        <TrendingPlayers leagueId={league.id} />
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
  initialWatchlist = [],
}: {
  league: League;
  members: Member[];
  myMemberId: string;
  isCommissioner: boolean;
  initialPicks: Pick[];
  myPowers: PowerRow[];
  initialWatchlist?: string[];
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
  // Commissioner proxy — the on-clock member's powers (so the commissioner can
  // apply that team's interactive power on their behalf when drafting for a no-show)
  const [proxyPowers, setProxyPowers] = useState<PowerRow[]>([]);
  const [proxySubmitting, setProxySubmitting] = useState(false);
  const [proxyVB, setProxyVB] = useState<{ memberId: string; teamName: string; round: number } | null>(null);
  const [proxyFC, setProxyFC] = useState<{ memberId: string; teamName: string; round: number } | null>(null);
  const [proxyHeist, setProxyHeist] = useState<{ memberId: string; teamName: string; round: number } | null>(null);
  // Draft Queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [autodraftSubmitting, setAutodraftSubmitting] = useState(false);
  // Draft Advisor
  const [advisorState, setAdvisorState] = useState<{ advice?: string; loading: boolean; error?: string }>({ loading: false });
  // Watchlist
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set(initialWatchlist));
  const [watchlistPlayers, setWatchlistPlayers] = useState<Player[]>([]);
  // Pick clock — server-anchored: deadline derives from the last pick's
  // picked_at (or draft_started_at for pick 1), so every client sees the same
  // clock and an offline picker can't freeze the draft.
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const autopickFiredForPickRef = useRef<number | null>(null);
  const forceFiredForPickRef = useRef<number | null>(null);
  // Round buffer
  const [roundBufferActive, setRoundBufferActive] = useState(false);
  const [roundBufferTimeLeft, setRoundBufferTimeLeft] = useState(30);
  const [bufferTelepathyReveal, setBufferTelepathyReveal] = useState<{
    powerName: string | null;
    cloaked: boolean;
    teamName: string;
  } | null>(null);
  const prevRoundRef = useRef<number>(-1); // -1 = uninitialized

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
  // Commissioner proxy mode: I'm the commissioner and someone ELSE (a no-show) is
  // on the clock. In this mode I draft — and apply interactive powers — for them.
  const isProxyMode = isCommissioner && !isMyTurn && !isDraftComplete && !!currentMemberId && currentMemberId !== myMemberId;
  const proxyPowerThisRound = isProxyMode ? (proxyPowers.find((p) => p.round === currentRound)?.draft_powers ?? null) : null;

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

  // Load the on-clock member's powers whenever proxy mode is active, so the
  // commissioner UI knows which interactive power (if any) that team holds.
  useEffect(() => {
    if (!isProxyMode || !currentMemberId) { setProxyPowers([]); return; }
    let cancelled = false;
    getMemberPowers(leagueId, currentMemberId).then((res) => {
      if (!cancelled && res.powers) setProxyPowers(res.powers as PowerRow[]);
    });
    return () => { cancelled = true; };
  }, [isProxyMode, currentMemberId, leagueId]);

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

  // ---- Round buffer: detect new round and trigger 30s window ----------------
  useEffect(() => {
    if (isDraftComplete) return;
    if (prevRoundRef.current === -1) {
      // First run — if draft is already in progress, initialize to currentRound
      // so we don't fire a buffer for a round already underway (reconnect case).
      // If not started yet, set to 0 so round 1 triggers the buffer when draft starts.
      prevRoundRef.current = draftStatus === "not_started" ? 0 : currentRound;
      return;
    }
    if (currentRound > prevRoundRef.current) {
      prevRoundRef.current = currentRound;
      setRoundBufferActive(true);
      setRoundBufferTimeLeft(30);
      setBufferTelepathyReveal(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRound, draftStatus, isDraftComplete]);

  // ---- Round buffer: countdown --------------------------------------------
  useEffect(() => {
    if (!roundBufferActive) return;
    const id = window.setInterval(() => {
      setRoundBufferTimeLeft((prev) => {
        if (prev <= 1) {
          setRoundBufferActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [roundBufferActive]);

  // ---- Telepathy: auto-reveal first picker's power at buffer start ---------
  useEffect(() => {
    if (!roundBufferActive) return;
    if (myPowerThisRound?.draft_powers?.name !== "Telepathy") return;
    if (bufferTelepathyReveal) return;
    const firstPickNo = (currentRound - 1) * league.max_teams + 1;
    const firstSlot = snakeDraftSlot(firstPickNo, league.max_teams);
    const firstMemberId = activeDraftOrder[firstSlot - 1];
    if (!firstMemberId || firstMemberId === myMemberId) {
      setBufferTelepathyReveal({ powerName: null, cloaked: false, teamName: "you pick first" });
      return;
    }
    const teamName = members.find((m) => m.id === firstMemberId)?.team_name ?? "First picker";
    revealNextPower({ leagueId, nextMemberId: firstMemberId, currentRound }).then((reveal) => {
      setBufferTelepathyReveal({ ...reveal, teamName });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundBufferActive, myPowerThisRound?.draft_powers?.name, bufferTelepathyReveal]);

  // Show Draft Heist modal at round buffer start (replaces old isMyTurn trigger)
  useEffect(() => {
    if (roundBufferActive && myPowerThisRound?.draft_powers?.name === "Draft Heist" && heistUsedRound !== currentRound && !showHeistModal) {
      setShowHeistModal(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundBufferActive, myPowerThisRound?.draft_powers?.name, currentRound]);

  useEffect(() => {
    let cancelled = false;
    // Retries on a transient failure and NEVER blanks a good list with []. Under
    // many managers loading at draft start on a shared DB, a single dropped
    // request used to leave the list permanently empty until a manual refresh
    // (inaugural-draft incident 2026-09-02).
    const fetchPlayers = async (attempt: number) => {
      const hasSearch = search.trim().length >= 2;
      const hasPos = posFilter !== "ALL";

      let q = supabase
        .from("players")
        .select("id, full_name, position, team, status, injury_status, adp")
        .not("position", "is", null);

      if (hasSearch) q = q.ilike("full_name", `%${search.trim()}%`);
      if (hasPos) q = q.eq("position", posFilter);

      // Default (ALL + no search): show top 60 by ADP
      const { data, error } = await q.order("adp", { ascending: true, nullsFirst: false }).limit(60);
      if (cancelled) return;
      if (error || !data) {
        // Back off and retry rather than clobbering whatever we already show.
        if (attempt < 4) setTimeout(() => { if (!cancelled) fetchPlayers(attempt + 1); }, 600 * (attempt + 1));
        return;
      }
      setPlayers(data as Player[]);
    };

    const timer = setTimeout(() => fetchPlayers(0), search ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, posFilter]);

  // Self-heal: if the DEFAULT available-player view is empty while the draft is
  // live, keep re-pulling the top 60 every 3s until it populates — so a manager
  // whose initial load lost the race recovers on their own, no refresh needed.
  useEffect(() => {
    const defaultView = search.trim().length < 2 && posFilter === "ALL";
    if (!defaultView || players.length > 0 || isDraftComplete) return;
    const id = setInterval(async () => {
      const { data } = await supabase
        .from("players")
        .select("id, full_name, position, team, status, injury_status, adp")
        .not("position", "is", null)
        .order("adp", { ascending: true, nullsFirst: false })
        .limit(60);
      if (data && data.length) setPlayers(data as Player[]);
    }, 3000);
    return () => clearInterval(id);
  }, [players.length, isDraftComplete, search, posFilter]);

  // Load queue on mount (and whenever myMemberId changes)
  useEffect(() => {
    if (draftStatus !== "not_started") fetchQueue();
  }, [fetchQueue, draftStatus]);

  // Sync watchlist player details whenever watchlistIds changes
  useEffect(() => {
    const ids = [...watchlistIds];
    if (ids.length === 0) { setWatchlistPlayers([]); return; }
    supabase
      .from("players")
      .select("id, full_name, position, team, status, injury_status, adp")
      .in("id", ids)
      .then(({ data }) => { if (data) setWatchlistPlayers(data as Player[]); });
  }, [watchlistIds]);

  // ---- Pick clock: server-anchored deadline (same on every client) ---------
  // Anchor = last pick's picked_at (or draft_started_at for pick #1).
  // Round-first picks get the 30s round buffer added, matching the buffer UI.
  const clockSecs = league.pick_clock_seconds ?? null;
  const lastPickAt = picks.length > 0 ? picks[picks.length - 1].picked_at : null;
  const clockAnchorIso = lastPickAt ?? league.draft_started_at ?? null;
  const isRoundFirstPick = (currentPickNo - 1) % league.max_teams === 0;
  const pickDeadlineMs =
    clockSecs && clockAnchorIso && draftStatus === "in_progress" && !isDraftComplete
      ? new Date(clockAnchorIso).getTime() + ((isRoundFirstPick ? 30 : 0) + clockSecs) * 1000
      : null;

  useEffect(() => {
    if (!pickDeadlineMs || roundBufferActive) {
      setTimeLeft(null);
      return;
    }
    const tick = () =>
      setTimeLeft(Math.max(0, Math.ceil((pickDeadlineMs - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [pickDeadlineMs, roundBufferActive]);

  // On-the-clock client: fire self-autodraft once when the deadline passes
  useEffect(() => {
    if (
      timeLeft === 0 &&
      isMyTurn &&
      !submitting &&
      !isDraftComplete &&
      pickDeadlineMs &&
      autopickFiredForPickRef.current !== currentPickNo
    ) {
      autopickFiredForPickRef.current = currentPickNo;
      handleAutodraft();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, isMyTurn, submitting, isDraftComplete, currentPickNo, pickDeadlineMs]);

  // Every OTHER client: safety net for an offline picker (audit U6). After the
  // deadline plus a grace window, any client may force the pick server-side.
  // Random jitter spreads the calls; the force_autopick RPC re-validates the
  // deadline and turn, so losers of the race are cheap no-ops.
  useEffect(() => {
    if (timeLeft !== 0 || isMyTurn || isDraftComplete || !pickDeadlineMs) return;
    if (forceFiredForPickRef.current === currentPickNo) return;
    const delay = 15000 + Math.random() * 5000; // 15s grace + 0-5s jitter
    const t = window.setTimeout(async () => {
      if (forceFiredForPickRef.current === currentPickNo) return;
      forceFiredForPickRef.current = currentPickNo;
      await forceAutopick(leagueId);
      fetchPicks();
    }, delay);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, isMyTurn, isDraftComplete, currentPickNo, pickDeadlineMs, leagueId]);

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

  // Next pick number for the current user (first future pick_no where they're on the clock)
  const myNextPickNo = (() => {
    if (isDraftComplete) return null;
    const startFrom = isMyTurn ? currentPickNo + 1 : currentPickNo;
    for (let pno = startFrom; pno <= totalPicks; pno++) {
      const s = snakeDraftSlot(pno, league.max_teams);
      if (activeDraftOrder[s - 1] === myMemberId) return pno;
    }
    return null;
  })();

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

  // ---- Watchlist handlers ----------------------------------------------------
  async function handleToggleWatchlist(playerId: string) {
    const inList = watchlistIds.has(playerId);
    // Optimistic update
    setWatchlistIds((prev) => {
      const next = new Set(prev);
      if (inList) next.delete(playerId); else next.add(playerId);
      return next;
    });
    if (inList) {
      await removeFromWatchlist(myMemberId, playerId, leagueId);
    } else {
      await addToWatchlist(myMemberId, playerId, leagueId);
    }
  }

  // ---- Draft Advisor ---------------------------------------------------------
  async function getPickAdvice() {
    setAdvisorState({ loading: true });
    try {
      const res = await fetch("/api/draft-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: leagueId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdvisorState({ loading: false, error: data.error ?? "Oracle could not advise" });
        return;
      }
      setAdvisorState({ loading: false, advice: data.advice });
    } catch {
      setAdvisorState({ loading: false, error: "Network error — try again" });
    }
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

  // ---- Commissioner proxy pick (draft for the on-the-clock no-show) ----------
  async function handleCommissionerPick(playerId: string, playerName: string, targetMemberId: string, teamName: string) {
    if (!window.confirm(`Draft ${playerName} for ${teamName}? This is a commissioner pick on their behalf.`)) return;
    // Capture the team's power for THIS round before the pick advances the clock.
    const powerNow = proxyPowers.find((p) => p.round === currentRound)?.draft_powers ?? null;
    const roundNow = currentRound;
    const hasFuturePeek = proxyPowers.some((p) => p.round > roundNow && p.round <= roundNow + 2);
    setError(null);
    setPowerResult(null);
    setSubmitting(true);
    try {
      const result = await commissionerPick(leagueId, targetMemberId, playerId);
      if (result?.error) {
        setError(result.error);
      } else {
        setSuccess(`Drafted ${playerName} for ${teamName}.`);
        await fetchPicks();
        setTimeout(() => setSuccess(null), 4000);
        // Apply the team's INTERACTIVE power on their behalf (position-tied powers
        // already auto-attached inside the RPC). Draft Heist is pre-pick (banner button).
        if (powerNow?.name === "Vampire Bite") {
          setProxyVB({ memberId: targetMemberId, teamName, round: roundNow });
        } else if (powerNow?.name === "Foresight Coin") {
          if (hasFuturePeek) {
            setProxyFC({ memberId: targetMemberId, teamName, round: roundNow });
          } else {
            setPowerResult({ type: "meta", message: `Foresight Coin (${teamName}) — no future rounds to swap.` });
            setTimeout(() => setPowerResult(null), 5000);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commissioner pick failed.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Commissioner proxy power handlers -------------------------------------
  async function handleProxyVampireBite(targetPlayerId: string) {
    if (!proxyVB) return;
    setProxySubmitting(true);
    const result = await commissionerVampireBite(leagueId, proxyVB.memberId, targetPlayerId, proxyVB.round);
    setProxySubmitting(false);
    const team = proxyVB.teamName;
    setProxyVB(null);
    if (result.error) {
      setError(result.error);
    } else {
      setPowerResult({ type: "applied", message: `Vampire Bite locked in for ${team} — 10% of that player's weekly score drains to them all season.` });
      setTimeout(() => setPowerResult(null), 6000);
    }
  }

  async function handleProxyForesight(swapWithRound: number) {
    if (!proxyFC) return;
    setProxySubmitting(true);
    const team = proxyFC.teamName;
    if (swapWithRound !== proxyFC.round) {
      const result = await commissionerForesightSwap(leagueId, proxyFC.memberId, proxyFC.round, swapWithRound);
      if (result.error) {
        setError(result.error);
      } else {
        const swappedName = proxyPowers.find((p) => p.round === swapWithRound)?.draft_powers?.name ?? "Unknown";
        setProxyPowers((prev) => {
          const next = prev.map((p) => ({ ...p }));
          const ci = next.findIndex((p) => p.round === proxyFC.round);
          const si = next.findIndex((p) => p.round === swapWithRound);
          if (ci !== -1 && si !== -1) {
            const tmp = next[ci].draft_powers;
            next[ci] = { ...next[ci], draft_powers: next[si].draft_powers };
            next[si] = { ...next[si], draft_powers: tmp };
          }
          return next;
        });
        setPowerResult({ type: "applied", message: `Foresight Coin (${team}) — swapped to Round ${swapWithRound}'s power: ${swappedName}!` });
        setTimeout(() => setPowerResult(null), 6000);
      }
    } else {
      setPowerResult({ type: "meta", message: `Foresight Coin (${team}) — kept this round's power.` });
      setTimeout(() => setPowerResult(null), 5000);
    }
    setProxySubmitting(false);
    setProxyFC(null);
  }

  async function handleProxyHeist(targetMemberId: string) {
    if (!proxyHeist) return;
    setProxySubmitting(true);
    const team = proxyHeist.teamName;
    const actingMemberId = proxyHeist.memberId;
    const result = await commissionerHeist(leagueId, actingMemberId, targetMemberId);
    setProxySubmitting(false);
    setProxyHeist(null);
    if (result.error) {
      setError(result.error);
    } else if (result.blocked) {
      setPowerResult({ type: "blocked", message: `Draft Heist blocked! ${result.blockerTeam ?? "That team"} has Hero's Shield this round.` });
      setTimeout(() => setPowerResult(null), 8000);
    } else {
      // Reflect the swapped order locally so the board updates immediately.
      const newOrder = [...activeDraftOrder];
      const aIdx = newOrder.indexOf(actingMemberId);
      const tIdx = newOrder.indexOf(targetMemberId);
      if (aIdx !== -1 && tIdx !== -1) { newOrder[aIdx] = targetMemberId; newOrder[tIdx] = actingMemberId; }
      setHeistOriginalOrder(activeDraftOrder);
      setHeistUsedRound(currentRound);
      setDraftOrderState(newOrder);
      const targetTeam = memberMap[targetMemberId]?.team_name ?? "target";
      setPowerResult({ type: "applied", message: `Draft Heist executed for ${team} — swapped draft slots with ${targetTeam} this round!` });
      setTimeout(() => setPowerResult(null), 8000);
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

      {/* Commissioner proxy modals — apply a no-show's interactive power on their behalf */}
      {proxyVB && (
        <VampireBiteModal
          picks={picks}
          memberMap={memberMap}
          forTeam={proxyVB.teamName}
          onSelect={handleProxyVampireBite}
          onSkip={() => {
            setProxyVB(null);
            setPowerResult({ type: "fizzled", message: `Vampire Bite skipped for ${proxyVB.teamName} — power forfeited.` });
            setTimeout(() => setPowerResult(null), 5000);
          }}
          submitting={proxySubmitting}
        />
      )}
      {proxyFC && (
        <ForesightCoinModal
          currentRound={proxyFC.round}
          myPowers={proxyPowers}
          forTeam={proxyFC.teamName}
          onSelect={handleProxyForesight}
          submitting={proxySubmitting}
        />
      )}
      {proxyHeist && (
        <HeistModal
          members={members}
          myMemberId={proxyHeist.memberId}
          memberMap={memberMap}
          forTeam={proxyHeist.teamName}
          pickedThisRound={new Set(picks.filter((p) => p.round === currentRound).map((p) => p.member_id))}
          onSelect={handleProxyHeist}
          onSkip={() => {
            setProxyHeist(null);
            setPowerResult({ type: "fizzled", message: `Draft Heist skipped for ${proxyHeist.teamName} — power forfeited this round.` });
            setTimeout(() => setPowerResult(null), 5000);
          }}
          submitting={proxySubmitting}
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

        {/* Round buffer banner — shown at the start of each round */}
        {!isDraftComplete && roundBufferActive && (
          <div
            className="rounded-lg border px-5 py-4 flex flex-col gap-3"
            style={{ borderColor: "#FFD700", background: "rgba(255,215,0,0.06)" }}
          >
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] mb-1" style={{ color: "#FFD700" }}>
                  Round {currentRound} Begins
                </p>
                <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>
                  Pre-round buffer — activate powers before picks start
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#8888aa" }}>
                  Draft Heist &amp; Telepathy can be used now · Picks begin when timer expires
                </p>
              </div>
              <div
                className="flex items-center justify-center rounded-full font-bold tabular-nums shrink-0"
                style={{
                  width: 56, height: 56,
                  background: roundBufferTimeLeft <= 5 ? "rgba(204,0,0,0.18)" : "rgba(255,215,0,0.10)",
                  border: `2px solid ${roundBufferTimeLeft <= 5 ? "#CC0000" : "#FFD700"}`,
                  color: roundBufferTimeLeft <= 5 ? "#CC0000" : "#FFD700",
                  fontSize: 20,
                }}
              >
                {roundBufferTimeLeft}
              </div>
            </div>

            {/* Telepathy reveal */}
            {bufferTelepathyReveal && (
              <div className="rounded-md border px-3 py-2.5" style={{ borderColor: "#0057FF", background: "#0a0e1a" }}>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: "#0057FF" }}>
                  🧠 Telepathy — First Picker This Round
                </p>
                {bufferTelepathyReveal.cloaked ? (
                  <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>
                    {bufferTelepathyReveal.teamName} — power is <span style={{ color: "#8888aa" }}>Shadow Guard</span>
                  </p>
                ) : bufferTelepathyReveal.powerName ? (
                  <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>
                    {bufferTelepathyReveal.teamName} has{" "}
                    <span style={{ color: "#FFD700" }}>{bufferTelepathyReveal.powerName}</span>
                  </p>
                ) : (
                  <p className="text-sm" style={{ color: "#f4f4f8" }}>
                    {bufferTelepathyReveal.teamName} — no power this round
                  </p>
                )}
              </div>
            )}

            {/* My power reminder during buffer */}
            {myPowerThisRound?.draft_powers && (
              <div className="rounded-md border px-3 py-2" style={{ borderColor: "#2a2a40", background: "#0d0d1a" }}>
                <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: "#8888aa" }}>Your power this round</p>
                <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>
                  {myPowerThisRound.draft_powers.name}
                  {myPowerThisRound.draft_powers.tied_position &&
                    myPowerThisRound.draft_powers.tied_position !== "ANY" && (
                      <span className="ml-2 rounded px-1.5 py-0.5 text-xs font-normal" style={{ background: "#1c1c2b", color: "#f4f4f8" }}>
                        {myPowerThisRound.draft_powers.tied_position} only
                      </span>
                    )}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: "#d4d4e8" }}>
                  {myPowerThisRound.draft_powers.description}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Turn banner — shown only when buffer is not active */}
        {!isDraftComplete && !roundBufferActive && (
          <div
            className="rounded-lg border px-5 py-4"
            style={{
              borderColor: isMyTurn ? "#FFD700" : isProxyMode ? "#7A5CFF" : "#2a2a40",
              background: isMyTurn ? "rgba(255,215,0,0.07)" : isProxyMode ? "rgba(122,92,255,0.12)" : "#15151f",
              boxShadow: isProxyMode ? "0 0 0 1px rgba(122,92,255,0.35)" : undefined,
            }}
          >
            {isMyTurn ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-4 flex-wrap">
                  <p className="font-semibold" style={{ color: "#FFD700" }}>
                    {timeLeft === 0 ? "Time’s up — autopicking…" : "It’s your turn — pick now!"}
                  </p>
                  {timeLeft !== null && timeLeft > 0 && (
                    <div
                      className="flex items-center justify-center rounded-full font-bold tabular-nums"
                      style={{
                        width: 52, height: 52, flexShrink: 0,
                        background: timeLeft <= 10 ? "rgba(204,0,0,0.18)" : "rgba(255,215,0,0.10)",
                        border: `2px solid ${timeLeft <= 10 ? "#CC0000" : "#FFD700"}`,
                        color: timeLeft <= 10 ? "#CC0000" : "#FFD700",
                        fontSize: timeLeft >= 100 ? 14 : 18,
                      }}
                    >
                      {timeLeft}
                    </div>
                  )}
                </div>
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
            ) : isProxyMode ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] font-bold" style={{ color: "#B9A6FF" }}>
                      ⚡ Commissioner Proxy
                    </p>
                    <p className="mt-1 text-lg font-bold" style={{ color: "#f4f4f8" }}>
                      You are drafting for{" "}
                      <span style={{ color: "#B9A6FF" }}>{currentMember?.team_name ?? "this team"}</span>
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: "#c9c2f0" }}>
                      This is <span className="font-semibold">not your team</span> — use the purple
                      “Draft for {currentMember?.team_name ?? "this team"}” buttons in the player list below.
                    </p>
                  </div>
                  {timeLeft !== null && timeLeft > 0 && (
                    <div
                      className="flex items-center justify-center rounded-full font-bold tabular-nums shrink-0"
                      style={{
                        width: 52, height: 52,
                        background: timeLeft <= 10 ? "rgba(204,0,0,0.18)" : "rgba(122,92,255,0.15)",
                        border: `2px solid ${timeLeft <= 10 ? "#CC0000" : "#7A5CFF"}`,
                        color: timeLeft <= 10 ? "#CC0000" : "#B9A6FF",
                        fontSize: timeLeft >= 100 ? 14 : 18,
                      }}
                    >
                      {timeLeft}
                    </div>
                  )}
                </div>
                {proxyPowerThisRound && (
                  <div className="rounded-md border px-3 py-2.5" style={{ borderColor: "#7A5CFF", background: "#12101f" }}>
                    <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: "#B9A6FF" }}>
                      {currentMember?.team_name ?? "This team"}’s power this round
                    </p>
                    <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>
                      {proxyPowerThisRound.name}
                      {proxyPowerThisRound.tied_position && proxyPowerThisRound.tied_position !== "ANY" && (
                        <span className="ml-2 rounded px-1.5 py-0.5 text-xs font-normal" style={{ background: "#1c1c2b", color: "#f4f4f8" }}>
                          {proxyPowerThisRound.tied_position} only
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: "#c9c2f0" }}>{proxyPowerThisRound.description}</p>
                    {proxyPowerThisRound.name === "Draft Heist" && currentMemberId && currentMember && (
                      <button
                        onClick={() => setProxyHeist({ memberId: currentMemberId, teamName: currentMember.team_name, round: currentRound })}
                        disabled={proxySubmitting}
                        className="mt-2 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        style={{ background: "#CC0000", color: "#f4f4f8" }}
                      >
                        Use Draft Heist for {currentMember.team_name} (before picking)
                      </button>
                    )}
                    {(proxyPowerThisRound.name === "Vampire Bite" || proxyPowerThisRound.name === "Foresight Coin") && (
                      <p className="mt-1.5 text-xs font-semibold" style={{ color: "#B9A6FF" }}>
                        You’ll choose how to use {proxyPowerThisRound.name} right after you make {currentMember?.team_name ?? "their"} pick.
                      </p>
                    )}
                  </div>
                )}
                {timeLeft === 0 && (
                  <p className="text-xs font-semibold" style={{ color: "#CC0000" }}>
                    Clock expired — pick now for {currentMember?.team_name ?? "this team"} or it will autopick.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm text-white">
                  {timeLeft === 0 ? (
                    <>
                      <span className="font-semibold" style={{ color: "#CC0000" }}>
                        {currentMember?.team_name ?? "Another manager"}
                      </span>{" "}
                      ran out of time — autopicking…
                    </>
                  ) : (
                    <>
                      Waiting on{" "}
                      <span className="font-semibold" style={{ color: "#f4f4f8" }}>
                        {currentMember?.team_name ?? "another manager"}
                      </span>{" "}
                      to pick...
                    </>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  {timeLeft !== null && timeLeft > 0 && (
                    <span
                      className="rounded-full px-3 py-1 text-xs font-bold tabular-nums"
                      style={{
                        background: timeLeft <= 10 ? "rgba(204,0,0,0.18)" : "#1c1c2b",
                        color: timeLeft <= 10 ? "#CC0000" : "#d4d4e8",
                        border: `1px solid ${timeLeft <= 10 ? "#CC0000" : "#2a2a40"}`,
                      }}
                    >
                      ⏱ {timeLeft}s
                    </span>
                  )}
                  {myNextPickNo !== null && (
                    <span
                      className="rounded-full px-3 py-1 text-xs font-semibold"
                      style={{ background: "#1c1c2b", color: "#FFD700", border: "1px solid rgba(255,215,0,0.25)" }}
                    >
                      Your next pick: #{myNextPickNo}
                    </span>
                  )}
                </div>
              </div>
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
                Shadow Guard active — this manager&rsquo;s pick is shielded from Vampire Bite.
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
                const inWatch = watchlistIds.has(p.id);
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                    style={{ borderColor: inWatch ? "rgba(61,220,132,0.3)" : "#2a2a40" }}
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
                      <button
                        onClick={() => handleToggleWatchlist(p.id)}
                        title={inWatch ? "Remove from watchlist" : "Add to watchlist"}
                        className="shrink-0 text-sm leading-none transition-colors"
                        style={{ color: inWatch ? "#3DDC84" : "#2a2a40" }}
                      >
                        ♥
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-semibold truncate">{p.full_name}</p>
                          <InjuryBadge injuryStatus={p.injury_status} />
                        </div>
                        <p className="text-xs text-white">
                          {p.position ?? "?"} - {p.team ?? "FA"}
                        </p>
                      </div>
                    </div>
                    {isMyTurn && !roundBufferActive && (
                      <button
                        onClick={() => handlePick(p.id, p.position ?? "")}
                        disabled={submitting}
                        className="ml-3 shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        style={{ background: "#0057FF", color: "#f4f4f8" }}
                      >
                        {submitting ? "..." : "Draft"}
                      </button>
                    )}
                    {isCommissioner && !isMyTurn && !isDraftComplete && !roundBufferActive && currentMemberId && currentMember && (
                      <button
                        onClick={() => handleCommissionerPick(p.id, p.full_name, currentMemberId, currentMember.team_name)}
                        disabled={submitting}
                        className="ml-3 shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        style={{ background: "#7A5CFF", color: "#f4f4f8" }}
                        title={`Commissioner: draft ${p.full_name} for ${currentMember.team_name}`}
                      >
                        {submitting ? "..." : `Draft for ${currentMember.team_name}`}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Right: queue + draft order + my powers */}
          <aside className="flex flex-col gap-5">

            {/* Draft Advisor */}
            {!isDraftComplete && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#FFD700" }}>
                  Draft Advisor
                </h3>
                {!advisorState.advice && !advisorState.loading && !advisorState.error && (
                  <button
                    onClick={getPickAdvice}
                    className="rounded-md px-3 py-2 text-xs font-semibold transition hover:opacity-80"
                    style={{ background: "rgba(255,215,0,0.1)", color: "#FFD700", border: "1px solid rgba(255,215,0,0.3)" }}
                  >
                    🧠 Advise My Next Pick
                  </button>
                )}
                {advisorState.loading && (
                  <p className="text-xs italic" style={{ color: "#8888aa" }}>
                    Oracle is scanning the board…
                  </p>
                )}
                {advisorState.error && (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs" style={{ color: "#ff8a8a" }}>{advisorState.error}</p>
                    <button
                      onClick={() => setAdvisorState({ loading: false })}
                      className="self-start text-xs underline"
                      style={{ color: "#CC0000" }}
                    >
                      Try again
                    </button>
                  </div>
                )}
                {advisorState.advice && (() => {
                  // Parse PICK: line for highlighted display
                  const pickMatch = advisorState.advice.match(/PICK:\s*(.+)/i);
                  const pickLine = pickMatch?.[1]?.trim() ?? null;
                  const prose = advisorState.advice.replace(/PICK:\s*.+/i, "").trim();
                  return (
                    <div className="flex flex-col gap-2 rounded-lg border p-2.5" style={{ borderColor: "rgba(255,215,0,0.25)", background: "rgba(255,215,0,0.04)" }}>
                      {prose && (
                        <p className="text-xs leading-relaxed" style={{ color: "#d4d4e8" }}>{prose}</p>
                      )}
                      {pickLine && (
                        <div className="rounded border px-2 py-1.5" style={{ borderColor: "#FFD70055", background: "rgba(255,215,0,0.08)" }}>
                          <p className="text-xs uppercase tracking-wide" style={{ color: "#FFD700" }}>Oracle Pick</p>
                          <p className="text-sm font-bold" style={{ color: "#FFD700" }}>{pickLine}</p>
                        </div>
                      )}
                      <button
                        onClick={() => setAdvisorState({ loading: false })}
                        className="self-start text-xs underline"
                        style={{ color: "#8888aa" }}
                      >
                        Ask again
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}

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

            {/* Watchlist */}
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#3DDC84" }}>
                Watchlist {watchlistIds.size > 0 && <span className="ml-1 text-xs font-normal" style={{ color: "#f4f4f8" }}>({watchlistIds.size})</span>}
              </h3>
              {watchlistIds.size === 0 ? (
                <p className="text-xs" style={{ color: "#f4f4f8" }}>
                  Click ♥ on a player to add them to your watchlist.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {watchlistPlayers.map((p) => {
                    const isDrafted = pickedIds.has(p.id);
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 rounded border px-2 py-1.5"
                        style={{
                          borderColor: isDrafted ? "#1a1a2e" : "rgba(61,220,132,0.25)",
                          background: isDrafted ? "rgba(255,255,255,0.02)" : "transparent",
                          opacity: isDrafted ? 0.45 : 1,
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: "#f4f4f8" }}>
                            {p.full_name}
                          </p>
                          <p className="text-xs" style={{ color: isDrafted ? "#CC0000" : "#8888aa" }}>
                            {p.position ?? "?"} · {p.team ?? "FA"}
                            {isDrafted && " · Drafted"}
                          </p>
                        </div>
                        {!isDrafted && isMyTurn && (
                          <button
                            onClick={() => handlePick(p.id, p.position ?? "")}
                            disabled={submitting}
                            className="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold disabled:opacity-50"
                            style={{ background: "#0057FF", color: "#f4f4f8" }}
                          >
                            Draft
                          </button>
                        )}
                        <button
                          onClick={() => handleToggleWatchlist(p.id)}
                          className="shrink-0 text-xs leading-none"
                          style={{ color: "#CC0000" }}
                          title="Remove from watchlist"
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
                    {dp?.name && POWER_HINTS[dp.name] && (
                      <p className="text-xs" style={{ color: dp.name === "Power Negation" ? "#CC6666" : "#8888aa" }}>
                        {POWER_HINTS[dp.name]}
                      </p>
                    )}
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
