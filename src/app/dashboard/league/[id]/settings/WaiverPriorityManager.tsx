"use client";

import { useRef, useState } from "react";
import { saveWaiverPriority } from "./actions";

interface Member {
  id: string;
  team_name: string;
  faction: "hero" | "villain" | null;
  waiver_priority: number | null;
}

export default function WaiverPriorityManager({
  leagueId,
  members,
}: {
  leagueId: string;
  members: Member[];
}) {
  // Sort by current priority (nulls last), then fallback to team_name
  const sorted = [...members].sort((a, b) => {
    if (a.waiver_priority == null && b.waiver_priority == null) return a.team_name.localeCompare(b.team_name);
    if (a.waiver_priority == null) return 1;
    if (b.waiver_priority == null) return -1;
    return a.waiver_priority - b.waiver_priority;
  });

  const [order, setOrder] = useState<Member[]>(sorted);
  const [saved, setSaved] = useState(false);
  const dragIdx = useRef<number | null>(null);

  function factionColor(f: string | null) {
    if (f === "hero") return "#0057FF";
    if (f === "villain") return "#CC0000";
    return "#8888aa";
  }

  async function handleSave() {
    const formData = new FormData();
    formData.set("leagueId", leagueId);
    formData.set("order", JSON.stringify(order.map((m) => m.id)));
    setSaved(false);
    await saveWaiverPriority(formData);
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs" style={{ color: "#8888aa" }}>
        Drag to reorder. #1 = highest priority (claims first).
      </p>
      <div className="flex flex-col gap-1">
        {order.map((member, idx) => (
          <div
            key={member.id}
            draggable
            onDragStart={() => { dragIdx.current = idx; }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragIdx.current === null || dragIdx.current === idx) return;
              const next = [...order];
              const [moved] = next.splice(dragIdx.current, 1);
              next.splice(idx, 0, moved);
              dragIdx.current = idx;
              setOrder(next);
            }}
            onDragEnd={() => { dragIdx.current = null; }}
            className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-grab active:cursor-grabbing select-none"
            style={{ borderColor: "#2a2a40", background: "#15151f" }}
          >
            <span className="text-xs font-bold shrink-0 tabular-nums w-5 text-right" style={{ color: "#FFD700" }}>
              {idx + 1}
            </span>
            <span className="text-base" style={{ color: "#8888aa" }}>☰</span>
            <span className="text-sm font-semibold flex-1 truncate" style={{ color: "#f4f4f8" }}>
              {member.team_name}
            </span>
            <span className="text-xs shrink-0" style={{ color: factionColor(member.faction) }}>
              {member.faction ?? "—"}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="rounded-md px-4 py-2 text-sm font-semibold"
          style={{ background: "#0057FF", color: "#fff" }}
        >
          Save Priority Order
        </button>
        {saved && (
          <span className="text-sm" style={{ color: "#3DDC84" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}
