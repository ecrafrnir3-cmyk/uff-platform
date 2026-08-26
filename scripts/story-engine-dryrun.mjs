// Story-engine smoke test (read-only). Verifies the LP rule numbers and the live
// read pipeline / Faction-Tide against The First War. Writes nothing.
// Run: node scripts/story-engine-dryrun.mjs
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .replace(/^﻿/, "").split("\n").filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

// ── mirror of rules.ts (spec numbers) for a standalone assertion battery ──
const RANK_THRESHOLDS = [3, 8, 15, 24, 35];
const rankFor = (lp) => RANK_THRESHOLDS.reduce((r, t) => r + (lp >= t ? 1 : 0), 0);
const factionTideLp = (avg, max) => { let v = Math.max(8, Math.round(0.75 * avg)); if (max > 8) v = Math.min(v, max - 1); return v; };
const lp = (o) => { let x = 0; if (o.won) x += o.margin >= 30 ? 3 : 2; if (o.lost) { x -= 1; if (o.streak >= 3) x -= 1; } x += o.feats ?? 0; if (o.won && o.rival) x += 3; if (o.won && o.upset) x += 2; return x; };

let pass = 0, fail = 0;
const ck = (name, got, want) => { if (got === want) pass++; else { fail++; console.error(`FAIL ${name}: got ${got}, want ${want}`); } };
ck("win", lp({ won: true, margin: 10 }), 2);
ck("blowout", lp({ won: true, margin: 30 }), 3);
ck("loss", lp({ lost: true, margin: 5, streak: 1 }), -1);
ck("third-straight-loss", lp({ lost: true, margin: 5, streak: 3 }), -2);
ck("beat-rival", lp({ won: true, margin: 5, rival: true }), 5);
ck("upset", lp({ won: true, margin: 5, upset: true }), 4);
ck("blowout+rival+upset", lp({ won: true, margin: 40, rival: true, upset: true }), 8);
ck("rank Unproven", rankFor(0), 0);
ck("rank Named@8", rankFor(8), 2);
ck("rank Legend@35", rankFor(35), 5);
ck("tide floor (0 data)", factionTideLp(0, 0), 8);
ck("tide caps below champ", factionTideLp(40, 50), 30);
console.log(`Rule assertions: ${pass} passed, ${fail} failed.`);

// ── live read pipeline vs The First War ──
const { data: lg } = await admin.from("uff_leagues").select("id, story_engine_enabled, season").eq("name", "The First War").maybeSingle();
const { data: chars } = await admin.from("uff_characters").select("id, name, faction");
const { data: members } = await admin.from("league_members").select("id, character_id, faction").eq("league_id", lg.id);
const { data: matches } = await admin.from("uff_matchups").select("member_id, matchup_id, week, points").eq("league_id", lg.id).eq("is_complete", true);

const claimed = new Set(members.filter((m) => m.character_id != null).map((m) => m.character_id));
const byFaction = { hero: [], villain: [] };
for (const c of chars) if (claimed.has(c.id)) byFaction[c.faction].push(0); // 0 LP each until games are scored
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const max = (a) => (a.length ? Math.max(...a) : 0);

const free = chars.filter((c) => !claimed.has(c.id));
console.log(`\nLeague "The First War": flag=${lg.story_engine_enabled ? "ON" : "OFF"}, completed matchups=${matches.length}`);
console.log(`Claimed champions: ${claimed.size} | Free Legends: ${free.length}`);
for (const f of ["hero", "villain"]) {
  const tide = factionTideLp(avg(byFaction[f]), max(byFaction[f]));
  const names = free.filter((c) => c.faction === f).map((c) => c.name).join(", ");
  console.log(`  ${f.padEnd(7)} free legends → LP ${tide} (rank ${rankFor(tide)}): ${names}`);
}
process.exit(fail > 0 ? 1 : 0);
