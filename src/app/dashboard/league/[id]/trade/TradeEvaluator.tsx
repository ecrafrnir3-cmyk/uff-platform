"use client";

import { useState } from "react";

interface PlayerBasic {
  player_id: string;
  full_name: string;
  position: string | null;
  team: string | null;
}

const POS_COLOR: Record<string, string> = {
  QB: "#0057FF", RB: "#3DDC84", WR: "#FFD700",
  TE: "#FF6B35", K: "#f4f4f8", DEF: "#CC0000", DST: "#CC0000",
};

function PosBadge({ position }: { position: string | null }) {
  const pos = (position ?? "?").toUpperCase();
  const color = POS_COLOR[pos] ?? "#f4f4f8";
  return (
    <span
      className="inline-block w-8 rounded text-center text-xs font-bold leading-5 uppercase shrink-0"
      style={{ background: color + "22", color }}
    >
      {pos}
    </span>
  );
}

export default function TradeEvaluator({
  leagueId,
  myPlayers,
  theirPlayers,
  partnerName,
  partnerMemberId,
}: {
  leagueId: string;
  myPlayers: PlayerBasic[];
  theirPlayers: PlayerBasic[];
  partnerName: string;
  partnerMemberId: string;
}) {
  const [mySelected, setMySelected] = useState<Set<string>>(new Set());
  const [theirSelected, setTheirSelected] = useState<Set<string>>(new Set());
  const [state, setState] = useState<{
    verdict?: string;
    loading: boolean;
    error?: string;
  }>({ loading: false });

  function toggleMy(pid: string) {
    setMySelected((prev) => {
      const n = new Set(prev);
      if (n.has(pid)) n.delete(pid); else n.add(pid);
      return n;
    });
    // Reset verdict when selection changes
    if (state.verdict) setState({ loading: false });
  }

  function toggleTheir(pid: string) {
    setTheirSelected((prev) => {
      const n = new Set(prev);
      if (n.has(pid)) n.delete(pid); else n.add(pid);
      return n;
    });
    if (state.verdict) setState({ loading: false });
  }

  async function evaluate() {
    if (mySelected.size === 0 || theirSelected.size === 0) return;
    setState({ loading: true });
    try {
      const res = await fetch("/api/trade-eval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          league_id: leagueId,
          proposer_player_ids: [...mySelected],
          receiver_player_ids: [...theirSelected],
          partner_member_id: partnerMemberId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Evaluation failed");
      setState({ loading: false, verdict: data.verdict });
    } catch (err) {
      setState({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const canEvaluate = mySelected.size > 0 && theirSelected.size > 0 && !state.loading;

  // Parse verdict line for color coding
  const verdictLines = state.verdict?.split("\n") ?? [];
  const verdictLine = verdictLines.find((l) => l.startsWith("VERDICT:")) ?? null;
  const bodyLines = verdictLines.filter((l) => !l.startsWith("VERDICT:")).join("\n").trim();
  const verdictColor =
    verdictLine?.includes("FAIR") ? "#3DDC84"
    : verdictLine?.includes("AVOID") ? "#CC0000"
    : "#FFD700";

  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: "#13132b", borderColor: "#2a2a40" }}
    >
      <h2 className="text-base font-bold mb-0.5" style={{ color: "#FFD700" }}>
        ⚖️ Oracle Trade Verdict
      </h2>
      <p className="text-xs mb-4" style={{ color: "#f4f4f8" }}>
        Select players on each side to evaluate before proposing.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* My side */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#f4f4f8" }}>
            You send
          </p>
          <div className="flex flex-col gap-1">
            {myPlayers.length === 0 ? (
              <p className="text-xs" style={{ color: "#f4f4f8" }}>No players on your roster.</p>
            ) : myPlayers.map((p) => (
              <label
                key={p.player_id}
                className="flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer"
                style={{
                  border: `1px solid ${mySelected.has(p.player_id) ? "#FFD700" : "#2a2a40"}`,
                  background: mySelected.has(p.player_id) ? "rgba(255,215,0,0.07)" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={mySelected.has(p.player_id)}
                  onChange={() => toggleMy(p.player_id)}
                  className="accent-yellow-400 w-4 h-4 shrink-0"
                />
                <PosBadge position={p.position} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "#f4f4f8" }}>
                    {p.full_name}
                  </p>
                  <p className="text-xs" style={{ color: "#f4f4f8" }}>
                    {p.team ?? "FA"}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Their side */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#f4f4f8" }}>
            You receive from {partnerName}
          </p>
          <div className="flex flex-col gap-1">
            {theirPlayers.length === 0 ? (
              <p className="text-xs" style={{ color: "#f4f4f8" }}>This team has no active players.</p>
            ) : theirPlayers.map((p) => (
              <label
                key={p.player_id}
                className="flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer"
                style={{
                  border: `1px solid ${theirSelected.has(p.player_id) ? "#3DDC84" : "#2a2a40"}`,
                  background: theirSelected.has(p.player_id) ? "rgba(61,220,132,0.07)" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={theirSelected.has(p.player_id)}
                  onChange={() => toggleTheir(p.player_id)}
                  className="accent-green-400 w-4 h-4 shrink-0"
                />
                <PosBadge position={p.position} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "#f4f4f8" }}>
                    {p.full_name}
                  </p>
                  <p className="text-xs" style={{ color: "#f4f4f8" }}>
                    {p.team ?? "FA"}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Verdict display */}
      {state.verdict && (
        <div
          className="mb-4 rounded-lg border px-4 py-3"
          style={{ borderColor: verdictColor + "33", background: verdictColor + "08" }}
        >
          <p
            className="mb-1.5 text-xs font-semibold uppercase tracking-widest"
            style={{ color: verdictColor }}
          >
            ⚖️ Oracle&apos;s Verdict
          </p>
          {bodyLines && (
            <p className="text-sm leading-relaxed mb-2" style={{ color: "#d4d4e8" }}>
              {bodyLines}
            </p>
          )}
          {verdictLine && (
            <p className="text-sm font-bold" style={{ color: verdictColor }}>
              {verdictLine}
            </p>
          )}
        </div>
      )}

      {state.error && (
        <p className="mb-3 text-xs" style={{ color: "#ff8a8a" }}>
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        {state.loading ? (
          <p className="text-xs" style={{ color: "#FFD700" }}>
            ⚖️ The Oracle weighs both sides…
          </p>
        ) : (
          <button
            onClick={evaluate}
            disabled={!canEvaluate}
            className="rounded-lg px-5 py-2 text-sm font-bold transition-opacity disabled:opacity-40 hover:opacity-90"
            style={{ background: "#FFD700", color: "#0d0d1a" }}
          >
            ⚖️ Get Oracle&apos;s Verdict
          </button>
        )}
        {!canEvaluate && !state.loading && (
          <p className="text-xs" style={{ color: "#f4f4f8" }}>
            Select at least one player from each side.
          </p>
        )}
      </div>
    </div>
  );
}
