import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { randomizeFactions, setMyFaction, startDraft } from "./actions";
import RenameTeam from "./RenameTeam";
import NewsletterCard from "./NewsletterCard";

interface MemberRow {
  id: string;
  team_name: string;
  is_commissioner: boolean;
  faction: "hero" | "villain" | null;
  user_id: string;
  profiles: { display_name: string | null; username: string } | null;
}

const HERO_COLOR = "#0057FF";
const VILLAIN_COLOR = "#CC0000";

function FactionBadge({ faction }: { faction: "hero" | "villain" | null }) {
  if (faction === "hero") {
    return (
      <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
        style={{ background: "rgba(0,87,255,0.15)", color: HERO_COLOR }}>
        Hero
      </span>
    );
  }
  if (faction === "villain") {
    return (
      <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
        style={{ background: "rgba(204,0,0,0.15)", color: VILLAIN_COLOR }}>
        Villain
      </span>
    );
  }
  return (
    <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white"
      style={{ background: "#1c1c2b" }}>
      Unassigned
    </span>
  );
}

export default async function LeagueDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id: leagueId } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, season, max_teams, commissioner_id, draft_status, draft_rounds, draft_order")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) redirect("/dashboard?error=" + encodeURIComponent("League not found."));

  const { data: members } = await supabase
    .from("league_members")
    .select("id, team_name, is_commissioner, faction, user_id, profiles(display_name, username)")
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true })
    .returns<MemberRow[]>();

  const memberList = members ?? [];

  const { data: me } = await supabase
    .from("league_members")
    .select("id, faction, is_commissioner, team_name")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  // Fetch recent announcements (pinned first, then latest 3)
  const { data: announcementsRaw } = await supabase
    .from("uff_announcements")
    .select("id, title, body, pinned, created_at")
    .eq("league_id", leagueId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(3);
  const announcements = (announcementsRaw ?? []) as { id: string; title: string; body: string; pinned: boolean; created_at: string }[];

  // Fetch the most recent newsletter for this league (if any)
  const { data: newsletter } = league.draft_status === "completed"
    ? await supabase
        .from("league_newsletters")
        .select("week, content, generated_at")
        .eq("league_id", leagueId)
        .order("week", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  // ── Recent activity feed (last 8 events for hub widget) ────────────────────
  interface RecentRosterRow {
    id: string; member_id: string; player_id: string;
    added_at: string; dropped_at: string | null;
    players: { full_name: string } | null;
    league_members: { team_name: string } | null;
  }
  interface RecentTradeRow {
    id: string; updated_at: string;
    proposer_player_ids: string[];
    receiver_player_ids: string[];
    proposer: { team_name: string } | null;
    receiver: { team_name: string } | null;
  }

  const [recentRosterRes, recentTradeRes] = league.draft_status === "completed"
    ? await Promise.all([
        supabase
          .from("uff_roster_players")
          .select("id, member_id, player_id, added_at, dropped_at, players(full_name), league_members(team_name)")
          .eq("league_id", leagueId)
          .order("added_at", { ascending: false })
          .limit(10)
          .returns<RecentRosterRow[]>(),
        supabase
          .from("uff_trades")
          .select("id, updated_at, proposer_player_ids, receiver_player_ids, proposer:league_members!proposer_id(team_name), receiver:league_members!receiver_id(team_name)")
          .eq("league_id", leagueId)
          .eq("status", "accepted")
          .order("updated_at", { ascending: false })
          .limit(5)
          .returns<RecentTradeRow[]>(),
      ])
    : [{ data: null }, { data: null }];

  type ActivityItem =
    | { kind: "add"; ts: Date; team: string; player: string }
    | { kind: "drop"; ts: Date; team: string; player: string }
    | { kind: "trade"; ts: Date; from: string; to: string };

  const activityItems: ActivityItem[] = [];

  for (const r of recentRosterRes.data ?? []) {
    activityItems.push({ kind: "add", ts: new Date(r.added_at), team: r.league_members?.team_name ?? "?", player: r.players?.full_name ?? "?" });
    if (r.dropped_at) {
      activityItems.push({ kind: "drop", ts: new Date(r.dropped_at), team: r.league_members?.team_name ?? "?", player: r.players?.full_name ?? "?" });
    }
  }
  for (const t of recentTradeRes.data ?? []) {
    activityItems.push({ kind: "trade", ts: new Date(t.updated_at), from: t.proposer?.team_name ?? "?", to: t.receiver?.team_name ?? "?" });
  }
  activityItems.sort((a, b) => b.ts.getTime() - a.ts.getTime());
  const recentActivity = activityItems.slice(0, 6);

  const isCommissioner = league.commissioner_id === user.id;
  const myFaction = me.faction;
  const allFactionsAssigned = memberList.every((m) => m.faction !== null);
  const unassignedCount = memberList.filter((m) => m.faction === null).length;
  const draftLocked = league.draft_status !== "not_started";

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link href="/dashboard" className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; All Leagues
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            Ultimate Fantasy Football
          </p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            {league.name}
          </h1>
          <p className="text-sm text-white">
            Season {league.season} &middot; {memberList.length} / {league.max_teams} teams &middot; {league.draft_rounds}-round snake draft &middot; Draft: {league.draft_status.replaceAll("_", " ")}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Link
              href={`/dashboard/league/${league.id}/roster`}
              className="inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold"
              style={{ background: "#0057FF", color: "#f4f4f8" }}
            >
              My Team
            </Link>
            {league.draft_status === "completed" && (
              <>
                <Link
                  href={`/dashboard/league/${league.id}/matchups`}
                  className="inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold"
                  style={{ background: "#FFD700", color: "#0d0d1a" }}
                >
                  Matchups
                </Link>
                <Link
                  href={`/dashboard/league/${league.id}/standings`}
                  className="inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold"
                  style={{ background: "#1c1c2b", color: "#f4f4f8", border: "1px solid #2a2a40" }}
                >
                  Standings
                </Link>
                <Link
                  href={`/dashboard/league/${league.id}/playoffs`}
                  className="inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold"
                  style={{ background: "#1c1c2b", color: "#FFD700", border: "1px solid #2a2a4088" }}
                >
                  Playoffs
                </Link>
              </>
            )}
            {league.draft_status !== "completed" && (
              <Link
                href={`/dashboard/league/${league.id}/draft`}
                className="inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: "#FFD700", color: "#0d0d1a" }}
              >
                Draft Room
              </Link>
            )}
          </div>
        </header>

        {error && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}>
            {decodeURIComponent(error)}
          </p>
        )}

        <section className="rounded-lg border p-4" style={{ borderColor: "#2a2a40" }}>
          <RenameTeam leagueId={leagueId} currentName={me.team_name} />
        </section>

        {!draftLocked && (
          <section className="flex flex-col gap-4 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Pick Your Faction</h2>
            <p className="text-sm text-white">
              AFC teams are <span style={{ color: HERO_COLOR }}>Heroes</span>. NFC teams are{" "}
              <span style={{ color: VILLAIN_COLOR }}>Villains</span>. Your faction determines which NFL
              players give you bonus points each week.
            </p>

            {myFaction && (
              <p className="text-sm font-semibold">
                You are:{" "}
                <span style={{ color: myFaction === "hero" ? HERO_COLOR : VILLAIN_COLOR }}>
                  {myFaction === "hero" ? "Hero" : "Villain"}
                </span>
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <form action={setMyFaction}>
                <input type="hidden" name="leagueId" value={leagueId} />
                <input type="hidden" name="faction" value="hero" />
                <button
                  type="submit"
                  className="rounded-md px-4 py-2 text-sm font-semibold"
                  style={{
                    background: myFaction === "hero" ? HERO_COLOR : "rgba(0,87,255,0.1)",
                    color: myFaction === "hero" ? "#f4f4f8" : HERO_COLOR,
                    border: "1px solid " + HERO_COLOR,
                  }}
                >
                  Hero (AFC)
                </button>
              </form>
              <form action={setMyFaction}>
                <input type="hidden" name="leagueId" value={leagueId} />
                <input type="hidden" name="faction" value="villain" />
                <button
                  type="submit"
                  className="rounded-md px-4 py-2 text-sm font-semibold"
                  style={{
                    background: myFaction === "villain" ? VILLAIN_COLOR : "rgba(204,0,0,0.1)",
                    color: myFaction === "villain" ? "#f4f4f8" : VILLAIN_COLOR,
                    border: "1px solid " + VILLAIN_COLOR,
                  }}
                >
                  Villain (NFC)
                </button>
              </form>
            </div>

            {isCommissioner && unassignedCount > 0 && (
              <form action={randomizeFactions}>
                <input type="hidden" name="leagueId" value={leagueId} />
                <button
                  type="submit"
                  className="rounded-md px-4 py-2 text-sm font-semibold"
                  style={{ background: "#FFD700", color: "#0d0d1a" }}
                >
                  Randomize remaining factions
                </button>
                <p className="mt-1 text-xs text-white">
                  Auto-balances any managers who haven&rsquo;t picked a side yet.
                </p>
              </form>
            )}
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Managers</h2>
          <div className="flex flex-col gap-2">
            {memberList.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg border px-4 py-3"
                style={{ borderColor: "#2a2a40" }}
              >
                <div>
                  <p className="font-semibold">
                    {m.team_name}{" "}
                    {m.is_commissioner && (
                      <span className="ml-1 text-xs uppercase tracking-wide" style={{ color: "#FFD700" }}>
                        Commissioner
                      </span>
                    )}
                    {m.user_id === user.id && <span className="ml-1 text-xs text-white">(you)</span>}
                  </p>
                  <p className="text-sm text-white">{m.profiles?.display_name ?? m.profiles?.username}</p>
                </div>
                <FactionBadge faction={m.faction} />
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Draft</h2>

          {league.draft_status === "not_started" && isCommissioner && (
            allFactionsAssigned ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-white">All {memberList.length} managers have factions. Ready to start.</p>
                <form action={startDraft}>
                  <input type="hidden" name="leagueId" value={leagueId} />
                  <button type="submit" className="rounded-md px-4 py-2 text-sm font-semibold"
                    style={{ background: "#FFD700", color: "#0d0d1a" }}>
                    Start Draft
                  </button>
                </form>
              </div>
            ) : (
              <p className="text-sm text-white">
                {unassignedCount} manager{unassignedCount !== 1 ? "s" : ""} still need a faction before the draft can start.
              </p>
            )
          )}

          {league.draft_status === "not_started" && !isCommissioner && (
            <p className="text-sm text-white">Waiting for the commissioner to start the draft.</p>
          )}

          {league.draft_status === "in_progress" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-white">The draft is in progress.</p>
              <Link href={`/dashboard/league/${leagueId}/draft`}
                className="inline-flex w-fit items-center rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: "#FFD700", color: "#0d0d1a" }}>
                Go to Draft Room
              </Link>
            </div>
          )}

          {league.draft_status === "completed" && (
            <p className="text-sm text-white">The draft is complete. Good luck this season!</p>
          )}
        </section>

        {league.draft_status === "completed" && newsletter && (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Oracle Dispatch</h2>
            <NewsletterCard
              week={newsletter.week}
              content={newsletter.content}
              generatedAt={newsletter.generated_at}
            />
          </section>
        )}

        {/* Bulletin Board — shows if any announcements exist */}
        {announcements.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>📌 Bulletin Board</h2>
              <Link href={`/dashboard/league/${leagueId}/announcements`} className="text-xs underline" style={{ color: "#0057FF" }}>
                View all
              </Link>
            </div>
            <div className="flex flex-col gap-2">
              {announcements.map((a) => (
                <div key={a.id} className="rounded-lg border px-4 py-3 flex flex-col gap-1"
                  style={{ borderColor: a.pinned ? "rgba(255,215,0,0.35)" : "#2a2a40", background: a.pinned ? "rgba(255,215,0,0.03)" : "#0d0d1a" }}>
                  <p className="font-semibold text-sm" style={{ color: a.pinned ? "#FFD700" : "#f4f4f8" }}>
                    {a.pinned && "📌 "}{a.title}
                  </p>
                  <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "#d4d4e8" }}>{a.body}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Commissioner shortcut to post when no announcements */}
        {announcements.length === 0 && me.is_commissioner && (
          <section>
            <Link href={`/dashboard/league/${leagueId}/announcements`}
              className="block rounded-lg border px-4 py-3 text-sm text-center transition hover:border-yellow-500"
              style={{ borderColor: "#2a2a40", color: "#8888aa", borderStyle: "dashed" }}>
              📌 Post a bulletin board announcement
            </Link>
          </section>
        )}

        {league.draft_status === "completed" && recentActivity.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Recent Activity</h2>
              <Link
                href={`/dashboard/league/${leagueId}/transactions`}
                className="text-xs underline"
                style={{ color: "#0057FF" }}
              >
                View all
              </Link>
            </div>
            <div className="flex flex-col divide-y" style={{ borderColor: "#2a2a40", border: "1px solid #2a2a40", borderRadius: 8 }}>
              {recentActivity.map((item, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  {item.kind === "add" && (
                    <>
                      <span className="text-base">✅</span>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold truncate" style={{ color: "#f4f4f8" }}>{item.team}</span>
                        <span className="text-xs truncate" style={{ color: "#3DDC84" }}>Added {item.player}</span>
                      </div>
                      <span className="ml-auto text-xs shrink-0" style={{ color: "#6b6b8d" }}>
                        {item.ts.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </>
                  )}
                  {item.kind === "drop" && (
                    <>
                      <span className="text-base">❌</span>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold truncate" style={{ color: "#f4f4f8" }}>{item.team}</span>
                        <span className="text-xs truncate" style={{ color: "#CC0000" }}>Dropped {item.player}</span>
                      </div>
                      <span className="ml-auto text-xs shrink-0" style={{ color: "#6b6b8d" }}>
                        {item.ts.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </>
                  )}
                  {item.kind === "trade" && (
                    <>
                      <span className="text-base">🔄</span>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm truncate" style={{ color: "#f4f4f8" }}>
                          <span className="font-semibold">{item.from}</span>
                          <span style={{ color: "#6b6b8d" }}> × </span>
                          <span className="font-semibold">{item.to}</span>
                        </span>
                        <span className="text-xs" style={{ color: "#FFD700" }}>Trade completed</span>
                      </div>
                      <span className="ml-auto text-xs shrink-0" style={{ color: "#6b6b8d" }}>
                        {item.ts.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {league.draft_status === "completed" && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Season</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: "My Team",    href: `/dashboard/league/${leagueId}/roster`,      emoji: "🏟️" },
                { label: "Matchups",   href: `/dashboard/league/${leagueId}/matchups`,     emoji: "⚔️" },
                { label: "Standings",  href: `/dashboard/league/${leagueId}/standings`,    emoji: "📊" },
                { label: "Playoffs",   href: `/dashboard/league/${leagueId}/playoffs`,     emoji: "🏆" },
                { label: "Free Agents",href: `/dashboard/league/${leagueId}/free-agents`,   emoji: "🔍" },
                { label: "Trade",      href: `/dashboard/league/${leagueId}/trade`,          emoji: "🔄" },
                { label: "Schedule",   href: `/dashboard/league/${leagueId}/schedule`,       emoji: "📅" },
                { label: "Settings",   href: `/dashboard/league/${leagueId}/settings`,       emoji: "⚙️" },
              ].map(({ label, href, emoji }) => (
                <Link
                  key={label}
                  href={href}
                  className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold transition-colors hover:border-blue-500"
                  style={{ borderColor: "#2a2a40", color: "#f4f4f8" }}
                >
                  <span>{emoji}</span>
                  {label}
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}