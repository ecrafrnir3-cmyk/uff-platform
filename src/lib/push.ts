/**
 * Server-only helper for sending Web Push notifications.
 * Uses service role (admin) to read subscriptions — call only from server
 * actions / API routes. Never throws — push failure must not fail the caller.
 *
 * Degrades to a silent no-op when the VAPID env vars are absent, so deploys
 * are safe before the keys are configured in Vercel.
 */
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

let vapidConfigured: boolean | null = null;

function ensureVapid(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:noreply@playuff.com";
  if (!publicKey || !privateKey) {
    vapidConfigured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

// One stalled/hostile endpoint must not hang a draft pick, an announcement, or
// a cron. web-push honors `timeout` (ms) on the underlying request.
const SEND_TIMEOUT_MS = 10_000;
// Backstop against a single user accumulating pathological subscription rows.
const MAX_SUBS_PER_USER = 25;
// Keep the encrypted payload comfortably under the ~4 KB Web Push ceiling.
const TITLE_MAX = 200;
const BODY_MAX = 300;
const PAYLOAD_BYTES_MAX = 3500;

export type PushPayload = {
  title: string;
  body?: string;
  /** Path to open on tap, e.g. /dashboard/league/abc/draft */
  url?: string;
  /** Same tag replaces an undismissed earlier notification (e.g. per-league draft clock) */
  tag?: string;
  /** Time-to-live in seconds. Short for time-sensitive alerts (draft clock). Default 1h. */
  ttl?: number;
};

export type PushResult = {
  /** Whether VAPID keys are present server-side. */
  configured: boolean;
  /** How many subscription rows the user has. */
  attempted: number;
  /** How many sends the push service accepted. */
  delivered: number;
};

function buildBody(payload: PushPayload): string {
  const title = payload.title.slice(0, TITLE_MAX);
  let body = payload.body ? payload.body.slice(0, BODY_MAX) : undefined;
  let json = JSON.stringify({
    title,
    body: body ?? "",
    url: payload.url ?? "/dashboard",
    tag: payload.tag,
  });
  // Defensive: if an oversized field still pushes us past the limit, drop body.
  if (Buffer.byteLength(json, "utf8") > PAYLOAD_BYTES_MAX) {
    body = undefined;
    json = JSON.stringify({
      title,
      body: "",
      url: payload.url ?? "/dashboard",
      tag: payload.tag,
    });
  }
  return json;
}

/**
 * Send a push notification to every device the user has subscribed.
 * Expired/revoked/mismatched subscriptions (404/410/403) are deleted as
 * they're discovered. Returns a summary so callers can report honestly.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<PushResult> {
  try {
    if (!ensureVapid()) return { configured: false, attempted: 0, delivered: 0 };
    const admin = createAdminClient();
    const { data: subs } = await admin
      .from("uff_push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(MAX_SUBS_PER_USER);
    if (!subs || subs.length === 0) {
      return { configured: true, attempted: 0, delivered: 0 };
    }

    const body = buildBody(payload);
    const ttl = payload.ttl ?? 3600;

    const outcomes = await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint as string,
              keys: {
                p256dh: sub.p256dh as string,
                auth: sub.auth as string,
              },
            },
            body,
            { TTL: ttl, timeout: SEND_TIMEOUT_MS }
          );
          return true;
        } catch (err) {
          const status =
            typeof err === "object" && err !== null && "statusCode" in err
              ? (err as { statusCode: number }).statusCode
              : null;
          // 404/410 expired or unsubscribed; 403 VAPID key mismatch (rotation).
          if (status === 404 || status === 410 || status === 403) {
            await admin
              .from("uff_push_subscriptions")
              .delete()
              .eq("id", sub.id as string);
          } else {
            console.error("[push] send failed:", status ?? err);
          }
          return false;
        }
      })
    );

    return {
      configured: true,
      attempted: subs.length,
      delivered: outcomes.filter(Boolean).length,
    };
  } catch (err) {
    console.error("[push] sendPushToUser failed:", err);
    return { configured: false, attempted: 0, delivered: 0 };
  }
}
