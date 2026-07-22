import { NextRequest, NextResponse } from "next/server";
import { getCurrentNFLWeek, getRawNFLWeek } from "@/lib/nfl-utils";

// Called by GitHub Actions cron every 15 min on game days (Thu-Tue UTC).
// Proxies to the Supabase score-matchups Edge Function.
// Protected by CRON_SECRET so only our cron can invoke it.
export async function POST(req: NextRequest) {
  // Fail closed if the secret was never configured (audit M1)
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cronSecret  = process.env.CRON_SECRET;

  if (!supabaseUrl || !serviceKey || !cronSecret) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  // Off-season runs are pointless — skip instead of scoring a clamped week
  const raw = getRawNFLWeek();
  if (raw < 1 || raw > 18) {
    return NextResponse.json({ ok: true, skipped: "out of season", week: raw });
  }
  const week = getCurrentNFLWeek();

  // 60s timeout so a hung edge function can't pin the serverless invocation
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/score-matchups`, {
      method: "POST",
      headers: {
        // Service-role key authenticates us to Supabase (required to invoke the function)
        Authorization: `Bearer ${serviceKey}`,
        // x-cron-secret is what the edge function itself checks to verify the caller
        "x-cron-secret": cronSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ week }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return NextResponse.json(
      { ok: false, error: `edge function unreachable: ${String(err)}`, week },
      { status: 502 },
    );
  }
  clearTimeout(timer);

  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  // Propagate failure as a non-200 so the GitHub Actions workflow turns red —
  // this previously returned 200 unconditionally, letting scoring be broken
  // for weeks while every cron run showed green (audit C6).
  return NextResponse.json(
    { ok: res.ok, status: res.status, week, data },
    { status: res.ok ? 200 : 502 },
  );
}
