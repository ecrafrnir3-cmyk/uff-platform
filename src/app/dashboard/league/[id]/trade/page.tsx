import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { proposeTrade } from "../trade-actions";

const POS_COLOR: Record<string, string> = {
  QB: "#0057FF", RB: "#3DDC84", WR: "#FFD700",
  TE: "#FF6B35", K: "#8a8a9a", DEF: "#CC0000", DST: "#CC0000",
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
  const color = POS_COLOR[pos] ?? "#8a8a9a";
  return (
    <span
      className="inline-block w-8 rounded text-center text-xs font-bold leading-5 uppercase"
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
        <p className="text-xs" style={{ color: "#8a8a9a" }}>
          {p.team ?? "\u2014"}
        </p>
      </div>
      <span className="text-xs capitalize" style={{ color: "#8a8a9a" }}>
        {player.slot === "ir" ? "IR" : player.slot}
      </span>
    </label>
  );
}

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify membership
  const { data: me } = await supabase
    .from("league_members")
    .select("id, team_name, faction")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me)
    redirect(
      "/dashboard?error=" + encodeURIComponent("You\'re not a member of that league.")
    );

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
  let receiverMember: { id: string; team_name: string; faction: string } | null =
    null;

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

  const GOLD = "#FFD700";

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
            style={{ color: "#8a8a9a", border: "1px solid #2a2a40" }}
          >
            ← Roster
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: GOLD }}>
            Propose a Trade
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

        {/* Step 1: Pick a team */}
        <div
          className="rounded-xl p-5 mb-6"
          style={{ background: "#13132b", border: "1px solid #2a2a40" }}
        >
          <h2 className="text-base font-bold mb-3" style={{ color: "#f4f4f8" }}>
            Step 1 — Pick a trade partner
          </h2>
          {members.length === 0 ? (
            <p className="text-sm" style={{ color: "#8a8a9a" }}>
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
                <p className="text-xs mb-3" style={{ color: "#8a8a9a" }}>
                  From{" "}
                  <span style={{ color: GOLD }}>{me.team_name}</span>
                </p>
                {myRoster.length === 0 ? (
                  <p className="text-sm" style={{ color: "#8a8a9a" }}>
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
                <p className="text-xs mb-3" style={{ color: "#8a8a9a" }}>
                  From{" "}
                  <span style={{ color: GOLD }}>{receiverMember.team_name}</span>
                </p>
                {receiverRoster.length === 0 ? (
                  <p className="text-sm" style={{ color: "#8a8a9a" }}>
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
                className="rounded-lg px-8 py-2.5 text-sm font-bold transition-opacity hover:opacity-90"
                style={{ background: GOLD, color: "#0d0d1a" }}
              >
                Send Trade Offer →
              </button>
            </div>
          </form>
        ) : (
          <div
            className="rounded-xl p-8 text-center"
            style={{ background: "#13132b", border: "1px solid #2a2a40" }}
          >
            <p className="text-sm" style={{ color: "#8a8a9a" }}>
              Select a team above to see their roster and build your offer.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
