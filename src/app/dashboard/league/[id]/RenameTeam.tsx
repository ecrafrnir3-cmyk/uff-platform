"use client";

import { useState, useTransition } from "react";
import { renameTeam } from "./actions";

export default function RenameTeam({
  leagueId,
  currentName,
}: {
  leagueId: string;
  currentName: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    const name = value.trim();
    if (name.length < 2) { setError("At least 2 characters."); return; }
    if (name.length > 40) { setError("40 characters max."); return; }
    startTransition(async () => {
      const res = await renameTeam(leagueId, name);
      if (res?.error) { setError(res.error); return; }
      setEditing(false);
    });
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm" style={{ color: "#a0a0c0" }}>
          Your team:{" "}
          <span className="font-semibold" style={{ color: "#f4f4f8" }}>{currentName}</span>
        </span>
        <button
          onClick={() => { setValue(currentName); setEditing(true); }}
          className="rounded px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
          style={{ background: "rgba(0,87,255,0.15)", color: "#0057FF", border: "1px solid rgba(0,87,255,0.3)" }}
        >
          ✏️ Rename
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={value}
          maxLength={40}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setError(null); } }}
          placeholder="New team name"
          className="rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8", minWidth: 200 }}
        />
        <button
          onClick={save}
          disabled={pending}
          className="rounded px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: "#0057FF", color: "#f4f4f8" }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => { setEditing(false); setError(null); }}
          disabled={pending}
          className="rounded px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: "#1c1c2b", color: "#a0a0c0", border: "1px solid #2a2a40" }}
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs" style={{ color: "#ff8a8a" }}>{error}</p>}
    </div>
  );
}
