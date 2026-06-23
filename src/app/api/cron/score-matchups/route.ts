import { NextRequest, NextResponse } from "next/server";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";

// Called by GitHub Actions cron every 15 min on game days (Thu-Tue UTC).
// Proxies to the Supabase score-matchups Edge Function.
// Protected by CRON_SECRET so only our cron can invoke it.
export async function POST(req: NextRequest) {
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

  const week = getCurrentNFLWeek();

  const res = await fetch(`${supabaseUrl}/functions/v1/score-matchups`, {
    method: "POST",
    headers: {
      // Service-role key authenticates us to Supabase (required to invoke the function)
      Authorization: `Bearer ${serviceKey}`,
      // x-cron-secret is what the edge function itself checks to verify the caller
      "x-cron-secret": cronSecret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ week }),
  });

  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  return NextResponse.json({ ok: res.ok, status: res.status, week, data });
}
