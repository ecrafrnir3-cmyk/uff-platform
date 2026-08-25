/**
 * Server-only helper for creating in-app notifications.
 * Uses service role (admin) to bypass RLS — call only from server actions / API routes.
 * Also fans out a Web Push to the recipient's subscribed devices (src/lib/push.ts)
 * — the single choke point, so every notification type gets push automatically.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";

/** Deep-link path for a notification type — mirrors the email templates' links. */
function pushUrl(type: string, leagueId: string): string {
  const base = `/dashboard/league/${leagueId}`;
  switch (type) {
    case "on_the_clock":
      return `${base}/draft`;
    case "trade_proposed":
    case "trade_accepted":
    case "trade_rejected":
    case "trade_approved":
    case "trade_vetoed":
      return `${base}/trade`;
    case "waiver_results":
      return `${base}/free-agents`;
    case "announcement":
      return `${base}/announcements`;
    case "newsletter":
      return base;
    default:
      return `${base}/notifications`;
  }
}

export async function createNotification({
  leagueId,
  userId,
  type,
  title,
  body,
}: {
  leagueId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("uff_notifications").insert({
      league_id: leagueId,
      user_id: userId,
      type,
      title,
      body: body ?? null,
    });

    // Web Push fan-out — sendPushToUser never throws and no-ops without VAPID keys.
    // on_the_clock uses a per-league tag so a newer clock alert replaces a stale
    // one, and a short TTL so a phone that reconnects after the pick window
    // doesn't buzz about a pick that was already autopicked away.
    const onTheClock = type === "on_the_clock";
    await sendPushToUser(userId, {
      title,
      body: body ?? undefined,
      url: pushUrl(type, leagueId),
      tag: onTheClock ? `on_the_clock:${leagueId}` : undefined,
      ttl: onTheClock ? 300 : undefined,
    });
  } catch (err) {
    // Never crash calling code — notifications are non-critical
    console.error("[notifications] createNotification failed:", err);
  }
}
