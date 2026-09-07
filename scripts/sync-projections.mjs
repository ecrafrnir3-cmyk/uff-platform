// Pull Sleeper weekly projections into player_projections.
//
//   node scripts/sync-projections.mjs [week] [season]
//   node scripts/sync-projections.mjs 1 2026
//
// Sleeper serves projections at
//   https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position[]=...
// and returns the SAME stat keys the scoring engine already reads (rec, rec_td,
// rush_yd, pass_td, sacks, pts_allow_*, ...). That matters: we store the raw
// stat line, not a pre-computed number, so each league scores projections
// through its OWN scoring_settings. A projected point total in UFF is therefore
// what the player would actually score in UFF, not a generic PPR figure.
//
// D/ST is the reason this exists as much as anything: every NFL defense has a
// NULL adp in our players table, so nothing that ranks by ADP can ever surface
// one — which is exactly why autodraft left teams with no defense on
// 2026-09-07. Projections DO cover all 32.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Minimal .env.local reader (no dotenv dependency in this repo).
function loadEnv() {
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* env may already be present (CI) */ }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://synfuvgdamhjboobjmls.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is not set (expected in .env.local).");
  process.exit(1);
}

const week = Number(process.argv[2] || 1);
const season = Number(process.argv[3] || 2026);
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  const qs = new URLSearchParams({ season_type: "regular", order_by: "pts_ppr" });
  for (const p of POSITIONS) qs.append("position[]", p);
  const url = `https://api.sleeper.app/projections/nfl/${season}/${week}?${qs}`;

  console.log(`Fetching projections — season ${season}, week ${week}…`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Sleeper returned ${res.status}`);
    process.exit(1);
  }
  const rows = await res.json();
  console.log(`Sleeper returned ${rows.length} rows.`);

  // Only keep players we actually carry, so the FK can't reject the batch.
  const known = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("players").select("id").range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    data.forEach((r) => known.add(r.id));
    if (data.length < 1000) break;
  }
  console.log(`Known players: ${known.size}`);

  const seen = new Set();
  const upserts = [];
  let skipped = 0;
  for (const r of rows) {
    const pid = String(r.player_id ?? r.player?.player_id ?? "");
    if (!pid || !known.has(pid)) { skipped++; continue; }
    if (seen.has(pid)) continue;            // one row per player per week
    seen.add(pid);
    const stats = r.stats ?? {};
    upserts.push({
      player_id: pid,
      season,
      week,
      stats,
      pts_ppr: stats.pts_ppr ?? null,
      updated_at: new Date().toISOString(),
    });
  }
  console.log(`Upserting ${upserts.length} projections (skipped ${skipped} unknown players).`);

  for (let i = 0; i < upserts.length; i += 500) {
    const chunk = upserts.slice(i, i + 500);
    const { error } = await supabase
      .from("player_projections")
      .upsert(chunk, { onConflict: "player_id,season,week" });
    if (error) throw error;
    process.stdout.write(`  ${Math.min(i + 500, upserts.length)}/${upserts.length}\r`);
  }

  const { count } = await supabase
    .from("player_projections")
    .select("*", { count: "exact", head: true })
    .eq("season", season)
    .eq("week", week);
  console.log(`\nDone. player_projections now holds ${count} rows for ${season} wk${week}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
