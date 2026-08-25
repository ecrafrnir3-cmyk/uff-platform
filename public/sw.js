/**
 * UFF service worker — push notifications ONLY.
 * Deliberately no fetch handler / offline cache: caching a Next.js deploy's
 * assets in a SW is how PWAs end up serving stale builds forever. Push is the
 * only job here.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "UFF", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Ultimate Fantasy Football";
  const options = {
    body: data.body || "",
    icon: "/icon",
    badge: "/icon",
    data: { url: data.url || "/dashboard" },
  };
  if (data.tag) {
    options.tag = data.tag;
    // Without renotify, a same-tag replacement is silent (no sound/vibration/
    // banner) — a repeat "You're on the clock" would arrive unnoticed.
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

// The push service can rotate/expire a subscription. Re-subscribe with the same
// application server key and hand the new subscription to the server so the
// device keeps receiving. Server actions aren't callable from a SW, so POST to
// a route; the request carries first-party cookies for auth.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const appServerKey = event.oldSubscription?.options?.applicationServerKey;
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey || undefined,
        });
        const json = newSub.toJSON();
        await fetch("/api/push/resubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys,
            oldEndpoint: event.oldSubscription?.endpoint,
          }),
        });
      } catch {
        // Best effort — the client reconciles on next dashboard visit.
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            try {
              await client.focus();
              if ("navigate" in client) await client.navigate(url);
              return;
            } catch {
              // fall through to openWindow
            }
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
