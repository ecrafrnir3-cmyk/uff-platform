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

interface PowerRow {
  id: string;
  round: number;
  draft_powers: { name: string; category: string | null; description: string } | null;
  team_active_powers: { status: string }[] | null;
}

interface DraftPickRow {
  id: string;
  round: number;
  pick_no: number;
  picked_at: string;
  players: { full_name: string; position: string | null; team: string | null } | null;
  league_members: { team_name: string } | null;
}

interface NewsItem {
  title: string;
  link: string;
}

const HERO_COLOR = "#0057FF";
const VILLAIN_COLOR = "#CC0000";

// Standard fantasy lineup ordering for grouping the roster.
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DST"];

const POWER_STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: "#3DDC84", bg: "rgba(61,220,132,0.15)" },
  fizzled: { label: "Fizzled", color: "#8a8a9a", bg: "#1c1c2b" },
  negated: { label: "Negated", color: "#CC0000", bg: "rgba(204,0,0,0.15)" },
  restored: { label: "Restored", color: "#0057FF", bg: "rgba(0,87,255,0.15)" },
  pending: { label: "Pending", color: "#8a8a9a", bg: "#1c1c2b" },
};

function positionRank(position: string | null) {
  if (!position) return POSITION_ORDER.length;
  const idx = POSITION_ORDER.indexOf(position.toUpperCase());
  return idx === -1 ? POSITION_ORDER.length : idx;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Free, no-auth ESPN NFL headlines feed. Revalidated every 30 min. */
async function getNflNews(): Promise<NewsItem[]> {
  try {
    const res = await fetch("https://www.espn.com/espn/rss/nfl/news", {
      next: { revalidate: 1800 },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: NewsItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) && items.length < 5) {
      const block = match[1];
      const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      if (title && link) items.push({ title, link });
    }
    return items;
  } catch {
    return [];
  }
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

function PowerStatusBadge({ status }: { status: string }) {
  const style = POWER_STATUS_STYLES[status] ?? POWER_STATUS_STYLES.pending;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ background: style.bg, color: style.color }}
    >
      {style.label}
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

  const [{ data: roster }, { data: teams }, { data: bonus }, { data: powers }, { data: picks }, news] = await Promise.all([
    supabase
      .from("uff_roster_players")
      .select("id, added_at, player_id, players(id, full_name, position, team, status)")
      .eq("member_id", me.id)
      .is("dropped_at", null)
      .order("added_at", { ascending: true })
      .returns<RosterRow[]>(),
    supabase.from("nfl_teams").select("abbr, faction").returns<TeamFactionRow[]>(),
    supabase.rpc("calculate_faction_roster_bonus", { p_member_id: me.id }),
    supabase
      .from("draft_power_assignments")
      .select("id, round, draft_powers(name, category, description), team_active_powers(status)")
      .eq("member_id", me.id)
      .order("round", { ascending: true })
      .returns<PowerRow[]>(),
    supabase
      .from("uff_draft_picks")
      .select("id, round, pick_no, picked_at, players(full_name, position, team), league_members(team_name)")
      .eq("league_id", leagueId)
      .order("picked_at", { ascending: false })
      .limit(8)
      .returns<DraftPickRow[]>(),
    getNflNews(),
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

  const powerList = powers ?? [];
  const pickList = picks ?? [];

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-6xl flex-col gap-8">
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
          {/* Left column: powers controlled by this manager */}
          <aside className="order-2 flex flex-col gap-3 lg:order-1">
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
              Your Powers
            </h2>
            {powerList.length === 0 ? (
              <p className="rounded-lg border p-4 text-sm text-zinc-400" style={{ borderColor: "#2a2a40" }}>
                Powers are assigned during the draft &mdash; none yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {powerList.map((p) => {
                  const status = p.team_active_powers?.[0]?.status ?? "pending";
                  return (
                    <div key={p.id} className="rounded-lg border p-3" style={{ borderColor: "#2a2a40" }}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Round {p.round}</p>
                        <PowerStatusBadge status={status} />
                      </div>
                      <p className="mt-1 text-sm font-semibold">{p.draft_powers?.name ?? "Unknown power"}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>

          {/* Center column: roster + faction bonus */}
          <div className="order-1 flex flex-col gap-8 lg:order-2">
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
          </div>

          {/* Right column: league activity + NFL news */}
          <aside className="order-3 flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
                League Activity
              </h2>
              {pickList.length === 0 ? (
                <p className="rounded-lg border p-4 text-sm text-zinc-400" style={{ borderColor: "#2a2a40" }}>
                  No draft picks yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {pickList.map((pick) => (
                    <div key={pick.id} className="rounded-lg border p-3" style={{ borderColor: "#2a2a40" }}>
                      <p className="text-sm">
                        <span className="font-semibold">{pick.league_members?.team_name ?? "A manager"}</span>{" "}
                        drafted{" "}
                        <span className="font-semibold">{pick.players?.full_name ?? "a player"}</span>
                        {pick.players?.position ? ` (${pick.players.position}${pick.players.team ? ` · ${pick.players.team}` : ""})` : ""}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Round {pick.round}, Pick {pick.pick_no} &middot; {timeAgo(pick.picked_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
                NFL News
              </h2>
              {news.length === 0 ? (
                <p className="rounded-lg border p-4 text-sm text-zinc-400" style={{ borderColor: "#2a2a40" }}>
                  Headlines unavailable right now &mdash; check back later.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {news.map((item) => (
                    <a
                      key={item.link}
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border p-3 text-sm underline-offset-2 hover:underline"
                      style={{ borderColor: "#2a2a40" }}
                    >
                      {item.title}
                    </a>
                  ))}
                  <p className="text-xs text-zinc-500">Source: ESPN NFL headlines</p>
                </div>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
