/**
 * One place that writes a push subscription for the signed-in user (audit A3-09): the save
 * server action and the service worker's re-subscribe route both go through it, so the rate
 * limit and the per-user device cap cannot drift apart again.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ValidatedSubscription } from "@/lib/push-validate";

export const MAX_SUBS_PER_USER = 10;

export async function persistPushSubscription(
  userId: string,
  sub: ValidatedSubscription,
  userAgent: string | null,
  rateKey = "push-save"
): Promise<{ error?: string }> {
  // Rate-limit the write path itself so it can't be scripted into a fan-out
  // amplifier (sendPushToUser iterates every row).
  const { allowed } = await checkRateLimit(`${userId}:${rateKey}`, 10);
  if (!allowed) return { error: "Too many attempts — try again in a minute." };

  const admin = createAdminClient();
  const { error } = await admin.from("uff_push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent: userAgent,
    },
    { onConflict: "endpoint" }
  );
  if (error) return { error: error.message };

  // Enforce the per-user cap: keep the newest MAX, delete the rest.
  const { data: rows } = await admin
    .from("uff_push_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (rows && rows.length > MAX_SUBS_PER_USER) {
    const overflow = rows.slice(MAX_SUBS_PER_USER).map((r) => r.id as string);
    await admin.from("uff_push_subscriptions").delete().in("id", overflow);
  }
  return {};
}
