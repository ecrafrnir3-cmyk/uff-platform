"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { addPlayer, addAndDropPlayer } from "../player-actions";
import { submitWaiverBid, cancelWaiverBid } from "./faab-actions";

const supabase = createClient();

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

interface Player {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  status: string | null;
  adp: number | null;
}

interface ActiveRosterPlayer {
  player_id: string;
  full_name: string;
  position: string | null;
}

export interface WaiverBid {
  id: string;
  player_id: string;
  bid_amount: number;
  drop_player_id: string | null;
  status: string;
}

function statusColor(status: string | null) {
  if (!status || status === "Active") return null;
  if (status === "Injured Reserve") return "#CC0000";
  if (status === "Questionable") return "#FFD700";
  if (status === "Doubtful" || status === "Out") return "#ff8a8a";
  return "#f4f4f8";
}

const POS_COLOR: Record<string, string> = {
  QB: "#0057FF", RB: "#3DDC84", WR: "#FFD700",
  TE: "#FF6B35", K: "#f4f4f8", DEF: "#CC0000", DST: "#CC0000",
};

export default function FreeAgents({
  leagueId,
  rosteredIds,
  projMap,
  hasProjections,
  rosterFull,
  maxActive,
  week,
  myActiveRoster,
  faabEnabled = false,
  myBalance = 0,
  myBids = [],
  bidPlayerNames = {},
}: {
  leagueId: string;
  rosteredIds: string[];
  projMap: Record<string, number>;
  hasProjections: boolean;
  rosterFull: boolean;
  maxActive: number;
  week: number;
  myActiveRoster: ActiveRosterPlayer[];
  faabEnabled?: boolean;
  myBalance?: number;
  myBids?: WaiverBid[];
  bidPlayerNames?: Record<string, string>;
}) {
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [players, setPlayers] = useState<Player[]>([]);
  const [intelMap, setIntelMap] = useState<Record<string, { loading: boolean; intel?: string; error?: string }>>({});

  // ── Instant-add mode state ──────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [dropPlayerId, setDropPlayerId] = useState<string>("");

  // ── FAAB mode state ─────────────────────────────────────────────────────────
  // bid form open + input per player
  const [bidForm, setBidForm] = useState<Record<string, { amount: string; dropId: string }>>({});
  const [bidSubmitting, setBidSubmitting] = useState<string | null>(null);
  const [bidError, setBidError] = useState<string | null>(null);
  const [localBids, setLocalBids] = useState<WaiverBid[]>(myBids);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const rosteredSet = new Set(rosteredIds);

  useEffect(() => {
    const fetchPlayers = async () => {
      const hasSearch = search.trim().length >= 2;
      const hasPos = posFilter !== "ALL";

      let q = supabase
        .from("players")
        .select("id, full_name, position, team, status, adp")
        .not("position", "is", null)
        .not("position", "eq", "");

      if (hasSearch) q = q.ilike("full_name", `%${search.trim()}%`);
      if (hasPos) q = q.eq("position", posFilter);

      const { data } = await q.order("adp", { ascending: true, nullsFirst: false }).limit(150);
      if (data) {
        const free = (data as Player[]).filter((p) => !rosteredSet.has(p.id));
        if (hasProjections) {
          free.sort((a, b) => (projMap[b.id] ?? 0) - (projMap[a.id] ?? 0));
        }
        setPlayers(free);
      }
    };

    const timer = setTimeout(fetchPlayers, search ? 300 : 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, posFilter]);

  async function getIntel(playerId: string) {
    setIntelMap((prev) => ({ ...prev, [playerId]: { loading: true } }));
    try {
      const res = await fetch("/api/waiver-intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: leagueId, player_id: playerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIntelMap((prev) => ({ ...prev, [playerId]: { loading: false, error: data.error ?? "No intel available" } }));
        return;
      }
      setIntelMap((prev) => ({ ...prev, [playerId]: { loading: false, intel: data.intel } }));
    } catch {
      setIntelMap((prev) => ({ ...prev, [playerId]: { loading: false, error: "Network error" } }));
    }
  }

  // ── Instant-add handlers ─────────────────────────────────────────────────────
  async function handleAdd(playerId: string) {
    setSubmitting(playerId);
    const fd = new FormData();
    fd.append("leagueId", leagueId);
    if (rosterFull) {
      if (!dropPlayerId) { setSubmitting(null); return; }
      fd.append("addPlayerId", playerId);
      fd.append("dropPlayerId", dropPlayerId);
      await addAndDropPlayer(fd);
    } else {
      fd.append("playerId", playerId);
      await addPlayer(fd);
    }
    setSubmitting(null);
  }

  // ── FAAB bid handlers ────────────────────────────────────────────────────────
  function openBidForm(playerId: string) {
    setBidForm((prev) => ({
      ...prev,
      [playerId]: prev[playerId] ? prev[playerId] : { amount: "0", dropId: "" },
    }));
    setBidError(null);
  }

  function closeBidForm(playerId: string) {
    setBidForm((prev) => {
      const next = { ...prev };
      delete next[playerId];
      return next;
    });
    setBidError(null);
  }

  async function handleBidSubmit(player: Player) {
    const form = bidForm[player.id];
    if (!form) return;

    const amount = parseInt(form.amount, 10);
    if (isNaN(amount) || amount < 0) {
      setBidError("Enter a valid bid amount (0 or more).");
      return;
    }
    if (amount > myBalance) {
      setBidError(`Bid exceeds your balance ($${myBalance}).`);
      return;
    }
    if (rosterFull && !form.dropId) {
      setBidError("Your roster is full — select a player to drop.");
      return;
    }

    setBidSubmitting(player.id);
    setBidError(null);
    const fd = new FormData();
    fd.append("leagueId", leagueId);
    fd.append("playerId", player.id);
    fd.append("bidAmount", String(amount));
    fd.append("dropPlayerId", form.dropId);
    fd.append("week", String(week));

    const result = await submitWaiverBid(fd);
    if (result.error) {
      setBidError(result.error);
    } else {
      // Fetch real bids from DB so we have the actual UUID for cancellation
      // RLS ensures we only see our own pending bids
      const { data: freshBids } = await supabase
        .from("uff_waiver_bids")
        .select("id, player_id, bid_amount, drop_player_id, status")
        .eq("league_id", leagueId)
        .eq("week", week)
        .eq("status", "pending");
      setLocalBids(freshBids ?? []);
      closeBidForm(player.id);
    }
    setBidSubmitting(null);
  }

  async function handleCancelBid(bidId: string) {
    setCancellingId(bidId);
    const fd = new FormData();
    fd.append("bidId", bidId);
    const result = await cancelWaiverBid(fd);
    if (!result.error) {
      setLocalBids((prev) => prev.filter((b) => b.id !== bidId));
    }
    setCancellingId(null);
  }

  const dropDisabled = rosterFull && !dropPlayerId;
  const pendingBids = localBids.filter((b) => b.status === "pending");
  const pendingPlayerIds = new Set(pendingBids.map((b) => b.player_id));

  // Merge server-fetched names (for bid players) with locally visible player list
  const playerNameMap: Record<string, string> = { ...bidPlayerNames };
  for (const p of players) playerNameMap[p.id] = p.full_name;

  return (
    <div className="flex flex-col gap-6">

      {/* ── FAAB balance banner ─────────────────────────────────────────────── */}
      {faabEnabled && (
        <div
          className="flex items-center justify-between rounded-lg border px-4 py-3"
          style={{ borderColor: "#FFD70044", background: "rgba(255,215,0,0.04)" }}
        >
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "#FFD700" }}>
              FAAB Balance
            </p>
            <p className="text-2xl font-black tabular-nums" style={{ color: "#FFD700" }}>
              ${myBalance}
            </p>
            <p className="text-xs" style={{ color: "#8888aa" }}>
              Bids are blind — processed by the commissioner. Highest bid wins.
            </p>
          </div>
          {pendingBids.length > 0 && (
            <div
              className="rounded-full px-3 py-1 text-xs font-bold"
              style={{ background: "rgba(0,87,255,0.12)", color: "#0057FF", border: "1px solid #0057FF33" }}
            >
              {pendingBids.length} pending bid{pendingBids.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      {/* ── Pending bids this week ──────────────────────────────────────────── */}
      {faabEnabled && pendingBids.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "#6b6b8a" }}>
            My Bids · Week {week}
          </p>
          {pendingBids.map((bid) => {
            const dropName = myActiveRoster.find((r) => r.player_id === bid.drop_player_id)?.full_name;
            return (
              <div
                key={bid.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
                style={{ borderColor: "#2a2a40", background: "#15151f" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {playerNameMap[bid.player_id] ?? bid.player_id}
                  </p>
                  {dropName && (
                    <p className="text-xs" style={{ color: "#CC0000" }}>
                      Drop: {dropName}
                    </p>
                  )}
                </div>
                <span
                  className="text-sm font-black tabular-nums shrink-0"
                  style={{ color: "#FFD700" }}
                >
                  ${bid.bid_amount}
                </span>
                <button
                  disabled={cancellingId === bid.id}
                  onClick={() => handleCancelBid(bid.id)}
                  className="shrink-0 rounded px-2 py-1 text-xs font-semibold disabled:opacity-40"
                  style={{ background: "rgba(204,0,0,0.12)", color: "#CC0000", border: "1px solid #CC000033" }}
                >
                  {cancellingId === bid.id ? "…" : "Cancel"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Search + filter ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
        />
        <div className="flex flex-wrap gap-1">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              onClick={() => setPosFilter(pos)}
              className="rounded px-3 py-1.5 text-xs font-semibold"
              style={{
                background: posFilter === pos ? "#0057FF" : "#1c1c2b",
                color: "#f4f4f8",
              }}
            >
              {pos}
            </button>
          ))}
        </div>
        {hasProjections && (
          <p className="text-xs" style={{ color: "#f4f4f8" }}>
            Ranked by projected points · Week {week}
          </p>
        )}
        {!hasProjections && (
          <p className="text-xs" style={{ color: "#f4f4f8" }}>
            Ranked by ADP · Projections available once the season starts
          </p>
        )}
        {faabEnabled && (
          <p className="text-xs" style={{ color: "#8888aa" }}>
            Click <strong style={{ color: "#0057FF" }}>Bid</strong> to submit a FAAB waiver claim. Bids are sealed until the commissioner processes waivers.
          </p>
        )}
      </div>

      {/* ── Drop-to-add selector (instant mode only) ───────────────────────── */}
      {!faabEnabled && rosterFull && (
        <div
          className="rounded-lg border p-4 flex flex-col gap-3"
          style={{ borderColor: "#FFD700", background: "#1a1500" }}
        >
          <p className="text-sm font-semibold" style={{ color: "#FFD700" }}>
            Roster full ({maxActive} players) — select a player to drop, then click Add.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs uppercase tracking-wide" style={{ color: "#f4f4f8" }}>Drop</label>
            <select
              value={dropPlayerId}
              onChange={(e) => setDropPlayerId(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm w-full"
              style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
            >
              <option value="">— Choose a player to drop —</option>
              {myActiveRoster.map((rp) => (
                <option key={rp.player_id} value={rp.player_id}>
                  [{(rp.position ?? "?").toUpperCase()}] {rp.full_name}
                </option>
              ))}
            </select>
            {dropPlayerId && (
              <p className="text-xs" style={{ color: "#f4f4f8" }}>
                {myActiveRoster.find((r) => r.player_id === dropPlayerId)?.full_name} will be released when you click Add.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Global bid error ───────────────────────────────────────────────── */}
      {bidError && (
        <p
          className="rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}
        >
          {bidError}
        </p>
      )}

      {/* ── Player list ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        {players.length === 0 && (
          <p className="py-8 text-center text-sm text-white">
            {search.trim().length > 0 || posFilter !== "ALL"
              ? "No available free agents match your search."
              : "Loading free agents…"}
          </p>
        )}

        {players.map((p, idx) => {
          const proj    = projMap[p.id];
          const sColor  = statusColor(p.status);
          const intel   = intelMap[p.id];
          const form    = bidForm[p.id];
          const hasBid  = faabEnabled && pendingPlayerIds.has(p.id);
          const existingBid = faabEnabled ? localBids.find(
            (b) => b.player_id === p.id && b.status === "pending"
          ) : undefined;

          return (
            <div
              key={p.id}
              className="flex flex-col rounded-lg border px-3 py-2 gap-1.5"
              style={{
                borderColor: hasBid ? "#0057FF44" : "#2a2a40",
                background: hasBid ? "rgba(0,87,255,0.03)" : "transparent",
              }}
            >
              {/* Main row */}
              <div className="flex items-center justify-between gap-3">
                {/* Rank */}
                <span className="w-6 text-right text-xs shrink-0" style={{ color: "#f4f4f8" }}>{idx + 1}</span>

                {/* Headshot */}
                {p.position !== "DEF" && p.position !== "DST" && (
                  <img
                    src={`https://sleepercdn.com/content/nfl/players/thumb/${p.id}.jpg`}
                    alt=""
                    width={32} height={32}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                    style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, width: 32, height: 32, background: "#1c1c2b" }}
                  />
                )}

                {/* Player info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{p.full_name}</p>
                  <p className="text-xs text-white">
                    {p.position ?? "?"} &middot; {p.team ?? "FA"}
                    {p.status && p.status !== "Active" && (
                      <span className="ml-1 font-semibold" style={{ color: sColor ?? undefined }}>
                        · {p.status}
                      </span>
                    )}
                  </p>
                </div>

                {/* Projected pts */}
                {hasProjections && (
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums" style={{ color: "#f4f4f8" }}>
                      {proj != null ? proj.toFixed(1) : "—"}
                    </p>
                    <p className="text-xs" style={{ color: "#f4f4f8" }}>proj</p>
                  </div>
                )}

                {/* Intel button */}
                {!intel && (
                  <button
                    onClick={() => getIntel(p.id)}
                    title="Get AI analysis"
                    className="shrink-0 rounded px-2 py-1 text-xs font-semibold transition hover:opacity-80"
                    style={{ background: "rgba(0,87,255,0.12)", color: "#0057FF", border: "1px solid #0057FF33" }}
                  >
                    💡
                  </button>
                )}
                {intel?.loading && (
                  <span className="shrink-0 text-xs" style={{ color: "#8888aa" }}>…</span>
                )}

                {/* Action button */}
                {faabEnabled ? (
                  hasBid && !form ? (
                    // Has an existing bid — show bid amount + edit button
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-bold tabular-nums" style={{ color: "#0057FF" }}>
                        ${existingBid?.bid_amount ?? 0}
                      </span>
                      <button
                        onClick={() => {
                          setBidForm((prev) => ({
                            ...prev,
                            [p.id]: { amount: String(existingBid?.bid_amount ?? 0), dropId: existingBid?.drop_player_id ?? "" },
                          }));
                        }}
                        className="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold"
                        style={{ background: "#1c1c2b", color: "#0057FF", border: "1px solid #0057FF44" }}
                      >
                        Edit
                      </button>
                    </div>
                  ) : form ? null : (
                    <button
                      onClick={() => openBidForm(p.id)}
                      className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold"
                      style={{ background: "#0057FF", color: "#f4f4f8" }}
                    >
                      Bid
                    </button>
                  )
                ) : (
                  <button
                    disabled={dropDisabled || submitting === p.id}
                    onClick={() => handleAdd(p.id)}
                    className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                    style={{ background: rosterFull ? "#CC0000" : "#0057FF", color: "#f4f4f8" }}
                    title={rosterFull && !dropPlayerId ? "Select a player to drop first" : undefined}
                  >
                    {submitting === p.id ? "…" : rosterFull ? "Add & Drop" : "Add"}
                  </button>
                )}
              </div>

              {/* ── FAAB bid form (inline) ──────────────────────────────────────── */}
              {faabEnabled && form && (
                <div
                  className="mt-1 flex flex-col gap-2 rounded-lg border p-3"
                  style={{ borderColor: "#0057FF33", background: "rgba(0,87,255,0.04)" }}
                >
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "#0057FF" }}>
                    Submit FAAB Bid — {p.full_name}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold" style={{ color: "#FFD700" }}>$</span>
                      <input
                        type="number"
                        min={0}
                        max={myBalance}
                        value={form.amount}
                        onChange={(e) =>
                          setBidForm((prev) => ({ ...prev, [p.id]: { ...prev[p.id], amount: e.target.value } }))
                        }
                        className="w-20 rounded border px-2 py-1 text-sm text-center tabular-nums"
                        style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
                      />
                      <span className="text-xs" style={{ color: "#8888aa" }}>/ ${myBalance}</span>
                    </div>

                    {/* Drop selector — required if full, optional otherwise */}
                    <select
                      value={form.dropId}
                      onChange={(e) =>
                        setBidForm((prev) => ({ ...prev, [p.id]: { ...prev[p.id], dropId: e.target.value } }))
                      }
                      className="rounded-md border px-2 py-1 text-xs flex-1 min-w-[140px]"
                      style={{ borderColor: "#2a2a40", background: "#15151f", color: "#f4f4f8" }}
                    >
                      <option value="">{rosterFull ? "— Select drop (required) —" : "— Drop player (optional) —"}</option>
                      {myActiveRoster.map((rp) => (
                        <option key={rp.player_id} value={rp.player_id}>
                          [{(rp.position ?? "?").toUpperCase()}] {rp.full_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <button
                      disabled={bidSubmitting === p.id}
                      onClick={() => handleBidSubmit(p)}
                      className="rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                      style={{ background: "#0057FF", color: "#f4f4f8" }}
                    >
                      {bidSubmitting === p.id ? "Submitting…" : hasBid ? "Update Bid" : "Submit Bid"}
                    </button>
                    <button
                      onClick={() => closeBidForm(p.id)}
                      className="rounded-md px-3 py-1.5 text-xs font-semibold"
                      style={{ background: "#1c1c2b", color: "#f4f4f8", border: "1px solid #2a2a40" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Intel text */}
              {intel?.intel && (
                <p className="text-xs leading-relaxed pl-1" style={{ color: "#88aaff" }}>
                  💡 {intel.intel}
                </p>
              )}
              {intel?.error && (
                <p className="text-xs pl-1" style={{ color: "#ff8a8a" }}>{intel.error}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
