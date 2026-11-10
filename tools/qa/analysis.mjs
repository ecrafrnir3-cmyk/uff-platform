// Numbers for the report, from the saved rows (no key, no network): measured output lengths and the
// cap each site needs, latency, grader agreement with the Opus cross-check and with the reviewer, and
// cost per call per site per model. Writes results/analysis.json and prints a summary.
//   node tools/qa/analysis.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAll, judge } from './summary.mjs';
import { SITES } from './sites.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(here, 'results');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const key = (r) => `${r.sid}|${r.model}|${r.cap}`;
const q = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const { answers, grades, verdicts } = loadAll();
const MODELS = ['haiku45', 'haiku55', 'sonnet55'];
const out = { caps: {}, latency: {}, cost: {}, crosscheck: {} };

// Output lengths at the measuring cap (8,000): the model is not told max_tokens, so an answer that ends
// below a cap is the answer that cap would give. Proposed cap = twice the longest measured reply
// (thinking included), rounded up to 100, never below today's cap: cost is per token used, so the
// headroom costs nothing unless a reply needs it, and a cut reply is the failure being fixed.
for (const site of Object.keys(SITES)) {
  for (const m of MODELS) {
    const rows = answers.filter((a) => a.site === site && a.model === m && a.cap === 'raised');
    const outs = rows.map((a) => a.usage.output_tokens);
    const max = Math.max(0, ...outs);
    (out.caps[site] ??= { today: SITES[site].cap })[m] = { n: rows.length, p50: q(outs, 0.5), p95: q(outs, 0.95), max, proposed: Math.max(SITES[site].cap, Math.ceil((max * 2) / 100) * 100) };
    const ms = rows.map((a) => a.ms);
    (out.latency[site] ??= {})[m] = { p50: q(ms, 0.5), p95: q(ms, 0.95) };
    const today = answers.filter((a) => a.site === site && a.model === m && a.cap === 'today');
    (out.cost[site] ??= {})[m] = {
      today: today.reduce((s, a) => s + a.cost, 0) / (today.length || 1),
      raised: rows.reduce((s, a) => s + a.cost, 0) / (rows.length || 1),
      inTok: rows.reduce((s, a) => s + a.usage.input_tokens, 0) / (rows.length || 1),
    };
  }
}

// Opus 5.5 cross-check: the same rubric on a fixed 30-answer sample.
const cross = jsonl(path.join(RESULTS, 'crosscheck.jsonl'));
const agree = { n: 0, factSame: 0, voiceSame: 0, opusVsReviewer: 0, sonnetVsReviewer: 0, rows: [] };
for (const c of cross) {
  const g = grades[key(c)];
  const a = answers.find((x) => key(x) === key(c));
  if (!g || !a) continue;
  const j = judge(a, grades, verdicts);
  const sonnetFail = g.fact_issues.length > 0, opusFail = c.fact_issues.length > 0, reviewerFail = j.factPass === false;
  agree.n++;
  if (sonnetFail === opusFail) agree.factSame++;
  if (g.voice.pass === c.voice.pass) agree.voiceSame++;
  if (opusFail === reviewerFail) agree.opusVsReviewer++;
  if (sonnetFail === reviewerFail) agree.sonnetVsReviewer++;
  agree.rows.push({ key: key(c), sonnet: g.fact_issues.map((i) => i.kind), opus: c.fact_issues.map((i) => i.kind), reviewer: reviewerFail ? 'fail' : 'pass', sonnetVoice: g.voice.pass, opusVoice: c.voice.pass });
}
out.crosscheck = agree;

// Reviewer vs grader across every graded answer: how often the grader's FACT call stood.
let issues = 0, confirmed = 0, answersFlagged = 0, answersKept = 0;
for (const a of answers) {
  const g = grades[key(a)];
  if (!g || !g.fact_issues.length) continue;
  answersFlagged++;
  const v = verdicts[key(a)]?.fact || [];
  issues += g.fact_issues.length;
  confirmed += v.filter((x) => x === 'confirmed').length;
  if (v.some((x) => x === 'confirmed')) answersKept++;
}
out.review = { issues, confirmed, answersFlagged, answersKept };

// Monthly cost. Real call volume is NOT measured (Vercel's Hobby plan keeps one hour of logs; the
// rate_limits table keeps only each user's last window and prunes itself). So this prices a stated
// scenario: every one of 14 managers uses each weekly advisor about once a week. Calls per week:
const PER_WEEK = { 'start-sit': 14, chat: 42, oracle: 7, 'matchup-preview': 14, 'power-rankings': 14, 'draft-advisor': 0, 'token-advisor': 5, 'trade-eval': 2, 'trade-veto': 1, 'trade-actions': 1, 'waiver-intel': 28, newsletter: 1 };
const RECOMMENDED = { 'power-rankings': 'sonnet55', newsletter: 'sonnet55' }; // everything else: haiku55
const month = (perCall) => perCall * 52 / 12;
let today = 0, proposed = 0, allHaiku55 = 0, allSonnet = 0;
const perSite = {};
for (const [site, n] of Object.entries(PER_WEEK)) {
  const c = out.cost[site];
  const rec = RECOMMENDED[site] || 'haiku55';
  perSite[site] = { perWeek: n, today: month(n * c.haiku45.today), proposed: month(n * c[rec].raised), model: rec };
  today += perSite[site].today; proposed += perSite[site].proposed;
  allHaiku55 += month(n * c.haiku55.raised); allSonnet += month(n * c.sonnet55.raised);
}
out.monthly = { scenario: PER_WEEK, perSite, today, proposed, allHaiku55, allSonnet };
fs.writeFileSync(path.join(RESULTS, 'analysis.json'), JSON.stringify(out, null, 1));
console.log(`Monthly (scenario, not measured): today $${today.toFixed(2)}; proposed mix $${proposed.toFixed(2)}; all Haiku 5.5 $${allHaiku55.toFixed(2)}; all Sonnet 5.5 $${allSonnet.toFixed(2)}`);

console.log('Caps (output tokens at the 8,000 measuring cap: p50 / p95 / max -> proposed):');
for (const [site, c] of Object.entries(out.caps)) console.log(`  ${site.padEnd(16)} today ${String(c.today).padStart(5)} | ` + MODELS.map((m) => `${m} ${c[m].p50}/${c[m].p95}/${c[m].max} -> ${c[m].proposed}`).join(' | '));
console.log('Latency ms at the raised cap (p50 / p95):');
for (const [site, l] of Object.entries(out.latency)) console.log(`  ${site.padEnd(16)} ` + MODELS.map((m) => `${m} ${l[m].p50}/${l[m].p95}`).join(' | '));
console.log(`Cross-check (${agree.n} answers): FACT pass/fail Sonnet=Opus ${agree.factSame}/${agree.n}; VOICE ${agree.voiceSame}/${agree.n}; Opus=reviewer ${agree.opusVsReviewer}/${agree.n}; Sonnet=reviewer ${agree.sonnetVsReviewer}/${agree.n}`);
console.log(`Review: ${issues} grader FACT issues on ${answersFlagged} answers; ${confirmed} confirmed; ${answersKept} answers still fail after review.`);
