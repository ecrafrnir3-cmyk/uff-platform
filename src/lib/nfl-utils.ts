// NFL week math for the 2026 season.
//
// The week ROLLS at Wednesday 2026-09-09 00:00 UTC (Sep 9 is a Wednesday) —
// this Wednesday boundary is what the Wednesday-morning finalize/newsletter
// crons' `week - 1` logic depends on. Do not change this anchor without also
// changing those crons.
const SEASON_START_UTC = new Date("2026-09-09");

// Raw (unclamped) week number: <= 0 before the season, > 18 after it ends.
// Crons use this to detect off-season instead of being clamped into
// re-processing week 1 / week 17 forever (audit C5).
export function getRawNFLWeek(): number {
  const diff = Math.floor((Date.now() - SEASON_START_UTC.getTime()) / (7 * 86400000));
  return diff + 1;
}

// Returns the current NFL week clamped to 1-18 (UI-safe).
export function getCurrentNFLWeek(): number {
  return Math.min(Math.max(getRawNFLWeek(), 1), 18);
}

// Fallback whole-week lock time (used when uff_game_schedule is not yet seeded).
// Per-player locks via uff_game_schedule take precedence when available.
// Week 1 kickoff: Thursday 2026-09-10 20:20 ET = 2026-09-11T00:20:00Z.
// (The old value locked lineups Wednesday evening — a full day early.)
export function getWeekLockTime(week: number): Date {
  const WEEK1_LOCK_UTC = new Date("2026-09-11T00:20:00Z");
  return new Date(WEEK1_LOCK_UTC.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
}

export function isLineupLocked(week: number): boolean {
  return Date.now() >= getWeekLockTime(week).getTime();
}
