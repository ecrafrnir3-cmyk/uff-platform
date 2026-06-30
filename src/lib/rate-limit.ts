/**
 * Simple in-memory rate limiter.
 * Per-serverless-instance — not globally shared, but good enough for pre-launch protection.
 * Each serverless cold start gets a fresh counter; that's acceptable.
 */

const store = new Map<string, { count: number; resetAt: number }>();

// Prune stale entries when store grows large
function maybePrune() {
  if (store.size < 5_000) return;
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (now > v.resetAt) store.delete(k);
  }
}

/**
 * Check and increment rate limit counter for a given key.
 * @param key      Unique string, e.g. `${userId}:oracle`
 * @param maxPerMinute  Max allowed calls per 60-second window
 */
export function checkRateLimit(
  key: string,
  maxPerMinute: number
): { allowed: boolean; remaining: number } {
  maybePrune();
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || now > existing.resetAt) {
    store.set(key, { count: 1, resetAt: now + 60_000 });
    return { allowed: true, remaining: maxPerMinute - 1 };
  }

  if (existing.count >= maxPerMinute) {
    return { allowed: false, remaining: 0 };
  }

  existing.count++;
  return { allowed: true, remaining: maxPerMinute - existing.count };
}
