"use client";

import { useState } from "react";
import { postDraftVampireBite } from "../draft/actions";

export interface BiteTarget {
  playerId: string;
  name: string;
  position: string | null;
  team: string | null;
  adp: number | null;
  ownerTeam: string;
}

// Blocking gate shown INSTEAD of the roster while a manager still holds an
// unused Vampire Bite. Many managers closed the draft room the moment their
// last pick landed, so the post-draft panel in the draft room would never have
// been seen — this puts the choice in front of them wherever they go next.
// It disappears on its own at Week 1 kickoff, so nobody can be locked out.
export default function VampireBiteGate({
  leagueId,
  targets,
}: {
  leagueId: string;
  targets: BiteTarget[];
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BiteTarget | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const filtered = targets.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || (t.ownerTeam ?? "").toLowerCase().includes(q);
  });

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    const result = await postDraftVampireBite({ leagueId, targetPlayerId: selected.playerId });
    setSubmitting(false);
    if (result.error) {
      // Never closes on a rejection — pick someone else instead.
      setError(result.error);
      setSelected(null);
      return;
    }
    setDone(selected.name);
    // Full reload so the server re-renders the roster now that the bite is used.
    window.location.reload();
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
        <p className="text-lg font-semibold" style={{ color: "#3DDC84" }}>
          Bite locked in on {done} — loading your roster…
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-10 sm:px-8" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-2xl flex-col gap-5">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em]" style={{ color: "#CC0000" }}>
            One thing first
          </p>
          <h1 className="text-3xl font-bold" style={{ color: "#f4f4f8" }}>
            🧛 Your Vampire Bite is unused
          </h1>
          <p className="text-sm" style={{ color: "#d4d4e8" }}>
            You were dealt Vampire Bite in the draft and never used it. Choose any opponent&rsquo;s
            drafted player — <span className="font-semibold" style={{ color: "#ff8a8a" }}>10% of their
            score drains to you every week, all season.</span>
          </p>
          <p className="text-sm font-semibold" style={{ color: "#FFD700" }}>
            ⏳ This closes at Week 1 kickoff. Pick your target to continue to your roster.
          </p>
          <p className="text-xs" style={{ color: "#8888aa" }}>
            Ranked by draft ADP — the biggest names still un-bitten are at the top.
            Anyone already bitten by another manager has been removed.
          </p>
        </header>

        {error && (
          <p className="rounded-md border px-3 py-2 text-sm font-semibold"
             style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}>
            {error} Your bite has NOT been used — choose someone else.
          </p>
        )}

        <input
          type="text"
          placeholder="Search player or team…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
        />

        <div className="flex flex-col gap-1 max-h-[55vh] overflow-y-auto pr-1">
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm" style={{ color: "#8888aa" }}>No players match.</p>
          )}
          {filtered.map((t) => {
            const isSel = selected?.playerId === t.playerId;
            return (
              <button
                key={t.playerId}
                onClick={() => setSelected(t)}
                className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition"
                style={{
                  borderColor: isSel ? "#CC0000" : "#2a2a40",
                  background: isSel ? "rgba(204,0,0,0.12)" : "#15151f",
                }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "#f4f4f8" }}>{t.name}</p>
                  <p className="text-xs" style={{ color: "#8888aa" }}>
                    {t.position ?? "?"} · {t.team ?? "FA"} · {t.ownerTeam}
                  </p>
                </div>
                <div className="ml-2 shrink-0 text-right">
                  {t.adp != null && (
                    <span className="block text-xs tabular-nums" style={{ color: "#FFD700" }}>
                      ADP {t.adp}
                    </span>
                  )}
                  {isSel && <span className="text-xs font-bold" style={{ color: "#CC0000" }}>TARGET</span>}
                </div>
              </button>
            );
          })}
        </div>

        <button
          onClick={submit}
          disabled={!selected || submitting}
          className="w-full rounded-md px-4 py-3 text-sm font-bold disabled:opacity-40"
          style={{ background: "#CC0000", color: "#f4f4f8" }}
        >
          {submitting ? "Biting…" : selected ? `Bite ${selected.name}` : "Select a target"}
        </button>
      </main>
    </div>
  );
}
