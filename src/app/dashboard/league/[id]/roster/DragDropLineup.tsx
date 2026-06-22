"use client";

import { useState } from "react";
import { setLineup } from "../lineup-actions";

interface RosterPlayer {
  player_id: string;
  full_name: string;
  position: string;
  team?: string;
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
  TE: "#FF6B35", K: "#8a8a9a", DEF: "#CC0000", DST: "#CC0000",
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
  const posColor = POS_COLOR[position] ?? "#8a8a9a";

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
        fontSize: size * 0.32, fontWeight: 700, color: "#8a8a9a",
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
}: {
  leagueId: string;
  week: number;
  slots: string[];
  activeRoster: RosterPlayer[];
  currentLineup: Record<string, string>;
  locked: boolean;
  lockTime: string;
  seasonPts?: Record<string, number>;
}) {
  const [assignments, setAssignments] = useState<Record<string, string>>(currentLineup);
  const [draggedId,   setDraggedId]   = useState<string | null>(null);
  const [dragSource,  setDragSource]  = useState<string | null>(null);
  const [overSlot,    setOverSlot]    = useState<string | null>(null);
  const [overBench,   setOverBench]   = useState(false);
  const [invalidSlot, setInvalidSlot] = useState<string | null>(null);

  const assignedIds = new Set(
    Object.entries(assignments).filter(([, v]) => v !== "").map(([, v]) => v)
  );

  function eligible(pid: string, slot: string): boolean {
    const player = activeRoster.find((p) => p.player_id === pid);
    if (!player) return false;
    return (SLOT_ELIGIBLE[slotBase(slot)] ?? []).includes(player.position);
  }

  function onDragStart(pid: string, src: string) {
    if (locked) return;
    setDraggedId(pid);
    setDragSource(src);
  }

  function onDragEnd() {
    setDraggedId(null);
    setDragSource(null);
    setOverSlot(null);
    setOverBench(false);
    setInvalidSlot(null);
  }

  function dropOnSlot(slot: string) {
    if (!draggedId || locked) return;
    if (!eligible(draggedId, slot)) {
      setInvalidSlot(slot);
      setTimeout(() => setInvalidSlot(null), 600);
      setOverSlot(null);
      return;
    }
    setAssignments((prev) => {
      const next = { ...prev };
      const displaced = next[slot];
      if (dragSource && dragSource !== "bench") next[dragSource] = displaced ?? "";
      next[slot] = draggedId!;
      return next;
    });
    setOverSlot(null);
  }

  function dropOnBench() {
    if (!draggedId || !dragSource || dragSource === "bench" || locked) return;
    setAssignments((prev) => ({ ...prev, [dragSource!]: "" }));
    setOverBench(false);
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
        const candidate = activeRoster.find(
          (p) => eligiblePos.includes(p.position) && !usedIds.has(p.player_id)
        );
        if (candidate) {
          next[slot] = candidate.player_id;
          usedIds.add(candidate.player_id);
        }
      }
      return next;
    });
  }

  const benchPlayers = activeRoster.filter((p) => !assignedIds.has(p.player_id));
  const filledCount  = Object.values(assignments).filter(Boolean).length;
  const emptySlots   = slots.length - filledCount;

  const lockDisplay = new Date(lockTime).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
    timeZone: "America/New_York",
  });

  async function handleSave(fd: FormData) {
    await setLineup(fd);
  }

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
          <span className="text-xs" style={{ color: "#8a8a9a" }}>
            {locked
              ? `Locked ${lockDisplay}`
              : `${filledCount} / ${slots.length} starters set`}
          </span>
        </div>
      </div>

      {/* Hint / lock bar */}
      {!locked ? (
        <div
          className="px-4 py-1.5 text-xs"
          style={{ background: "#0f0f1c", color: "#5a5a7a", borderBottom: "1px solid #1a1a2e" }}
        >
          Drag players into slots &middot; Drop onto Bench to remove &middot; Locks {lockDisplay}
        </div>
      ) : (
        <div
          className="px-4 py-1.5 text-xs"
          style={{ background: "#1a0e16", color: "#ff8a8a", borderBottom: "1px solid rgba(204,0,0,0.2)" }}
        >
          Lineup locked for Week {week}. No changes allowed after {lockDisplay}.
        </div>
      )}

      {/* Starters */}
      <div className="flex flex-col" style={{ background: "#0d0d1a" }}>
        {slots.map((slot, i) => {
          const pid    = assignments[slot] ?? "";
          const player = pid ? activeRoster.find((p) => p.player_id === pid) : null;
          const base   = slotBase(slot);
          const posColor  = POS_COLOR[base] ?? "#8a8a9a";
          const isOver    = !locked && overSlot === slot;
          const isInvalid = invalidSlot === slot;
          const dropOk    = draggedId ? eligible(draggedId, slot) : true;
          const pts       = player ? (seasonPts?.[player.player_id] ?? null) : null;

          return (
            <div
              key={slot}
              onDragOver={(e) => { if (!locked) { e.preventDefault(); setOverSlot(slot); } }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverSlot(null);
              }}
              onDrop={() => dropOnSlot(slot)}
              className="flex items-center gap-3 px-3 py-2"
              style={{
                borderBottom: i < slots.length - 1 ? "1px solid #1a1a2e" : undefined,
                background: isInvalid
                  ? "rgba(204,0,0,0.07)"
                  : isOver
                    ? (dropOk ? "rgba(0,87,255,0.07)" : "rgba(204,0,0,0.07)")
                    : "transparent",
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
                  color: player ? posColor : "#3a3a50",
                  letterSpacing: "0.04em",
                }}
              >
                {base}
              </div>

              {/* Player card or empty drop zone */}
              {player ? (
                <div
                  draggable={!locked}
                  onDragStart={() => onDragStart(player.player_id, slot)}
                  onDragEnd={onDragEnd}
                  className="flex flex-1 items-center gap-3 rounded-lg px-2 py-1.5"
                  style={{
                    cursor: locked ? "default" : "grab",
                    background: "#13132b",
                    border: "1px solid #2a2a40",
                    userSelect: "none",
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
                    <p className="text-xs truncate" style={{ color: "#8a8a9a" }}>
                      <span style={{ color: posColor, fontWeight: 600 }}>{player.position}</span>
                      {player.team ? " · " + player.team : ""}
                    </p>
                  </div>
                  {pts != null && (
                    <div className="text-right flex-shrink-0 pr-1">
                      <p className="text-sm font-bold tabular-nums" style={{ color: "#FFD700" }}>
                        {pts.toFixed(1)}
                      </p>
                      <p className="text-xs" style={{ color: "#5a5a7a" }}>pts</p>
                    </div>
                  )}
                  {!locked && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssignments((prev) => ({ ...prev, [slot]: "" }));
                      }}
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-base transition-colors hover:text-red-400"
                      style={{ color: "#5a5a7a", background: "transparent" }}
                      title="Remove from lineup"
                      aria-label="Remove from lineup"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ) : (
                <div
                  className="flex-1 flex items-center rounded-lg px-3 text-xs"
                  style={{
                    height: 46,
                    border: "1px dashed",
                    borderColor: isInvalid || (isOver && !dropOk)
                      ? VILLAIN_COLOR
                      : isOver
                        ? HERO_COLOR
                        : "#2a2a40",
                    color: isInvalid || (isOver && !dropOk) ? VILLAIN_COLOR : "#3a3a50",
                    transition: "border-color 0.1s, color 0.1s",
                  }}
                >
                  {isOver && !dropOk ? "Wrong position for this slot" : `Drop ${base} here`}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bench drop zone */}
      <div
        onDragOver={(e) => { if (!locked) { e.preventDefault(); setOverBench(true); } }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverBench(false);
        }}
        onDrop={dropOnBench}
        style={{
          background: overBench ? "rgba(138,138,154,0.05)" : "#080812",
          borderTop: "2px solid #2a2a40",
          transition: "background 0.1s",
        }}
      >
        <div
          className="px-4 py-2 flex items-center justify-between"
          style={{ borderBottom: benchPlayers.length > 0 ? "1px solid #1a1a2e" : undefined }}
        >
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#5a5a7a" }}>
            Bench &mdash; {benchPlayers.length} player{benchPlayers.length !== 1 ? "s" : ""}
          </span>
          {overBench && !locked && (
            <span className="text-xs" style={{ color: "#8a8a9a" }}>Drop here to bench</span>
          )}
        </div>

        {benchPlayers.length === 0 ? (
          <p className="px-4 py-3 text-xs" style={{ color: "#3a3a50" }}>All players starting</p>
        ) : (
          <div className="flex flex-col">
            {benchPlayers.map((p, i) => {
              const posColor = POS_COLOR[p.position] ?? "#8a8a9a";
              const pts = seasonPts?.[p.player_id] ?? null;
              return (
                <div
                  key={p.player_id}
                  draggable={!locked}
                  onDragStart={() => onDragStart(p.player_id, "bench")}
                  onDragEnd={onDragEnd}
                  className="flex items-center gap-3 px-3 py-2"
                  style={{
                    borderBottom: i < benchPlayers.length - 1 ? "1px solid #1a1a2e" : undefined,
                    cursor: locked ? "default" : "grab",
                    userSelect: "none",
                    minHeight: 54,
                  }}
                >
                  <div
                    className="flex-shrink-0 rounded text-center text-xs font-bold uppercase"
                    style={{
                      width: 44, padding: "3px 0",
                      background: "#1a1a2e", color: "#5a5a7a",
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
                    <p className="text-sm font-semibold truncate" style={{ color: "#8a8a9a" }}>
                      {p.full_name}
                    </p>
                    <p className="text-xs" style={{ color: "#5a5a6a" }}>
                      <span style={{ color: posColor + "aa", fontWeight: 600 }}>{p.position}</span>
                      {p.team ? " · " + p.team : ""}
                    </p>
                  </div>
                  {pts != null && (
                    <p className="text-sm tabular-nums flex-shrink-0 pr-1" style={{ color: "#5a5a7a" }}>
                      {pts.toFixed(1)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Save bar */}
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
