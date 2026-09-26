/**
 * Rate limiter backed by the shared rate_limits table (rate_limit_hit, audit A3-06), so a
 * per-minute ceiling holds across every serverless instance. The in-memory map below is the
 * fallback when the database call fails — never a reason to let a request through unlimited.
 */
import { createAdminClient } from "@/lib/supabase/admin";

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
export async function checkRateLimit(
  key: string,
  maxPerMinute: number
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("rate_limit_hit", { p_key: key, p_max: maxPerMinute, p_window_seconds: 60 });
    if (!error && data && typeof (data as { allowed?: unknown }).allowed === "boolean") {
      const d = data as { allowed: boolean; remaining: number };
      return { allowed: d.allowed, remaining: Number(d.remaining ?? 0) };
    }
    if (error) console.error("[rate-limit] shared counter unavailable, using local:", error.message);
  } catch (e) {
    console.error("[rate-limit] shared counter threw, using local:", (e as Error).message);
  }
  return checkRateLimitLocal(key, maxPerMinute);
}

function checkRateLimitLocal(
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
