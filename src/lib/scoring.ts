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

// ── Draft powers ─────────────────────────────────────────────────────────────
// MIRRORS applyDraftPower in supabase/functions/score-matchups (the engine). The
// engine decides what a week actually scored; this copy exists so the app can
// SHOW that number instead of the raw stat line. Change one, change both.
//
// Until 2026-09-23 the app had no copy at all, so every page showed a player's
// raw score while the engine counted the bonus — a QB with Gunslinger appeared as
// 16.18 next to a badge advertising a bonus that was really worth 18.18, and a
// team's starters never summed to the board.

export type PowerEntry = { power: string; restored?: boolean };

export const POWER_LABELS: Record<string, string> = {
  gunslinger: "Gunslinger",
  berserker_rage: "Berserker Rage",
  reception_specialist: "Reception Specialist",
  iron_defense: "Iron Defense",
  red_zone_menace: "Red Zone Menace",
  goal_line_hammer: "Goal Line Hammer",
  seam_buster: "Seam Buster",
  sniper: "Sniper",
  power_negation: "Power Negation",
};

export function applyDraftPower(
  power: string,
  stats: Record<string, number>,
  baseScore: number,
  settings: Record<string, number>,
): number {
  switch (power) {
    case "gunslinger":           return (stats["pass_td"] ?? 0) * 1;
    case "berserker_rage":       return (stats["rush_yd"] ?? 0) * 0.1;
    case "reception_specialist": return (stats["rec"]     ?? 0) * 0.5;
    // Iron Defense: a negative D/ST floors at 0, a positive one doubles.
    case "iron_defense":         return baseScore < 0 ? -baseScore : baseScore;
    case "red_zone_menace":      return (stats["rec_td"]  ?? 0) * 1;
    case "goal_line_hammer":     return (stats["rush_td"] ?? 0) * 1;
    case "seam_buster":          return (stats["rec_td"]  ?? 0) * 1;
    case "sniper":               return (stats["fgm_50p"] ?? 0) * (settings["fgm_50p"] ?? 0);
    case "power_negation":       return -(baseScore / 2);
    default:                     return 0;
  }
}

// Base score plus the player's draft-power bonus, carrying the engine's three
// exclusions: Time Stone is an injury freeze (a substitution, not a bonus) and is
// handled by the caller, Vampire Bite is resolved team-side, and a RESTORED Power
// Negation no longer halves.
//
// Returns the parts, not just a total, so a caller can show "16.18 + 2.00" — a
// single adjusted number is the thing nobody can reconcile against a stat line.
export function scoreWithPower(
  stats: Record<string, number> | null | undefined,
  settings: Record<string, number> | null | undefined,
  pe?: PowerEntry | null,
): { base: number; bonus: number; total: number; power: string | null } {
  const base = computeScore(stats, settings);
  const none = { base, bonus: 0, total: base, power: null };
  if (!stats || !settings || !pe) return none;
  if (pe.power === "time_stone" || pe.power === "vampire_bite") return none;
  // Power Negation IS shown, and a restored one correctly stops halving — the same
  // rule the engine uses.
  //
  // It was briefly excluded here (2026-09-24) on the belief that it never fired,
  // because five teams' boards matched their un-negated totals. That was a bad
  // comparison, not a bug: the model behind it left out the FACTION BONUS (0.5 per
  // same-faction active player, up to +8.00 a team) and the vampire siphon. Once
  // both are included, 14 of 14 week-2 boards match to the cent WITH the halving
  // applied — Blessed Defender 110.32 board, 110.32 modelled — and five teams are
  // off by 3.20 to 11.25 without it. The power works.
  //
  // Lesson worth keeping: when a total does not reconcile, suspect the model before
  // the mechanic. A missing team-level term can imitate a missing per-player one.
  if (pe.power === "power_negation" && pe.restored) return none;
  const bonus = Math.round(applyDraftPower(pe.power, stats, base, settings) * 100) / 100;
  if (bonus === 0) return { base, bonus: 0, total: base, power: pe.power };
  return { base, bonus, total: Math.round((base + bonus) * 100) / 100, power: pe.power };
}
