// Reads, ONCE, the rows the twelve AI call sites read, into tools/qa/fixtures/db.json (gitignored).
//
//   node tools/qa/capture-fixtures.mjs
//
// Read-only by construction: every request is an HTTP GET to PostgREST, which maps to SELECT, and
// get() refuses any other method. Only FINAL weeks are read (week <= 8; Week 9 is not final until the
// Wednesday 2026-11-11 cron). The league's join code is never selected. Nothing is printed but counts.
// It also reads Sleeper's public projections endpoint for weeks 6-8, the exact URL start-sit calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvVar } from './env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'fixtures');
const SUPABASE_URL = 'https://synfuvgdamhjboobjmls.supabase.co'; // project uff-platform (CLAUDE.md)
const LAST_FINAL_WEEK = 8;
const SEASON = 2026;

const key = readEnvVar('SUPABASE_SERVICE_ROLE_KEY');
if (!key) { console.error('SUPABASE_SERVICE_ROLE_KEY not found in .env.local'); process.exit(2); }

async function get(url, init = {}) {
  if ((init.method ?? 'GET') !== 'GET') throw new Error('capture-fixtures only reads: GET requests only');
  const r = await fetch(url, { ...init, method: 'GET' });
  if (!r.ok) throw new Error(`GET ${url.split('?')[0]} -> HTTP ${r.status}`);
  return r.json();
}

async function table(name, query, { pageSize = 1000 } = {}) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/${name}?${query}&limit=${pageSize}&offset=${offset}`;
    const page = await get(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

const db = {};
db.uff_leagues = await table('uff_leagues', 'select=id,name,commissioner_id,season,max_teams,draft_rounds,draft_status,lineup_slots,scoring_settings,waiver_type,median_scoring,trade_deadline_week,faab_budget');
if (db.uff_leagues.length !== 1) throw new Error(`expected one league, found ${db.uff_leagues.length}`);
const leagueId = db.uff_leagues[0].id;
const L = `league_id=eq.${leagueId}`;
db.league_members = await table('league_members', `select=id,league_id,user_id,team_name,faction,waiver_priority&${L}`);
db.uff_matchups = await table('uff_matchups', `select=id,matchup_id,league_id,week,season,member_id,points,projected,is_complete,void_result,token_bonus,oracle_recap&${L}&week=lte.${LAST_FINAL_WEEK}`);
db.weekly_token_assignments = await table('weekly_token_assignments', `select=id,league_id,member_id,week,token_id,choice,status&${L}&week=lte.${LAST_FINAL_WEEK}`);
db.uff_roster_players = await table('uff_roster_players', `select=id,league_id,member_id,player_id,added_at,dropped_at,slot,week_added,on_trade_block&${L}`);
db.uff_lineups = await table('uff_lineups', `select=id,league_id,member_id,player_id,week,slot,lineup_source&${L}&week=lte.${LAST_FINAL_WEEK}`);
// The NFL schedule is static and public; one week past the last final week is read so the
// assistant chat (which during Week 9 says "WEEK: 9") can be graded on which teams are on bye.
db.uff_game_schedule = await table('uff_game_schedule', `select=season,week,team,kickoff_utc&season=eq.${SEASON}&week=lte.${LAST_FINAL_WEEK + 1}`);
db.players = await table('players', 'select=id,full_name,position,team,status,adp,injury_status&order=id');
db.draft_powers = await table('draft_powers', 'select=id,name,category,description&order=id');
db.uff_draft_picks = await table('uff_draft_picks', `select=id,league_id,round,pick_no,member_id,player_id,picked_at&${L}&order=pick_no`);
db.uff_trades = await table('uff_trades', `select=id,league_id,proposer_id,receiver_id,proposer_player_ids,receiver_player_ids,status&${L}`);

// The matchups must all be final; refuse to write a fixture that is not.
const open = db.uff_matchups.filter((m) => !m.is_complete);
if (open.length) throw new Error(`${open.length} matchup rows in weeks <= ${LAST_FINAL_WEEK} are not complete`);

// Sleeper projections, the endpoint start-sit fetches, kept only for rostered players.
const rostered = new Set(db.uff_roster_players.map((r) => r.player_id));
const sleeper = {};
for (const wk of [6, 7, 8]) {
  const all = await get(`https://api.sleeper.app/v1/projections/nfl/${SEASON}/${wk}?season_type=regular`);
  sleeper[wk] = { entries: Object.keys(all).length, players: Object.fromEntries(Object.entries(all).filter(([id]) => rostered.has(id))) };
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'db.json'), JSON.stringify({ capturedAt: new Date().toISOString(), lastFinalWeek: LAST_FINAL_WEEK, season: SEASON, db, sleeper }, null, 1));
console.log('Wrote tools/qa/fixtures/db.json (gitignored). Row counts:');
for (const [k, v] of Object.entries(db)) console.log(`  ${k.padEnd(26)} ${v.length}`);
for (const [wk, s] of Object.entries(sleeper)) console.log(`  sleeper wk${wk}: ${s.entries} entries, ${Object.keys(s.players).length} rostered kept`);
