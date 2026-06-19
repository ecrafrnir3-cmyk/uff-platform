"use client";

import { useState } from "react";
import { setLineup } from "../lineup-actions";

interface RosterPlayer {
  player_id: string;
  full_name: string;
  position: string;
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

const HERO_COLOR    = "#0057FF";
const VILLAIN_COLOR = "#CC0000";

function slotBase(slot: string): string {
  return slot.replace(/_\d+$/, "");
}

export default function DragDropLineup({
  leagueId,
  week,
  slots,
  activeRoster,
  currentLineup,
  locked,
  lockTime,
}: {
  leagueId: string;
  week: number;
  slots: string[];
  activeRoster: RosterPlayer[];
  currentLineup: Record<string, string>;
  locked: boolean;
  lockTime: string; // ISO string for display
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
      if (dragSource && dragSource !== "bench") {
        next[dragSource] = displaced ?? "";
      }
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

  const benchPlayers = activeRoster.filter((p) => !assignedIds.has(p.player_id));
  const filledCount  = Object.values(assignments).filter(Boolean).length;

  async function handleSave(fd: FormData) {
    await setLineup(fd);
  }

  // Format lock time for display
  const lockDisplay = new Date(lockTime).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
    timeZone: "America/New_York",
  });

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-5" style={{ borderColor: locked ? "#CC0000" : "#2a2a40" }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
          Starting Lineup &mdash; Week {week}
        </h2>
        <span className="text-xs" style={{ color: locked ? "#CC0000" : "#8a8a9a" }}>
          {locked
            ? "\uD83D\uDD12 Locked"
            : `${filledCount} / ${slots.length} filled`}
        </span>
      </div>

      {locked ? (
        <div className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: "#CC0000", background: "#1a0e16", color: "#ff8a8a" }}>
          <span className="font-semibold">Lineup locked</span> for Week {week}. No changes allowed after Thursday kickoff ({lockDisplay}).
        </div>
      ) : (
        <p className="text-xs" style={{ color: "#8a8a9a" }}>
          Drag players into starter slots. FLEX accepts RB, WR, or TE.
          Drop a starter back to Bench to remove them.
          Locks at Thursday kickoff ({lockDisplay}).
        </p>
      )}

      {/* Starter grid */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        {slots.map((slot) => {
          const pid    = assignments[slot] ?? "";
          const player = pid ? activeRoster.find((p) => p.player_id === pid) : null;
          const isOver    = !locked && overSlot === slot;
          const isInvalid = invalidSlot === slot;
          const dropOk    = draggedId ? eligible(draggedId, slot) : true;

          return (
            <div
              key={slot}
              onDragOver={(e) => { if (!locked) { e.preventDefault(); setOverSlot(slot); } }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverSlot(null);
              }}
              onDrop={() => dropOnSlot(slot)}
              className="relative flex flex-col rounded-lg border p-2"
              style={{
                minHeight: 72,
                borderColor: isInvalid
                  ? VILLAIN_COLOR
                  : isOver
                    ? (dropOk ? HERO_COLOR : VILLAIN_COLOR)
                    : pid ? "#2a3a5a" : "#2a2a40",
                background: isInvalid
                  ? "rgba(204,0,0,0.08)"
                  : isOver
                    ? (dropOk ? "rgba(0,87,255,0.08)" : "rgba(204,0,0,0.08)")
                    : pid ? "rgba(0,87,255,0.03)" : "transparent",
                transition: "border-color 0.12s, background 0.12s",
                opacity: locked ? 0.75 : 1,
              }}
            >
              <p
                className="mb-1 text-xs font-bold uppercase tracking-wider"
                style={{ color: pid ? HERO_COLOR : "#8a8a9a" }}
              >
                {slotBase(slot)}
              </p>

              {player ? (
                <div
                  draggable={!locked}
                  onDragStart={() => onDragStart(player.player_id, slot)}
                  onDragEnd={onDragEnd}
                  className="rounded px-1.5 py-1 select-none"
                  style={{
                    background: "#15151f",
                    cursor: locked ? "default" : "grab",
                  }}
                >
                  <p className="truncate text-xs font-semibold" title={player.full_name}>
                    {player.full_name.split(" ").pop()}
                  </p>
                  <p className="text-xs" style={{ color: "#8a8a9a" }}>
                    {player.position}
                  </p>
                </div>
              ) : (
                <p className="text-xs" style={{ color: isOver && !dropOk ? VILLAIN_COLOR : "#3a3a50" }}>
                  {isOver && !dropOk ? "Wrong pos" : "Empty"}
                </p>
              )}

              {player && !locked && (
                <button
                  onClick={() => setAssignments((prev) => ({ ...prev, [slot]: "" }))}
                  className="absolute right-1 top-1 text-xs leading-none"
                  style={{ color: "#8a8a9a" }}
                  aria-label="Clear slot"
                >
                  &times;
                </button>
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
        className="rounded-lg border p-3"
        style={{
          borderStyle: "dashed",
          borderColor: overBench ? "#8a8a9a" : "#2a2a40",
          background:  overBench ? "rgba(138,138,154,0.05)" : "transparent",
          transition: "border-color 0.1s",
        }}
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "#8a8a9a" }}>
          Bench ({benchPlayers.length})
        </p>
        {benchPlayers.length === 0 ? (
          <p className="text-xs" style={{ color: "#3a3a50" }}>All players are starting</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {benchPlayers.map((p) => (
              <div
                key={p.player_id}
                draggable={!locked}
                onDragStart={() => onDragStart(p.player_id, "bench")}
                onDragEnd={onDragEnd}
                className="select-none rounded-full px-3 py-1 text-xs font-semibold"
                style={{
                  background: "#1c1c2b",
                  color: "#f4f4f8",
                  cursor: locked ? "default" : "grab",
                }}
                title={p.full_name + " (" + p.position + ")"}
              >
                {p.full_name.split(" ").pop()}{" "}
                <span style={{ color: "#8a8a9a" }}>({p.position})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save button — hidden when locked */}
      {!locked && (
        <form action={handleSave} className="flex items-center gap-3">
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
            className="rounded-md px-5 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: "#FFD700", color: "#0d0d1a" }}
          >
            Save Lineup
          </button>
          {filledCount < slots.length && (
            <span className="text-xs" style={{ color: "#8a8a9a" }}>
              {slots.length - filledCount} slot{slots.length - filledCount !== 1 ? "s" : ""}{" "}empty &mdash; those score 0
            </span>
          )}
        </form>
      )}
    </section>
  );
}
