"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateSubscription, ENDPOINT_MAX } from "@/lib/push-validate";
import { persistPushSubscription } from "@/lib/push-store";

// Keep at most this many devices per user; prune the oldest beyond it so no
// single account can accumulate an unbounded fan-out target set.

/**
 * Persist (or refresh) a device's push subscription for the signed-in user.
 * Upserts on endpoint — globally unique per the Push API spec — so a
 * re-subscribe refreshes keys and a shared device that switches accounts
 * moves the endpoint to the new user.
 */
export async function savePushSubscription(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const v = validateSubscription(sub);
  if (!v.ok) return { error: v.error };

  const userAgent = (await headers()).get("user-agent")?.slice(0, 512) ?? null;

  // Rate limit, upsert and the per-user device cap live in one place shared with the
  // service worker's re-subscribe route (audit A3-09).
  return persistPushSubscription(user.id, v.value, userAgent);
}

/** Remove this device's subscription for the signed-in user. */
export async function deletePushSubscription(
  endpoint: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  if (typeof endpoint !== "string" || endpoint.length > ENDPOINT_MAX) {
    return { error: "Invalid endpoint." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("uff_push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  return {};
}

/** Send the signed-in user a test push so they can see it working. */
export async function sendTestPush(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { allowed } = await checkRateLimit(`${user.id}:push-test`, 5);
  if (!allowed) return { error: "Slow down — try again in a minute." };

  const result = await sendPushToUser(user.id, {
    title: "🏈 UFF push is live",
    body: "You'll get draft, trade, and waiver alerts on this device.",
    url: "/dashboard",
  });

  if (!result.configured) {
    return { error: "Push isn't configured on the server yet." };
  }
  if (result.attempted === 0) {
    return { error: "No subscribed devices found for your account." };
  }
  if (result.delivered === 0) {
    return { error: "The push service rejected the send — try disabling and re-enabling." };
  }
  return {};
}
