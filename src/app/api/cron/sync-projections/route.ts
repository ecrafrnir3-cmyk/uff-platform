import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRawNFLWeek } from "@/lib/nfl-utils";

// Pulls Sleeper weekly projections into player_projections.
//
// Called by GitHub Actions every Wednesday at 08:00 UTC — after the NFL week
// rolls (Wednesday 00:00 UTC) and after finalize-week runs at 07:00, so the
// projections loaded are for the week that is ABOUT to be played.
//
// ⚠️ Source endpoint matters. /v1/projections/nfl/{season}/{week} answers 200
// with ~7,600 players whose stat objects are all EMPTY — that silently produced
// zero projections for the whole app until 2026-09-07. The populated endpoint
// is /projections/nfl/{season}/{week}?season_type=regular&position[]=..., used
// below. Verify any change to this URL against real numbers, not a 200.
//
// Stat lines are stored RAW so each league scores them through its own
// scoring_settings (see src/lib/scoring.ts) — the projection a manager sees is
// what the player would score in THEIR league, not a generic PPR figure.

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const SEASON = 2026;

export async function POST(req: NextRequest) {
  // Fail closed if the secret was never configured (audit M1).
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  // Allow an explicit week for backfills/manual runs; default to the week now
  // being played. Uses the RAW week so the off-season no-ops instead of
  // re-pulling week 1 forever (audit C5).
  let body: { week?: number } = {};
  try { body = await req.json(); } catch { /* no body is fine */ }
  const week = body.week ?? getRawNFLWeek();
  if (week < 1 || week > 18) {
    return NextResponse.json({ ok: true, skipped: "out of season", week });
  }

  const qs = new URLSearchParams({ season_type: "regular", order_by: "pts_ppr" });
  for (const p of POSITIONS) qs.append("position[]", p);

  const res = await fetch(`https://api.sleeper.app/projections/nfl/${SEASON}/${week}?${qs}`);
  if (!res.ok) {
    return NextResponse.json({ error: `Sleeper returned ${res.status}`, week }, { status: 502 });
  }
  const rows: Array<{ player_id?: string; stats?: Record<string, number> }> = await res.json();

  const supabase = createClient(supabaseUrl, serviceKey);

  // Only keep players we carry, or the FK rejects the whole batch.
  const known = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("players").select("id").range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    data.forEach((r) => known.add(r.id as string));
    if (data.length < 1000) break;
  }

  const seen = new Set<string>();
  const upserts: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const pid = String(r.player_id ?? "");
    if (!pid || !known.has(pid) || seen.has(pid)) continue;
    seen.add(pid);
    const stats = r.stats ?? {};
    upserts.push({
      player_id: pid,
      season: SEASON,
      week,
      stats,
      pts_ppr: stats.pts_ppr ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  // A week with no projections is a broken pull, not an empty week — never let
  // it quietly wipe or no-op its way to looking successful.
  if (upserts.length === 0) {
    return NextResponse.json({ error: "Sleeper returned no usable projections", week, received: rows.length }, { status: 502 });
  }

  let written = 0;
  for (let i = 0; i < upserts.length; i += 500) {
    const { error } = await supabase
      .from("player_projections")
      .upsert(upserts.slice(i, i + 500), { onConflict: "player_id,season,week" });
    if (error) return NextResponse.json({ error: error.message, week, written }, { status: 500 });
    written += Math.min(500, upserts.length - i);
  }

  return NextResponse.json({ ok: true, season: SEASON, week, received: rows.length, written });
}
