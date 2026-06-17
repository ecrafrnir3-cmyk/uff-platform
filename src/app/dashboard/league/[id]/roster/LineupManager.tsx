"use client";

import { useState } from "react";
import { setLineup } from "../lineup-actions";

interface RosterPlayer {
  player_id: string;
  full_name: string;
  position: string;
}

// Which positions can fill each slot type
const SLOT_ELIGIBLE: Record<string, string[]> = {
  QB:   ["QB"],
  RB:   ["RB"],
  WR:   ["WR"],
  TE:   ["TE"],
  FLEX: ["RB", "WR", "TE"],
  K:    ["K"],
  DEF:  ["DEF"],
};

function slotBase(slot: string): string {
  return slot.replace(/_\d+$/, "");
}

function slotLabel(slot: string): string {
  const base = slotBase(slot);
  return base;
}

export default function LineupManager({
  leagueId,
  week,
  slots,
  activeRoster,
  currentLineup,
}: {
  leagueId: string;
  week: number;
  slots: string[];
  activeRoster: RosterPlayer[];
  currentLineup: Record<string, string>;
}) {
  const [assignments, setAssignments] = useState<Record<string, string>>(currentLineup);
  const [saving, setSaving] = useState(false);

  function assign(slot: string, playerId: string) {
    setAssignments((prev) => ({ ...prev, [slot]: playerId }));
  }

  const assignedIds = new Set(
    Object.entries(assignments)
      .filter(([, pid]) => pid !== "")
      .map(([, pid]) => pid)
  );

  function eligibleForSlot(slot: string): RosterPlayer[] {
    const eligible = SLOT_ELIGIBLE[slotBase(slot)] ?? [];
    const current = assignments[slot];
    return activeRoster.filter(
      (p) =>
        eligible.includes(p.position) &&
        (!assignedIds.has(p.player_id) || p.player_id === current)
    );
  }

  const benchPlayers = activeRoster.filter((p) => !assignedIds.has(p.player_id));
  const starterCount = Object.values(assignments).filter((v) => v !== "").length;

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    await setLineup(formData);
    setSaving(false);
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border p-5"
      style={{ borderColor: "#2a2a40" }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
          Starting Lineup &mdash; Week {week}
        </h2>
        <span className="text-xs text-zinc-500">
          {starterCount} / {slots.length} slots filled
        </span>
      </div>

      <p className="text-xs text-zinc-500">
        Only starters score. Set your lineup each week before games kick off.
        FLEX accepts RB, WR, or TE.
      </p>

      <form action={handleSubmit}>
        <input type="hidden" name="leagueId" value={leagueId} />
        <input type="hidden" name="week" value={week} />

        <div className="flex flex-col gap-2">
          {slots.map((slot) => {
            const eligible = eligibleForSlot(slot);
            const current = assignments[slot] ?? "";
            const currentPlayer = activeRoster.find((p) => p.player_id === current);
            return (
              <div
                key={slot}
                className="flex items-center gap-3 rounded-md border px-3 py-2"
                style={{
                  borderColor: current ? "#0057FF" : "#2a2a40",
                  background: current ? "rgba(0,87,255,0.05)" : "transparent",
                }}
              >
                <span
                  className="w-12 shrink-0 text-xs font-bold uppercase tracking-wider"
                  style={{ color: current ? "#0057FF" : "#8a8a9a" }}
                >
                  {slotLabel(slot)}
                </span>

                <select
                  name={`slot_${slot}`}
                  value={current}
                  onChange={(e) => assign(slot, e.target.value)}
                  className="flex-1 rounded border px-2 py-1 text-sm"
                  style={{
                    borderColor: "#2a2a40",
                    background: "#0d0d1a",
                    color: "#f4f4f8",
                  }}
                >
                  <option value="">-- Empty --</option>
                  {eligible.map((p) => (
                    <option key={p.player_id} value={p.player_id}>
                      {p.full_name} ({p.position})
                    </option>
                  ))}
                </select>

                {currentPlayer && (
                  <button
                    type="button"
                    onClick={() => assign(slot, "")}
                    className="shrink-0 text-xs"
                    style={{ color: "#8a8a9a" }}
                    title="Clear slot"
                  >
                    x
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || starterCount === 0}
            className="rounded-md px-5 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: "#FFD700", color: "#0d0d1a" }}
          >
            {saving ? "Saving..." : "Save Lineup"}
          </button>
          {starterCount < slots.length && (
            <p className="text-xs text-zinc-500">
              {slots.length - starterCount} slot{slots.length - starterCount !== 1 ? "s" : ""} empty &mdash; those positions score 0.
            </p>
          )}
        </div>
      </form>

      {benchPlayers.length > 0 && (
        <div className="border-t pt-4" style={{ borderColor: "#2a2a40" }}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Bench</p>
          <div className="flex flex-wrap gap-2">
            {benchPlayers.map((p) => (
              <span
                key={p.player_id}
                className="rounded-full px-3 py-1 text-xs"
                style={{ background: "#1c1c2b", color: "#8a8a9a" }}
              >
                {p.full_name} ({p.position})
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
