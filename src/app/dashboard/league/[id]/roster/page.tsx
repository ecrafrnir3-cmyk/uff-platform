import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface RosterRow {
  id: string;
  added_at: string;
  player_id: string;
  players: {
    id: string;
    full_name: string;
    position: string | null;
    team: string | null;
    status: string | null;
  } | null;
}

interface TeamFactionRow {
  abbr: string;
  faction: "hero" | "villain";
}

const HERO_COLOR = "#0057FF";
const VILLAIN_COLOR = "#CC0000";

// Standard fantasy lineup ordering for grouping the roster.
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DST"];

function positionRank(position: string | null) {
  if (!position) return POSITION_ORDER.length;
  const idx = POSITION_ORDER.indexOf(position.toUpperCase());
  return idx === -1 ? POSITION_ORDER.length : idx;
}

function FactionBadge({ faction }: { faction: "hero" | "villain" | null }) {
  if (faction === "hero") {
    return (
      <span
        className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
        style={{ background: "rgba(0,87,255,0.15)", color: HERO_COLOR }}
      >
        Hero
      </span>
    );
  }
  if (faction === "villain") {
    return (
      <span
        className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
        style={{ background: "rgba(204,0,0,0.15)", color: VILLAIN_COLOR }}
      >
        Villain
      </span>
    );
  }
  return (
    <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500" style={{ background: "#1c1c2b" }}>
      &mdash;
    </span>
  );
}

export default async function RosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: leagueId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, season")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) redirect("/dashboard?error=" + encodeURIComponent("League not found."));

  const { data: me } = await supabase
    .from("league_members")
    .select("id, team_name, faction")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  const [{ data: roster }, { data: teams }, { data: bonus }] = await Promise.all([
    supabase
      .from("uff_roster_players")
      .select("id, added_at, player_id, players(id, full_name, position, team, status)")
      .eq("member_id", me.id)
      .is("dropped_at", null)
      .order("added_at", { ascending: true })
      .returns<RosterRow[]>(),
    supabase.from("nfl_teams").select("abbr, faction").returns<TeamFactionRow[]>(),
    supabase.rpc("calculate_faction_roster_bonus", { p_member_id: me.id }),
  ]);

  const teamFaction = new Map((teams ?? []).map((t) => [t.abbr, t.faction]));
  const rosterList = (roster ?? []).slice().sort((a, b) => {
    const pa = positionRank(a.players?.position ?? null);
    const pb = positionRank(b.players?.position ?? null);
    if (pa !== pb) return pa - pb;
    return (a.players?.full_name ?? "").localeCompare(b.players?.full_name ?? "");
  });

  const bonusPoints = typeof bonus === "number" ? bonus : Number(bonus ?? 0);
  const matchingCount = rosterList.filter((r) => {
    const f = r.players?.team ? teamFaction.get(r.players.team) : null;
    return me.faction && f === me.faction;
  }).length;

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${league.id}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            My Team
          </p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            {me.team_name}
          </h1>
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span>Season {league.season}</span>
            <span>&middot;</span>
            <span>Faction:</span>
            <FactionBadge faction={me.faction} />
          </div>
        </header>

        <section className="flex flex-col gap-2 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
            Faction Roster Bonus
          </h2>
          {me.faction ? (
            <>
              <p className="text-sm text-zinc-400">
                +0.5 pts per rostered player on a {me.faction === "hero" ? "Hero (AFC)" : "Villain (NFC)"} team.
              </p>
              <p className="text-2xl font-semibold" style={{ color: me.faction === "hero" ? HERO_COLOR : VILLAIN_COLOR }}>
                +{bonusPoints.toFixed(1)} pts/week
              </p>
              <p className="text-sm text-zinc-500">
                {matchingCount} of {rosterList.length} rostered player{rosterList.length === 1 ? "" : "s"} match your faction.
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-400">
              Pick a faction on the{" "}
              <Link href={`/dashboard/league/${league.id}`} className="underline" style={{ color: "#0057FF" }}>
                league page
              </Link>{" "}
              to start earning the Faction Roster Bonus.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
            Roster ({rosterList.length})
          </h2>

          {rosterList.length === 0 && (
            <p className="rounded-lg border p-5 text-sm text-zinc-400" style={{ borderColor: "#2a2a40" }}>
              No players on your roster yet &mdash; the draft tool is coming up next.
            </p>
          )}

          <div className="flex flex-col gap-2">
            {rosterList.map((r) => {
              const player = r.players;
              const pFaction = player?.team ? teamFaction.get(player.team) ?? null : null;
              const matches = me.faction !== null && pFaction === me.faction;
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                  style={{ borderColor: matches ? (me.faction === "hero" ? HERO_COLOR : VILLAIN_COLOR) : "#2a2a40" }}
                >
                  <div>
                    <p className="font-semibold">{player?.full_name ?? r.player_id}</p>
                    <p className="text-sm text-zinc-400">
                      {player?.position ?? "?"} &middot; {player?.team ?? "FA"}
                      {player?.status && player.status !== "Active" ? ` · ${player.status}` : ""}
                    </p>
                  </div>
                  <FactionBadge faction={pFaction} />
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
