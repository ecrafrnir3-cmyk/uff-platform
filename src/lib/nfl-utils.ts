// Returns the current NFL week (1–18) based on the 2026 season start date.
export function getCurrentNFLWeek(): number {
  const start = new Date("2026-09-03");
  const diff  = Math.floor((Date.now() - start.getTime()) / (7 * 86400000));
  return Math.min(Math.max(diff + 1, 1), 18);
}
