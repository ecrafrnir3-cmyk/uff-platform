import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { randomizeFactions, setMyFaction, startDraft } from "./actions";

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
    <span className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500"
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
    .order("created_at", { ascending: true })
    .returns<MemberRow[]>();

  const memberList = members ?? [];

  const { data: me } = await supabase
    .from("league_members")
    .select("id, faction")
    .eq("league_id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

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
          <p className="text-sm text-zinc-400">
            Season {league.season} &middot; {memberList.length} / {league.max_teams} teams &middot; 16-round snake draft &middot; Draft: {league.draft_status.replaceAll("_", " ")}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Link
              href={`/dashboard/league/${league.id}/roster`}
              className="inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold"
              style={{ background: "#0057FF", color: "#f4f4f8" }}
            >
              My Team
            </Link>
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

        {!draftLocked && (
          <section className="flex flex-col gap-4 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
            <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>Pick Your Faction</h2>
            <p className="text-sm text-zinc-400">
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
                <p className="mt-1 text-xs text-zinc-500">
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
                    {m.user_id === user.id && <span className="ml-1 text-xs text-zinc-500">(you)</span>}
                  </p>
                  <p className="text-sm text-zinc-400">{m.profiles?.display_name ?? m.profiles?.username}</p>
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
                <p className="text-sm text-zinc-400">All {memberList.length} managers have factions. Ready to start.</p>
                <form action={startDraft}>
                  <input type="hidden" name="leagueId" value={leagueId} />
                  <button type="submit" className="rounded-md px-4 py-2 text-sm font-semibold"
                    style={{ background: "#FFD700", color: "#0d0d1a" }}>
                    Start Draft
                  </button>
                </form>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">
                {unassignedCount} manager{unassignedCount !== 1 ? "s" : ""} still need a faction before the draft can start.
              </p>
            )
          )}

          {league.draft_status === "not_started" && !isCommissioner && (
            <p className="text-sm text-zinc-400">Waiting for the commissioner to start the draft.</p>
          )}

          {league.draft_status === "in_progress" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-zinc-400">The draft is in progress.</p>
              <Link href={`/dashboard/league/${leagueId}/draft`}
                className="inline-flex w-fit items-center rounded-md px-4 py-2 text-sm font-semibold"
                style={{ background: "#FFD700", color: "#0d0d1a" }}>
                Go to Draft Room
              </Link>
            </div>
          )}

          {league.draft_status === "completed" && (
            <p className="text-sm text-zinc-400">The draft is complete. Good luck this season!</p>
          )}
        </section>
      </main>
    </div>
  );
}