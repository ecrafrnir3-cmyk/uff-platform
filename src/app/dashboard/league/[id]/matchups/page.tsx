import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MatchupView from "./MatchupView";

interface MatchupRow {
  id: string;
  matchup_id: number;
  week: number;
  member_id: string;
  points: number;
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
  searchParams: Promise<{ week?: string }>;
}) {
  const { id: leagueId } = await params;
  const { week: weekParam } = await searchParams;
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
    .select("id, matchup_id, week, member_id, points, is_complete, league_members(team_name, faction)")
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
            {/* Week nav */}
            <div className="flex flex-wrap gap-1">
              {availableWeeks.map((w) => (
                <Link
                  key={w}
                  href={`?week=${w}`}
                  className="rounded px-3 py-1.5 text-xs font-semibold"
                  style={{
                    background: w === viewWeek ? "#0057FF" : "#1c1c2b",
                    color: w === viewWeek ? "#f4f4f8" : "#8a8a9a",
                  }}
                >
                  Wk {w}
                </Link>
              ))}
            </div>

            <MatchupView
              leagueId={leagueId}
              week={viewWeek}
              matchupPairs={matchupPairs}
              myMemberId={me.id}
            />
          </>
        )}
      </main>
    </div>
  );
}
