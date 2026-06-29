import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { proposeTrade, respondToTrade, cancelTrade } from "../trade-actions";
import TradeEvaluator from "./TradeEvaluator";

const POS_COLOR: Record<string, string> = {
  QB: "#0057FF", RB: "#3DDC84", WR: "#FFD700",
  TE: "#FF6B35", K: "#f4f4f8", DEF: "#CC0000", DST: "#CC0000",
};
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DST"];

function positionRank(pos: string | null) {
  if (!pos) return POSITION_ORDER.length;
  const idx = POSITION_ORDER.indexOf(pos.toUpperCase());
  return idx === -1 ? POSITION_ORDER.length : idx;
}

interface RosterPlayer {
  id: string;
  player_id: string;
  slot: string;
  players: {
    id: string;
    full_name: string;
    position: string | null;
    team: string | null;
  } | null;
}

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

function PlayerCheckbox({
  player,
  name,
}: {
  player: RosterPlayer;
  name: string;
}) {
  const p = player.players;
  if (!p) return null;
  return (
    <label
      className="flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors"
      style={{ border: "1px solid #2a2a40" }}
    >
      <input
        type="checkbox"
        name={name}
        value={player.player_id}
        className="accent-yellow-400 w-4 h-4"
      />
      <PosBadge position={p.position} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: "#f4f4f8" }}>
          {p.full_name}
        </p>
        <p className="text-xs" style={{ color: "#f4f4f8" }}>
          {p.team ?? "—"}
        </p>
      </div>
      <span className="text-xs capitalize" style={{ color: "#f4f4f8" }}>
        {player.slot === "ir" ? "IR" : player.slot}
      </span>
    </label>
  );
}

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  pending:        { label: "Awaiting Response",     color: "#FFD700" },
  pending_review: { label: "Awaiting Commissioner", color: "#0057FF" },
  accepted:       { label: "Accepted ✓",            color: "#3DDC84" },
  rejected:       { label: "Rejected",              color: "#CC0000" },
  vetoed:         { label: "Vetoed",                color: "#CC0000" },
};

export default async function TradePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ receiverId?: string; error?: string }>;
}) {
  const { id: leagueId } = await params;
  const { receiverId, error } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify membership
  const { data: me } = await supabase
    .from("league_members")
    .select("id, team_name, faction")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me)
    redirect("/dashboard?error=" + encodeURIComponent("You\'re not a member of that league."));

  // All other members
  const { data: allMembers } = await supabase
    .from("league_members")
    .select("id, team_name, faction")
    .eq("league_id", leagueId)
    .neq("id", me.id);
  const members = allMembers ?? [];

  // My active roster
  const { data: myRosterRaw } = await supabase
    .from("uff_roster_players")
    .select("id, player_id, slot, players(id, full_name, position, team)")
    .eq("member_id", me.id)
    .is("dropped_at", null);
  const myRoster = (myRosterRaw ?? []) as unknown as RosterPlayer[];
  myRoster.sort(
    (a, b) =>
      positionRank(a.players?.position ?? null) -
      positionRank(b.players?.position ?? null)
  );

  // Receiver's roster (if a partner is selected)
  let receiverRoster: RosterPlayer[] = [];
  let receiverMember: { id: string; team_name: string; faction: string } | null = null;

  if (receiverId) {
    receiverMember = members.find((m) => m.id === receiverId) ?? null;
    if (receiverMember) {
      const { data: rxRaw } = await supabase
        .from("uff_roster_players")
        .select("id, player_id, slot, players(id, full_name, position, team)")
        .eq("member_id", receiverId)
        .is("dropped_at", null);
      receiverRoster = (rxRaw ?? []) as unknown as RosterPlayer[];
      receiverRoster.sort(
        (a, b) =>
          positionRank(a.players?.position ?? null) -
          positionRank(b.players?.position ?? null)
      );
    }
  }

  // ─── Trade inbox data ───
  const [{ data: incomingRaw }, { data: sentRaw }] = await Promise.all([
    supabase
      .from("uff_trades")
      .select("id, proposer_id, proposer_player_ids, receiver_player_ids, status, created_at")
      .eq("league_id", leagueId)
      .eq("receiver_id", me.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("uff_trades")
      .select("id, receiver_id, proposer_player_ids, receiver_player_ids, status, created_at, veto_reason")
      .eq("league_id", leagueId)
      .eq("proposer_id", me.id)
      .in("status", ["pending", "pending_review", "accepted", "rejected", "vetoed"])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const incomingTrades = (incomingRaw ?? []) as Array<{
    id: string;
    proposer_id: string;
    proposer_player_ids: string[];
    receiver_player_ids: string[];
    status: string;
    created_at: string;
  }>;

  const sentTrades = (sentRaw ?? []) as Array<{
    id: string;
    receiver_id: string;
    proposer_player_ids: string[];
    receiver_player_ids: string[];
    status: string;
    created_at: string;
    veto_reason: string | null;
  }>;

  // Build player name map for all trade player IDs
  const tradePlayerIds = [
    ...new Set([
      ...incomingTrades.flatMap((t) => [...(t.proposer_player_ids ?? []), ...(t.receiver_player_ids ?? [])]),
      ...sentTrades.flatMap((t) => [...(t.proposer_player_ids ?? []), ...(t.receiver_player_ids ?? [])]),
    ]),
  ];
  type PlayerInfo = { name: string; position: string | null };
  const playerInfoMap: Record<string, PlayerInfo> = {};
  if (tradePlayerIds.length > 0) {
    const { data: pRows } = await supabase
      .from("players")
      .select("id, full_name, position")
      .in("id", tradePlayerIds);
    for (const p of pRows ?? []) {
      playerInfoMap[p.id] = { name: p.full_name, position: p.position ?? null };
    }
  }

  // Member name map (includes self)
  const memberNameMap: Record<string, string> = { [me.id]: me.team_name };
  for (const m of members) memberNameMap[m.id] = m.team_name;

  const GOLD = "#FFD700";

  function timeAgo(iso: string) {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <div
      className="min-h-screen px-4 py-8"
      style={{ background: "#0d0d1a", color: "#f4f4f8" }}
    >
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href={`/dashboard/league/${leagueId}/roster`}
            className="text-sm font-semibold px-3 py-1 rounded-md transition-colors hover:bg-white/10"
            style={{ color: "#f4f4f8", border: "1px solid #2a2a40" }}
          >
            ← Roster
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: GOLD }}>
            Trade Center
            {incomingTrades.length > 0 && (
              <span
                className="ml-2 inline-flex items-center justify-center rounded-full text-sm font-bold px-2"
                style={{ background: "#CC0000", color: "#fff" }}
              >
                {incomingTrades.length}
              </span>
            )}
          </h1>
        </div>

        {/* Error flash */}
        {error && (
          <div
            className="mb-4 rounded-lg px-4 py-3 text-sm font-semibold"
            style={{
              background: "rgba(204,0,0,0.15)",
              color: "#CC0000",
              border: "1px solid rgba(204,0,0,0.3)",
            }}
          >
            {decodeURIComponent(error)}
          </div>
        )}

        {/* ── Incoming Trade Offers ── */}
        {incomingTrades.length > 0 && (
          <section className="mb-8">
            <h2 className="text-base font-bold mb-3 flex items-center gap-2" style={{ color: "#f4f4f8" }}>
              📥 Incoming Offers
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold"
                style={{ background: "#CC0000", color: "#fff" }}
              >
                {incomingTrades.length}
              </span>
            </h2>
            <div className="flex flex-col gap-4">
              {incomingTrades.map((trade) => {
                const fromName = memberNameMap[trade.proposer_id] ?? "Unknown Team";
                const theyOffer = trade.proposer_player_ids ?? [];
                const theyWant  = trade.receiver_player_ids ?? [];
                return (
                  <div
                    key={trade.id}
                    className="rounded-xl p-5"
                    style={{ background: "#13132b", border: "1px solid rgba(204,0,0,0.35)" }}
                  >
                    {/* Offer header */}
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <span className="text-sm font-bold" style={{ color: GOLD }}>
                          {fromName}
                        </span>
                        <span className="ml-2 text-xs" style={{ color: "#6b6b8a" }}>
                          {timeAgo(trade.created_at)}
                        </span>
                      </div>
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ background: "#FFD70022", color: GOLD }}
                      >
                        Pending
                      </span>
                    </div>

                    {/* Player columns */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                      <div>
                        <p className="text-xs font-semibold uppercase mb-2" style={{ color: "#6b6b8a" }}>
                          They send you
                        </p>
                        <div className="flex flex-col gap-1.5">
                          {theyOffer.map((pid) => {
                            const p = playerInfoMap[pid];
                            return (
                              <div key={pid} className="flex items-center gap-2">
                                <PosBadge position={p?.position ?? null} />
                                <span className="text-sm font-medium" style={{ color: "#f4f4f8" }}>
                                  {p?.name ?? pid}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase mb-2" style={{ color: "#6b6b8a" }}>
                          You send them
                        </p>
                        <div className="flex flex-col gap-1.5">
                          {theyWant.map((pid) => {
                            const p = playerInfoMap[pid];
                            return (
                              <div key={pid} className="flex items-center gap-2">
                                <PosBadge position={p?.position ?? null} />
                                <span className="text-sm font-medium" style={{ color: "#f4f4f8" }}>
                                  {p?.name ?? pid}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Accept / Reject buttons */}
                    <div className="flex gap-3">
                      <form action={respondToTrade}>
                        <input type="hidden" name="leagueId" value={leagueId} />
                        <input type="hidden" name="tradeId" value={trade.id} />
                        <input type="hidden" name="accept" value="true" />
                        <button
                          type="submit"
                          className="rounded-lg px-5 py-2 text-sm font-bold transition-opacity hover:opacity-90"
                          style={{ background: "#3DDC84", color: "#0d0d1a" }}
                        >
                          Accept ✓
                        </button>
                      </form>
                      <form action={respondToTrade}>
                        <input type="hidden" name="leagueId" value={leagueId} />
                        <input type="hidden" name="tradeId" value={trade.id} />
                        <input type="hidden" name="accept" value="false" />
                        <button
                          type="submit"
                          className="rounded-lg px-5 py-2 text-sm font-bold transition-opacity hover:opacity-90"
                          style={{
                            background: "rgba(204,0,0,0.15)",
                            color: "#CC0000",
                            border: "1px solid rgba(204,0,0,0.3)",
                          }}
                        >
                          Reject ✗
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Sent Offers ── */}
        {sentTrades.length > 0 && (
          <section className="mb-8">
            <h2 className="text-base font-bold mb-3" style={{ color: "#f4f4f8" }}>
              📤 Sent Offers
            </h2>
            <div className="flex flex-col gap-3">
              {sentTrades.map((trade) => {
                const toName = memberNameMap[trade.receiver_id] ?? "Unknown Team";
                const iSend    = trade.proposer_player_ids ?? [];
                const iReceive = trade.receiver_player_ids ?? [];
                const badge = STATUS_BADGE[trade.status] ?? { label: trade.status, color: "#6b6b8a" };
                return (
                  <div
                    key={trade.id}
                    className="rounded-xl p-4"
                    style={{ background: "#13132b", border: "1px solid #2a2a40" }}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <span className="text-xs" style={{ color: "#6b6b8a" }}>To: </span>
                        <span className="text-sm font-bold" style={{ color: GOLD }}>{toName}</span>
                        <span className="ml-2 text-xs" style={{ color: "#6b6b8a" }}>
                          {timeAgo(trade.created_at)}
                        </span>
                      </div>
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: badge.color + "22", color: badge.color }}
                      >
                        {badge.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <p className="text-xs font-semibold uppercase mb-1" style={{ color: "#6b6b8a" }}>
                          You send
                        </p>
                        <div className="flex flex-col gap-1">
                          {iSend.map((pid) => {
                            const p = playerInfoMap[pid];
                            return (
                              <div key={pid} className="flex items-center gap-1.5">
                                <PosBadge position={p?.position ?? null} />
                                <span className="text-xs" style={{ color: "#f4f4f8" }}>{p?.name ?? pid}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase mb-1" style={{ color: "#6b6b8a" }}>
                          You receive
                        </p>
                        <div className="flex flex-col gap-1">
                          {iReceive.map((pid) => {
                            const p = playerInfoMap[pid];
                            return (
                              <div key={pid} className="flex items-center gap-1.5">
                                <PosBadge position={p?.position ?? null} />
                                <span className="text-xs" style={{ color: "#f4f4f8" }}>{p?.name ?? pid}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {trade.status === "vetoed" && trade.veto_reason && (
                      <p className="text-xs mb-3 italic" style={{ color: "#CC0000" }}>
                        Veto reason: {trade.veto_reason}
                      </p>
                    )}

                    {trade.status === "pending" && (
                      <form action={cancelTrade}>
                        <input type="hidden" name="leagueId" value={leagueId} />
                        <input type="hidden" name="tradeId" value={trade.id} />
                        <button
                          type="submit"
                          className="text-xs px-3 py-1 rounded font-semibold transition-opacity hover:opacity-80"
                          style={{ background: "#1c1c2b", color: "#6b6b8a", border: "1px solid #2a2a40" }}
                        >
                          Cancel Offer
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Divider before propose form ── */}
        {(incomingTrades.length > 0 || sentTrades.length > 0) && (
          <div className="mb-6 border-t" style={{ borderColor: "#2a2a40" }} />
        )}

        {/* Step 1: Pick a team */}
        <div
          className="rounded-xl p-5 mb-6"
          style={{ background: "#13132b", border: "1px solid #2a2a40" }}
        >
          <h2 className="text-base font-bold mb-3" style={{ color: "#f4f4f8" }}>
            Propose a Trade — Step 1: Pick a partner
          </h2>
          {members.length === 0 ? (
            <p className="text-sm" style={{ color: "#f4f4f8" }}>
              No other teams in this league yet.
            </p>
          ) : (
            <form method="get" className="flex items-center gap-3 flex-wrap">
              <select
                name="receiverId"
                defaultValue={receiverId ?? ""}
                className="flex-1 min-w-[200px] rounded-lg px-3 py-2 text-sm font-medium focus:outline-none"
                style={{
                  background: "#1c1c2b",
                  color: "#f4f4f8",
                  border: "1px solid #2a2a40",
                }}
              >
                <option value="" disabled>
                  Select a team…
                </option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.team_name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg px-5 py-2 text-sm font-bold transition-opacity hover:opacity-90"
                style={{ background: GOLD, color: "#0d0d1a" }}
              >
                View Roster
              </button>
            </form>
          )}
        </div>

        {/* Oracle Trade Evaluator */}
        {receiverMember && (
          <div className="mb-6">
            <TradeEvaluator
              leagueId={leagueId}
              myPlayers={myRoster
                .filter((r) => r.players != null)
                .map((r) => ({
                  player_id: r.player_id,
                  full_name: r.players?.full_name ?? "",
                  position: r.players?.position ?? null,
                  team: r.players?.team ?? null,
                }))}
              theirPlayers={receiverRoster
                .filter((r) => r.players != null)
                .map((r) => ({
                  player_id: r.player_id,
                  full_name: r.players?.full_name ?? "",
                  position: r.players?.position ?? null,
                  team: r.players?.team ?? null,
                }))}
              partnerName={receiverMember.team_name}
              partnerMemberId={receiverMember.id}
            />
          </div>
        )}

        {/* Step 2: Build the offer */}
        {receiverMember ? (
          <form action={proposeTrade}>
            <input type="hidden" name="leagueId" value={leagueId} />
            <input type="hidden" name="receiverId" value={receiverMember.id} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              {/* Your side */}
              <div
                className="rounded-xl p-5"
                style={{ background: "#13132b", border: "1px solid #2a2a40" }}
              >
                <h2 className="text-base font-bold mb-1" style={{ color: "#f4f4f8" }}>
                  Step 2a — Players you send
                </h2>
                <p className="text-xs mb-3" style={{ color: "#f4f4f8" }}>
                  From{" "}
                  <span style={{ color: GOLD }}>{me.team_name}</span>
                </p>
                {myRoster.length === 0 ? (
                  <p className="text-sm" style={{ color: "#f4f4f8" }}>
                    No active players on your roster.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {myRoster.map((rp) => (
                      <PlayerCheckbox
                        key={rp.id}
                        player={rp}
                        name="proposerPlayer"
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Their side */}
              <div
                className="rounded-xl p-5"
                style={{ background: "#13132b", border: "1px solid #2a2a40" }}
              >
                <h2 className="text-base font-bold mb-1" style={{ color: "#f4f4f8" }}>
                  Step 2b — Players you receive
                </h2>
                <p className="text-xs mb-3" style={{ color: "#f4f4f8" }}>
                  From{" "}
                  <span style={{ color: GOLD }}>{receiverMember.team_name}</span>
                </p>
                {receiverRoster.length === 0 ? (
                  <p className="text-sm" style={{ color: "#f4f4f8" }}>
                    This team has no active players.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {receiverRoster.map((rp) => (
                      <PlayerCheckbox
                        key={rp.id}
                        player={rp}
                        name="receiverPlayer"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Submit */}
            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-lg px-8 py-3 text-sm font-bold transition-opacity hover:opacity-90"
                style={{ background: GOLD, color: "#0d0d1a" }}
              >
                Send Trade Offer →
              </button>
            </div>
          </form>
        ) : (
          members.length > 0 && (
            <p className="text-center text-sm mt-4" style={{ color: "#6b6b8a" }}>
              Select a partner above to build your offer.
            </p>
          )
        )}
      </div>
    </div>
  );
}
