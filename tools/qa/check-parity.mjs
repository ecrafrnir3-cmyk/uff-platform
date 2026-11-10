// Proves the harness sends exactly what each of the twelve call sites sends, and reads replies the
// way each one reads them. No network, no database, no real key: the routes run in-process with
// fake Supabase/Next.js modules over the same per-case snapshot the harness reads, and fetch is a
// recorder.
//
//   node tools/qa/check-parity.mjs              the refactored code in src/ (must pass)
//   node tools/qa/check-parity.mjs --all        also the ORIGINAL code at b01a33f (must pass) and two
//                                               deliberately altered copies per site (each must FAIL)
//   node tools/qa/check-parity.mjs --site oracle
//
// For each case: (1) the request body the handler would POST to /v1/messages is compared byte for byte
// with the harness's (JSON.stringify of both), with the headers; (2) for four reply shapes (text first;
// thinking first, then text; thinking only, cut off; text cut off) what the route returns or stores is
// compared with what the harness says it shows.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerLoader } from './loader/register.mjs';

registerLoader({ parity: true });
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const ORIGINAL_REF = 'b01a33f';
const FAKE_KEY = 'parity-check-fake-key-not-real';
for (const k of ['ANTHROPIC_API_KEY', 'QA_ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
Object.assign(process.env, { ANTHROPIC_API_KEY: FAKE_KEY, CRON_SECRET: 'parity-secret', NEXT_PUBLIC_SUPABASE_URL: 'https://parity.invalid', SUPABASE_SERVICE_ROLE_KEY: 'parity-fake-service-key' });

const { SITES, assemble, useCase } = await import('./sites.mjs');
const { loadFixture, loadCases } = await import('./cases.mjs');
const { QaRedirect } = await import('./fakes/next-navigation.mjs');
const F = loadFixture();
const ALL = loadCases();

// fetch: record Anthropic calls, answer Sleeper from the fixture, refuse anything else.
let upstream = null;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const S = globalThis.__QA__;
  if (u === 'https://api.anthropic.com/v1/messages') {
    S.anthropic.push({ url: u, opts });
    return { ok: true, status: 200, body: null, json: async () => upstream, text: async () => JSON.stringify(upstream) };
  }
  if (u.startsWith('https://api.sleeper.app/')) {
    S.sleeper.push(u);
    return { ok: true, status: 200, json: async () => S.sleeperData, text: async () => JSON.stringify(S.sleeperData) };
  }
  throw new Error(`parity: unexpected fetch ${u}`);
};

const SHAPES = [
  { name: 'text block first', data: { content: [{ type: 'text', text: 'The Oracle has spoken.\nVERDICT: FAIR' }], stop_reason: 'end_turn' } },
  { name: 'thinking first, then text', data: { content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'Start the healthy one.\nVERDICT: VETO — lopsided.' }], stop_reason: 'end_turn' } },
  { name: 'thinking only, cut off by max_tokens', data: { content: [{ type: 'thinking', thinking: '', signature: 'sig' }], stop_reason: 'max_tokens' } },
  { name: 'text cut off by max_tokens', data: { content: [{ type: 'text', text: 'The prophecy stops mid' }], stop_reason: 'max_tokens' } },
];

const fakeReq = (body, { query = '', auth = null } = {}) => ({
  json: async () => body,
  headers: { get: (k) => (k.toLowerCase() === 'authorization' ? auth : null) },
  nextUrl: { searchParams: new URLSearchParams(query) },
});
const fakeForm = (fields) => ({
  get: (k) => (Array.isArray(fields[k]) ? fields[k][0] : fields[k] ?? null),
  getAll: (k) => (Array.isArray(fields[k]) ? fields[k] : fields[k] != null ? [fields[k]] : []),
});

// Runs the handler of `mod` for case c; returns what it sent upstream and what it showed or stored.
async function runHandler(siteName, mod, c) {
  const S = useCase(F, c);
  let res = null, redirect = null;
  // The handlers log failures (with league names) to the console; keep them off the terminal.
  const saved = [console.log, console.error, console.warn];
  console.log = console.error = console.warn = () => {};
  try {
    if (siteName === 'trade-actions') await mod.proposeTrade(fakeForm(c.request));
    else if (siteName === 'newsletter') res = await mod.POST(fakeReq({}, { query: `week=${c.request.week}&noEmail=1`, auth: 'Bearer parity-secret' }));
    else res = await mod.POST(fakeReq(c.request));
  } catch (e) {
    if (e instanceof QaRedirect) redirect = e.redirectTo; else throw e;
  } finally {
    [console.log, console.error, console.warn] = saved;
  }
  const j = res?.jsonBody;
  let shown;
  switch (siteName) {
    case 'start-sit': case 'draft-advisor': case 'token-advisor': shown = j?.advice ?? ''; break;
    case 'oracle': shown = j?.recap ?? ''; break;
    case 'matchup-preview': shown = j?.preview ?? ''; break;
    case 'power-rankings': shown = j?.rankings ?? ''; break;
    case 'trade-eval': shown = j?.verdict ?? ''; break;
    case 'trade-veto': shown = j?.analysis ?? ''; break;
    case 'waiver-intel': shown = j?.intel ?? ''; break;
    case 'trade-actions': shown = S.templates.find((t) => t.name === 'tradeProposedHtml')?.args?.aiAnalysis ?? ''; break;
    case 'newsletter': shown = S.writes.find((w) => w.table === 'league_newsletters')?.v?.content ?? ''; break;
    default: shown = null;
  }
  return { S, res, redirect, shown, j };
}

// The ORIGINAL code (b01a33f) sent Haiku 4.5 at each site's own cap and read the first content block.
// Against it the harness request is compared with only those three things mapped back, so the check
// still proves every prompt byte unchanged after the model swap, and still catches an altered cap.
const ORIGINAL_MODEL = 'claude-haiku-4-5-20251001';
function asOriginal(siteName, body) {
  const { output_config, ...b } = body;
  return { ...b, model: ORIGINAL_MODEL, max_tokens: SITES[siteName].cap };
}
function originalShown(siteName, data) {
  const t = data.content?.[0]?.text;
  if (siteName === 'waiver-intel') return t?.trim() ?? '';
  return t ?? '';
}

async function checkTarget(label, mods, sites, { stopAtFirst = false, original = false } = {}) {
  const fails = [];
  let compared = 0;
  for (const siteName of sites) {
    const mod = mods[siteName];
    const cases = ALL.filter((c) => c.site === siteName);
    for (const c of cases) {
      upstream = SHAPES[0].data;
      const mine = await assemble(F, c);
      if (original && mine.body) mine.body = asOriginal(siteName, mine.body);
      const ran = await runHandler(siteName, mod, c);
      const calls = ran.S.anthropic;
      if (mine.refused) {
        if (calls.length) fails.push(`${c.id}: harness refuses (${mine.refused}) but the handler called the model`); else compared++;
        continue;
      }
      if (calls.length !== 1) { fails.push(`${c.id}: handler made ${calls.length} model calls (status ${ran.res?.status}, ${JSON.stringify(ran.j ?? ran.redirect)?.slice(0, 120)})`); if (stopAtFirst) break; continue; }
      const { opts } = calls[0];
      const want = JSON.stringify(mine.body);
      const hdr = opts.headers || {};
      if (JSON.stringify(hdr) !== JSON.stringify({ 'x-api-key': FAKE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' })) fails.push(`${c.id}: headers differ: ${Object.keys(hdr).join(', ')}`);
      if (opts.method !== 'POST') fails.push(`${c.id}: method ${opts.method}`);
      if (opts.body !== want) {
        let at = 0; while (at < want.length && want[at] === opts.body[at]) at++;
        fails.push(`${c.id}: request differs at character ${at}: harness …${JSON.stringify(want.slice(Math.max(0, at - 40), at + 40))} vs handler …${JSON.stringify(String(opts.body).slice(Math.max(0, at - 40), at + 40))}`);
        if (stopAtFirst) break;
      } else compared++;
    }
    if (stopAtFirst && fails.length) continue;
    // Reply reading, on the site's first case (chat forwards the stream; its reader is the page).
    if (siteName === 'chat') continue;
    const c = cases[0];
    for (const shape of SHAPES) {
      upstream = shape.data;
      const ran = await runHandler(siteName, mod, c);
      const harness = (original ? originalShown(siteName, shape.data) : SITES[siteName].shown(shape.data)) || '';
      const stored = siteName === 'newsletter' ? (SITES.newsletter.format(harness, null, shape.data) ? '' : harness) : harness;
      if ((ran.shown || '') !== stored) fails.push(`${siteName} reply "${shape.name}": route shows ${JSON.stringify(ran.shown)}, harness says ${JSON.stringify(stored)}`);
      else compared++;
      if (siteName === 'trade-veto' && ran.j && ran.j.verdict !== (stored ? (await import('./sites.mjs')).BUILDERS.trades.tradeVetoVerdict(stored) : undefined)) {
        if (stored) fails.push(`trade-veto reply "${shape.name}": verdict ${ran.j.verdict} differs from the harness's`);
      }
    }
  }
  const ok = fails.length === 0;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${compared} comparisons matched, ${fails.length} mismatches.`);
  for (const f of fails.slice(0, 4)) console.log(`       ${f}`);
  if (fails.length > 4) console.log(`       ... and ${fails.length - 4} more`);
  return ok;
}

const SITE_NAMES = Object.keys(SITES);
let n = 0;
const importFile = async (file) => import(pathToFileURL(file).href + `?parity=${++n}`);
async function modsFrom(rootDir, sites) {
  const out = {};
  for (const s of sites) out[s] = await importFile(path.join(rootDir, SITES[s].file));
  return out;
}

// Two altered copies per site, made from the ORIGINAL file: each must make the check fail.
const MUTANTS = {
  'start-sit': [['max_tokens: 300,', 'max_tokens: 301,'], ['Under 150 words', 'Under 160 words']],
  // (.limit(60) -> .limit(59) on the transaction query is NOT caught, correctly: only the newest 10
  // events reach the prompt, so the 60th row never shows. The recent-matchups cap does.)
  chat: [['max_tokens: 400,', 'max_tokens: 401,'], ['.slice(0, 6)', '.slice(0, 5)']],
  oracle: [['max_tokens: 200,', 'max_tokens: 201,'], ['stay under 120 words', 'stay under 130 words']],
  'matchup-preview': [['max_tokens: 200,', 'max_tokens: 201,'], ['callerToken?.token_id === 9', 'callerToken?.token_id === 8']],
  'power-rankings': [['max_tokens: 600,', 'max_tokens: 601,'], ['allWeeks.slice(0, 3)', 'allWeeks.slice(0, 2)']],
  'draft-advisor': [['max_tokens: 200,', 'max_tokens: 201,'], ['.slice(0, 30);', '.slice(0, 29);']],
  'token-advisor': [['max_tokens: 200,', 'max_tokens: 201,'], ['in 3-4 sentences', 'in 3-5 sentences']],
  'trade-eval': [['max_tokens: 250,', 'max_tokens: 251,'], ['in 3-4 sentences', 'in 2-4 sentences']],
  'trade-veto': [['max_tokens: 250,', 'max_tokens: 251,'], ['Be direct and fair.', 'Be direct.']],
  'trade-actions': [['max_tokens: 200,', 'max_tokens: 201,'], ['2-3 sentence analysis only.', '2-4 sentence analysis only.']],
  'waiver-intel': [['max_tokens: 120,', 'max_tokens: 121,'], ['.join(" | ") || "empty roster"', '.join(", ") || "empty roster"']],
  newsletter: [['max_tokens: 1200,', 'max_tokens: 1201,'], ['.slice(0, Math.min(standings.length, 8))', '.slice(0, Math.min(standings.length, 9))']],
};

const argv = process.argv.slice(2);
const only = argv.includes('--site') ? [argv[argv.indexOf('--site') + 1]] : SITE_NAMES;
let good = await checkTarget(`refactored code in src/ (${only.length} sites)`, await modsFrom(ROOT, only), only);

if (argv.includes('--all')) {
  const tmp = path.join(here, '.parity-tmp');
  fs.rmSync(tmp, { recursive: true, force: true });
  const origRoot = path.join(tmp, 'orig');
  for (const s of only) {
    const f = path.join(origRoot, SITES[s].file);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, execFileSync('git', ['show', `${ORIGINAL_REF}:${SITES[s].file}`], { cwd: ROOT }));
  }
  good = (await checkTarget(`original code at ${ORIGINAL_REF}`, await modsFrom(origRoot, only), only, { original: true })) && good;
  for (const s of only) {
    const src = fs.readFileSync(path.join(origRoot, SITES[s].file), 'utf8');
    for (const [i, [from, to]] of MUTANTS[s].entries()) {
      if (!src.includes(from)) { console.log(`MUTANT SETUP FAILED: ${s} #${i + 1}: "${from}" not in the original`); good = false; continue; }
      const f = path.join(tmp, `mutant-${s}-${i + 1}`, SITES[s].file);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, src.replace(from, to));
      const passed = await checkTarget(`altered copy of the original ${s} #${i + 1}: ${JSON.stringify(from)} -> ${JSON.stringify(to)} (must FAIL)`, { [s]: await importFile(f) }, [s], { stopAtFirst: true, original: true });
      if (passed) { console.log('       ^ this altered copy was NOT detected'); good = false; }
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(good ? '\nPARITY PROVEN: the harness matches the refactored and the original handlers on every case, and every altered copy was caught.' : '\nPARITY NOT PROVEN (see above).');
}
process.exit(good ? 0 : 1);
