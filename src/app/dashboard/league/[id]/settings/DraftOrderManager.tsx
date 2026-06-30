"use client";

import { useState, useRef } from "react";
import { saveDraftOrder } from "./actions";

interface Member {
  id: string;
  team_name: string;
  faction: "hero" | "villain" | null;
}

const HERO_COLOR    = "#0057FF";
const VILLAIN_COLOR = "#CC0000";

export default function DraftOrderManager({
  leagueId,
  members,
  initialOrder,
  draftStatus,
}: {
  leagueId: string;
  members: Member[];
  initialOrder: string[];
  draftStatus: string;
}) {
  const locked = draftStatus !== "not_started";

  // Build ordered list from initialOrder (fall back to join order)
  const ordered = initialOrder.length > 0
    ? initialOrder
        .map((id) => members.find((m) => m.id === id))
        .filter(Boolean) as Member[]
    : [...members];

  const [order, setOrder] = useState<Member[]>(ordered);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const dragIdx = useRef<number | null>(null);

  function randomize() {
    const shuffled = [...order];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setOrder(shuffled);
    setSaved(false);
  }

  function onDragStart(idx: number) { dragIdx.current = idx; }
  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const next = [...order];
    const [moved] = next.splice(dragIdx.current, 1);
    next.splice(idx, 0, moved);
    dragIdx.current = idx;
    setOrder(next);
    setSaved(false);
  }
  function onDrop() { dragIdx.current = null; }

  async function handleSave() {
    setSaving(true);
    const fd = new FormData();
    fd.set("leagueId", leagueId);
    fd.set("order", JSON.stringify(order.map((m) => m.id)));
    await saveDraftOrder(fd);
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-3">
      {locked ? (
        <p className="text-xs" style={{ color: "#8888aa" }}>
          Draft has started — order is locked.
        </p>
      ) : (
        <p className="text-xs" style={{ color: "#8888aa" }}>
          Drag rows to reorder. Pick 1 drafts first. Click <strong>Randomize</strong> to shuffle, then <strong>Save Order</strong>.
        </p>
      )}

      <div className="flex flex-col gap-1">
        {order.map((m, i) => {
          const factionColor = m.faction === "hero" ? HERO_COLOR : m.faction === "villain" ? VILLAIN_COLOR : "#8888aa";
          return (
            <div
              key={m.id}
              draggable={!locked}
              onDragStart={() => onDragStart(i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={onDrop}
              className="flex items-center gap-3 rounded-md border px-3 py-2"
              style={{
                borderColor: "#2a2a40",
                background: "#15151f",
                cursor: locked ? "default" : "grab",
                userSelect: "none",
              }}
            >
              <span className="text-sm font-bold tabular-nums w-5 text-right" style={{ color: "#FFD700" }}>
                {i + 1}
              </span>
              {!locked && (
                <span style={{ color: "#4a4a6a", fontSize: 14 }}>⠿</span>
              )}
              <span className="flex-1 text-sm font-semibold truncate" style={{ color: "#f4f4f8" }}>
                {m.team_name}
              </span>
              <span className="text-xs capitalize" style={{ color: factionColor }}>
                {m.faction ?? "—"}
              </span>
            </div>
          );
        })}
      </div>

      {!locked && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={randomize}
            className="rounded-md px-4 py-2 text-sm font-semibold"
            style={{ background: "rgba(255,215,0,0.12)", color: "#FFD700", border: "1px solid rgba(255,215,0,0.3)" }}
          >
            🎲 Randomize
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-semibold"
            style={{ background: "#0057FF", color: "#f4f4f8", opacity: saving ? 0.7 : 1 }}
          >
            {saving ? "Saving…" : "Save Order"}
          </button>
          {saved && (
            <span className="self-center text-xs" style={{ color: "#3DDC84" }}>✓ Saved</span>
          )}
        </div>
      )}
    </div>
  );
}
