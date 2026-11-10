// Stand-in for @/lib/nfl-utils with the week fixed by the case (globalThis.__QA__.week), so a
// handler run today sees the week the case is about.
export const SEASON = 2026;
export function getRawNFLWeek() { return globalThis.__QA__.week; }
export function getCurrentNFLWeek() { return Math.min(Math.max(globalThis.__QA__.week, 1), 18); }
export function getWeekLockTime(week) {
  const WEEK1_LOCK_UTC = new Date('2026-09-11T00:20:00Z');
  return new Date(WEEK1_LOCK_UTC.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
}
export function isLineupLocked() { return false; }
