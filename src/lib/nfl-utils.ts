// Returns the current NFL week (1-18) based on the 2026 season start date.
// Week 1 opens Thursday Sep 9, 2026 (confirmed via ESPN API).
export function getCurrentNFLWeek(): number {
  const start = new Date("2026-09-09");
  const diff  = Math.floor((Date.now() - start.getTime()) / (7 * 86400000));
  return Math.min(Math.max(diff + 1, 1), 18);
}

// Fallback whole-week lock time (used when uff_game_schedule is not yet seeded).
// Per-player locks via uff_game_schedule take precedence when available.
// Week 1 Thursday opener: 2026-09-09 20:20 ET = 2026-09-10T00:20:00Z
export function getWeekLockTime(week: number): Date {
  const WEEK1_LOCK_UTC = new Date("2026-09-10T00:20:00Z");
  return new Date(WEEK1_LOCK_UTC.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
}

export function isLineupLocked(week: number): boolean {
  return Date.now() >= getWeekLockTime(week).getTime();
}
