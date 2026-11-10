// Generates the tables and the appendix of docs/model-eval-2026-11-10.md from the saved rows, with
// everything from the database taken out: team names, player names, the league name and decimal
// scores are replaced (teams by T-labels, players by [player], scores by N). Then it scans the whole
// report for any team name, player name, league name or join code and fails loudly if one is found.
//   node tools/qa/report-parts.mjs            writes results/report-tables.md and results/report-appendix.md
//   node tools/qa/report-parts.mjs --check <file>   leak check only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixture, loadCases, helpers } from './cases.mjs';
import { loadAll, tables } from './summary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(here, 'results');
const F = loadFixture();
const H = helpers(F);
const key = (r) => `${r.sid}|${r.model}|${r.cap}`;

// Names that must never reach the public repository.
const teamNames = H.members.map((m) => ({ name: m.team_name, label: H.label[m.id] }));
const leagueName = H.league.name;
const relevant = new Set([...F.db.uff_roster_players.map((r) => r.player_id), ...F.db.uff_draft_picks.map((p) => p.player_id), ...F.db.players.filter((p) => p.adp != null).map((p) => p.id)]);
// Defenses are stored as players named after NFL teams ("Houston Texans"): public, not league data.
const people = F.db.players.filter((p) => relevant.has(p.id) && p.position !== 'DEF');
const playerNames = people.map((p) => p.full_name);
const COMMON = new Set(['love', 'little', 'young', 'hill', 'brown', 'smith', 'allen', 'ward', 'james', 'moore', 'gay', 'price', 'mason', 'harris', 'jones', 'davis', 'johnson', 'williams', 'walker', 'wilson', 'taylor', 'white', 'king', 'bell', 'cook', 'gray', 'rice', 'reed', 'hunter', 'irving', 'henry', 'carter', 'chase', 'will', 'mike', 'jordan', 'kyle', 'josh', 'justin', 'chris', 'tyler', 'drake', 'travis', 'mark', 'brian', 'jake', 'blake', 'cam', 'sam', 'matt', 'tony', 'john', 'david', 'george', 'tom', 'nick', 'ray', 'dak']);
const bare = (n) => n.replace(/\s+(Jr\.|Sr\.|II|III|IV)$/, '');
const lastNames = [...new Set(playerNames.map((n) => bare(n).split(' ').pop()).filter((n) => n && n.length >= 4))];
const firstNames = [...new Set(playerNames.map((n) => n.split(' ')[0]).filter((n) => n && n.length >= 4 && !COMMON.has(n.toLowerCase())))];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function redact(text) {
  let t = String(text);
  for (const { name, label } of [...teamNames].sort((a, b) => b.name.length - a.name.length)) {
    const variants = [name, name.replace(/’/g, "'"), name.replace(/'/g, '’')];
    for (const v of variants) t = t.replace(new RegExp(esc(v), 'gi'), label);
  }
  t = t.replace(new RegExp(esc(leagueName), 'gi'), '[league]');
  for (const n of [...playerNames].sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(`\\b${esc(n)}\\b`, 'g'), '[player]');
  for (const n of lastNames) t = t.replace(new RegExp(`\\b${esc(n)}\\b`, 'g'), '[player]');
  for (const n of firstNames) t = t.replace(new RegExp(`\\b${esc(n)}\\b`, 'g'), '[player]');
  t = t.replace(/\[player\](\s+\[player\])+/g, '[player]');
  t = t.replace(/\b\d{2,4}\.\d{1,2}\b/g, 'N'); // scores, PF totals, margins
  return t;
}

export function leakCheck(raw) {
  const hits = [];
  // The all-caps lane code word REVEILLE (public already: docs/session-log.md) is allowed; any other
  // spelling of a team name is not.
  const text = String(raw).replace(/\bREVEILLE\b/g, '');
  for (const { name } of teamNames) if (text.toLowerCase().includes(name.toLowerCase()) || text.toLowerCase().includes(name.replace(/’/g, "'").toLowerCase())) hits.push(`team name: ${name.length} chars`);
  if (text.toLowerCase().includes(leagueName.toLowerCase())) hits.push('league name');
  const code = F.db.uff_leagues[0].join_code; // not captured (never selected), so this is undefined by design
  if (code && text.includes(code)) hits.push('join code');
  for (const n of playerNames) if (new RegExp(`\\b${esc(n)}\\b`).test(text)) hits.push(`player name (${n.length} chars)`);
  for (const n of lastNames) if (!COMMON.has(n.toLowerCase()) && new RegExp(`\\b${esc(n)}\\b`).test(text)) hits.push(`player surname (${n.length} chars)`);
  for (const n of firstNames) if (new RegExp(`\\b${esc(n)}\\b`).test(text)) hits.push(`player first name (${n.length} chars)`);
  return [...new Set(hits)];
}

// --assemble <body.md> <out.md>: put the generated tables and appendix into the hand-written body at
// <!-- TABLES --> and <!-- APPENDIX -->, then leak-check the result.
if (process.argv.includes('--assemble')) {
  const i = process.argv.indexOf('--assemble');
  const [bodyFile, outFile] = [process.argv[i + 1], process.argv[i + 2]];
  const body = fs.readFileSync(bodyFile, 'utf8')
    .replace('<!-- TABLES -->', fs.readFileSync(path.join(RESULTS, 'report-tables.md'), 'utf8').trim())
    .replace('<!-- APPENDIX -->', fs.readFileSync(path.join(RESULTS, 'report-appendix.md'), 'utf8').trim());
  const hits = leakCheck(body);
  if (hits.length) { console.log(`LEAK CHECK FAILED, nothing written:\n  ${hits.join('\n  ')}`); process.exit(1); }
  fs.writeFileSync(outFile, body);
  console.log(`wrote ${outFile} (${body.length} chars); leak check clean.`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  const f = process.argv[process.argv.indexOf('--check') + 1];
  const hits = leakCheck(fs.readFileSync(f, 'utf8'));
  if (hits.length) { console.log(`LEAK CHECK FAILED for ${f}:\n  ${hits.join('\n  ')}`); process.exit(1); }
  console.log(`leak check passed: ${f} names no team, player or league and holds no join code.`);
  process.exit(0);
}

// ── tables ────────────────────────────────────────────────────────────────────
const T = tables();
const LABEL = { haiku45: 'Haiku 4.5 (today)', haiku55: 'Haiku 5.5', sonnet55: 'Sonnet 5.5' };
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
const A = JSON.parse(fs.readFileSync(path.join(RESULTS, 'analysis.json'), 'utf8'));
const L = [];
for (const cap of ['today', 'raised']) {
  L.push(`### At ${cap === 'today' ? "each site's own cap (today's max_tokens)" : 'the 8,000-token measuring cap'}\n`);
  L.push('| site | model | n | shown by today\'s reader | FORMAT, today\'s reader | FORMAT, text blocks joined | FACT pass (reviewed) | VOICE | LENGTH | cut off | $ per call |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  const rows = [['all sites', T.overall], ...Object.entries(T.sites)];
  for (const [site, byKey] of rows) {
    for (const m of ['haiku45', 'haiku55', 'sonnet55']) {
      const s = byKey[`${m}|${cap}`];
      if (!s) continue;
      L.push(`| ${site === 'all sites' ? '**all sites**' : site} | ${LABEL[m]} | ${s.n} | ${s.shownToday}/${s.n} | ${pct(s.formatToday, s.n)} | ${pct(s.formatFixed, s.n)} | ${pct(s.factPass, s.graded)} (${s.factPass}/${s.graded}) | ${pct(s.voicePass, s.graded)} | ${pct(s.lengthPass, s.n)} | ${s.cut} | $${s.costPerCall.toFixed(5)} |`);
    }
  }
  L.push('');
}
L.push('### Output length and the cap each site needs\n');
L.push('Output tokens (thinking included) at the 8,000-token measuring cap: median / 95th percentile / longest, and the proposed cap (twice the longest reply, rounded up to 100, never below today\'s).\n');
L.push('| site | today\'s cap | Haiku 4.5 | Haiku 5.5 | Sonnet 5.5 |');
L.push('|---|---|---|---|---|');
for (const [site, c] of Object.entries(A.caps)) L.push(`| ${site} | ${c.today} | ${c.haiku45.p50} / ${c.haiku45.p95} / ${c.haiku45.max} → ${c.haiku45.proposed} | ${c.haiku55.p50} / ${c.haiku55.p95} / ${c.haiku55.max} → ${c.haiku55.proposed} | ${c.sonnet55.p50} / ${c.sonnet55.p95} / ${c.sonnet55.max} → ${c.sonnet55.proposed} |`);
L.push('\n### Latency (milliseconds, at the measuring cap: median / 95th percentile)\n');
L.push('| site | Haiku 4.5 | Haiku 5.5 | Sonnet 5.5 |');
L.push('|---|---|---|---|');
for (const [site, l] of Object.entries(A.latency)) L.push(`| ${site} | ${l.haiku45.p50} / ${l.haiku45.p95} | ${l.haiku55.p50} / ${l.haiku55.p95} | ${l.sonnet55.p50} / ${l.sonnet55.p95} |`);
L.push('\n### Cost per call (USD, from each reply\'s `usage` at the 2026-11-10 list prices)\n');
L.push('| site | Haiku 4.5, today\'s cap | Haiku 5.5, measuring cap | Sonnet 5.5, measuring cap | avg input tokens (4.5 / 5.5 tokenizer) |');
L.push('|---|---|---|---|---|');
for (const [site, c] of Object.entries(A.cost)) L.push(`| ${site} | $${c.haiku45.today.toFixed(5)} | $${c.haiku55.raised.toFixed(5)} | $${c.sonnet55.raised.toFixed(5)} | ${Math.round(c.haiku45.inTok)} / ${Math.round(c.haiku55.inTok)} |`);
fs.writeFileSync(path.join(RESULTS, 'report-tables.md'), L.join('\n') + '\n');

// ── appendix: every FACT issue and FORMAT failure, with the verdict ────────────
const { cases, answers, grades, verdicts } = loadAll();
const P = [];
const bySite = {};
for (const a of answers) (bySite[a.site] ??= []).push(a);
for (const [site, list] of Object.entries(bySite)) {
  P.push(`\n### ${site}\n`);
  for (const a of list.sort((x, y) => (key(x) < key(y) ? -1 : 1))) {
    const g = grades[key(a)];
    const v = verdicts[key(a)] || {};
    const fmt = a.formatToday || a.formatFixed;
    if (!(g && g.fact_issues.length) && !fmt) continue;
    const parts = [];
    if (g && g.fact_issues.length) {
      const kinds = g.fact_issues.map((i, n) => `${(v.factKinds?.[n] ?? i.kind)}:${v.fact?.[n] === 'confirmed' ? 'C' : v.fact?.[n] === 'overruled' ? 'O' : '?'}`);
      parts.push(`FACT ${kinds.join(', ')}${v.note ? ` — ${redact(v.note)}` : ''}`);
    }
    if (fmt) parts.push(`FORMAT ${a.formatToday ? `today: ${redact(a.formatToday).replace(/"[^"]*"/g, '"…"')}` : 'today: ok'}; joined: ${a.formatFixed ? redact(a.formatFixed).replace(/"[^"]*"/g, '"…"') : 'ok'} → ${v.format === 'overruled' ? 'O' : 'C'}`);
    P.push(`- \`${a.sid} ${a.model} ${a.cap}\` (${cases[a.sid].memberLabel ?? '-'}, ${cases[a.sid].kind}): ${parts.join(' | ')}`);
  }
}
fs.writeFileSync(path.join(RESULTS, 'report-appendix.md'), P.join('\n') + '\n');
const hits = leakCheck(L.join('\n') + P.join('\n'));
console.log(`wrote results/report-tables.md and results/report-appendix.md; leak check: ${hits.length ? 'FAILED ' + hits.join('; ') : 'clean'}`);
