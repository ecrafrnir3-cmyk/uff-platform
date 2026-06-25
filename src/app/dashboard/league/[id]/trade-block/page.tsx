import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const HERO_COLOR    = "#0057FF";
const VILLAIN_COLOR = "#CC0000";
const GOLD          = "#FFD700";

const POS_COLOR: Record<string, string> = {
  QB: HERO_COLOR, RB: "#3DDC84", WR: GOLD,
  TE: "#FF6B35",  K: "#f4f4f8", DEF: VILLAIN_COLOR, DST: VILLAIN_COLOR,
};

function factionColor(faction: string | null) {
  if (faction === "hero") return HERO_COLOR;
  if (faction === "villain") return VILLAIN_COLOR;
  return "#f4f4f8";
}

function PosBadge({ pos }: { pos: string | null }) {
  const p = (pos ?? "?").toUpperCase();
  const color = POS_COLOR[p] ?? "#aaaacc";
  return (
    <span
      className="inline-block w-8 rounded text-center text-xs font-bold leading-5 uppercase"
      style={{ background: color + "22", color }}
    >
      {p}
    </span>
  );
}

interface TradeBlockRow {
  player_id: string;
  on_trade_block: boolean;
  member_id: string;
  players: { full_name: string; position: string | null; team: string | null; status: string | null } | null;
  league_members: { id: string; team_name: string; faction: "hero" | "villain" | null } | null;
}

export default async function TradeBlockPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: leagueId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name")
    .eq("id", leagueId)
    .maybeSingle();
  if (!league) redirect("/dashboard?error=" + encodeURIComponent("League not found."));

  const { data: me } = await supabase
    .from("league_members")
    .select("id")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  // Fetch all players on the trade block in this league
  const { data: blockRows } = await supabase
    .from("uff_roster_players")
    .select("player_id, on_trade_block, member_id, players(full_name, position, team, status), league_members(id, team_name, faction)")
    .eq("league_id", leagueId)
    .eq("on_trade_block", true)
    .is("dropped_at", null)
    .returns<TradeBlockRow[]>();

  const rows = blockRows ?? [];

  // Group by member
  const byMember: Record<string, { teamName: string; faction: string | null; isMe: boolean; players: TradeBlockRow[] }> = {};
  for (const row of rows) {
    const memberId = row.member_id;
    if (!byMember[memberId]) {
      byMember[memberId] = {
        teamName: row.league_members?.team_name ?? "Unknown",
        faction:  row.league_members?.faction ?? null,
        isMe:     memberId === me.id,
        players:  [],
      };
    }
    byMember[memberId].players.push(row);
  }

  // Sort: other teams first (so you see others' offers), own team at bottom
  const groups = Object.entries(byMember).sort(([aId, a], [bId, b]) => {
    if (a.isMe && !b.isMe) return 1;
    if (!a.isMe && b.isMe) return -1;
    return a.teamName.localeCompare(b.teamName);
  });

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link
            href={`/dashboard/league/${leagueId}`}
            className="text-sm underline"
            style={{ color: HERO_COLOR }}
          >
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: GOLD }}>
            Ultimate Fantasy Football
          </p>
          <h1
            className="text-3xl sm:text-4xl"
            style={{ fontFamily: "var(--font-display, sans-serif)", color: GOLD }}
          >
            Trade Block
          </h1>
          <p className="text-sm text-white">
            Players league managers are willing to trade — reach out via the trade page.
          </p>
        </header>

        {/* Manage your own block */}
        <div className="flex items-center gap-3 rounded-lg border px-4 py-3" style={{ borderColor: "#2a2a40" }}>
          <p className="flex-1 text-sm text-white">
            List your own players to signal you&rsquo;re open to offers.
          </p>
          <Link
            href={`/dashboard/league/${leagueId}/roster`}
            className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold"
            style={{ background: "rgba(255,215,0,0.12)", color: GOLD, border: "1px solid rgba(255,215,0,0.3)" }}
          >
            Manage My Block →
          </Link>
        </div>

        {groups.length === 0 ? (
          <div
            className="rounded-lg border p-8 text-center text-sm"
            style={{ borderColor: "#2a2a40", color: "#6b6b8a" }}
          >
            No players on the trade block yet. Be the first to list someone.
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map(([memberId, group]) => (
              <section key={memberId} className="flex flex-col gap-3">
                {/* Team header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: factionColor(group.faction) }}>
                      {group.teamName}
                    </span>
                    {group.isMe && (
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "#2a2a40", color: "#8888aa" }}>
                        you
                      </span>
                    )}
                    <span className="text-xs capitalize" style={{ color: factionColor(group.faction) }}>
                      {group.faction ?? ""}
                    </span>
                  </div>
                  {!group.isMe && (
                    <Link
                      href={`/dashboard/league/${leagueId}/trade`}
                      className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition hover:opacity-80"
                      style={{ background: HERO_COLOR, color: "#f4f4f8" }}
                    >
                      Propose Trade
                    </Link>
                  )}
                </div>

                {/* Player list */}
                <div className="flex flex-col gap-2">
                  {group.players.map((row) => {
                    const p = row.players;
                    const statusBad = p?.status && p.status !== "Active";
                    return (
                      <div
                        key={row.player_id}
                        className="flex items-center gap-3 rounded-lg border px-4 py-3"
                        style={{ borderColor: "rgba(255,215,0,0.2)", background: "rgba(255,215,0,0.02)" }}
                      >
                        <PosBadge pos={p?.position ?? null} />
                        {/* Headshot */}
                        {p?.position !== "DEF" && p?.position !== "DST" && (
                          <img
                            src={`https://sleepercdn.com/content/nfl/players/thumb/${row.player_id}.jpg`}
                            alt=""
                            width={32} height={32}
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                            style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0, width: 32, height: 32, background: "#1c1c2b" }}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{p?.full_name ?? row.player_id}</p>
                          <p className="text-xs" style={{ color: "#8888aa" }}>
                            {p?.team ?? "FA"}
                            {statusBad && (
                              <span className="ml-1 font-semibold" style={{ color: p?.status === "Questionable" ? GOLD : VILLAIN_COLOR }}>
                                · {p?.status}
                              </span>
                            )}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold" style={{ color: GOLD }}>
                          Available
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
