/**
 * Shared validation for Web Push subscriptions. Used by the save server action
 * and the SW re-subscribe route so both enforce the same rules.
 *
 * The host allowlist is the important one: without it, savePushSubscription
 * would accept any https:// URL and sendPushToUser would then POST to it —
 * a blind SSRF / outbound-amplification primitive. Endpoints must belong to a
 * real browser push service.
 */

// Push endpoints are URLs at the browser vendor's push service; keys are
// base64url (p256dh ~87 chars, auth ~22). Caps are generous sanity bounds.
export const ENDPOINT_MAX = 1024;
export const KEY_MAX = 512;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

// Public vendor push-service domains only — never internal/arbitrary hosts.
const ALLOWED_HOST_SUFFIXES = [
  ".googleapis.com", // FCM (Chrome/Android): fcm.googleapis.com, android.googleapis.com
  ".mozilla.com", // Firefox: updates.push.services.mozilla.com
  ".windows.com", // Edge/WNS: *.notify.windows.com
  ".apple.com", // Safari/iOS 16.4+: web.push.apple.com
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // Require the default TLS port — real push services never use a custom port,
  // and blocking custom ports closes off internal-service targeting.
  if (url.port !== "" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export type ValidatedSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function validateSubscription(sub: {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}): { ok: true; value: ValidatedSubscription } | { ok: false; error: string } {
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (
    typeof endpoint !== "string" ||
    endpoint.length > ENDPOINT_MAX ||
    !isAllowedPushEndpoint(endpoint)
  ) {
    return { ok: false, error: "Invalid or untrusted push endpoint." };
  }
  if (
    typeof p256dh !== "string" ||
    !BASE64URL.test(p256dh) ||
    p256dh.length > KEY_MAX ||
    typeof auth !== "string" ||
    !BASE64URL.test(auth) ||
    auth.length > KEY_MAX
  ) {
    return { ok: false, error: "Invalid subscription keys." };
  }
  return { ok: true, value: { endpoint, p256dh, auth } };
}
