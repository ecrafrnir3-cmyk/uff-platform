import { NextRequest, NextResponse } from "next/server";
import { getCurrentNFLWeek, getRawNFLWeek } from "@/lib/nfl-utils";

const SEASON = 2026;

// Has any game in this week actually started?
//
// The cron used to be gated by a day-of-week mask that skipped Wednesday, on the
// reasoning that Wednesday has no NFL games. That is true of the calendar and false
// of the scheduler: GitHub delays scheduled runs, and on 2026-09-23 a tick scheduled
// for Tuesday 23:45 UTC executed at 00:25 UTC Wednesday — after the 00:00 UTC week
// rollover. It therefore scored week 3, whose earliest kickoff was still two days
// away, and wrote 2.00-12.22 points onto an unplayed board (OPEN-LOOPS #54).
//
// So the gate is the schedule, not the day. This reads uff_game_schedule for the
// target week and reports whether any kickoff has passed.
//
// It FAILS OPEN on purpose. An empty or unreachable schedule means missing data,
// not "no game has kicked off" — treating the two the same would silently stop
// scoring for a whole week, which is far worse than the phantom points it prevents.
async function anyGameStarted(
  supabaseUrl: string,
  serviceKey: string,
  week: number,
): Promise<{ started: boolean; games: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/uff_game_schedule?season=eq.${SEASON}&week=eq.${week}&select=kickoff_utc`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal: controller.signal,
      },
    );
    if (!res.ok) return { started: true, games: -1 };
    const rows = (await res.json()) as { kickoff_utc: string | null }[];
    if (!Array.isArray(rows) || rows.length === 0) return { started: true, games: 0 };
    const now = Date.now();
    const started = rows.some((r) => r.kickoff_utc && Date.parse(r.kickoff_utc) <= now);
    return { started, games: rows.length };
  } catch {
    return { started: true, games: -1 };
  } finally {
    clearTimeout(timer);
  }
}

// Called by GitHub Actions cron every 15 min, every day.
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

  // Don't score a week nobody has played yet. ?force=1 bypasses it for a manual
  // rescore (the route is CRON_SECRET-protected, so only our cron can pass it).
  if (req.nextUrl.searchParams.get("force") !== "1") {
    const { started, games } = await anyGameStarted(supabaseUrl, serviceKey, week);
    if (!started) {
      return NextResponse.json({
        ok: true,
        skipped: "no game in this week has kicked off yet",
        week,
        games,
      });
    }
  }

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
