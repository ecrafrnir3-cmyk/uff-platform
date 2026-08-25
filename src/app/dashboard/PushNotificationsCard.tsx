"use client";

import { useCallback, useEffect, useState } from "react";
import {
  savePushSubscription,
  deletePushSubscription,
  sendTestPush,
} from "./push-actions";

type Status =
  | "loading"
  | "unsupported" // browser has no Push API
  | "ios-install" // iOS Safari tab — push only works once added to Home Screen
  | "denied" // permission blocked at the browser level
  | "off"
  | "on";

/** Decode a base64url VAPID public key into the raw bytes subscribe() wants. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Enable/disable Web Push for this device.
 * variant="card" — standalone section card (dashboard hub).
 * variant="banner" — compact banner (league notifications page).
 */
export default function PushNotificationsCard({
  variant = "card",
}: {
  variant?: "card" | "banner";
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<"idle" | "sending" | "sent">("idle");

  useEffect(() => {
    let cancelled = false;
    const detect = async (): Promise<Status> => {
      const supported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      if (!supported) {
        // iOS exposes push only to installed (Home Screen) PWAs on 16.4+.
        const isIOS =
          /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        const standalone = window.matchMedia("(display-mode: standalone)").matches;
        return isIOS && !standalone ? "ios-install" : "unsupported";
      }
      if (Notification.permission === "denied") return "denied";
      try {
        // Registering is idempotent and also picks up sw.js updates on each visit.
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (sub && Notification.permission === "granted") {
          // Reconcile the server row with THIS browser's subscription: heals a
          // server-side prune and, on a shared device, re-claims the endpoint
          // for the now-signed-in user (upsert is idempotent). Best effort.
          const json = sub.toJSON();
          if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
            savePushSubscription({
              endpoint: json.endpoint,
              keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
            }).catch(() => {});
          }
          return "on";
        }
        return "off";
      } catch {
        // Transient SW-registration failure (network hiccup, momentary 5xx):
        // let the user retry via Enable rather than falsely claiming the
        // browser is unsupported.
        return "off";
      }
    };
    detect().then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // .trim() guards against a trailing space/newline if the key was pasted
      // into the host's env config (a common cause of a silently invalid key).
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
      if (!key) {
        setError("Push isn't configured on the server yet.");
        return;
      }
      // Prompt for permission FIRST, synchronously within the click's user
      // activation — Safari/iOS invalidates the prompt if it's requested after
      // awaiting SW registration on a slow first-ever enable.
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer,
      });
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("Browser returned an incomplete subscription.");
      }
      const result = await savePushSubscription({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      if (result.error) {
        await sub.unsubscribe().catch(() => {});
        setError(result.error);
        return;
      }
      setStatus("on");
      // Welcome push so the user sees it working immediately.
      sendTestPush().catch(() => {});
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? `Couldn't enable notifications: ${e.message}`
          : "Couldn't enable notifications."
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        // Remove the server row FIRST; if that fails, keep the browser
        // subscription so the two don't drift out of sync.
        const res = await deletePushSubscription(sub.endpoint);
        if (res.error) {
          setError(res.error);
          return;
        }
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch {
      setError("Couldn't disable notifications.");
    } finally {
      setBusy(false);
    }
  }, []);

  const test = useCallback(async () => {
    setTestState("sending");
    setError(null);
    const result = await sendTestPush().catch(() => ({ error: "Failed to send." }));
    if (result?.error) {
      setError(result.error);
      setTestState("idle");
      return;
    }
    setTestState("sent");
    setTimeout(() => setTestState("idle"), 3000);
  }, []);

  const statusLine = (): string => {
    switch (status) {
      case "loading":
        return "Checking this device…";
      case "unsupported":
        return "This browser doesn't support push notifications.";
      case "ios-install":
        return "On iPhone: tap Share → Add to Home Screen, then open UFF from the icon to enable notifications.";
      case "denied":
        return "Notifications are blocked for this site — re-enable them in your browser settings, then reload.";
      case "off":
        return "Get draft, trade, and waiver alerts on this device — even when UFF is closed.";
      case "on":
        return "This device gets draft, trade, and waiver alerts.";
    }
  };

  const controls = (
    <div className="flex items-center gap-2 shrink-0">
      {status === "off" && (
        <button
          onClick={enable}
          disabled={busy}
          className="rounded px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{
            background: "rgba(0,87,255,0.15)",
            color: "#0057FF",
            border: "1px solid rgba(0,87,255,0.3)",
          }}
        >
          {busy ? "Enabling…" : "Enable"}
        </button>
      )}
      {status === "on" && (
        <>
          <span
            className="rounded px-2 py-1 text-xs font-semibold"
            style={{ background: "rgba(61,220,132,0.12)", color: "#3DDC84" }}
          >
            ✓ On
          </span>
          <button
            onClick={test}
            disabled={busy || testState === "sending"}
            className="rounded px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{
              background: "rgba(0,87,255,0.15)",
              color: "#0057FF",
              border: "1px solid rgba(0,87,255,0.3)",
            }}
          >
            {testState === "sending"
              ? "Sending…"
              : testState === "sent"
                ? "Sent ✓"
                : "Send test"}
          </button>
          <button
            onClick={disable}
            disabled={busy}
            className="rounded px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{
              background: "#1c1c2b",
              color: "#a0a0c0",
              border: "1px solid #2a2a40",
            }}
          >
            {busy ? "…" : "Disable"}
          </button>
        </>
      )}
    </div>
  );

  if (variant === "banner") {
    return (
      <div
        className="flex flex-col gap-2 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: "#0057FF44", background: "rgba(0,87,255,0.04)" }}
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold" style={{ color: "#0057FF" }}>
            🔔 Push notifications
          </p>
          <p className="text-xs" style={{ color: "#8888aa" }}>
            {statusLine()}
          </p>
          {error && (
            <p className="text-xs" style={{ color: "#ff8a8a" }}>
              {error}
            </p>
          )}
        </div>
        {controls}
      </div>
    );
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border p-5"
      style={{ borderColor: "#2a2a40" }}
    >
      <h2 className="text-lg font-semibold" style={{ color: "#FFD700" }}>
        🔔 Push Notifications
      </h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm" style={{ color: "#a0a0c0" }}>
          {statusLine()}
        </p>
        {controls}
      </div>
      {error && (
        <p className="text-sm" style={{ color: "#ff8a8a" }}>
          {error}
        </p>
      )}
    </section>
  );
}
