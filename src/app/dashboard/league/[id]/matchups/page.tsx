import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MatchupView from "./MatchupView";
import { finalizeWeek } from "./actions";

interface MatchupRow {
  id: string;
  matchup_id: number;
  week: number;
  member_id: string;
  points: number;
  projected: number | null;
  is_complete: boolean;
  league_members: { team_name: string; faction: "hero" | "villain" | null } | null;
}

// Best-guess for current NFL week (week 1 = Sept 7, 2026)
function getCurrentNFLWeek(): number {
  const season_start = new Date("2026-09-03");
  const now = new Date();
  const diff = Math.floor((now.getTime() - season_start.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return Math.min(Math.max(diff + 1, 1), 18);
}

export default async function MatchupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string; error?: string; saved?: string }>;
}) {
  const { id: leagueId } = await params;
  const { week: weekParam, error: pageError, saved: pageSaved } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("uff_leagues")
    .select("id, name, season, commissioner_id")
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

  // Determine week to view
  const currentWeek = getCurrentNFLWeek();
  const viewWeek = weekParam ? parseInt(weekParam) : currentWeek;

  const { data: matchupRows } = await supabase
    .from("uff_matchups")
    .select("id, matchup_id, week, member_id, points, projected, is_complete, league_members(team_name, faction)")
    .eq("league_id", leagueId)
    .eq("week", viewWeek)
    .order("matchup_id")
    .returns<MatchupRow[]>();

  // Group into pairs by matchup_id
  const pairMap = new Map<number, MatchupRow[]>();
  for (const m of (matchupRows ?? [])) {
    if (!pairMap.has(m.matchup_id)) pairMap.set(m.matchup_id, []);
    pairMap.get(m.matchup_id)!.push(m);
  }
  const matchupPairs = [...pairMap.values()];

  // Available weeks (derived from existing matchup data)
  const { data: weekRows } = await supabase
    .from("uff_matchups")
    .select("week")
    .eq("league_id", leagueId)
    .order("week");
  const availableWeeks = [...new Set((weekRows ?? []).map((r) => r.week))];

  const hasSchedule = availableWeeks.length > 0;
  const isCommissioner = league.commissioner_id === user.id;
  // Check if current week is already finalized (all matchup rows is_complete)
  const weekIsFinalized =
    matchupPairs.length > 0 &&
    matchupPairs.every((pair) => pair.every((row) => row.is_complete));

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            Ultimate Fantasy Football
          </p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            Matchups
          </h1>
        </header>

        {pageError && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#CC0000", color: "#ff8a8a", background: "#1a0e16" }}>
            {decodeURIComponent(pageError)}
          </p>
        )}
        {pageSaved && (
          <p className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#3DDC84", color: "#3DDC84", background: "#0e1a12" }}>
            Week {viewWeek} finalized — winners locked in.
          </p>
        )}

        {!hasSchedule && (
          <div className="rounded-lg border p-5 text-sm text-zinc-400" style={{ borderColor: "#2a2a40" }}>
            No schedule yet.{" "}
            {league.commissioner_id === user.id ? (
              <Link href={`/dashboard/league/${leagueId}/settings`} className="underline" style={{ color: "#0057FF" }}>
                Generate the schedule in League Settings.
              </Link>
            ) : (
              "The commissioner needs to generate the schedule."
            )}
          </div>
        )}
        {hasSchedule && (
          <>
            {/* Week selector */}
            <div className="flex flex-wrap gap-2">
              {availableWeeks.map((w) => (
                <Link
                  key={w}
                  href={`/dashboard/league/${leagueId}/matchups?week=${w}`}
                  className="rounded px-3 py-1.5 text-xs font-semibold"
                  style={{
                    background: w === viewWeek ? "#0057FF" : "#1c1c2b",
                    color: w === viewWeek ? "#f4f4f8" : "#8a8a9a",
                  }}
                >
                  Week {w}
                </Link>
              ))}
            </div>

            <MatchupView
              leagueId={leagueId}
              week={viewWeek}
              matchupPairs={matchupPairs}
              myMemberId={me.id}
            />

            {isCommissioner && !weekIsFinalized && (
              <form action={finalizeWeek}>
                <input type="hidden" name="leagueId" value={leagueId} />
                <input type="hidden" name="week" value={viewWeek} />
                <button
                  type="submit"
                  className="rounded-md px-4 py-2 text-sm font-semibold"
                  style={{ background: "#1c1c2b", color: "#8a8a9a", border: "1px solid #2a2a40" }}
                >
                  Finalize Week {viewWeek}
                </button>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
