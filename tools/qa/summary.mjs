// Tables from the saved rows: results/summary.md and results/summary.json. No key, no network.
//   node tools/qa/summary.mjs            (or: node tools/qa/eval.mjs summary)
// Applies results/verdicts.json, the reviewer's verdict on every FACT issue and FORMAT failure:
//   { "<sid>|<model>|<cap>": { "fact": [ "confirmed" | "overruled", ... one per grader issue ],
//                              "factNote": "...", "format": "confirmed" | "overruled", "formatNote": "..." } }
// An answer passes FACT after review when none of its issues is confirmed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases } from './cases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = process.env.QA_RESULTS_DIR ? path.resolve(process.env.QA_RESULTS_DIR) : path.join(here, 'results');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const latest = (rows, key) => { const m = new Map(); for (const r of rows) m.set(key(r), r); return [...m.values()]; };
const key = (r) => `${r.sid}|${r.model}|${r.cap}`;
const MODEL_LABEL = { haiku45: 'Haiku 4.5 (today)', haiku55: 'Haiku 5.5', sonnet55: 'Sonnet 5.5' };
const MODELS = ['haiku45', 'haiku55', 'sonnet55'];
const CAPS = ['today', 'raised'];

export function loadAll() {
  const cases = Object.fromEntries(loadCases().map((c) => [c.id, c]));
  const answers = latest(jsonl(path.join(RESULTS, 'answers.jsonl')), key);
  const grades = Object.fromEntries(latest(jsonl(path.join(RESULTS, 'grades.jsonl')), key).map((g) => [key(g), g]));
  const vf = path.join(RESULTS, 'verdicts.json');
  const verdicts = fs.existsSync(vf) ? JSON.parse(fs.readFileSync(vf, 'utf8')) : {};
  return { cases, answers, grades, verdicts };
}

// The reviewed state of one answer.
export function judge(a, grades, verdicts) {
  const g = grades[key(a)];
  const v = verdicts[key(a)] || {};
  const issues = g ? g.fact_issues : null;
  const decided = issues ? issues.map((iss, i) => ({ ...iss, kind: v.factKinds?.[i] ?? iss.kind, verdict: v.fact?.[i] ?? 'unreviewed' })) : null;
  const kept = decided ? decided.filter((d) => d.verdict !== 'overruled') : null;
  const formatToday = a.formatToday && v.formatToday !== 'overruled' ? a.formatToday : null;
  const formatFixed = a.formatFixed && v.format !== 'overruled' ? a.formatFixed : null;
  return {
    graded: !!g,
    factPass: kept ? kept.length === 0 : null,
    factRaw: issues ? issues.length === 0 : null,
    bye: kept ? kept.filter((d) => d.kind === 'bye').length : 0,
    nonBye: kept ? kept.filter((d) => d.kind !== 'bye').length : 0,
    unreviewed: decided ? decided.filter((d) => d.verdict === 'unreviewed').length : 0,
    voicePass: g ? (v.voice ? v.voice === 'pass' : g.voice.pass) : null,
    formatTodayPass: !formatToday,
    formatFixedPass: !formatFixed,
    shownToday: !!a.shownToday && a.stop_reason !== 'max_tokens',
  };
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
const frac = (n, d) => (d ? `${n}/${d}` : '-');
const quant = (xs, q) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };

export function tables() {
  const { cases, answers, grades, verdicts } = loadAll();
  const sites = [...new Set(Object.values(cases).map((c) => c.site))];
  const cells = {};
  for (const a of answers) {
    const j = judge(a, grades, verdicts);
    const k = `${a.site}|${a.model}|${a.cap}`;
    (cells[k] ??= []).push({ a, j });
  }
  const stat = (list) => {
    const n = list.length;
    const graded = list.filter((x) => x.j.graded);
    return {
      n,
      shownToday: list.filter((x) => x.j.shownToday).length,
      formatToday: list.filter((x) => x.j.formatTodayPass).length,
      formatFixed: list.filter((x) => x.j.formatFixedPass).length,
      cut: list.filter((x) => x.a.stop_reason === 'max_tokens').length,
      thinkingFirst: list.filter((x) => x.a.types?.[0] === 'thinking').length,
      graded: graded.length,
      factPass: graded.filter((x) => x.j.factPass).length,
      factRawPass: graded.filter((x) => x.j.factRaw).length,
      byeAnswers: graded.filter((x) => x.j.bye > 0).length,
      nonByeAnswers: graded.filter((x) => x.j.nonBye > 0).length,
      unreviewed: graded.reduce((s, x) => s + x.j.unreviewed, 0),
      voicePass: graded.filter((x) => x.j.voicePass).length,
      lengthPass: list.filter((x) => x.a.lengthPass).length,
      markdown: list.filter((x) => x.a.markdown).length,
      outP50: quant(list.map((x) => x.a.usage.output_tokens), 0.5),
      outMax: Math.max(0, ...list.map((x) => x.a.usage.output_tokens)),
      inAvg: list.length ? list.reduce((s, x) => s + x.a.usage.input_tokens, 0) / list.length : 0,
      costPerCall: list.length ? list.reduce((s, x) => s + x.a.cost, 0) / list.length : 0,
    };
  };
  const out = { sites: {}, overall: {} };
  for (const s of sites) for (const m of MODELS) for (const c of CAPS) { const l = cells[`${s}|${m}|${c}`]; if (l) (out.sites[s] ??= {})[`${m}|${c}`] = stat(l); }
  for (const m of MODELS) for (const c of CAPS) { const l = Object.entries(cells).filter(([k]) => k.endsWith(`|${m}|${c}`)).flatMap(([, v]) => v); if (l.length) out.overall[`${m}|${c}`] = stat(l); }
  return out;
}

function render(T) {
  const L = [];
  const head = '| model | cap | n | shown today | FORMAT today | FORMAT fixed | FACT (reviewed) | answers with a bye miss | other FACT fails | VOICE | LENGTH | cut off | out tok p50 / max | $ per call |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const row = (m, c, s) => `| ${MODEL_LABEL[m]} | ${c} | ${s.n} | ${frac(s.shownToday, s.n)} | ${pct(s.formatToday, s.n)} | ${pct(s.formatFixed, s.n)} | ${pct(s.factPass, s.graded)}${s.unreviewed ? ` (${s.unreviewed} unreviewed)` : ''} | ${s.byeAnswers} | ${s.nonByeAnswers} | ${pct(s.voicePass, s.graded)} | ${pct(s.lengthPass, s.n)} | ${s.cut} | ${s.outP50} / ${s.outMax} | $${s.costPerCall.toFixed(5)} |`;
  L.push('## All sites together\n', head, sep);
  for (const [k, s] of Object.entries(T.overall)) { const [m, c] = k.split('|'); L.push(row(m, c, s)); }
  for (const [site, byKey] of Object.entries(T.sites)) {
    L.push(`\n## ${site}\n`, head, sep);
    for (const [k, s] of Object.entries(byKey)) { const [m, c] = k.split('|'); L.push(row(m, c, s)); }
  }
  return L.join('\n');
}

if (process.argv[1] && (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) || process.argv[2] === 'summary')) {
  const T = tables();
  fs.writeFileSync(path.join(RESULTS, 'summary.json'), JSON.stringify(T, null, 1));
  const md = `# UFF model evaluation: summary (generated ${new Date().toISOString()})\n\n"shown today" = the route's current reader (first content block) shows a reply that was not cut off. FORMAT today = parses as the route and page expect with today's reader; FORMAT fixed = the same with every text block joined. FACT is after the reviewer's verdicts (results/verdicts.json).\n\n${render(T)}\n`;
  fs.writeFileSync(path.join(RESULTS, 'summary.md'), md);
  console.log(md);
}
