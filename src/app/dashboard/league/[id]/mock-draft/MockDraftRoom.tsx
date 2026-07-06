"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Player {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  adp: number | null;
  injury_status: string | null;
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
  draft_order: string[];
  max_teams: number;
  draft_rounds: number;
}

interface PowerInfo {
  id: number;
  name: string;
  category: string | null;
  description: string;
  tied_position: string | null;
}

interface PowerAssignmentRow {
  member_id: string;
  round: number;
  draft_powers: PowerInfo | null;
}

interface MockPick {
  round: number;
  pickNo: number;
  memberId: string;
  playerId: string;
  playerName: string;
  playerPosition: string;
  playerTeam: string;
  powerApplied: string | null;
}

interface PowerEvent {
  id: number;
  text: string;
  color: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const POS_COLORS: Record<string, string> = {
  QB: "#FF6B35",
  RB: "#3DDC84",
  WR: "#0057FF",
  TE: "#FFD700",
  K: "#a78bfa",
  DEF: "#CC0000",
};

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

// How many of each position each CPU team should target per draft
const POS_TARGETS: Record<string, number> = {
  QB: 2,
  RB: 5,
  WR: 5,
  TE: 2,
  K: 1,
  DEF: 1,
};

// Priority order for CPU picks at each point in the draft
const POS_PRIORITY_TIERS = [
  ["RB", "WR"],       // Early rounds — skill positions
  ["QB", "TE"],       // Mid rounds
  ["RB", "WR", "TE"], // Fill flex
  ["QB", "RB", "WR"], // Late depth
  ["K", "DEF"],       // Final rounds
];

function getPosColor(pos: string | null): string {
  return POS_COLORS[pos ?? ""] ?? "#f4f4f8";
}

function pickNoForSlot(round: number, col: number, maxTeams: number): number {
  const posInRound = round % 2 === 1 ? col : maxTeams - col + 1;
  return (round - 1) * maxTeams + posInRound;
}

function memberIdxForPickNo(pickNo: number, maxTeams: number): number {
  const round = Math.ceil(pickNo / maxTeams);
  const posInRound = pickNo - (round - 1) * maxTeams;
  return round % 2 === 1 ? posInRound - 1 : maxTeams - posInRound;
}

// ─────────────────────────────────────────────────────────────────────────────
// CPU pick logic
// ─────────────────────────────────────────────────────────────────────────────

function getRosterCounts(picks: MockPick[], memberId: string): Record<string, number> {
  const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  for (const p of picks) {
    if (p.memberId === memberId && p.playerPosition in counts) {
      counts[p.playerPosition]++;
    }
  }
  return counts;
}

function matchesPosition(playerPos: string | null, required: string): boolean {
  if (!playerPos) return false;
  if (required === "ANY") return true;
  if (required === "WR/RB/TE") return ["WR", "RB", "TE"].includes(playerPos);
  if (required === "D/ST") return playerPos === "DEF";
  return playerPos === required;
}

function getBestAvailableByNeed(
  available: Player[],
  rosterCounts: Record<string, number>,
  round: number,
  draftRounds: number
): Player | null {
  if (available.length === 0) return null;

  // Determine which positions still have room
  const needed = Object.entries(POS_TARGETS)
    .filter(([pos, target]) => (rosterCounts[pos] ?? 0) < target)
    .map(([pos]) => pos);

  if (needed.length === 0) return available[0];

  // Tier priority based on round progress
  const tierIdx = Math.min(
    Math.floor((round / draftRounds) * POS_PRIORITY_TIERS.length),
    POS_PRIORITY_TIERS.length - 1
  );
  const tierPositions = POS_PRIORITY_TIERS[tierIdx];

  // Find best available player matching tier priority AND needed
  for (const pos of tierPositions) {
    if (!needed.includes(pos)) continue;
    const match = available.find((p) => p.position === pos);
    if (match) return match;
  }

  // Fallback: any needed position
  for (const pos of needed) {
    const match = available.find((p) => p.position === pos);
    if (match) return match;
  }

  return available[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Small UI bits
// ─────────────────────────────────────────────────────────────────────────────

function InjuryBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, { label: string; color: string }> = {
    Out: { label: "OUT", color: "#ff6b6b" },
    Doubtful: { label: "D", color: "#ff8a8a" },
    Questionable: { label: "Q", color: "#FFD700" },
    IR: { label: "IR", color: "#8888aa" },
  };
  const s = map[status];
  if (!s) return null;
  return (
    <span
      className="ml-1 rounded px-1 text-xs font-bold"
      style={{ background: "rgba(255,255,255,0.08)", color: s.color }}
    >
      {s.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modals
// ─────────────────────────────────────────────────────────────────────────────

function VampireBiteModal({
  picks,
  memberMap,
  shadowGuarded,
  myMemberId,
  onSelect,
  onSkip,
}: {
  picks: MockPick[];
  memberMap: Record<string, Member>;
  shadowGuarded: Set<string>;
  myMemberId: string;
  onSelect: (playerId: string, playerName: string) => void;
  onSkip: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  const eligible = picks.filter(
    (p) => p.memberId !== myMemberId && !shadowGuarded.has(p.playerId)
  );
  const filtered = eligible.filter((p) =>
    !search.trim() || p.playerName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)" }}>
      <div className="mx-4 flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border p-6"
        style={{ background: "#0d0d1a", borderColor: "#CC0000" }}>
        <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "#CC0000" }}>🧛 Vampire Bite</p>
        <h2 className="mt-1 text-xl font-bold" style={{ color: "#f4f4f8" }}>Choose your target</h2>
        <p className="mt-1 mb-3 text-sm" style={{ color: "#d4d4e8" }}>
          10% of their weekly score drains to you all season.
        </p>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2 w-full rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
        />
        <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1" style={{ maxHeight: "40vh" }}>
          {filtered.length === 0 && (
            <p className="py-4 text-center text-sm" style={{ color: "#6b6b8a" }}>No eligible targets.</p>
          )}
          {filtered.map((pick) => {
            const isSelected = selected?.id === pick.playerId;
            const owner = memberMap[pick.memberId];
            return (
              <button
                key={pick.playerId}
                onClick={() => setSelected({ id: pick.playerId, name: pick.playerName })}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-left"
                style={{
                  borderColor: isSelected ? "#CC0000" : "#2a2a40",
                  background: isSelected ? "rgba(204,0,0,0.12)" : "#15151f",
                }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>{pick.playerName}</p>
                  <p className="text-xs" style={{ color: getPosColor(pick.playerPosition) }}>
                    {pick.playerPosition} · {pick.playerTeam} · {owner?.team_name ?? ""}
                  </p>
                </div>
                {isSelected && <span className="text-xs font-bold" style={{ color: "#CC0000" }}>LOCKED</span>}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => selected && onSelect(selected.id, selected.name)}
            disabled={!selected}
            className="flex-1 rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: "#CC0000", color: "#f4f4f8" }}
          >
            {selected ? `Bite ${selected.name.split(" ").pop()}` : "Select target"}
          </button>
          <button onClick={onSkip} className="rounded-md px-4 py-2.5 text-sm"
            style={{ background: "#1c1c2b", color: "#f4f4f8" }}>
            Skip
          </button>
        </div>
        <p className="mt-2 text-center text-xs" style={{ color: "#6b6b8a" }}>Skipping forfeits the bite.</p>
      </div>
    </div>
  );
}

function HeistModal({
  members,
  myMemberId,
  draftOrder,
  pickedThisRound,
  heroShieldedThisRound,
  onSelect,
  onSkip,
}: {
  members: Member[];
  myMemberId: string;
  draftOrder: string[];
  pickedThisRound: Set<string>;
  heroShieldedThisRound: Set<string>;
  onSelect: (targetMemberId: string) => void;
  onSkip: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const myIdx = draftOrder.indexOf(myMemberId);
  // Only allow stealing from teams who haven't picked yet AND are picking before me
  const targets = draftOrder
    .slice(0, myIdx)
    .filter((id) => !pickedThisRound.has(id))
    .map((id) => members.find((m) => m.id === id))
    .filter(Boolean) as Member[];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)" }}>
      <div className="mx-4 flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border p-6"
        style={{ background: "#0d0d1a", borderColor: "#CC0000" }}>
        <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "#CC0000" }}>💥 Draft Heist</p>
        <h2 className="mt-1 text-xl font-bold" style={{ color: "#f4f4f8" }}>Steal a pick slot</h2>
        <p className="mt-1 mb-4 text-sm" style={{ color: "#d4d4e8" }}>
          Swap draft positions for this round only. Target teams picking before you.
        </p>
        <div className="flex flex-col gap-2 overflow-y-auto pr-1" style={{ maxHeight: "40vh" }}>
          {targets.length === 0 && (
            <p className="py-4 text-center text-sm" style={{ color: "#6b6b8a" }}>
              No valid targets — you already have the earliest slot this round.
            </p>
          )}
          {targets.map((m) => {
            const isSelected = selected === m.id;
            const shielded = heroShieldedThisRound.has(m.id);
            return (
              <button
                key={m.id}
                onClick={() => !shielded && setSelected(m.id)}
                disabled={shielded}
                className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-left"
                style={{
                  borderColor: isSelected ? "#CC0000" : "#2a2a40",
                  background: isSelected ? "rgba(204,0,0,0.12)" : shielded ? "rgba(0,0,0,0.2)" : "#15151f",
                  opacity: shielded ? 0.5 : 1,
                }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>{m.team_name}</p>
                  <p className="text-xs" style={{ color: m.faction === "hero" ? "#0057FF" : "#CC0000" }}>
                    {m.faction ?? "Unassigned"}
                    {shielded && <span className="ml-2 font-bold" style={{ color: "#FFD700" }}>🛡 Hero&apos;s Shield</span>}
                  </p>
                </div>
                {isSelected && <span className="text-xs font-bold" style={{ color: "#CC0000" }}>TARGET</span>}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => selected && onSelect(selected)}
            disabled={!selected}
            className="flex-1 rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: "#CC0000", color: "#f4f4f8" }}
          >
            {selected ? "Execute Heist" : "Select target"}
          </button>
          <button onClick={onSkip} className="rounded-md px-4 py-2.5 text-sm"
            style={{ background: "#1c1c2b", color: "#f4f4f8" }}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

function ForesightModal({
  currentRound,
  powersMap,
  myMemberId,
  draftRounds,
  onSelect,
}: {
  currentRound: number;
  powersMap: Record<number, PowerInfo | null>;
  myMemberId: string;
  draftRounds: number;
  onSelect: (swapWithRound: number) => void;
}) {
  const [selected, setSelected] = useState(currentRound);
  const options = [currentRound, currentRound + 1, currentRound + 2]
    .filter((r) => r <= draftRounds)
    .map((r) => ({ round: r, power: powersMap[r] ?? null }))
    .filter((o) => o.power !== null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)" }}>
      <div className="mx-4 w-full max-w-md rounded-xl border p-6"
        style={{ background: "#0d0d1a", borderColor: "#FFD700" }}>
        <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "#FFD700" }}>🪙 Foresight Coin</p>
        <h2 className="mt-1 text-xl font-bold" style={{ color: "#f4f4f8" }}>Choose your power</h2>
        <p className="mt-1 mb-4 text-sm" style={{ color: "#d4d4e8" }}>Keep this round&apos;s power or swap with a future round.</p>
        <div className="flex flex-col gap-2">
          {options.map(({ round, power }) => {
            const isSelected = selected === round;
            return (
              <button key={round}
                onClick={() => setSelected(round)}
                className="rounded-lg border px-4 py-3 text-left"
                style={{ borderColor: isSelected ? "#FFD700" : "#2a2a40", background: isSelected ? "rgba(255,215,0,0.08)" : "#15151f" }}>
                <p className="text-xs uppercase mb-0.5" style={{ color: "#FFD700" }}>
                  Round {round}{round === currentRound ? " · current" : ""}
                </p>
                <p className="text-sm font-semibold" style={{ color: "#f4f4f8" }}>{power?.name}</p>
                <p className="text-xs mt-0.5" style={{ color: "#d4d4e8" }}>{power?.description}</p>
              </button>
            );
          })}
        </div>
        <button
          onClick={() => onSelect(selected)}
          className="mt-4 w-full rounded-md px-4 py-2.5 text-sm font-semibold"
          style={{ background: "#FFD700", color: "#0d0d1a" }}
        >
          {selected === currentRound ? "Keep current power" : `Swap — take Round ${selected}'s power`}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function MockDraftRoom({
  league,
  members,
  myMemberId,
  allPowerRows,
  players,
}: {
  league: League;
  members: Member[];
  myMemberId: string;
  allPowerRows: PowerAssignmentRow[];
  players: Player[];
}) {
  // ── Derived constants ──────────────────────────────────────────────────────
  const totalPicks = league.max_teams * league.draft_rounds;
  const memberMap = Object.fromEntries(members.map((m) => [m.id, m]));
  const playerMap = Object.fromEntries(players.map((p) => [p.id, p]));

  // allPowersMap[memberId][round] = PowerInfo | null
  const allPowersMap: Record<string, Record<number, PowerInfo | null>> = {};
  for (const row of allPowerRows) {
    if (!allPowersMap[row.member_id]) allPowersMap[row.member_id] = {};
    allPowersMap[row.member_id][row.round] = row.draft_powers;
  }

  const hasPowers = allPowerRows.length > 0;

  // ── Draft state ────────────────────────────────────────────────────────────
  const [picks, setPicks] = useState<MockPick[]>([]);
  const [draftOrder, setDraftOrder] = useState<string[]>(league.draft_order);

  // Power tracking
  const [shadowGuarded, setShadowGuarded] = useState<Set<string>>(new Set());
  const [heroShieldRounds, setHeroShieldRounds] = useState<Record<string, Set<number>>>({});
  const [vampireBites, setVampireBites] = useState<Record<string, string>>({}); // biterMemberId → targetPlayerId
  const [powerEvents, setPowerEvents] = useState<PowerEvent[]>([]);
  const eventIdRef = useRef(0);
  const prevRoundRef = useRef<number>(0); // tracks last round seen for buffer trigger

  // Modal state
  const [showVampireModal, setShowVampireModal] = useState(false);
  const [showHeistModal, setShowHeistModal] = useState(false);
  const [showForesightModal, setShowForesightModal] = useState(false);
  const [pendingPickPlayer, setPendingPickPlayer] = useState<Player | null>(null);
  // Foresight Coin swaps: overrides allPowersMap for the user's rounds
  const [userPowerOverrides, setUserPowerOverrides] = useState<Record<number, PowerInfo | null>>({});

  // UI state
  const [posFilter, setPosFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [showBoard, setShowBoard] = useState(false);
  const [activeTab, setActiveTab] = useState<"players" | "roster" | "log">("players");
  const [cpuThinking, setCpuThinking] = useState(false);
  // Round buffer state
  const [bufferActive, setBufferActive] = useState(false);
  const [bufferTimeLeft, setBufferTimeLeft] = useState(30);

  // ── Derived current pick state ─────────────────────────────────────────────
  const currentPickNo = picks.length + 1;
  const isDraftComplete = picks.length >= totalPicks;
  const currentRound = Math.ceil(currentPickNo / league.max_teams);
  const currentMemberIdx = memberIdxForPickNo(currentPickNo, league.max_teams);
  const currentMemberId = draftOrder[currentMemberIdx] ?? "";
  const isMyTurn = !isDraftComplete && currentMemberId === myMemberId;

  const myPicks = picks.filter((p) => p.memberId === myMemberId);

  // Picks this round (for Heist modal)
  const picksThisRound = new Set(
    picks
      .filter((p) => p.round === currentRound)
      .map((p) => p.memberId)
  );

  // Hero's Shield this round
  const heroShieldedThisRound = new Set(
    Object.entries(heroShieldRounds)
      .filter(([, rounds]) => rounds.has(currentRound))
      .map(([memberId]) => memberId)
  );

  // Available players
  const draftedIds = new Set(picks.map((p) => p.playerId));
  const availablePlayers = players.filter((p) => !draftedIds.has(p.id));

  const filteredPlayers = availablePlayers.filter((p) => {
    const matchPos = posFilter === "ALL" || p.position === posFilter;
    const matchSearch = !search.trim() || p.full_name.toLowerCase().includes(search.toLowerCase());
    return matchPos && matchSearch;
  });

  // Quick lookup: power name → description (for inline badges)
  const powerDescByName: Record<string, string> = {};
  for (const row of allPowerRows) {
    if (row.draft_powers && !powerDescByName[row.draft_powers.name]) {
      powerDescByName[row.draft_powers.name] = row.draft_powers.description;
    }
  }

  // ── Power event logger ─────────────────────────────────────────────────────
  const addEvent = useCallback((text: string, color: string = "#FFD700") => {
    const id = ++eventIdRef.current;
    setPowerEvents((prev) => [{ id, text, color }, ...prev].slice(0, 40));
  }, []);

  // ── Apply pick (shared by user + CPU) ─────────────────────────────────────
  const applyPick = useCallback(
    (player: Player, memberId: string, pickNo: number, round: number, powerOverride?: PowerInfo | null) => {
      // powerOverride: explicit value passed by user-pick paths (supports Foresight Coin swaps)
      // undefined = look up from allPowersMap (CPU path)
      const power = powerOverride !== undefined
        ? powerOverride
        : (hasPowers ? allPowersMap[memberId]?.[round] ?? null : null);
      let powerApplied: string | null = null;

      // Resolve tied_to_pick powers automatically
      if (power && power.category === "tied_to_pick") {
        const eligible = matchesPosition(player.position, power.tied_position ?? "ANY");
        if (eligible) {
          powerApplied = power.name;
          addEvent(
            `⚡ ${memberMap[memberId]?.team_name} → ${power.name} on ${player.full_name}`,
            "#FFD700"
          );
          if (power.name === "Shadow Guard") {
            setShadowGuarded((prev) => new Set([...prev, player.id]));
          }
        }
      }

      // Hero's Shield auto-marks (category may be draft_mechanic)
      if (power && power.name === "Hero's Shield") {
        setHeroShieldRounds((prev) => {
          const updated = { ...prev };
          if (!updated[memberId]) updated[memberId] = new Set();
          const newSet = new Set(updated[memberId]);
          newSet.add(round);
          updated[memberId] = newSet;
          return updated;
        });
        addEvent(`🛡 ${memberMap[memberId]?.team_name} equipped Hero's Shield — Round ${round}`, "#FFD700");
      }

      const newPick: MockPick = {
        round,
        pickNo,
        memberId,
        playerId: player.id,
        playerName: player.full_name,
        playerPosition: player.position ?? "?",
        playerTeam: player.team ?? "FA",
        powerApplied,
      };

      setPicks((prev) => [...prev, newPick]);
      return { newPick, power };
    },
    [allPowersMap, hasPowers, memberMap, addEvent]
  );

  // ── CPU pick logic ─────────────────────────────────────────────────────────
  const runCpuPick = useCallback(
    (memberId: string, round: number, pickNo: number, currentPicks: MockPick[], currentDraftOrder: string[]) => {
      const power = hasPowers ? allPowersMap[memberId]?.[round] : null;
      const currentDraftedIds = new Set(currentPicks.map((p) => p.playerId));
      const available = players.filter((p) => !currentDraftedIds.has(p.id));

      if (available.length === 0) return;

      // ── Draft mechanic: Draft Heist ────────────────────────────────────────
      if (power && power.name === "Draft Heist") {
        const myIdx = currentDraftOrder.indexOf(memberId);
        // CPU heists if they're in the back half of the round
        if (myIdx > league.max_teams / 2) {
          const pickedThisRoundNow = new Set(
            currentPicks.filter((p) => p.round === round).map((p) => p.memberId)
          );
          // Find earliest picker who hasn't picked yet and isn't shielded
          const target = currentDraftOrder.find(
            (id, i) => i < myIdx && !pickedThisRoundNow.has(id) && !heroShieldedThisRound.has(id)
          );
          if (target) {
            const targetIdx = currentDraftOrder.indexOf(target);
            const newOrder = [...currentDraftOrder];
            newOrder[myIdx] = target;
            newOrder[targetIdx] = memberId;
            setDraftOrder(newOrder);
            addEvent(
              `💥 ${memberMap[memberId]?.team_name} used Draft Heist on ${memberMap[target]?.team_name}!`,
              "#CC0000"
            );
            // The CPU now picks from the new position — recalculate isn't needed here
            // since we're already running the pick for this member
          }
        }
      }

      // ── Choose player ──────────────────────────────────────────────────────
      let chosen: Player | null = null;

      if (power && power.category === "tied_to_pick" && power.tied_position && power.tied_position !== "ANY") {
        // Try to pick the position the power requires
        const posMatch = available.filter((p) => matchesPosition(p.position, power.tied_position!));
        chosen = posMatch[0] ?? null;
      }

      if (!chosen) {
        const rosterCounts = getRosterCounts(currentPicks, memberId);
        chosen = getBestAvailableByNeed(available, rosterCounts, round, league.draft_rounds);
      }

      if (!chosen) return;

      applyPick(chosen, memberId, pickNo, round);

      // ── Post-pick powers ───────────────────────────────────────────────────

      // Vampire Bite (draft_mechanic): CPU targets highest-value pick on the user's team (not shadow guarded)
      // Bug fix: was checking `appliedPower === null` which made the condition unreachable
      if (hasPowers && power && power.name === "Vampire Bite") {
        const userPicks = currentPicks.filter((p) => p.memberId === myMemberId);
        const unguardedUserPicks = userPicks.filter((p) => !shadowGuarded.has(p.playerId));
        // Sort by ADP (lowest ADP = highest value)
        const sorted = [...unguardedUserPicks].sort(
          (a, b) =>
            (playerMap[a.playerId]?.adp ?? 999) - (playerMap[b.playerId]?.adp ?? 999)
        );
        if (sorted.length > 0) {
          const target = sorted[0];
          setVampireBites((prev) => ({ ...prev, [memberId]: target.playerId }));
          addEvent(
            `🧛 ${memberMap[memberId]?.team_name} Vampire Bit your ${target.playerName}!`,
            "#CC0000"
          );
        }
      }

      // Power Negation is a tied_to_pick debuff — score-matchups halves the drafted player's
      // own weekly score (case 'power_negation': return -(baseScore / 2)). applyPick() applies
      // it automatically via the tied_to_pick branch. No CPU post-pick action needed.
    },
    [
      allPowersMap,
      hasPowers,
      players,
      league,
      applyPick,
      addEvent,
      memberMap,
      myMemberId,
      shadowGuarded,
      playerMap,
      heroShieldedThisRound,
    ]
  );

  // ── CPU auto-pick effect ───────────────────────────────────────────────────
  const cpuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isDraftComplete || isMyTurn || bufferActive) return;
    if (showVampireModal || showHeistModal || showForesightModal) return;

    setCpuThinking(true);
    cpuTimerRef.current = setTimeout(() => {
      setCpuThinking(false);
      runCpuPick(currentMemberId, currentRound, currentPickNo, picks, draftOrder);
    }, 750);

    return () => {
      if (cpuTimerRef.current) clearTimeout(cpuTimerRef.current);
    };
  }, [currentPickNo, isMyTurn, isDraftComplete, bufferActive, showVampireModal, showHeistModal, showForesightModal]); // eslint-disable-line

  // ── Round buffer effects ───────────────────────────────────────────────────
  // Fire a 30-second buffer whenever the round increments (including round 1 on mount)
  useEffect(() => {
    if (isDraftComplete) return;
    if (currentRound !== prevRoundRef.current) {
      prevRoundRef.current = currentRound;
      setBufferActive(true);
      setBufferTimeLeft(30);
    }
  }, [currentRound, isDraftComplete]);

  // Countdown tick — decrements every second, closes buffer at 0
  useEffect(() => {
    if (!bufferActive) return;
    if (bufferTimeLeft <= 0) { setBufferActive(false); return; }
    const t = setTimeout(() => setBufferTimeLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [bufferActive, bufferTimeLeft]);

  // ── User pick handler ──────────────────────────────────────────────────────
  const handleUserPickPlayer = useCallback(
    (player: Player) => {
      if (!isMyTurn || isDraftComplete) return;
      // Use override-aware lookup so Foresight Coin swaps reflect correctly in modal checks
      const power = hasPowers
        ? (currentRound in userPowerOverrides
            ? userPowerOverrides[currentRound]
            : allPowersMap[myMemberId]?.[currentRound]) ?? null
        : null;

      // Draft Heist: show modal before the pick
      if (power && power.name === "Draft Heist") {
        setPendingPickPlayer(player);
        setShowHeistModal(true);
        return;
      }

      // Foresight Coin: show modal before the pick
      if (power && power.name === "Foresight Coin") {
        setPendingPickPlayer(player);
        setShowForesightModal(true);
        return;
      }

      commitUserPick(player);
    },
    [isMyTurn, isDraftComplete, hasPowers, allPowersMap, myMemberId, currentRound, userPowerOverrides] // eslint-disable-line
  );

  const commitUserPick = useCallback(
    (player: Player, powerOverride?: PowerInfo | null) => {
      // Resolve effective power: explicit override takes priority (Foresight Coin swap),
      // then userPowerOverrides state, then allPowersMap default
      const effectivePower = powerOverride !== undefined
        ? powerOverride
        : (hasPowers
            ? (currentRound in userPowerOverrides
                ? userPowerOverrides[currentRound]
                : allPowersMap[myMemberId]?.[currentRound]) ?? null
            : null);
      const { power } = applyPick(player, myMemberId, currentPickNo, currentRound, effectivePower);

      // Vampire Bite: show modal after pick
      if (hasPowers && power && power.name === "Vampire Bite") {
        setShowVampireModal(true);
        return;
      }

      // Telepathy: reveal next picker's power (same round only — real DraftRoom guards this)
      if (hasPowers && power && power.name === "Telepathy") {
        const nextPickNo2 = currentPickNo + 1;
        if (nextPickNo2 <= totalPicks && Math.ceil(nextPickNo2 / league.max_teams) === currentRound) {
          const nextIdx = memberIdxForPickNo(nextPickNo2, league.max_teams);
          const nextMemberId = draftOrder[nextIdx];
          const nextPower = nextMemberId ? allPowersMap[nextMemberId]?.[currentRound] : null;
          if (nextPower && nextPower.name !== "Shadow Guard") {
            addEvent(
              `🔮 Telepathy: ${memberMap[nextMemberId]?.team_name} has "${nextPower.name}" this round!`,
              "#a78bfa"
            );
          } else if (nextPower?.name === "Shadow Guard") {
            addEvent(`🔮 Telepathy blocked — Shadow Guard detected.`, "#6b6b8a");
          }
        }
      }

      setPendingPickPlayer(null);
      setShowHeistModal(false);
      setShowForesightModal(false);
    },
    [applyPick, myMemberId, currentPickNo, currentRound, hasPowers, totalPicks, league.max_teams, draftOrder, allPowersMap, addEvent, memberMap, userPowerOverrides] // eslint-disable-line
  );

  // ── Heist modal confirm ────────────────────────────────────────────────────
  const handleHeistConfirm = (targetMemberId: string) => {
    const myIdx = draftOrder.indexOf(myMemberId);
    const targetIdx = draftOrder.indexOf(targetMemberId);
    if (myIdx === -1 || targetIdx === -1) { setShowHeistModal(false); return; }
    const newOrder = [...draftOrder];
    newOrder[myIdx] = targetMemberId;
    newOrder[targetIdx] = myMemberId;
    setDraftOrder(newOrder);
    addEvent(
      `💥 You used Draft Heist on ${memberMap[targetMemberId]?.team_name}!`,
      "#CC0000"
    );
    setShowHeistModal(false);
    if (pendingPickPlayer) commitUserPick(pendingPickPlayer);
  };

  // ── Foresight modal confirm ────────────────────────────────────────────────
  const handleForesightConfirm = (swapWithRound: number) => {
    // Resolve current values before any state update
    const currentPower = currentRound in userPowerOverrides
      ? userPowerOverrides[currentRound]
      : (allPowersMap[myMemberId]?.[currentRound] ?? null);
    const futurePower = swapWithRound in userPowerOverrides
      ? userPowerOverrides[swapWithRound]
      : (allPowersMap[myMemberId]?.[swapWithRound] ?? null);

    if (swapWithRound !== currentRound) {
      // Persist the swap in override state for future rounds
      setUserPowerOverrides((prev) => ({
        ...prev,
        [currentRound]: futurePower,
        [swapWithRound]: currentPower,
      }));
      addEvent(
        `🪙 Foresight Coin: swapped Round ${currentRound}'s power for Round ${swapWithRound}'s power.`,
        "#FFD700"
      );
      // Pass futurePower directly — setUserPowerOverrides is async so commitUserPick
      // would see stale state if we relied on the closure alone
      setShowForesightModal(false);
      if (pendingPickPlayer) commitUserPick(pendingPickPlayer, futurePower);
    } else {
      addEvent(`🪙 Foresight Coin: kept Round ${currentRound}'s power.`, "#FFD700");
      setShowForesightModal(false);
      if (pendingPickPlayer) commitUserPick(pendingPickPlayer, currentPower);
    }
  };

  // ── Vampire bite confirm (user) ────────────────────────────────────────────
  const handleUserVampireBiteConfirm = (targetPlayerId: string, targetName: string) => {
    setVampireBites((prev) => ({ ...prev, [myMemberId]: targetPlayerId }));
    addEvent(`🧛 You Vampire Bit ${targetName}!`, "#CC0000");
    setShowVampireModal(false);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const myTeamName = memberMap[myMemberId]?.team_name ?? "Your Team";
  const currentTeamName = memberMap[currentMemberId]?.team_name ?? "—";
  const myRosterCounts = getRosterCounts(picks, myMemberId);

  return (
    <div className="min-h-screen" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      {/* Modals */}
      {showVampireModal && (
        <VampireBiteModal
          picks={picks}
          memberMap={memberMap}
          shadowGuarded={shadowGuarded}
          myMemberId={myMemberId}
          onSelect={handleUserVampireBiteConfirm}
          onSkip={() => setShowVampireModal(false)}
        />
      )}
      {showHeistModal && (
        <HeistModal
          members={members}
          myMemberId={myMemberId}
          draftOrder={draftOrder}
          pickedThisRound={picksThisRound}
          heroShieldedThisRound={heroShieldedThisRound}
          onSelect={handleHeistConfirm}
          onSkip={() => { setShowHeistModal(false); if (pendingPickPlayer) commitUserPick(pendingPickPlayer); }}
        />
      )}
      {showForesightModal && pendingPickPlayer && (
        <ForesightModal
          currentRound={currentRound}
          powersMap={{ ...allPowersMap[myMemberId], ...userPowerOverrides }}
          myMemberId={myMemberId}
          draftRounds={league.draft_rounds}
          onSelect={handleForesightConfirm}
        />
      )}

      {/* ── Header ── */}
      <div className="sticky top-0 z-30 border-b px-4 py-3 flex items-center justify-between gap-3"
        style={{ background: "rgba(13,13,26,0.97)", borderColor: "#2a2a40", backdropFilter: "blur(8px)" }}>
        <div className="flex items-center gap-3 min-w-0">
          <Link href={`/dashboard/league/${league.id}`}
            className="text-sm font-medium shrink-0" style={{ color: "#FFD700" }}>
            ← {league.name}
          </Link>
          <span className="text-sm font-bold truncate" style={{ color: "#f4f4f8" }}>
            Mock Draft
          </span>
          {!hasPowers && (
            <span className="hidden sm:inline rounded-full px-2 py-0.5 text-xs" style={{ background: "rgba(255,107,53,0.15)", color: "#FF6B35", border: "1px solid rgba(255,107,53,0.3)" }}>
              No powers assigned yet
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs" style={{ color: "#6b6b8a" }}>
            {picks.length}/{totalPicks}
          </span>
          <button
            onClick={() => setShowBoard(!showBoard)}
            className="rounded-md border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: "#2a2a40", color: "#d4d4e8" }}>
            {showBoard ? "Hide" : "Board"}
          </button>
          {isDraftComplete && (
            <button
              onClick={() => { prevRoundRef.current = 0; setPicks([]); setDraftOrder(league.draft_order); setShadowGuarded(new Set()); setVampireBites({}); setHeroShieldRounds({}); setPowerEvents([]); setUserPowerOverrides({}); }}
              className="rounded-md px-3 py-1.5 text-xs font-bold"
              style={{ background: "#FFD700", color: "#0d0d1a" }}>
              Reset
            </button>
          )}
        </div>
      </div>

      {/* ── Round buffer overlay ── */}
      {!isDraftComplete && bufferActive && (
        <div className="px-4 py-4 border-b" style={{ borderColor: "#FFD700", background: "rgba(255,215,0,0.06)" }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold" style={{ color: "#FFD700" }}>
              🏈 Round {currentRound} of {league.draft_rounds} Starting…
            </p>
            {/* SVG countdown ring */}
            <div className="relative flex items-center justify-center" style={{ width: 44, height: 44 }}>
              <svg width="44" height="44" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="22" cy="22" r="18" fill="none" stroke="#2a2a40" strokeWidth="4" />
                <circle cx="22" cy="22" r="18" fill="none" stroke="#FFD700" strokeWidth="4"
                  strokeDasharray={`${(bufferTimeLeft / 30) * 113.1} 113.1`} />
              </svg>
              <span className="absolute text-xs font-bold" style={{ color: "#FFD700" }}>
                {bufferTimeLeft}
              </span>
            </div>
          </div>
          {/* User's power card for this round */}
          {(() => {
            const myRoundPower = hasPowers
              ? (currentRound in userPowerOverrides
                  ? userPowerOverrides[currentRound]
                  : allPowersMap[myMemberId]?.[currentRound]) ?? null
              : null;
            if (!myRoundPower) return (
              <p className="text-xs" style={{ color: "#9999bb" }}>
                {isMyTurn ? "🎯 You pick first this round — prepare your selection!" : "Draft begins shortly…"}
              </p>
            );
            return (
              <div className="rounded-lg border p-3" style={{ borderColor: "rgba(255,215,0,0.3)", background: "rgba(255,215,0,0.04)" }}>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-xs font-bold" style={{ color: "#FFD700" }}>
                    ⚡ Your Round {currentRound} Power:
                  </span>
                  <span className="rounded-full border px-2 py-0.5 text-xs font-semibold"
                    style={{ borderColor: "rgba(255,215,0,0.45)", color: "#FFD700" }}>
                    {myRoundPower.name}
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: "#d4d4e8" }}>{myRoundPower.description}</p>
                {myRoundPower.category === "draft_mechanic" && (
                  <p className="text-xs mt-2 italic" style={{ color: "#9999bb" }}>
                    Active power — decide whether to use it on your turn.
                  </p>
                )}
                {myRoundPower.category === "tied_to_pick" && (
                  <p className="text-xs mt-2 italic" style={{ color: "#9999bb" }}>
                    Auto-applies to your pick this round.
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Status banner ── */}
      {!isDraftComplete && !bufferActive && (
        <div
          className="px-4 py-3 text-center text-sm font-semibold border-b"
          style={{
            background: isMyTurn ? "rgba(0,87,255,0.12)" : "rgba(255,255,255,0.03)",
            borderColor: isMyTurn ? "#0057FF" : "#2a2a40",
            color: isMyTurn ? "#6daaff" : "#d4d4e8",
          }}
        >
          {cpuThinking
            ? `⏳ ${currentTeamName} is picking...`
            : isMyTurn
            ? `🎯 Your pick — Round ${currentRound} · Pick ${currentPickNo}/${totalPicks}`
            : `Round ${currentRound} · Pick ${currentPickNo}/${totalPicks} — ${currentTeamName}`}
          {isMyTurn && (() => {
            const myPower = hasPowers
              ? (currentRound in userPowerOverrides
                  ? userPowerOverrides[currentRound]
                  : allPowersMap[myMemberId]?.[currentRound]) ?? null
              : null;
            if (!myPower) return null;
            return (
              <span className="ml-3 rounded-full border px-2 py-0.5 text-xs"
                style={{ borderColor: "#FFD700", color: "#FFD700" }}>
                ⚡ {myPower.name}
              </span>
            );
          })()}
        </div>
      )}

      {isDraftComplete && (
        <div className="px-4 py-4 text-center" style={{ background: "rgba(255,215,0,0.06)", borderBottom: "1px solid #FFD700" }}>
          <p className="text-lg font-bold" style={{ color: "#FFD700" }}>✅ Mock Draft Complete!</p>
          <p className="text-sm mt-1" style={{ color: "#d4d4e8" }}>
            You drafted {myPicks.length} players. Hit Reset to run another mock.
          </p>
        </div>
      )}

      {/* ── Draft board (collapsible) ── */}
      {showBoard && (
        <div className="overflow-x-auto border-b" style={{ borderColor: "#2a2a40" }}>
          <table className="border-collapse" style={{ minWidth: `${48 + league.max_teams * 90}px`, fontSize: "11px" }}>
            <thead>
              <tr style={{ background: "#15151f" }}>
                <th className="border px-2 py-2 text-left font-normal" style={{ borderColor: "#2a2a40", color: "#6b6b8a", minWidth: "28px" }}>Rd</th>
                {draftOrder.map((mId) => {
                  const m = memberMap[mId];
                  return (
                    <th key={mId} className="border px-2 py-1 text-left"
                      style={{ borderColor: "#2a2a40", color: mId === myMemberId ? "#0057FF" : "#f4f4f8", minWidth: "82px", fontWeight: mId === myMemberId ? 700 : 400 }}>
                      <span className="block truncate text-xs">{m?.team_name ?? mId}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: league.draft_rounds }, (_, ri) => {
                const round = ri + 1;
                return (
                  <tr key={round}>
                    <td className="border px-2 py-1 text-xs" style={{ borderColor: "#2a2a40", color: "#6b6b8a", background: ri % 2 === 0 ? "#0d0d1a" : "#0f0f1e" }}>
                      {round}
                    </td>
                    {draftOrder.map((mId, ci) => {
                      const pNo = pickNoForSlot(round, ci + 1, league.max_teams);
                      const pick = picks.find((p) => p.pickNo === pNo);
                      const isCurrent = !isDraftComplete && pNo === currentPickNo;
                      const isMe = mId === myMemberId;
                      let bg = ri % 2 === 0 ? "#0d0d1a" : "#0f0f1e";
                      if (isCurrent) bg = "rgba(255,215,0,0.12)";
                      else if (isMe && pick) bg = "rgba(0,87,255,0.08)";
                      return (
                        <td key={mId} className="border px-1.5 py-1" style={{ borderColor: "#2a2a40", background: bg, minWidth: "82px" }}>
                          {pick ? (
                            <div>
                              <span className="block font-medium truncate" style={{ color: getPosColor(pick.playerPosition), fontSize: 10 }}>
                                {pick.playerName.split(" ").pop()}
                              </span>
                              <span className="block" style={{ color: "#6b6b8a", fontSize: 9 }}>
                                {pick.playerPosition}{pick.powerApplied ? " ⚡" : ""}
                                {shadowGuarded.has(pick.playerId) ? " 🛡" : ""}
                                {Object.values(vampireBites).includes(pick.playerId) ? " 🧛" : ""}
                              </span>
                            </div>
                          ) : isCurrent ? (
                            <span style={{ color: "#FFD700", fontSize: 10 }}>● ON CLOCK</span>
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
      )}

      {/* ── Main content ── */}
      <div className="mx-auto max-w-6xl px-3 pt-4 pb-10">
        {/* Tab bar */}
        <div className="flex gap-1 mb-4 border-b" style={{ borderColor: "#2a2a40" }}>
          {(["players", "roster", "log"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2 text-sm font-medium capitalize"
              style={{
                color: activeTab === tab ? "#FFD700" : "#d4d4e8",
                borderBottom: activeTab === tab ? "2px solid #FFD700" : "2px solid transparent",
              }}
            >
              {tab === "roster" ? `My Roster (${myPicks.length})` : tab === "log" ? `Power Log (${powerEvents.length})` : "Players"}
            </button>
          ))}
        </div>

        {/* ── Players tab ── */}
        {activeTab === "players" && (
          <div>
            {/* Filters */}
            <div className="flex flex-wrap gap-2 mb-3">
              <input
                type="text"
                placeholder="Search players..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 min-w-[160px] rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "#2a2a40", background: "#0f0f1e", color: "#f4f4f8" }}
              />
              <div className="flex gap-1 flex-wrap">
                {POSITIONS.map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setPosFilter(pos)}
                    className="rounded-md px-2.5 py-1.5 text-xs font-semibold"
                    style={{
                      background: posFilter === pos ? (POS_COLORS[pos] ?? "#FFD700") : "#1a1a2e",
                      color: posFilter === pos ? "#fff" : "#d4d4e8",
                    }}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            {/* Player list */}
            <div className="flex flex-col gap-1">
              {filteredPlayers.slice(0, 80).map((player) => {
                const isBitten = Object.values(vampireBites).includes(player.id);
                const isGuarded = shadowGuarded.has(player.id);
                return (
                  <button
                    key={player.id}
                    onClick={() => isMyTurn && !bufferActive && handleUserPickPlayer(player)}
                    disabled={!isMyTurn || isDraftComplete || bufferActive}
                    className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition"
                    style={{
                      borderColor: "#2a2a40",
                      background: "#0f0f1e",
                      opacity: (!isMyTurn || isDraftComplete || bufferActive) ? 0.65 : 1,
                      cursor: isMyTurn && !isDraftComplete && !bufferActive ? "pointer" : "default",
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-bold w-7 text-right shrink-0" style={{ color: "#6b6b8a" }}>
                        {player.adp ? Math.round(player.adp) : "—"}
                      </span>
                      <span className="rounded px-1.5 py-0.5 text-xs font-bold shrink-0"
                        style={{ background: "rgba(255,255,255,0.05)", color: getPosColor(player.position) }}>
                        {player.position ?? "?"}
                      </span>
                      <div className="min-w-0">
                        <span className="text-sm font-medium truncate block" style={{ color: "#f4f4f8" }}>
                          {player.full_name}
                          <InjuryBadge status={player.injury_status} />
                        </span>
                        <span className="text-xs" style={{ color: "#6b6b8a" }}>{player.team ?? "FA"}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {isGuarded && <span className="text-xs" title="Shadow Guard">🛡</span>}
                      {isBitten && <span className="text-xs" title="Vampire Bitten">🧛</span>}
                      {isMyTurn && !isDraftComplete && !bufferActive && (
                        <span className="rounded-md px-2 py-1 text-xs font-bold"
                          style={{ background: "rgba(0,87,255,0.2)", color: "#6daaff" }}>
                          Draft
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              {filteredPlayers.length > 80 && (
                <p className="py-2 text-center text-xs" style={{ color: "#6b6b8a" }}>
                  Showing 80 of {filteredPlayers.length} — use search to narrow
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── My Roster tab ── */}
        {activeTab === "roster" && (
          <div>
            {myPicks.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: "#6b6b8a" }}>
                No picks yet. Draft your first player.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {myPicks.map((pick) => {
                  const isBitten = Object.values(vampireBites).includes(pick.playerId) && Object.entries(vampireBites).some(([k, v]) => v === pick.playerId && k !== myMemberId);
                  const isGuarded = shadowGuarded.has(pick.playerId);
                  const biter = isBitten
                    ? Object.entries(vampireBites).find(([k, v]) => v === pick.playerId && k !== myMemberId)?.[0]
                    : null;
                  return (
                    <div key={pick.playerId}
                      className="flex items-center justify-between rounded-lg border px-3 py-2.5"
                      style={{ borderColor: "#2a2a40", background: isBitten ? "rgba(204,0,0,0.06)" : "#0f0f1e" }}>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-medium w-12 shrink-0" style={{ color: "#6b6b8a" }}>
                          Rd {pick.round}
                        </span>
                        <span className="text-xs font-bold w-8 shrink-0"
                          style={{ color: getPosColor(pick.playerPosition) }}>
                          {pick.playerPosition}
                        </span>
                        <div>
                          <p className="text-sm font-medium" style={{ color: "#f4f4f8" }}>{pick.playerName}</p>
                          <p className="text-xs" style={{ color: "#6b6b8a" }}>{pick.playerTeam}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {pick.powerApplied && (
                          <span className="rounded-full border px-2 py-0.5 text-xs"
                            title={powerDescByName[pick.powerApplied] ?? ""}
                            style={{ borderColor: "rgba(255,215,0,0.3)", color: "#FFD700" }}>
                            ⚡ {pick.powerApplied}
                            {powerDescByName[pick.powerApplied] && (
                              <span className="ml-1 font-normal italic" style={{ color: "#9999bb", fontSize: "9px" }}>
                                — {powerDescByName[pick.powerApplied].length > 40
                                  ? powerDescByName[pick.powerApplied].slice(0, 40) + "…"
                                  : powerDescByName[pick.powerApplied]}
                              </span>
                            )}
                          </span>
                        )}
                        {isGuarded && <span title="Shadow Guard">🛡</span>}
                        {isBitten && (
                          <span className="text-xs" style={{ color: "#CC0000" }}
                            title={`Bitten by ${memberMap[biter ?? ""]?.team_name}`}>
                            🧛 bitten
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Roster composition */}
            {myPicks.length > 0 && (
              <div className="mt-6 rounded-xl border p-4" style={{ borderColor: "#2a2a40", background: "#0f0f1e" }}>
                <p className="text-xs uppercase tracking-widest mb-3" style={{ color: "#6b6b8a" }}>Roster Composition</p>
                <div className="flex flex-wrap gap-3">
                  {["QB", "RB", "WR", "TE", "K", "DEF"].map((pos) => (
                    <div key={pos} className="text-center">
                      <div className="text-lg font-black" style={{ color: getPosColor(pos) }}>
                        {myRosterCounts[pos] ?? 0}
                      </div>
                      <div className="text-xs" style={{ color: "#6b6b8a" }}>{pos}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Power Log tab ── */}
        {activeTab === "log" && (
          <div>
            {powerEvents.length === 0 ? (
              <p className="py-8 text-center text-sm" style={{ color: "#6b6b8a" }}>
                No power events yet.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {powerEvents.map((event) => (
                  <div key={event.id}
                    className="rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: "#2a2a40", background: "#0f0f1e", color: event.color }}>
                    {event.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
