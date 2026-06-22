// scripts/seed-schedule.mjs
// Seeds uff_game_schedule with the full 2026 NFL regular season.
// Run once from the uff-platform directory:
//   node scripts/seed-schedule.mjs
//
// Requires .env.local with:
//   NEXT_PUBLIC_SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// ── ESPN → Sleeper abbreviation normalization ─────────────────────────────────
// Sleeper uses these; ESPN differs on a handful of teams.
const ESPN_TO_SLEEPER = {
  JAC: "JAX",   // Jacksonville Jaguars
  WSH: "WAS",   // Washington Commanders
  LA:  "LAR",   // LA Rams (ESPN sometimes drops the R)
};
function normalize(abbr) {
  return ESPN_TO_SLEEPER[abbr] ?? abbr;
}

// ── Load .env.local ───────────────────────────────────────────────────────────
const env = {};
try {
  const raw = readFileSync(".env.local", "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  console.error("❌  Could not read .env.local — run from the uff-platform directory.");
  process.exit(1);
}

const SUPABASE_URL = env["NEXT_PUBLIC_SUPABASE_URL"];
const SERVICE_KEY  = env["SUPABASE_SERVICE_ROLE_KEY"];
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Fetch one week from ESPN ──────────────────────────────────────────────────
async function fetchWeek(week) {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
    `?seasontype=2&week=${week}&dates=2026`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const rows = [];

  for (let week = 1; week <= 18; week++) {
    process.stdout.write(`Week ${String(week).padStart(2)}: `);
    let data;
    try {
      data = await fetchWeek(week);
    } catch (e) {
      console.log(`ERROR — ${e.message}`);
      continue;
    }

    const events = data.events ?? [];
    process.stdout.write(`${events.length} games  `);

    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      const kickoff = event.date; // ISO 8601 UTC, e.g. "2026-09-10T00:20Z"
      const teams = comp.competitors?.map((c) => normalize(c.team.abbreviation)) ?? [];
      if (teams.length < 2) continue;

      // One row per team so app can do: teamKickoff[player.team]
      for (const team of teams) {
        rows.push({ season: 2026, week, team, kickoff_utc: kickoff });
        process.stdout.write(team + " ");
      }
    }
    console.log();
    await new Promise((r) => setTimeout(r, 300)); // be polite to ESPN API
  }

  console.log(`\n✓  ${rows.length} rows collected (should be 544 for 272 games × 2 teams)\n`);

  // Upsert in batches of 100
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await supabase
      .from("uff_game_schedule")
      .upsert(batch, { onConflict: "season,week,team" });
    if (error) {
      console.error(`❌  Upsert error at row ${i}: ${error.message}`);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`  Upserted ${inserted}/${rows.length} rows`);
  }

  console.log("\n✅  Done! Re-run this script any time the NFL moves a game.");
}

main().catch((e) => { console.error(e); process.exit(1); });
