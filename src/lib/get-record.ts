/**
 * Computes a member's W/L record from a flat array of matchup rows.
 * Shared across AI routes (matchup-preview, trade-eval, token-advisor, oracle).
 * Single source of truth — do not duplicate inline.
 */
export interface CompletedMatchupRow {
  matchup_id: number;
  member_id: string;
  points: number;
}

export function getRecord(
  memberId: string,
  rows: CompletedMatchupRow[]
): { wins: number; losses: number } {
  let wins = 0,
    losses = 0;
  const myMatchupIds = rows
    .filter((m) => m.member_id === memberId)
    .map((m) => m.matchup_id);

  for (const matchupId of myMatchupIds) {
    const pair = rows.filter((m) => m.matchup_id === matchupId);
    if (pair.length < 2) continue;
    const my = pair.find((m) => m.member_id === memberId);
    const opp = pair.find((m) => m.member_id !== memberId);
    if (!my || !opp) continue;
    if (my.points > opp.points) wins++;
    else losses++;
  }
  return { wins, losses };
}
