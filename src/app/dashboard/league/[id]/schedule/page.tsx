import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

interface MatchupRow {
  matchup_id: number;
  member_id: string;
  week: number;
  points: number;
  is_complete: boolean;
  median_win: boolean | null;
}

interface MemberRow {
  id: string;
  team_name: string;
  faction: "hero" | "villain" | null;
  profiles: { display_name: string | null; username: string } | null;
}

function teamLabel(member: MemberRow | undefined) {
  if (!member) return "Unknown";
  return member.team_name;
}

export default async function SchedulePage({
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
    .select("id, name, season, season_weeks, median_scoring")
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

  const [{ data: matchupRows }, { data: memberRows }] = await Promise.all([
    supabase
      .from("uff_matchups")
      .select("matchup_id, member_id, week, points, is_complete, median_win")
      .eq("league_id", leagueId)
      .eq("season", league.season)
      .order("week", { ascending: true })
      .order("matchup_id", { ascending: true })
      .returns<MatchupRow[]>(),
    supabase
      .from("league_members")
      .select("id, team_name, faction, profiles(display_name, username)")
      .eq("league_id", leagueId)
      .returns<MemberRow[]>(),
  ]);

  const memberMap: Record<string, MemberRow> = {};
  for (const m of memberRows ?? []) memberMap[m.id] = m;

  // Group matchups by week, then pair by matchup_id
  const byWeek = new Map<number, Map<number, MatchupRow[]>>();
  for (const row of matchupRows ?? []) {
    if (!byWeek.has(row.week)) byWeek.set(row.week, new Map());
    const weekMap = byWeek.get(row.week)!;
    if (!weekMap.has(row.matchup_id)) weekMap.set(row.matchup_id, []);
    weekMap.get(row.matchup_id)!.push(row);
  }

  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  const showMedian = !!league.median_scoring;

  if (weeks.length === 0) {
    return (
      <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
        <main className="mx-auto max-w-3xl flex flex-col gap-8">
          <header className="flex flex-col gap-2">
            <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: "#0057FF" }}>
              &larr; Back to {league.name}
            </Link>
            <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
              Season Schedule
            </h1>
          </header>
          <div className="rounded-lg border p-6 text-sm text-center text-white" style={{ borderColor: "#2a2a40" }}>
            No matchups scheduled yet. The commissioner needs to generate the schedule first.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto max-w-3xl flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link href={`/dashboard/league/${leagueId}`} className="text-sm underline" style={{ color: "#0057FF" }}>
            &larr; Back to {league.name}
          </Link>
          <p className="text-sm uppercase tracking-[0.3em]" style={{ color: "#FFD700" }}>
            Ultimate Fantasy Football
          </p>
          <h1 className="text-3xl sm:text-4xl" style={{ fontFamily: "var(--font-display, sans-serif)", color: "#0057FF" }}>
            Season Schedule
          </h1>
          <p className="text-sm text-white">Season {league.season} · {weeks.length} weeks</p>
        </header>

        <div className="flex flex-col gap-8">
          {weeks.map((week) => {
            const weekMatchups = byWeek.get(week)!;
            const pairs = [...weekMatchups.values()];
            const weekComplete = pairs.every((pair) => pair.every((r) => r.is_complete));

            return (
              <section key={week} className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-lg" style={{ color: "#FFD700" }}>
                    Week {week}
                  </h2>
                  {weekComplete ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: "rgba(61,220,132,0.12)", color: "#3DDC84" }}>
                      Final
                    </span>
                  ) : pairs.some((p) => p.some((r) => r.is_complete)) ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: "rgba(255,215,0,0.1)", color: "#FFD700" }}>
                      In Progress
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: "rgba(136,136,170,0.12)", color: "#8888aa" }}>
                      Upcoming
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {pairs.map((pair) => {
                    if (pair.length < 2) return null;
                    const [a, b] = pair;
                    const memberA = memberMap[a.member_id];
                    const memberB = memberMap[b.member_id];
                    const isComplete = a.is_complete && b.is_complete;
                    const aWon = isComplete && a.points > b.points;
                    const bWon = isComplete && b.points > a.points;
                    const isTie = isComplete && a.points === b.points;
                    const myRow = a.member_id === me.id ? a : b.member_id === me.id ? b : null;
                    const isMyMatchup = !!myRow;

                    const factionA = memberA?.faction;
                    const factionB = memberB?.faction;

                    return (
                      <div
                        key={a.matchup_id}
                        className="rounded-lg border px-4 py-3 flex items-center gap-3"
                        style={{
                          borderColor: isMyMatchup ? "#0057FF44" : "#2a2a40",
                          background: isMyMatchup ? "rgba(0,87,255,0.04)" : "#0d0d1a",
                        }}
                      >
                        {/* Team A */}
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate" style={{
                            color: aWon ? "#3DDC84" : isComplete && !isTie ? "#8888aa" : "#f4f4f8"
                          }}>
                            {teamLabel(memberA)}
                            {a.member_id === me.id && <span className="ml-1 text-xs font-normal" style={{ color: "#0057FF" }}>(you)</span>}
                          </p>
                          <p className="text-xs" style={{
                            color: factionA === "hero" ? "#0057FF" : factionA === "villain" ? "#CC0000" : "#8888aa"
                          }}>
                            {factionA ?? "—"}
                            {showMedian && isComplete && a.median_win !== null && (
                              <span style={{ color: a.median_win ? "#3DDC84" : "#CC0000" }}>
                                {" · median "}{a.median_win ? "W" : "L"}
                              </span>
                            )}
                          </p>
                        </div>

                        {/* Score */}
                        <div className="flex items-center gap-2 shrink-0">
                          {isComplete ? (
                            <>
                              <span className="font-bold tabular-nums" style={{ color: aWon ? "#3DDC84" : "#f4f4f8" }}>
                                {a.points.toFixed(2)}
                              </span>
                              <span style={{ color: "#8888aa" }}>—</span>
                              <span className="font-bold tabular-nums" style={{ color: bWon ? "#3DDC84" : "#f4f4f8" }}>
                                {b.points.toFixed(2)}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs" style={{ color: "#8888aa" }}>vs</span>
                          )}
                        </div>

                        {/* Team B */}
                        <div className="flex-1 min-w-0 text-right">
                          <p className="font-semibold text-sm truncate" style={{
                            color: bWon ? "#3DDC84" : isComplete && !isTie ? "#8888aa" : "#f4f4f8"
                          }}>
                            {b.member_id === me.id && <span className="mr-1 text-xs font-normal" style={{ color: "#0057FF" }}>(you)</span>}
                            {teamLabel(memberB)}
                          </p>
                          <p className="text-xs" style={{
                            color: factionB === "hero" ? "#0057FF" : factionB === "villain" ? "#CC0000" : "#8888aa"
                          }}>
                            {showMedian && isComplete && b.median_win !== null && (
                              <span style={{ color: b.median_win ? "#3DDC84" : "#CC0000" }}>
                                {"median "}{b.median_win ? "W" : "L"}{" · "}
                              </span>
                            )}
                            {factionB ?? "—"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
