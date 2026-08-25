"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateSubscription, ENDPOINT_MAX } from "@/lib/push-validate";

// Keep at most this many devices per user; prune the oldest beyond it so no
// single account can accumulate an unbounded fan-out target set.
const MAX_SUBS_PER_USER = 10;

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

  // Rate-limit the write path itself so it can't be scripted into a fan-out
  // amplifier (sendPushToUser iterates every row).
  const { allowed } = checkRateLimit(`${user.id}:push-save`, 10);
  if (!allowed) return { error: "Too many attempts — try again in a minute." };

  const v = validateSubscription(sub);
  if (!v.ok) return { error: v.error };

  const userAgent = (await headers()).get("user-agent")?.slice(0, 512) ?? null;

  const admin = createAdminClient();
  const { error } = await admin.from("uff_push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: v.value.endpoint,
      p256dh: v.value.p256dh,
      auth: v.value.auth,
      user_agent: userAgent,
    },
    { onConflict: "endpoint" }
  );
  if (error) return { error: error.message };

  // Enforce the per-user cap: keep the newest MAX, delete the rest.
  const { data: rows } = await admin
    .from("uff_push_subscriptions")
    .select("id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (rows && rows.length > MAX_SUBS_PER_USER) {
    const overflow = rows.slice(MAX_SUBS_PER_USER).map((r) => r.id as string);
    await admin.from("uff_push_subscriptions").delete().in("id", overflow);
  }

  return {};
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

  const { allowed } = checkRateLimit(`${user.id}:push-test`, 5);
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
