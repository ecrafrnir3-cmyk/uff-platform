import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";

// ─── Called by GitHub Actions every hour ────────────────────────────────────
// Checks each FAAB league's waiver schedule (waiver_day + waiver_hour in ET).
// If the current ET day/hour matches, runs process_waiver_bids for that league.
// Uses ET = UTC-5 (fixed offset — no DST adjustment for simplicity).

interface LeagueRow {
  id: string;
  name: string;
  commissioner_id: string;
  waiver_day: number;
  waiver_hour: number;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing server config" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Current time in Eastern (UTC-5, fixed — no DST)
  const nowUTC  = new Date();
  const nowET   = new Date(nowUTC.getTime() - 5 * 60 * 60 * 1000);
  const etDow   = nowET.getUTCDay();    // 0=Sun, 1=Mon, ..., 6=Sat
  const etHour  = nowET.getUTCHours(); // 0-23

  const week = getCurrentNFLWeek();

  // Find leagues with auto-waiver enabled for this exact ET day + hour
  const { data: leagues, error: fetchErr } = await supabase
    .from("uff_leagues")
    .select("id, name, commissioner_id, waiver_day, waiver_hour")
    .eq("waiver_auto", true)
    .eq("waiver_day", etDow)
    .eq("waiver_hour", etHour)
    .returns<LeagueRow[]>();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!leagues || leagues.length === 0) {
    return NextResponse.json({
      processed: 0,
      week,
      et_day: etDow,
      et_hour: etHour,
      results: [],
    });
  }

  const results = [];
  for (const league of leagues) {
    const { data, error } = await supabase.rpc("process_waiver_bids", {
      p_league_id: league.id,
      p_user_id:   league.commissioner_id,
      p_week:      week,
    });
    results.push({
      league_id:   league.id,
      league_name: league.name,
      claims:      error ? null : (data ?? 0),
      error:       error?.message ?? null,
    });
  }

  const successCount = results.filter((r) => r.error === null).length;
  console.log(
    `[process-waivers] ET ${etDow}/${etHour} • week ${week} • ${successCount}/${leagues.length} leagues processed`
  );

  return NextResponse.json({
    processed: successCount,
    week,
    et_day:  etDow,
    et_hour: etHour,
    results,
  });
}
