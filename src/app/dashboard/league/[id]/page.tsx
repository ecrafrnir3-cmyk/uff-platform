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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, season, join_code, status, max_teams, draft_status, draft_rounds, commissioner_id")
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
  const me = memberList.find((m) => m.user_id === user.id);

  if (!me) redirect("/dashboard?error=" + encodeURIComponent("You're not a member of that league."));

  const isCommissioner = league.commissioner_id === user.id;
  const capacity = league.max_teams / 2;
  const heroCount = memberList.filter((m) => m.faction === "hero").length;
  const villainCount = memberList.filter((m) => m.faction === "villain").length;
  const unassignedCount = memberList.length - heroCount - villainCount;
  const draftLocked = league.draft_status !== "not_started";

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link href="/dashboard" className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to dashboard
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
            <Link
              href={`/dashboard/league/${league.id}/matchups`}
              className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-semibold"
              style={{ borderColor: "#2a2a40", color: "#f4f4f8" }}
            >
              Matchups
            </Link>
            {isCommissioner && (
              <Link
                href={`/dashboard/league/${league.id}/settings`}
                className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-semibold"
                style={{ borderColor: "#2a2a40", color: "#FFD700" }}
              >
                ⚙ Settings
              </Link>
            )}
          </div>
        </header>

        {error && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}>
            {decodeURIComponent(error)}
          </p>
        )}

        {isCommissioner && (
          <section className="rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Join code (share with your league)</p>
            <p className="mt-1 font-mono text-2xl" style={{ color: "#FFD700" }}>
              {league.join_code}
            </p>
          </section>
        )}

        <section className="flex flex-col gap-4 rounded-lg border p-5" style={{ borderColor: "#2a2a40" }}>
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
            Faction balance
          </h2>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: HERO_COLOR }}>Hero</span>
              <span className="text-zinc-400">
                {heroCount} / {capacity}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "#1c1c2b" }}>
              <div
                className="h-full"
                style={{ width: `${capacity ? Math.min(100, (heroCount / capacity) * 100) : 0}%`, background: HERO_COLOR }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-sm">
              <span style={{ color: VILLAIN_COLOR }}>Villain</span>
              <span className="text-zinc-400">
                {villainCount} / {capacity}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "#1c1c2b" }}>
              <div
                className="h-full"
                style={{ width: `${capacity ? Math.min(100, (villainCount / capacity) * 100) : 0}%`, background: VILLAIN_COLOR }}
              />
            </div>

            {unassignedCount > 0 && (
              <p className="mt-2 text-sm text-zinc-400">{unassignedCount} manager(s) haven&rsquo;t picked a side yet.</p>
            )}
          </div>

          {!draftLocked && (
            <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: "#2a2a40" }}>
              <p className="text-sm font-semibold">Your team: {me.team_name}</p>
              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-400">Your faction:</span>
                <FactionBadge faction={me.faction} />
              </div>
              <div className="flex flex-wrap gap-2">
                <form action={setMyFaction}>
                  <input type="hidden" name="leagueId" value={league.id} />
                  <input type="hidden" name="faction" value="hero" />
                  <button
                    type="submit"
                    disabled={me.faction === "hero"}
                    className="rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-40"
                    style={{ background: HERO_COLOR, color: "#f4f4f8" }}
                  >
                    I&rsquo;m Hero (AFC)
                  </button>
                </form>
                <form action={setMyFaction}>
                  <input type="hidden" name="leagueId" value={league.id} />
                  <input type="hidden" name="faction" value="villain" />
                  <button
                    type="submit"
                    disabled={me.faction === "villain"}
                    className="rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-40"
                    style={{ background: VILLAIN_COLOR, color: "#f4f4f8" }}
                  >
                    I&rsquo;m Villain (NFC)
                  </button>
                </form>
                {me.faction && (
                  <form action={setMyFaction}>
                    <input type="hidden" name="leagueId" value={league.id} />
                    <input type="hidden" name="faction" value="" />
                    <button
                      type="submit"
                      className="rounded-md border px-4 py-2 text-sm font-semibold"
                      style={{ borderColor: "#2a2a40", color: "#f4f4f8" }}
                    >
                      Clear pick
                    </button>
                  </form>
                )}
              </div>

              {isCommissioner && (
                <form action={randomizeFactions} className="mt-2">
                  <input type="hidden" name="leagueId" value={league.id} />
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
            </div>
          )}

          {draftLocked && <p className="text-sm text-zinc-400">Factions are locked &mdash; the draft has started.</p>}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
            Managers
          </h2>
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
           