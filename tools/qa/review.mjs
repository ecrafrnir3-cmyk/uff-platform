// Lists every FACT issue and every FORMAT failure for the reviewer to read, to results/review-*.md.
//   node tools/qa/review.mjs fact [--site s]     each graded answer with issues: the reply, each issue, the quote check
//   node tools/qa/review.mjs format [--site s]   each FORMAT failure: today's reader and the joined text, stop reason, blocks
//   node tools/qa/review.mjs show <sid> [model] [cap]   the inputs and every saved answer for one case
// Verdicts go in results/verdicts.json (see summary.mjs for the shape).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAll } from './summary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(here, 'results');
const [what, ...rest] = process.argv.slice(2);
const opt = (k) => (rest.includes(`--${k}`) ? rest[rest.indexOf(`--${k}`) + 1] : null);
const { cases, answers, grades, verdicts } = loadAll();
const key = (r) => `${r.sid}|${r.model}|${r.cap}`;
const site = opt('site');
const list = answers.filter((a) => !site || a.site === site).sort((x, y) => (key(x) < key(y) ? -1 : 1));
const clip = (s, n) => (s.length > n ? s.slice(0, n) + ` […${s.length - n} more]` : s);

if (what === 'fact') {
  const L = [];
  let n = 0;
  for (const a of list) {
    const g = grades[key(a)];
    if (!g || !g.fact_issues.length) continue;
    n++;
    const v = verdicts[key(a)]?.fact || [];
    L.push(`### ${key(a)}  (${cases[a.sid].kind})`);
    L.push('```', clip(a.shownFixed, 1800), '```');
    g.fact_issues.forEach((i, k) => L.push(`${k}. [${i.kind}] "${i.claim}" | quote ${i.input_silent ? '(inputs silent)' : `"${clip(i.input_quote, 220)}"`}${i.quoteFound === false ? ' **(QUOTE NOT IN INPUTS)**' : ''} | ${i.why}${v[k] ? `  → ${v[k]}` : ''}`));
    L.push('');
  }
  fs.writeFileSync(path.join(RESULTS, `review-fact${site ? '-' + site : ''}.md`), L.join('\n'));
  console.log(`${n} answers with FACT issues -> results/review-fact${site ? '-' + site : ''}.md`);
} else if (what === 'format') {
  const L = [];
  let n = 0;
  for (const a of list) {
    if (!a.formatToday && !a.formatFixed) continue;
    n++;
    L.push(`- ${key(a)} | blocks ${a.types.join('+') || 'none'} | stop ${a.stop_reason} | out ${a.usage.output_tokens}/${a.max_tokens} | today: ${a.formatToday || 'ok'} | fixed: ${a.formatFixed || 'ok'} | shown today: ${JSON.stringify(clip(a.shownToday || '', 90))} | joined tail: ${JSON.stringify((a.shownFixed || '').slice(-70))}`);
  }
  fs.writeFileSync(path.join(RESULTS, `review-format${site ? '-' + site : ''}.md`), L.join('\n') + '\n');
  console.log(`${n} answers with a FORMAT failure -> results/review-format${site ? '-' + site : ''}.md`);
} else if (what === 'show') {
  const [sid, model, cap] = rest;
  const { assemble } = await import('./sites.mjs');
  const { loadFixture } = await import('./cases.mjs');
  const a0 = await assemble(loadFixture(), cases[sid]);
  console.log(`== ${sid} (${cases[sid].kind})\n${a0.keyText}\n`);
  for (const a of answers.filter((x) => x.sid === sid && (!model || x.model === model) && (!cap || x.cap === cap))) {
    console.log(`--- ${a.model} ${a.cap} (stop ${a.stop_reason}, out ${a.usage.output_tokens}, blocks ${a.types.join('+')})\n${a.shownFixed}\n`);
  }
} else {
  console.log('usage: node tools/qa/review.mjs fact|format|show ...');
}
