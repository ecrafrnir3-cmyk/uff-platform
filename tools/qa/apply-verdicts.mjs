// Turns the reviewer's verdict notes into results/verdicts.json (read by summary.mjs).
//   node tools/qa/apply-verdicts.mjs results/verdicts-spec.txt
// One line per reviewed answer:
//   <sid>|<model>|<cap>  fact=C,O,C  format=C  voice=pass  # free note
// fact: one letter per grader issue in order (C = confirmed, O = overruled); format: C or O for its FORMAT
// failure; voice: pass or fail to overrule the grader's VOICE call. Lines starting with # are comments.
// A line "RULE format <regex>  C|O  # note" sets the format verdict for every FORMAT failure whose
// reason (today's or fixed) matches, unless that answer has its own line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAll } from './summary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = process.argv[2] || path.join(here, 'results', 'verdicts-spec.txt');
const { answers, grades } = loadAll();
const key = (r) => `${r.sid}|${r.model}|${r.cap}`;
const out = {};
const rules = [];
let lines = 0, problems = 0;
for (const raw of fs.readFileSync(spec, 'utf8').split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const [body, note = ''] = line.split(/\s+#\s*/);
  if (body.startsWith('RULE ')) {
    const m = body.match(/^RULE format (.+?)\s+([CO])$/);
    if (!m) { console.log(`bad rule: ${line}`); problems++; continue; }
    rules.push({ re: new RegExp(m[1]), v: m[2] === 'C' ? 'confirmed' : 'overruled', note });
    continue;
  }
  const [k, ...fields] = body.split(/\s+/);
  const v = { note };
  for (const f of fields) {
    const [name, val] = f.split('=');
    // C = confirmed, O = overruled, C~<kind> = confirmed under a corrected kind (the grader filed it wrongly)
    if (name === 'fact') {
      const parts = val.split(',');
      v.fact = parts.map((x) => (x === 'C' || x.startsWith('C~') ? 'confirmed' : x === 'O' ? 'overruled' : 'unreviewed'));
      if (parts.some((x) => x.startsWith('C~'))) v.factKinds = parts.map((x) => (x.startsWith('C~') ? x.slice(2) : null));
    }
    if (name === 'format') { v.format = val === 'C' ? 'confirmed' : 'overruled'; v.formatToday = v.format; }
    if (name === 'voice') v.voice = val;
  }
  const g = grades[k];
  if (v.fact && (!g || g.fact_issues.length !== v.fact.length)) { console.log(`${k}: ${v.fact.length} fact verdicts for ${g ? g.fact_issues.length : 'no'} grader issues`); problems++; }
  out[k] = v;
  lines++;
}
// Rules for FORMAT failures without their own line.
for (const a of answers) {
  if (!a.formatToday && !a.formatFixed) continue;
  const k = key(a);
  if (out[k]?.format) continue;
  const r = rules.find((x) => x.re.test(a.formatToday || '') || x.re.test(a.formatFixed || ''));
  if (r) { out[k] = { ...(out[k] || {}), format: r.v, formatToday: r.v, formatNote: r.note }; }
}
// Every FACT issue and FORMAT failure must have a verdict.
let missingFact = 0, missingFormat = 0;
for (const a of answers) {
  const k = key(a);
  const g = grades[k];
  if (g && g.fact_issues.length && !out[k]?.fact) missingFact++;
  if ((a.formatToday || a.formatFixed) && !out[k]?.format) missingFormat++;
}
fs.writeFileSync(path.join(here, 'results', 'verdicts.json'), JSON.stringify(out, null, 1));
console.log(`${lines} answer lines, ${rules.length} format rules -> results/verdicts.json. Problems: ${problems}. Still without a verdict: ${missingFact} answers with FACT issues, ${missingFormat} FORMAT failures.`);
