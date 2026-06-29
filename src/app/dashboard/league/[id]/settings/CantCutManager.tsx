"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { addToCantCutList } from "./actions";

const supabase = createClient();

interface Player {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
}

export default function CantCutManager({
  leagueId,
  cantCutPlayerIds,
}: {
  leagueId: string;
  cantCutPlayerIds: string[];
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Player[]>([]);
  const [selected, setSelected] = useState<Player | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const cantCutSet = new Set(cantCutPlayerIds);

  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("players")
        .select("id, full_name, position, team")
        .ilike("full_name", `%${search.trim()}%`)
        .not("position", "is", null)
        .limit(20);
      setResults((data ?? []) as Player[]);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  async function handleAdd() {
    if (!selected) return;
    setSubmitting(true);
    const fd = new FormData();
    fd.append("leagueId", leagueId);
    fd.append("playerId", selected.id);
    await addToCantCutList(fd);
    setSubmitting(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4" style={{ borderColor: "#2a2a40", background: "#15151f" }}>
      <p className="text-sm font-semibold text-white">Add a Player</p>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by player name…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setSelected(null); }}
        className="w-full rounded-md border px-3 py-2 text-sm"
        style={{ borderColor: "#2a2a40", background: "#0d0d1a", color: "#f4f4f8" }}
      />

      {/* Results dropdown */}
      {results.length > 0 && !selected && (
        <div className="flex flex-col gap-0.5 rounded-md border overflow-hidden" style={{ borderColor: "#2a2a40" }}>
          {results.map((p) => {
            const alreadyProtected = cantCutSet.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                disabled={alreadyProtected}
                onClick={() => { setSelected(p); setSearch(p.full_name); setResults([]); }}
                className="flex items-center gap-2 px-3 py-2 text-left text-sm disabled:opacity-40"
                style={{ background: "#1c1c2b", color: "#f4f4f8" }}
              >
                <span
                  className="inline-block w-8 rounded text-center text-xs font-bold uppercase leading-5 shrink-0"
                  style={{ background: "#0057FF22", color: "#0057FF" }}
                >
                  {(p.position ?? "?").toUpperCase()}
                </span>
                <span className="flex-1 truncate font-medium">{p.full_name}</span>
                <span className="text-xs shrink-0" style={{ color: "#6b6b8a" }}>{p.team ?? "FA"}</span>
                {alreadyProtected && (
                  <span className="text-xs shrink-0" style={{ color: "#CC0000" }}>Already protected</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Selected player confirm */}
      {selected && (
        <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: "#0057FF44", background: "rgba(0,87,255,0.05)" }}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase" style={{ color: "#0057FF" }}>{selected.position}</span>
            <span className="text-sm font-semibold">{selected.full_name}</span>
            <span className="text-xs" style={{ color: "#6b6b8a" }}>{selected.team ?? "FA"}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setSelected(null); setSearch(""); }}
              className="rounded px-2 py-1 text-xs font-semibold"
              style={{ background: "#1c1c2b", color: "#f4f4f8", border: "1px solid #2a2a40" }}
            >
              Clear
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleAdd}
              className="rounded px-3 py-1 text-xs font-semibold disabled:opacity-40"
              style={{ background: "#CC0000", color: "#f4f4f8" }}
            >
              {submitting ? "Adding…" : "Add to List"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
