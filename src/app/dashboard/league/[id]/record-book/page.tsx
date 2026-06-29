import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const HERO_COLOR    = "#0057FF";
const VILLAIN_COLOR = "#CC0000";
const GOLD          = "#FFD700";

function factionColor(faction: string | null) {
  if (faction === "hero") return HERO_COLOR;
  if (faction === "villain") return VILLAIN_COLOR;
  return "#f4f4f8";
}

interface MatchupRow {
  matchup_id: number;
  member_id:  string;
  week:       number;
  points:     number;
  is_complete: boolean;
  void_result: boolean;
  league_members: { team_name: string; faction: "hero" | "villain" | null } | null;
}

interface RecordEntry {
  label:     string;
  icon:      string;
  teamName:  string;
  faction:   string | null;
  value:     string;
  detail:    string;
  highlight?: "gold" | "villain";
}

function fmt(n: number) { return n.toFixed(2); }

function buildRecords(rows: MatchupRow[]): RecordEntry[] {
  const completed = rows.filter((r) => r.is_complete);
  if (completed.length < 2) return [];

  // Group rows by matchup_id to get pairs
  const byMatchup = new Map<number, MatchupRow[]>();
  for (const r of completed) {
    if (!byMatchup.has(r.matchup_id)) byMatchup.set(r.matchup_id, []);
    byMatchup.get(r.matchup_id)!.push(r);
  }
  const pairs = [...byMatchup.values()].filter((p) => p.length === 2);
  if (pairs.length === 0) return [];

  // ── Individual score records ─────────────────────────────────────────────
  let highScore   = completed[0];
  let lowScore    = completed[0];
  let mostInLoss: MatchupRow | null = null;

  for (const r of completed) {
    if (r.points > highScore.points) highScore = r;
    if (r.points < lowScore.points)  lowScore  = r;
  }

  // Most points in a loss — loser of each pair
  for (const [a, b] of pairs) {
    let loser: MatchupRow | null = null;
    if (a.points > b.points) loser = b;
    else if (b.points > a.points) loser = a;
    if (loser && (!mostInLoss || loser.points > mostInLoss.points)) {
      mostInLoss = loser;
    }
  }

  // ── Game records ─────────────────────────────────────────────────────────
  let biggestBlowout: { winner: MatchupRow; loser: MatchupRow; margin: number } | null = null;
  let closestGame:    { winner: MatchupRow; loser: MatchupRow; margin: number } | null = null;
  let highestCombined: { a: MatchupRow; b: MatchupRow; total: number } | null = null;

  for (const [a, b] of pairs) {
    const margin  = Math.abs(a.points - b.points);
    const winner  = a.points > b.points ? a : b;
    const loser   = a.points > b.points ? b : a;
    const total   = a.points + b.points;

    if (!biggestBlowout || margin > biggestBlowout.margin) {
      biggestBlowout = { winner, loser, margin };
    }
    if (margin > 0 && (!closestGame || margin < closestGame.margin)) {
      closestGame = { winner, loser, margin };
    }
    if (!highestCombined || total > highestCombined.total) {
      highestCombined = { a, b, total };
    }
  }

  // ── Highest-scoring week (sum of all scores that week) ───────────────────
  const weekTotals: Record<number, number> = {};
  for (const r of completed) {
    weekTotals[r.week] = (weekTotals[r.week] ?? 0) + r.points;
  }
  let highWeek = 0;
  let highWeekTotal = 0;
  for (const [week, total] of Object.entries(weekTotals)) {
    if (total > highWeekTotal) { highWeekTotal = total; highWeek = Number(week); }
  }

  // ── Win streaks ──────────────────────────────────────────────────────────
  // Build each member's game results in week order
  const memberResults: Record<string, { week: number; win: boolean; name: string; faction: string | null }[]> = {};
  for (const [a, b] of pairs) {
    const aWins = a.points > b.points;
    const bWins = b.points > a.points;
    const aName = a.league_members?.team_name ?? "Unknown";
    const bName = b.league_members?.team_name ?? "Unknown";
    if (!memberResults[a.member_id]) memberResults[a.member_id] = [];
    if (!memberResults[b.member_id]) memberResults[b.member_id] = [];
    // void_result on a row = Insurance token used; that member's loss is voided.
    // Winner always gets a win recorded. Insured loser gets no entry (streak unbroken).
    if (!a.void_result) memberResults[a.member_id].push({ week: a.week, win: aWins, name: aName, faction: a.league_members?.faction ?? null });
    if (!b.void_result) memberResults[b.member_id].push({ week: b.week, win: bWins, name: bName, faction: b.league_members?.faction ?? null });
  }

  let bestStreak = 0;
  let bestStreakName = "";
  let bestStreakFaction: string | null = null;

  for (const games of Object.values(memberResults)) {
    games.sort((a, b) => a.week - b.week);
    let streak = 0;
    let maxStreak = 0;
    for (const g of games) {
      if (g.win) { streak++; maxStreak = Math.max(maxStreak, streak); }
      else streak = 0;
    }
    if (maxStreak > bestStreak) {
      bestStreak = maxStreak;
      bestStreakName   = games[0].name;
      bestStreakFaction = games[0].faction;
    }
  }

  // ── Assemble records ──────────────────────────────────────────────────────
  const records: RecordEntry[] = [];

  records.push({
    label:    "Highest Single-Week Score",
    icon:     "🔥",
    teamName: highScore.league_members?.team_name ?? "Unknown",
    faction:  highScore.league_members?.faction ?? null,
    value:    fmt(highScore.points),
    detail:   `Week ${highScore.week}`,
    highlight: "gold",
  });

  records.push({
    label:    "Lowest Single-Week Score",
    icon:     "💀",
    teamName: lowScore.league_members?.team_name ?? "Unknown",
    faction:  lowScore.league_members?.faction ?? null,
    value:    fmt(lowScore.points),
    detail:   `Week ${lowScore.week}`,
    highlight: "villain",
  });

  if (biggestBlowout) {
    records.push({
      label:    "Biggest Blowout",
      icon:     "💥",
      teamName: biggestBlowout.winner.league_members?.team_name ?? "Unknown",
      faction:  biggestBlowout.winner.league_members?.faction ?? null,
      value:    `+${fmt(biggestBlowout.margin)}`,
      detail:   `${biggestBlowout.winner.league_members?.team_name ?? "?"} def. ${biggestBlowout.loser.league_members?.team_name ?? "?"} · Week ${biggestBlowout.winner.week}`,
      highlight: "gold",
    });
  }

  if (closestGame) {
    records.push({
      label:    "Closest Game",
      icon:     "😅",
      teamName: closestGame.winner.league_members?.team_name ?? "Unknown",
      faction:  closestGame.winner.league_members?.faction ?? null,
      value:    `+${fmt(closestGame.margin)}`,
      detail:   `${closestGame.winner.league_members?.team_name ?? "?"} edged ${closestGame.loser.league_members?.team_name ?? "?"} · Week ${closestGame.winner.week}`,
    });
  }

  if (mostInLoss) {
    records.push({
      label:    "Most Points in a Loss",
      icon:     "😤",
      teamName: mostInLoss.league_members?.team_name ?? "Unknown",
      faction:  mostInLoss.league_members?.faction ?? null,
      value:    fmt(mostInLoss.points),
      detail:   `Week ${mostInLoss.week} — and still lost`,
      highlight: "villain",
    });
  }

  if (highestCombined) {
    const { a, b, total } = highestCombined;
    records.push({
      label:    "Highest-Scoring Game",
      icon:     "⚡",
      teamName: a.league_members?.team_name ?? "Unknown",
      faction:  a.league_members?.faction ?? null,
      value:    fmt(total),
      detail:   `${a.league_members?.team_name ?? "?"} vs ${b.league_members?.team_name ?? "?"} · Week ${a.week} · combined pts`,
    });
  }

  if (highWeek > 0) {
    records.push({
      label:    "Highest-Scoring Week",
      icon:     "📈",
      teamName: `Week ${highWeek}`,
      faction:  null,
      value:    fmt(highWeekTotal),
      detail:   `Total points scored by all teams · Week ${highWeek}`,
    });
  }

  if (bestStreak >= 2) {
    records.push({
      label:    "Longest Win Streak",
      icon:     "🏆",
      teamName: bestStreakName,
      faction:  bestStreakFaction,
      value:    `${bestStreak}W`,
      detail:   `${bestStreak} consecutive wins`,
      highlight: "gold",
    });
  }

  return records;
}

export default async function RecordBookPage({
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
    .select("id, name, season")
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

  const { data: matchupRows } = await supabase
    .from("uff_matchups")
    .select("matchup_id, member_id, week, points, is_complete, void_result, league_members(team_name, faction)")
    .eq("league_id", leagueId)
    .eq("season", league.season)
    .returns<MatchupRow[]>();

  const records = buildRecords(matchupRows ?? []);
  const hasRecords = records.length > 0;

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link
            href={`/dashboard/league/${leagueId}`}
            className="text-sm underline"
            style={{ color: "#0057FF" }}
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
            Record Book
          </h1>
          <p className="text-sm text-white">Season {league.season} · All-time league records</p>
        </header>

        {!hasRecords ? (
          <div
            className="rounded-lg border p-8 text-center text-sm"
            style={{ borderColor: "#2a2a40", color: "#6b6b8a" }}
          >
            Records will appear here once the first week of games is finalized.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {records.map((rec) => {
              const accentColor =
                rec.highlight === "gold"    ? GOLD          :
                rec.highlight === "villain" ? VILLAIN_COLOR :
                "#2a2a40";
              const valueColor =
                rec.highlight === "gold"    ? GOLD          :
                rec.highlight === "villain" ? "#ff8a8a"     :
                "#f4f4f8";

              return (
                <div
                  key={rec.label}
                  className="flex flex-col gap-2 rounded-xl border p-5"
                  style={{
                    borderColor: accentColor + (rec.highlight ? "55" : ""),
                    background: rec.highlight === "gold"
                      ? "rgba(255,215,0,0.03)"
                      : rec.highlight === "villain"
                      ? "rgba(204,0,0,0.03)"
                      : "#0d0d1a",
                  }}
                >
                  {/* Label row */}
                  <div className="flex items-center gap-2">
                    <span className="text-lg leading-none">{rec.icon}</span>
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#8888aa" }}>
                      {rec.label}
                    </p>
                  </div>

                  {/* Value */}
                  <p className="text-3xl font-black tabular-nums leading-none" style={{ color: valueColor }}>
                    {rec.value}
                  </p>

                  {/* Team name */}
                  {rec.faction !== null && (
                    <p className="text-sm font-semibold" style={{ color: factionColor(rec.faction) }}>
                      {rec.teamName}
                    </p>
                  )}
                  {rec.faction === null && (
                    <p className="text-sm font-semibold text-white">{rec.teamName}</p>
                  )}

                  {/* Detail */}
                  <p className="text-xs leading-relaxed" style={{ color: "#6b6b8a" }}>
                    {rec.detail}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
