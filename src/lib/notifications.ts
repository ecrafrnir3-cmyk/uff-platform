/**
 * Server-only helper for creating in-app notifications.
 * Uses service role (admin) to bypass RLS — call only from server actions / API routes.
 */
import { createAdminClient } from "@/lib/supabase/admin";

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
  } catch (err) {
    // Never crash calling code — notifications are non-critical
    console.error("[notifications] createNotification failed:", err);
  }
}
