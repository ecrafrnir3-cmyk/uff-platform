// The Oracle — first AI character slice.
//
// For now this is rule-based (no API key needed) so the pipeline runs
// end-to-end today. Next step: swap generateOracleLine's body for a call
// to the Anthropic API (Claude Haiku, ~300 max_tokens) using this same
// MatchupView data as the prompt context.

import { League, Matchup, Roster, SleeperUser } from "./sleeper";

export interface TeamResult {
  rosterId: number;
  teamName: string;
  ownerName: string;
  points: number;
  record: string;
}

export interface MatchupView {
  matchupId: number;
  teamA: TeamResult;
  teamB: TeamResult;
  margin: number;
  winner: TeamResult;
  loser: TeamResult;
}

function teamLabel(roster: Roster, user: SleeperUser | undefined): string {
  return user?.team_name || user?.display_name || `Team ${roster.roster_id}`;
}

export function buildMatchupViews(
  rosters: Roster[],
  users: SleeperUser[],
  matchups: Matchup[]
): MatchupView[] {
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const rostersById = new Map(rosters.map((r) => [r.roster_id, r]));

  const byMatchupId = new Map<number, Matchup[]>();
  for (const m of matchups) {
    const list = byMatchupId.get(m.matchup_id) ?? [];
    list.push(m);
    byMatchupId.set(m.matchup_id, list);
  }

  const views: MatchupView[] = [];
  for (const [matchupId, pair] of byMatchupId) {
    if (pair.length !== 2) continue;
    const [m1, m2] = pair;
    const r1 = rostersById.get(m1.roster_id)!;
    const r2 = rostersById.get(m2.roster_id)!;

    const teamA: TeamResult = {
      rosterId: r1.roster_id,
      teamName: teamLabel(r1, usersById.get(r1.owner_id)),
      ownerName: usersById.get(r1.owner_id)?.display_name ?? "unknown",
      points: m1.points,
      record: `${r1.wins}-${r1.losses}`,
    };
    const teamB: TeamResult = {
      rosterId: r2.roster_id,
      teamName: teamLabel(r2, usersById.get(r2.owner_id)),
      ownerName: usersById.get(r2.owner_id)?.display_name ?? "unknown",
      points: m2.points,
      record: `${r2.wins}-${r2.losses}`,
    };

    const [winner, loser] =
      teamA.points >= teamB.points ? [teamA, teamB] : [teamB, teamA];

    views.push({
      matchupId,
      teamA,
      teamB,
      margin: Math.round((winner.points - loser.points) * 100) / 100,
      winner,
      loser,
    });
  }

  return views.sort((a, b) => a.matchupId - b.matchupId);
}

/**
 * The Oracle's reaction to a single matchup. Ominous, sage, confident.
 * Rule-based v0 — picks a tone based on margin size.
 */
export function generateOracleLine(view: MatchupView): string {
  const { winner, loser, margin } = view;

  if (margin < 1) {
    return `🔮 The Oracle foresaw chaos, and chaos delivered. ${winner.teamName} survives ${loser.teamName} by a mere ${margin.toFixed(2)} — the closest of margins, the cruelest of fates.`;
  }
  if (margin >= 40) {
    return `🔮 The Oracle warned of a reckoning. ${winner.teamName} (${winner.points.toFixed(1)}) buried ${loser.teamName} (${loser.points.toFixed(1)}) by ${margin.toFixed(1)} points — a massacre foretold, ignored, and now endured.`;
  }
  return `🔮 As written: ${winner.teamName} (${winner.points.toFixed(1)}) takes down ${loser.teamName} (${loser.points.toFixed(1)}). A ${margin.toFixed(1)}-point gap separates triumph from torment.`;
}

export function generateOracleRecap(league: League, views: MatchupView[]): string[] {
  const lines = [`🔮 The Oracle speaks on ${league.name}, Week 1:`];
  for (const v of views) {
    lines.push(generateOracleLine(v));
  }

  const blowout = [...views].sort((a, b) => b.margin - a.margin)[0];
  const nailbiter = [...views].sort((a, b) => a.margin - b.margin)[0];
  const highScore = [...views]
    .flatMap((v) => [v.teamA, v.teamB])
    .sort((a, b) => b.points - a.points)[0];

  lines.push("");
  lines.push(
    `🔮 The week's omens: ${blowout.winner.teamName} dealt the heaviest blow (+${blowout.margin.toFixed(1)}). ${nailbiter.winner.teamName} escaped the tightest brush with fate (+${nailbiter.margin.toFixed(2)}). And ${highScore.teamName} posted the week's highest total: ${highScore.points.toFixed(1)}.`
  );

  return lines;
}
