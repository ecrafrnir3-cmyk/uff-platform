import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const HERO_COLOR    = "#0057FF";
const VILLAIN_COLOR = "#CC0000";
const GOLD          = "#FFD700";

function factionColor(faction: string | null) {
  if (faction === "hero")    return HERO_COLOR;
  if (faction === "villain") return VILLAIN_COLOR;
  return "#6b6b8a";
}

function factionLabel(faction: string | null) {
  if (faction === "hero")    return "Hero";
  if (faction === "villain") return "Villain";
  return "Unassigned";
}

function factionBadgeStyle(faction: string | null) {
  if (faction === "hero")
    return { background: "rgba(0,87,255,0.12)", color: HERO_COLOR, border: "1px solid rgba(0,87,255,0.3)" };
  if (faction === "villain")
    return { background: "rgba(204,0,0,0.12)", color: VILLAIN_COLOR, border: "1px solid rgba(204,0,0,0.3)" };
  return { background: "rgba(107,107,138,0.12)", color: "#6b6b8a", border: "1px solid rgba(107,107,138,0.3)" };
}

interface MemberRow {
  id: string;
  team_name: string;
  faction: "hero" | "villain" | null;
  is_commissioner: boolean;
  profiles: { display_name: string | null; username: string | null } | null;
}

interface MatchupRow {
  matchup_id: number;
  member_id: string;
  points: number;
  void_result: boolean;
  is_complete: boolean;
  week: number;
}

interface Badge {
  emoji: string;
  label: string;
  color: string;
}

/**
 * Compute per-member streak/achievement badges from completed matchup data.
 *
 * @param matchups       ALL completed matchups for the league (all members, all weeks)
 * @param memberId       The member to compute badges for
 * @param weeklyHighScorers  memberId → count of weeks they were top scorer
 * @param leagueWeeklyLowScorers  memberId → count of weeks they were lowest scorer
 * @param allMemberIds   All member IDs (for last-place calculations)
 */
function computeBadges(
  matchups: MatchupRow[],
  memberId: string,
  weeklyHighScorers: Record<string, number>,
  weeklyLowScorers: Record<string, number>,
  leagueAvgByWeek: Record<number, number> // week → league avg pts
): Badge[] {
  const badges: Badge[] = [];

  // Pair map for margin calculations
  const byMatchup: Record<number, MatchupRow[]> = {};
  for (const r of matchups) {
    if (!byMatchup[r.matchup_id]) byMatchup[r.matchup_id] = [];
    byMatchup[r.matchup_id].push(r);
  }

  // My games in chronological order
  const myGames = matchups
    .filter((r) => r.member_id === memberId)
    .sort((a, b) => a.week - b.week);

  type Result = "W" | "L" | "T" | "V";
  const results: Result[] = [];
  let biggestWin = 0;
  let biggestLoss = 0;
  let aboveAvgWeeks = 0;
  let closestGameMargin = Infinity;

  for (const myRow of myGames) {
    const pair = byMatchup[myRow.matchup_id];
    if (!pair || pair.length < 2) continue;
    const opp = pair.find((r) => r.member_id !== memberId);
    if (!opp) continue;
    const margin = myRow.points - opp.points;
    const absMargin = Math.abs(margin);

    // Above-average week
    const leagueAvg = leagueAvgByWeek[myRow.week] ?? 0;
    if (leagueAvg > 0 && myRow.points > leagueAvg) aboveAvgWeeks++;

    // Closest game (near-miss win or nail-biter win)
    if (absMargin < closestGameMargin && absMargin > 0) closestGameMargin = absMargin;

    if (myRow.void_result && opp.points > myRow.points) {
      results.push("V");
    } else if (myRow.points > opp.points) {
      results.push("W");
      if (margin > biggestWin) biggestWin = margin;
    } else if (myRow.points < opp.points) {
      results.push("L");
      if (absMargin > biggestLoss) biggestLoss = absMargin;
    } else {
      results.push("T");
    }
  }

  const totalGames = results.length;
  const wins = results.filter((r) => r === "W").length;
  const losses = results.filter((r) => r === "L").length;

  // Current win streak (from end of schedule)
  let winStreak = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i] === "W") winStreak++;
    else break;
  }

  // Max win streak ever
  let maxWinStreak = 0, curStreak = 0;
  for (const r of results) {
    if (r === "W") { curStreak++; if (curStreak > maxWinStreak) maxWinStreak = curStreak; }
    else curStreak = 0;
  }

  // Current loss streak (from end of schedule)
  let lossStreak = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i] === "L") lossStreak++;
    else break;
  }

  // ── Badge conditions ────────────────────────────────────────────────────────

  // 🔥 Hot streak (current)
  if (winStreak >= 3) {
    badges.push({ emoji: "🔥", label: `${winStreak}-game hot streak`, color: "#FFD700" });
  } else if (winStreak === 2) {
    badges.push({ emoji: "🔥", label: "2-game streak", color: "#FFD700" });
  }

  // ❄️ Cold streak (current)
  if (lossStreak >= 3) {
    badges.push({ emoji: "❄️", label: `${lossStreak}-game skid`, color: "#6b9fff" });
  }

  // 💥 Biggest blowout delivered
  if (biggestWin >= 50) {
    badges.push({ emoji: "💥", label: `${Math.round(biggestWin)}-pt blowout`, color: "#ff4444" });
  } else if (biggestWin >= 35) {
    badges.push({ emoji: "💥", label: `${Math.round(biggestWin)}-pt blowout`, color: "#ff6060" });
  }

  // 😬 Nail-biter — closest win (< 3 pts)
  if (closestGameMargin > 0 && closestGameMargin <= 3 && results.includes("W")) {
    badges.push({ emoji: "😬", label: `Nail-biter (${closestGameMargin.toFixed(2)} pts)`, color: "#FFD700" });
  }

  // ⚡ Undefeated (no losses, at least 3 decisive games)
  const decisiveGames = results.filter((r) => r === "W" || r === "L").length;
  if (!results.includes("L") && decisiveGames >= 3) {
    badges.push({ emoji: "⚡", label: "Undefeated", color: "#3DDC84" });
  }

  // 💯 Win rate ≥ 75% (min 4 games)
  if (totalGames >= 4 && wins / totalGames >= 0.75 && results.includes("L")) {
    badges.push({ emoji: "💯", label: `${Math.round(wins / totalGames * 100)}% win rate`, color: "#3DDC84" });
  }

  // 👑 Top scorer weeks
  const topWeeks = weeklyHighScorers[memberId] ?? 0;
  if (topWeeks >= 3) {
    badges.push({ emoji: "👑", label: `Top scorer ×${topWeeks}`, color: "#FFD700" });
  } else if (topWeeks >= 1) {
    badges.push({ emoji: "👑", label: topWeeks === 1 ? "Top scorer" : `Top scorer ×${topWeeks}`, color: "#FFD700" });
  }

  // 📉 Basement dweller — lowest scorer 3+ weeks
  const lowWeeks = weeklyLowScorers[memberId] ?? 0;
  if (lowWeeks >= 3) {
    badges.push({ emoji: "📉", label: `Lowest scorer ×${lowWeeks}`, color: "#CC0000" });
  }

  // 📈 Consistent — above league avg 70%+ of weeks (min 4)
  if (totalGames >= 4 && aboveAvgWeeks / totalGames >= 0.7) {
    badges.push({ emoji: "📈", label: "Above average", color: "#3DDC84" });
  }

  // 🤝 Tie machine
  const ties = results.filter((r) => r === "T").length;
  if (ties >= 2) {
    badges.push({ emoji: "🤝", label: `${ties} ties`, color: "#8888aa" });
  }

  // 🛡️ Insurance token used (void result)
  const voided = results.filter((r) => r === "V").length;
  if (voided >= 1) {
    badges.push({ emoji: "🛡️", label: voided === 1 ? "Insurance saved" : `Insurance ×${voided}`, color: "#0057FF" });
  }

  // 🏆 All-time streak (maxWinStreak ≥ 5, not current — season long)
  if (maxWinStreak >= 5 && winStreak < maxWinStreak) {
    badges.push({ emoji: "🏆", label: `${maxWinStreak}-win best streak`, color: "#FFD700" });
  }

  // 😤 Hard luck — most losses overall (only show if ≥ 50% loss rate, min 4 games)
  if (totalGames >= 4 && losses / totalGames >= 0.6) {
    badges.push({ emoji: "😤", label: `${losses}–${wins} record`, color: "#CC0000" });
  }

  return badges;
}

function computeStandings(matchups: MatchupRow[]) {
  const stats: Record<string, { wins: number; losses: number; ties: number; pf: number; pa: number }> = {};

  const byMatchup: Record<number, MatchupRow[]> = {};
  for (const r of matchups) {
    if (!byMatchup[r.matchup_id]) byMatchup[r.matchup_id] = [];
    byMatchup[r.matchup_id].push(r);
  }

  for (const pair of Object.values(byMatchup)) {
    for (const r of pair) {
      if (!stats[r.member_id]) stats[r.member_id] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };
      stats[r.member_id].pf += r.points;
    }
    if (pair.length === 2) {
      const [a, b] = pair;
      if (!stats[a.member_id]) stats[a.member_id] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };
      if (!stats[b.member_id]) stats[b.member_id] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };

      // Points against
      stats[a.member_id].pa += b.points;
      stats[b.member_id].pa += a.points;

      // W/L — respect void_result (Insurance token voids a loss)
      if (a.void_result && b.points > a.points) {
        // a's loss voided — no record change for a
        stats[b.member_id].wins++;
      } else if (b.void_result && a.points > b.points) {
        // b's loss voided — no record change for b
        stats[a.member_id].wins++;
      } else if (a.points > b.points) {
        stats[a.member_id].wins++;
        stats[b.member_id].losses++;
      } else if (b.points > a.points) {
        stats[b.member_id].wins++;
        stats[a.member_id].losses++;
      } else {
        stats[a.member_id].ties++;
        stats[b.member_id].ties++;
      }
    }
  }

  return stats;
}

export default async function ManagersPage({
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

  // Fetch all members
  const { data: membersRaw } = await supabase
    .from("league_members")
    .select("id, team_name, faction, is_commissioner, profiles(display_name, username)")
    .eq("league_id", leagueId)
    .order("team_name");

  const members = (membersRaw ?? []) as unknown as MemberRow[];

  // Fetch all completed matchups for W/L/PF + badges
  const { data: matchupRows } = await supabase
    .from("uff_matchups")
    .select("matchup_id, member_id, points, void_result, is_complete, week")
    .eq("league_id", leagueId)
    .eq("season", league.season)
    .eq("is_complete", true)
    .returns<MatchupRow[]>();

  const allMatchups = matchupRows ?? [];
  const standings = computeStandings(allMatchups);

  // Compute weekly high scorers and low scorers, plus league avg by week
  const weeklyHighScorers: Record<string, number> = {};
  const weeklyLowScorers: Record<string, number> = {};
  const weekBest: Record<number, { memberId: string; score: number }> = {};
  const weekWorst: Record<number, { memberId: string; score: number }> = {};
  const weekScores: Record<number, number[]> = {};

  for (const r of allMatchups) {
    if (!weekScores[r.week]) weekScores[r.week] = [];
    weekScores[r.week].push(r.points);

    if (!weekBest[r.week] || r.points > weekBest[r.week].score) {
      weekBest[r.week] = { memberId: r.member_id, score: r.points };
    }
    if (!weekWorst[r.week] || r.points < weekWorst[r.week].score) {
      weekWorst[r.week] = { memberId: r.member_id, score: r.points };
    }
  }

  for (const { memberId } of Object.values(weekBest)) {
    weeklyHighScorers[memberId] = (weeklyHighScorers[memberId] ?? 0) + 1;
  }
  for (const { memberId } of Object.values(weekWorst)) {
    weeklyLowScorers[memberId] = (weeklyLowScorers[memberId] ?? 0) + 1;
  }

  // League avg pts by week
  const leagueAvgByWeek: Record<number, number> = {};
  for (const [week, scores] of Object.entries(weekScores)) {
    leagueAvgByWeek[Number(week)] = scores.reduce((s, v) => s + v, 0) / scores.length;
  }

  // Pre-compute badges for all members
  const memberBadges: Record<string, Badge[]> = {};
  for (const m of membersRaw ?? []) {
    memberBadges[m.id] = computeBadges(allMatchups, m.id, weeklyHighScorers, weeklyLowScorers, leagueAvgByWeek);
  }

  // Sort members: by wins desc, then PF desc
  const sorted = [...members].sort((a, b) => {
    const sa = standings[a.id] ?? { wins: 0, losses: 0, pf: 0, pa: 0 };
    const sb = standings[b.id] ?? { wins: 0, losses: 0, pf: 0, pa: 0 };
    if (sb.wins !== sa.wins) return sb.wins - sa.wins;
    return sb.pf - sa.pf;
  });

  // Faction split
  const heroes   = sorted.filter((m) => m.faction === "hero");
  const villains = sorted.filter((m) => m.faction === "villain");
  const other    = sorted.filter((m) => m.faction !== "hero" && m.faction !== "villain");

  const allGroups: { label: string; color: string; members: MemberRow[] }[] = [
    ...(heroes.length   > 0 ? [{ label: "Heroes",    color: HERO_COLOR,    members: heroes   }] : []),
    ...(villains.length > 0 ? [{ label: "Villains",  color: VILLAIN_COLOR, members: villains }] : []),
    ...(other.length    > 0 ? [{ label: "Unassigned", color: "#6b6b8a",    members: other    }] : []),
  ];

  const hasAnyGames = Object.keys(standings).length > 0;

  return (
    <div className="min-h-screen px-6 py-12 sm:px-12" style={{ background: "#0d0d1a", color: "#f4f4f8" }}>
      <main className="mx-auto flex max-w-4xl flex-col gap-10">

        {/* Header */}
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
            className="text-3xl sm:text-4xl font-black"
            style={{ fontFamily: "var(--font-display, sans-serif)", color: GOLD }}
          >
            Managers
          </h1>
          <p className="text-sm" style={{ color: "#8888aa" }}>
            Season {league.season} · {members.length} manager{members.length !== 1 ? "s" : ""} · {heroes.length} Heroes vs {villains.length} Villains
          </p>
          <Link
            href={`/dashboard/league/${leagueId}/h2h`}
            className="self-start text-sm font-semibold rounded-md px-3 py-1.5 mt-1"
            style={{ background: "rgba(0,87,255,0.12)", color: "#0057FF", border: "1px solid rgba(0,87,255,0.3)" }}
          >
            ⚡ Head-to-Head Comparison
          </Link>
        </header>

        {/* Faction groups */}
        {allGroups.map(({ label, color, members: group }) => (
          <section key={label} className="flex flex-col gap-4">
            {/* Faction header */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1" style={{ background: color + "44" }} />
              <span
                className="text-xs font-bold uppercase tracking-[0.25em]"
                style={{ color }}
              >
                {label}
              </span>
              <div className="h-px flex-1" style={{ background: color + "44" }} />
            </div>

            {/* Manager cards grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((member, rank) => {
                const s = standings[member.id] ?? { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };
                const displayName =
                  member.profiles?.display_name ??
                  member.profiles?.username ??
                  "Manager";
                const isMe = member.id === me.id;
                const totalGames = s.wins + s.losses + s.ties;
                const winPct = totalGames > 0 ? (s.wins / totalGames) : null;
                const fc = factionColor(member.faction);
                const badges = memberBadges[member.id] ?? [];

                return (
                  <div
                    key={member.id}
                    className="relative flex flex-col gap-3 rounded-xl border p-5"
                    style={{
                      borderColor: isMe ? fc : "#2a2a40",
                      background: isMe ? `${fc}08` : "#0d0d1a",
                      boxShadow: isMe ? `0 0 0 1px ${fc}33` : "none",
                    }}
                  >
                    {/* You badge */}
                    {isMe && (
                      <span
                        className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{ background: fc + "22", color: fc }}
                      >
                        You
                      </span>
                    )}

                    {/* Faction dot + team name */}
                    <div className="flex items-start gap-2.5">
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: fc }}
                      />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <p className="font-bold leading-tight truncate" style={{ color: fc }}>
                          {member.team_name}
                        </p>
                        <p className="text-xs truncate" style={{ color: "#8888aa" }}>
                          {displayName}
                          {member.is_commissioner && (
                            <span className="ml-1.5 text-[10px] uppercase tracking-wider" style={{ color: GOLD }}>
                              · Commissioner
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Faction badge */}
                    <div>
                      <span
                        className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={factionBadgeStyle(member.faction)}
                      >
                        {factionLabel(member.faction)}
                      </span>
                    </div>

                    {/* Achievement badges */}
                    {badges.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {badges.map((badge, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{
                              background: badge.color + "18",
                              color: badge.color,
                              border: `1px solid ${badge.color}44`,
                            }}
                          >
                            {badge.emoji} {badge.label}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Stats */}
                    {hasAnyGames ? (
                      <div className="grid grid-cols-3 gap-2 border-t pt-3" style={{ borderColor: "#2a2a40" }}>
                        <div className="flex flex-col gap-0.5 text-center">
                          <p
                            className="text-xl font-black tabular-nums leading-none"
                            style={{ color: "#f4f4f8" }}
                          >
                            {s.wins}-{s.losses}{s.ties > 0 ? `-${s.ties}` : ""}
                          </p>
                          <p className="text-[10px] uppercase tracking-wider" style={{ color: "#6b6b8a" }}>
                            Record
                          </p>
                        </div>
                        <div className="flex flex-col gap-0.5 text-center">
                          <p
                            className="text-xl font-black tabular-nums leading-none"
                            style={{ color: "#f4f4f8" }}
                          >
                            {s.pf.toFixed(1)}
                          </p>
                          <p className="text-[10px] uppercase tracking-wider" style={{ color: "#6b6b8a" }}>
                            PF
                          </p>
                        </div>
                        <div className="flex flex-col gap-0.5 text-center">
                          <p
                            className="text-xl font-black tabular-nums leading-none"
                            style={{ color: "#f4f4f8" }}
                          >
                            {winPct !== null ? `${Math.round(winPct * 100)}%` : "—"}
                          </p>
                          <p className="text-[10px] uppercase tracking-wider" style={{ color: "#6b6b8a" }}>
                            Win%
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs border-t pt-3" style={{ borderColor: "#2a2a40", color: "#6b6b8a" }}>
                        Season hasn&apos;t started yet
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {/* Empty state */}
        {members.length === 0 && (
          <div
            className="rounded-lg border p-8 text-center text-sm"
            style={{ borderColor: "#2a2a40", color: "#6b6b8a" }}
          >
            No managers have joined this league yet.
          </div>
        )}

        {/* Faction war summary */}
        {hasAnyGames && heroes.length > 0 && villains.length > 0 && (() => {
          const heroWins   = heroes.reduce((acc, m)   => acc + (standings[m.id]?.wins   ?? 0), 0);
          const villainWins = villains.reduce((acc, m) => acc + (standings[m.id]?.wins   ?? 0), 0);
          const heroPF     = heroes.reduce((acc, m)   => acc + (standings[m.id]?.pf     ?? 0), 0);
          const villainPF  = villains.reduce((acc, m) => acc + (standings[m.id]?.pf     ?? 0), 0);
          const leading = heroWins > villainWins ? "Heroes" : villainWins > heroWins ? "Villains" : "Tied";
          const leadColor = heroWins > villainWins ? HERO_COLOR : villainWins > heroWins ? VILLAIN_COLOR : GOLD;
          return (
            <section className="rounded-xl border p-5 flex flex-col gap-3" style={{ borderColor: "#2a2a40" }}>
              <p className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: GOLD }}>
                Faction War · Season {league.season}
              </p>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-black" style={{ color: HERO_COLOR }}>{heroWins}W</p>
                  <p className="text-xs uppercase tracking-wider mt-1" style={{ color: HERO_COLOR }}>Heroes</p>
                  <p className="text-xs mt-0.5" style={{ color: "#6b6b8a" }}>{heroPF.toFixed(1)} PF</p>
                </div>
                <div className="flex flex-col items-center justify-center gap-1">
                  <p className="text-xs uppercase tracking-wider" style={{ color: "#6b6b8a" }}>Leading</p>
                  <p className="text-sm font-bold" style={{ color: leadColor }}>{leading}</p>
                </div>
                <div>
                  <p className="text-2xl font-black" style={{ color: VILLAIN_COLOR }}>{villainWins}W</p>
                  <p className="text-xs uppercase tracking-wider mt-1" style={{ color: VILLAIN_COLOR }}>Villains</p>
                  <p className="text-xs mt-0.5" style={{ color: "#6b6b8a" }}>{villainPF.toFixed(1)} PF</p>
                </div>
              </div>
            </section>
          );
        })()}

      </main>
    </div>
  );
}
