// Shared fantasy scoring — the ONE place a Sleeper stat line becomes UFF points.
//
// The engine reads Sleeper's stat keys verbatim (no aliasing), so a league's
// scoring_settings map is { <sleeper_key>: multiplier }. Flag keys score a flat
// value when present rather than multiplying (a D/ST points-allowed bucket is a
// bucket, not a quantity).
//
// This mirrors score-matchups (the Deno edge function) and the matchup-breakdown
// route. Keep the three in step — this file is the canonical copy for the app.

export const FLAG_KEYS = new Set([
  "pts_allow_0", "pts_allow_1_6", "pts_allow_7_13", "pts_allow_14_20",
  "pts_allow_21_27", "pts_allow_28_34", "pts_allow_35p",
]);

export function computeScore(
  stats: Record<string, number> | null | undefined,
  scoringSettings: Record<string, number> | null | undefined,
): number {
  if (!stats || !scoringSettings) return 0;
  let score = 0;
  for (const [key, mult] of Object.entries(scoringSettings)) {
    const val = stats[key];
    if (val == null || val === 0) continue;
    score += FLAG_KEYS.has(key) ? mult : val * mult;
  }
  return Math.round(score * 100) / 100;
}
