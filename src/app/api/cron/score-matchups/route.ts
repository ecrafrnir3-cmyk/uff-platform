import { NextRequest, NextResponse } from "next/server";

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

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/score-matchups`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  return NextResponse.json({ ok: res.ok, status: res.status, data });
}
