// Returns the current NFL week (1-18) based on the 2026 season start date.
export function getCurrentNFLWeek(): number {
  const start = new Date("2026-09-03");
  const diff  = Math.floor((Date.now() - start.getTime()) / (7 * 86400000));
  return Math.min(Math.max(diff + 1, 1), 18);
}

// Week N locks at the Thursday night kickoff (8:20 PM ET = 00:20 UTC Friday).
// For weeks without a Thursday game this is still a safe cutoff.
export function getWeekLockTime(week: number): Date {
  // Week 1 Thursday: 2026-09-03 20:20 ET = 2026-09-04 00:20 UTC
  const WEEK1_LOCK_UTC = new Date("2026-09-04T00:20:00Z");
  return new Date(WEEK1_LOCK_UTC.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
}

export function isLineupLocked(week: number): boolean {
  return Date.now() >= getWeekLockTime(week).getTime();
}
