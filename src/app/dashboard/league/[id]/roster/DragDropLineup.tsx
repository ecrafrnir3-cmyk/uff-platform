"use client";

import { useState } from "react";
import { setLineup } from "../lineup-actions";
import { moveToIR } from "../player-actions";
import DropButton from "./DropButton";

interface RosterPlayer {
  player_id: string;
  full_name: string;
  position: string;
  team?: string;
  status?: string;
}

const SLOT_ELIGIBLE: Record<string, string[]> = {
  QB:   ["QB"],
  RB:   ["RB"],
  WR:   ["WR"],
  TE:   ["TE"],
  FLEX: ["RB", "WR", "TE"],
  K:    ["K"],
  DEF:  ["DEF", "DST"],
  DST:  ["DEF", "DST"],
};

const POS_COLOR: Record<string, string> = {
  QB: "#0057FF", RB: "#3DDC84", WR: "#FFD700",
  TE: "#FF6B35", K: "#f4f4f8", DEF: "#CC0000", DST: "#CC0000",
};

const HERO_COLOR    = "#0057FF";
const VILLAIN_COLOR = "#CC0000";

function slotBase(slot: string): string {
  return slot.replace(/_\d+$/, "");
}

function PlayerAvatar({ playerId, name, position, size = 36 }: {
  playerId: string; name: string; position: string; size?: number;
}) {
  const isTeam = position === "DEF" || position === "DST";
  const initials = name.split(" ").map((w: string) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const posColor = POS_COLOR[position] ?? "#f4f4f8";

  if (isTeam) {
    return (
      <div style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: posColor + "33", display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: size * 0.28, fontWeight: 700, color: posColor,
        letterSpacing: "-0.5px",
      }}>
        DEF
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <img
        src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
        alt={name}
        width={size}
        height={size}
        onError={(e) => {
          const el = e.currentTarget;
          el.style.display = "none";
          const sibling = el.nextElementSibling as HTMLElement | null;
          if (sibling) sibling.style.display = "flex";
        }}
        style={{
          width: size, height: size, borderRadius: "50%",
          objectFit: "cover", display: "block", background: "#1c1c2b",
        }}
      />
      <div style={{
        display: "none", position: "absolute", inset: 0, borderRadius: "50%",
        background: "#1c1c2b", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.32, fontWeight: 700, color: "#f4f4f8",
      }}>
        {initials}
      </div>
    </div>
  );
}

export default function DragDropLineup({
  leagueId,
  week,
  slots,
  activeRoster,
  currentLineup,
  locked,
  lockTime,
  seasonPts,
  gameTimes,
  playerPowers,
  irSlotsAvailable = 0,
  quickFeetAvailable = false,
}: {
  leagueId: string;
  week: number;
  slots: string[];
  activeRoster: RosterPlayer[];
  currentLineup: Record<string, string>;
  locked: boolean;
  lockTime: string;
  seasonPts?: Record<string, number>;
  gameTimes?: Record<string, string>;
  playerPowers?: Record<string, { emoji: string; name: string }>;
  irSlotsAvailable?: number;
  quickFeetAvailable?: boolean;
}) {
  const [assignments, setAssignments] = useState<Record<string, string>>(currentLineup);
  // selected: { id: player_id, source: slot-name | "bench" }
  const [selected, setSelected] = useState<{ id: string; source: string } | null>(null);
  // invalidTarget: slot name or "bench:pid" — briefly flashes red
  const [invalidTarget, setInvalidTarget] = useState<string | null>(null);

  function isPlayerLocked(player: RosterPlayer): boolean {
    if (locked) return true;
    if (!gameTimes || !player.team) return false;
    const kickoff = gameTimes[player.team];
    return kickoff ? Date.now() >= new Date(kickoff).getTime() : false;
  }

  const assignedIds = new Set(
    Object.entries(assignments).filter(([, v]) => v !== "").map(([, v]) => v)
  );

  function eligible(pid: string, slot: string): boolean {
    const player = activeRoster.find((p) => p.player_id === pid);
    if (!player) return false;
    return (SLOT_ELIGIBLE[slotBase(slot)] ?? []).includes(player.position);
  }

  function flashInvalid(target: string) {
    setInvalidTarget(target);
    setTimeout(() => setInvalidTarget(null), 500);
  }

  // ── Click a player (starter or bench) ───────────────────────────────────────
  function handleClickPlayer(pid: string, source: string) {
    if (locked) return;
    const player = activeRoster.find((p) => p.player_id === pid);
    if (!player || isPlayerLocked(player)) return;

    // Deselect if clicking the same player
    if (selected?.id === pid) {
      setSelected(null);
      return;
    }

    // Nothing selected yet — select this player
    if (!selected) {
      setSelected({ id: pid, source });
      return;
    }

    const A = selected;
    const B = { id: pid, source };

    // Both on bench — just switch selection to B
    if (A.source === "bench" && B.source === "bench") {
      setSelected(B);
      return;
    }

    // A on bench, B in starter slot → try to move A into B's slot, B → bench
    if (A.source === "bench") {
      if (!eligible(A.id, B.source)) {
        flashInvalid(B.source);
        return; // keep A selected
      }
      setAssignments((prev) => ({ ...prev, [B.source]: A.id }));
      setSelected(null);
      return;
    }

    // A in starter slot, B on bench → try to move B into A's slot, A → bench
    if (B.source === "bench") {
      if (!eligible(B.id, A.source)) {
        flashInvalid("bench:" + B.id);
        return; // keep A selected
      }
      setAssignments((prev) => ({ ...prev, [A.source]: B.id }));
      setSelected(null);
      return;
    }

    // Both in starter slots → A goes to B's slot (must be eligible)
    if (!eligible(A.id, B.source)) {
      flashInvalid(B.source);
      return; // keep A selected, flash target
    }
    setAssignments((prev) => {
      const next = { ...prev };
      next[B.source] = A.id;
      // B goes to A's slot if eligible, else bench (slot clears)
      next[A.source] = eligible(B.id, A.source) ? B.id : "";
      return next;
    });
    setSelected(null);
  }

  // ── Click an empty starter slot ──────────────────────────────────────────────
  function handleClickEmptySlot(slot: string) {
    if (locked || !selected) return;
    if (!eligible(selected.id, slot)) {
      flashInvalid(slot);
      return;
    }
    setAssignments((prev) => {
      const next = { ...prev };
      next[slot] = selected.id;
      if (selected.source !== "bench") next[selected.source] = "";
      return next;
    });
    setSelected(null);
  }

  // ── Move selected starter to bench ──────────────────────────────────────────
  function handleMoveToBench() {
    if (!selected || selected.source === "bench") return;
    setAssignments((prev) => ({ ...prev, [selected.source]: "" }));
    setSelected(null);
  }

  // ── Remove a starter from their slot (× button) ─────────────────────────────
  function removeFromSlot(slot: string) {
    if (selected?.source === slot) setSelected(null);
    setAssignments((prev) => ({ ...prev, [slot]: "" }));
  }

  function autoFill() {
    if (locked) return;
    setAssignments((prev) => {
      const next = { ...prev };
      const usedIds = new Set(Object.values(next).filter(Boolean));
      for (const slot of slots) {
        if (next[slot]) continue;
        const base = slotBase(slot);
        const eligiblePos = SLOT_ELIGIBLE[base] ?? [];
        const candidate =
          activeRoster.find((p) => eligiblePos.includes(p.position) && !usedIds.has(p.player_id) && !isPlayerLocked(p)) ??
          activeRoster.find((p) => eligiblePos.includes(p.position) && !usedIds.has(p.player_id));
        if (candidate) {
          next[slot] = candidate.player_id;
          usedIds.add(candidate.player_id);
        }
      }
      return next;
    });
    setSelected(null);
  }

  const benchPlayers = activeRoster.filter((p) => !assignedIds.has(p.player_id));
  const filledCount  = Object.values(assignments).filter(Boolean).length;
  const emptySlots   = slots.length - filledCount;

  const lockDisplay = new Date(lockTime).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
    timeZone: "America/New_York",
  });

  const nextKickoff = gameTimes
    ? Object.values(gameTimes)
        .map((t) => new Date(t))
        .filter((d) => d.getTime() > Date.now())
        .sort((a, b) => a.getTime() - b.getTime())[0]
    : null;

  const nextKickoffDisplay = nextKickoff
    ? nextKickoff.toLocaleString("en-US", {
        weekday: "short", hour: "numeric", minute: "2-digit",
        timeZoneName: "short", timeZone: "America/New_York",
      })
    : null;

  async function handleSave(fd: FormData) {
    await setLineup(fd);
  }

  // Whether a starter slot row should be highlighted as a valid target
  function slotIsValidTarget(slot: string): boolean {
    if (!selected) return false;
    return eligible(selected.id, slot);
  }

  const starterIsSelected = selected && selected.source !== "bench";

  return (
    <section
      className="flex flex-col rounded-xl overflow-hidden border"
      style={{ borderColor: locked ? VILLAIN_COLOR + "55" : "#2a2a40" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-wrap gap-2"
        style={{ background: "#15151f", borderBottom: "1px solid #2a2a40" }}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold" style={{ color: "#FFD700" }}>
            Starting Lineup &mdash; Week {week}
          </h2>
          {locked && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ background: "rgba(204,0,0,0.15)", color: VILLAIN_COLOR }}
            >
              &#128274; Locked
            </span>
          )}
          {quickFeetAvailable && !locked && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ background: "rgba(255,215,0,0.15)", color: "#FFD700" }}
              title="Quick Feet: you can swap one player after kickoff this week"
            >
              ⚡ Quick Feet
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!locked && emptySlots > 0 && (
            <button
              type="button"
              onClick={autoFill}
              className="rounded-md px-3 py-1.5 text-xs font-bold transition-opacity hover:opacity-80"
              style={{ background: "#1c1c2b", color: "#f4f4f8", border: "1px solid #2a2a40" }}
            >
              Auto-Fill
            </button>
          )}
          <span className="text-xs" style={{ color: "#f4f4f8" }}>
            {locked
              ? `Locked ${lockDisplay}`
              : `${filledCount} / ${slots.length} starters set`}
          </span>
        </div>
      </div>

      {/* Hint bar */}
      {!locked ? (
        <div
          className="px-4 py-1.5 text-xs"
          style={{ background: "#0f0f1c", color: "#f4f4f8", borderBottom: "1px solid #1a1a2e" }}
        >
          {selected
            ? <span style={{ color: "#FFD700" }}>Player selected — tap a slot or player to swap, or tap again to cancel</span>
            : quickFeetAvailable
              ? <>⚡ <span style={{ color: "#FFD700" }}>Quick Feet active</span> — you can swap one player even after kickoff this week</>
              : gameTimes
                ? nextKickoffDisplay
                  ? <>Tap a player to move them &middot; Players lock at kickoff &middot; First game: <span style={{ color: "#f4f4f8" }}>{nextKickoffDisplay}</span></>
                  : "Tap a player to select, then tap a slot or another player to swap"
                : `Tap a player to select, then tap a slot or another player to swap · Locks ${lockDisplay}`}
        </div>
      ) : (
        <div
          className="px-4 py-1.5 text-xs"
          style={{ background: "#1a0e16", color: "#ff8a8a", borderBottom: "1px solid rgba(204,0,0,0.2)" }}
        >
          Lineup locked for Week {week}. No changes allowed after {lockDisplay}.
        </div>
      )}

      {/* ── STARTERS ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col" style={{ background: "#0d0d1a" }}>
        {slots.map((slot, i) => {
          const pid       = assignments[slot] ?? "";
          const player    = pid ? activeRoster.find((p) => p.player_id === pid) : null;
          const base      = slotBase(slot);
          const posColor  = POS_COLOR[base] ?? "#f4f4f8";
          const isSelected = selected?.id === pid && pid !== "";
          const isInvalid  = invalidTarget === slot;
          const isValidTarget = selected && !isSelected && slotIsValidTarget(slot);
          const playerLocked  = player ? isPlayerLocked(player) : false;

          // Row background
          let rowBg = "transparent";
          if (isInvalid) rowBg = "rgba(204,0,0,0.07)";
          else if (isSelected) rowBg = "rgba(255,215,0,0.05)";
          else if (isValidTarget && !player) rowBg = "rgba(0,87,255,0.07)";

          return (
            <div
              key={slot}
              className="flex items-center gap-3 px-3 py-2"
              style={{
                borderBottom: i < slots.length - 1 ? "1px solid #1a1a2e" : undefined,
                background: rowBg,
                transition: "background 0.1s",
                minHeight: 62,
                opacity: locked ? 0.85 : 1,
              }}
            >
              {/* Slot badge */}
              <div
                className="flex-shrink-0 rounded text-center text-xs font-bold uppercase"
                style={{
                  width: 44, padding: "3px 0",
                  background: player ? posColor + "22" : "#1a1a2e",
                  color: player ? posColor : "#f4f4f8",
                  letterSpacing: "0.04em",
                }}
              >
                {base}
              </div>

              {/* Player card or empty slot */}
              {player ? (
                <div
                  onClick={() => handleClickPlayer(player.player_id, slot)}
                  className="flex flex-1 items-center gap-3 rounded-lg px-2 py-1.5"
                  style={{
                    cursor: playerLocked ? "default" : "pointer",
                    background: isSelected ? "#1a1620" : playerLocked ? "#0f0f1e" : "#13132b",
                    border: isSelected
                      ? `2px solid #FFD700`
                      : isInvalid
                        ? `1px solid ${VILLAIN_COLOR}`
                        : (isValidTarget
                            ? `1px solid ${HERO_COLOR}`
                            : `1px solid ${playerLocked ? "#3a1a1a" : "#2a2a40"}`),
                    userSelect: "none",
                    transition: "border-color 0.1s, background 0.1s",
                  }}
                >
                  <PlayerAvatar
                    playerId={player.player_id}
                    name={player.full_name}
                    position={player.position}
                    size={38}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "#f4f4f8" }}>
                      {player.full_name}
                    </p>
                    <p className="text-xs truncate" style={{ color: "#f4f4f8" }}>
                      <span style={{ color: posColor, fontWeight: 600 }}>{player.position}</span>
                      {player.team ? " · " + player.team : ""}
                      {gameTimes && player.team && !gameTimes[player.team] && (
                        <span style={{ color: "#FFD700", fontWeight: 700 }}> · BYE</span>
                      )}
                      {player.status && player.status !== "Active" && (
                        <span style={{ color: player.status === "Injured Reserve" ? VILLAIN_COLOR : "#FFD700", fontWeight: 600 }}>
                          {" · "}{player.status === "Injured Reserve" ? "IR" : player.status}
                        </span>
                      )}
                      {playerPowers?.[player.player_id] && (
                        <span
                          title={playerPowers[player.player_id].name}
                          style={{ marginLeft: 6, fontSize: "0.85em" }}
                        >
                          {playerPowers[player.player_id].emoji}
                        </span>
                      )}
                    </p>
                  </div>
                  {seasonPts?.[player.player_id] != null && (
                    <div className="text-right flex-shrink-0 pr-1">
                      <p className="text-sm font-bold tabular-nums" style={{ color: "#FFD700" }}>
                        {seasonPts[player.player_id].toFixed(1)}
                      </p>
                      <p className="text-xs" style={{ color: "#f4f4f8" }}>pts</p>
                    </div>
                  )}
                  {playerLocked ? (
                    <span
                      className="flex-shrink-0 text-sm"
                      title={`${player.team ?? "Game"} has kicked off — locked${quickFeetAvailable ? " (Quick Feet can override)" : ""}`}
                      style={{ color: quickFeetAvailable ? "#FFD700aa" : VILLAIN_COLOR + "aa", paddingRight: 2 }}
                    >
                      {quickFeetAvailable ? "⚡" : "🔒"}
                    </span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFromSlot(slot); }}
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-base transition-colors hover:text-red-400"
                      style={{ color: "#f4f4f8", background: "transparent" }}
                      title="Move to bench"
                      aria-label="Move to bench"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ) : (
                /* Empty slot — clickable target when player is selected */
                <div
                  onClick={() => handleClickEmptySlot(slot)}
                  className="lineup-slot-empty flex-1 flex items-center rounded-lg px-3 text-sm font-semibold"
                  style={{
                    height: 46,
                    border: "1px dashed",
                    borderColor: isInvalid
                      ? VILLAIN_COLOR
                      : isValidTarget
                        ? HERO_COLOR
                        : "#FFD700",
                    background: isValidTarget
                      ? "rgba(0,87,255,0.1)"
                      : isInvalid
                        ? "rgba(204,0,0,0.05)"
                        : "rgba(255,215,0,0.04)",
                    color: isInvalid
                      ? VILLAIN_COLOR
                      : isValidTarget
                        ? HERO_COLOR
                        : "#FFD700",
                    cursor: selected && isValidTarget ? "pointer" : "default",
                    transition: "border-color 0.1s, color 0.1s, background 0.1s",
                  }}
                >
                  {isValidTarget
                    ? `→ Move ${base} here`
                    : isInvalid
                      ? "Wrong position for this slot"
                      : `Drop ${base} here`}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── BENCH ─────────────────────────────────────────────────────────────── */}
      <div style={{ background: "#080812", borderTop: "2px solid #2a2a40" }}>

        {/* "Move to bench" strip — visible when a starter is selected */}
        {starterIsSelected && !locked && (
          <div
            onClick={handleMoveToBench}
            className="flex items-center justify-center gap-2 py-2 text-xs font-semibold cursor-pointer transition-colors"
            style={{
              background: "rgba(255,215,0,0.06)",
              borderBottom: "1px solid rgba(255,215,0,0.2)",
              color: "#FFD700",
            }}
          >
            ↓ Move to bench
          </div>
        )}

        <div
          className="px-4 py-2 flex items-center justify-between"
          style={{ borderBottom: benchPlayers.length > 0 ? "1px solid #1a1a2e" : undefined }}
        >
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#f4f4f8" }}>
            Bench &mdash; {benchPlayers.length} player{benchPlayers.length !== 1 ? "s" : ""}
          </span>
          {selected && !starterIsSelected && (
            <span className="text-xs" style={{ color: "#f4f4f8" }}>Tap a starter slot to swap</span>
          )}
        </div>

        {benchPlayers.length === 0 ? (
          <p className="px-4 py-3 text-xs" style={{ color: "#f4f4f8" }}>All players starting</p>
        ) : (
          <div className="flex flex-col">
            {benchPlayers.map((p, i) => {
              const posColor   = POS_COLOR[p.position] ?? "#f4f4f8";
              const pts        = seasonPts?.[p.player_id] ?? null;
              const playerLocked = isPlayerLocked(p);
              const isSelected   = selected?.id === p.player_id;
              const isInvalidBench = invalidTarget === "bench:" + p.player_id;

              return (
                <div
                  key={p.player_id}
                  onClick={() => handleClickPlayer(p.player_id, "bench")}
                  className="flex items-center gap-3 px-3 py-2"
                  style={{
                    borderBottom: i < benchPlayers.length - 1 ? "1px solid #1a1a2e" : undefined,
                    cursor: playerLocked ? "default" : "pointer",
                    userSelect: "none",
                    minHeight: 54,
                    opacity: playerLocked ? 0.65 : 1,
                    background: isSelected
                      ? "rgba(255,215,0,0.05)"
                      : isInvalidBench
                        ? "rgba(204,0,0,0.07)"
                        : "transparent",
                    outline: isSelected ? `2px solid #FFD700` : "none",
                    outlineOffset: "-2px",
                    transition: "background 0.1s",
                  }}
                >
                  <div
                    className="flex-shrink-0 rounded text-center text-xs font-bold uppercase"
                    style={{
                      width: 44, padding: "3px 0",
                      background: "#1a1a2e", color: "#f4f4f8",
                      letterSpacing: "0.04em",
                    }}
                  >
                    BN
                  </div>
                  <PlayerAvatar
                    playerId={p.player_id}
                    name={p.full_name}
                    position={p.position}
                    size={36}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "#f4f4f8" }}>
                      {p.full_name}
                    </p>
                    <p className="text-xs" style={{ color: "#f4f4f8" }}>
                      <span style={{ color: posColor + "aa", fontWeight: 600 }}>{p.position}</span>
                      {p.team ? " · " + p.team : ""}
                      {gameTimes && p.team && !gameTimes[p.team] && (
                        <span style={{ color: "#FFD700", fontWeight: 700 }}> · BYE</span>
                      )}
                      {p.status && p.status !== "Active" && (
                        <span style={{ color: p.status === "Injured Reserve" ? VILLAIN_COLOR : "#FFD700", fontWeight: 600 }}>
                          {" · "}{p.status === "Injured Reserve" ? "IR" : p.status}
                        </span>
                      )}
                      {playerPowers?.[p.player_id] && (
                        <span
                          title={playerPowers[p.player_id].name}
                          style={{ marginLeft: 6, fontSize: "0.85em" }}
                        >
                          {playerPowers[p.player_id].emoji}
                        </span>
                      )}
                    </p>
                  </div>
                  {pts != null && (
                    <p className="text-sm tabular-nums flex-shrink-0 pr-1" style={{ color: "#f4f4f8" }}>
                      {pts.toFixed(1)}
                    </p>
                  )}
                  {playerLocked && (
                    <span
                      className="flex-shrink-0 text-xs"
                      title={`${p.team ?? "Game"} has kicked off`}
                      style={{ color: VILLAIN_COLOR + "99", paddingRight: 4 }}
                    >
                      &#128274;
                    </span>
                  )}
                  {/* Move to IR — only when player has official IR designation and slots are open */}
                  {p.status === "Injured Reserve" && irSlotsAvailable > 0 && (
                    <form action={moveToIR} onClick={(e) => e.stopPropagation()}>
                      <input type="hidden" name="leagueId" value={leagueId} />
                      <input type="hidden" name="playerId" value={p.player_id} />
                      <button
                        type="submit"
                        className="rounded px-2 py-0.5 text-xs font-semibold flex-shrink-0"
                        style={{ background: "rgba(204,0,0,0.2)", color: "#ff8a8a" }}
                      >
                        → IR
                      </button>
                    </form>
                  )}
                  {/* Drop button */}
                  <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
                    <DropButton leagueId={leagueId} playerId={p.player_id} playerName={p.full_name} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── SAVE BAR ──────────────────────────────────────────────────────────── */}
      {!locked && (
        <div
          className="flex items-center justify-between px-4 py-3 gap-3 flex-wrap"
          style={{ background: "#15151f", borderTop: "1px solid #2a2a40" }}
        >
          <span className="text-xs" style={{ color: emptySlots > 0 ? "#FFD700" : "#3DDC84" }}>
            {emptySlots > 0
              ? `${emptySlots} slot${emptySlots !== 1 ? "s" : ""} empty — those score 0`
              : "✓ Lineup complete"}
          </span>
          <form action={handleSave} className="flex items-center gap-2">
            <input type="hidden" name="leagueId" value={leagueId} />
            <input type="hidden" name="week"     value={week} />
            {Object.entries(assignments)
              .filter(([, pid]) => pid !== "")
              .map(([slot, pid]) => (
                <input key={slot} type="hidden" name={"slot_" + slot} value={pid} />
              ))}
            <button
              type="submit"
              disabled={filledCount === 0}
              className="rounded-md px-5 py-2 text-sm font-bold disabled:opacity-40 transition-opacity hover:opacity-90"
              style={{ background: "#FFD700", color: "#0d0d1a" }}
            >
              Save Lineup
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
