import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateSubscription, ENDPOINT_MAX } from "@/lib/push-validate";
import { persistPushSubscription } from "@/lib/push-store";

/**
 * Re-subscribe endpoint for the service worker's `pushsubscriptionchange`
 * handler. The SW can't call a server action, so it POSTs the rotated
 * subscription here. Auth rides on first-party cookies; the request is
 * best-effort (the client also reconciles on next dashboard visit).
 */
export async function POST(req: NextRequest) {
  let payload: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    oldEndpoint?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const v = validateSubscription(payload);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const admin = createAdminClient();

  // Retire the old row if the browser told us which one rotated.
  if (
    typeof payload.oldEndpoint === "string" &&
    payload.oldEndpoint.length <= ENDPOINT_MAX
  ) {
    await admin
      .from("uff_push_subscriptions")
      .delete()
      .eq("endpoint", payload.oldEndpoint)
      .eq("user_id", user.id);
  }

  const ua = req.headers.get("user-agent")?.slice(0, 512) ?? null;
  // Same rate limit and device cap as the save action (audit A3-09)
  const { error } = await persistPushSubscription(user.id, v.value, ua, "push-resubscribe");
  if (error) return NextResponse.json({ error }, { status: error.startsWith("Too many") ? 429 : 500 });

  return NextResponse.json({ ok: true });
}
