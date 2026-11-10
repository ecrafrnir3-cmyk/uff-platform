// Every FACT issue on one site, compactly, for the reviewer: per case the input lines the claims are
// about (optional), then per answer each issue with the grader's reason. No verdicts are decided here.
//   node tools/qa/review-site.mjs <site> [--inputs] [--from <sid>] [--to <sid>]
import { loadFixture } from './cases.mjs';
import { assemble } from './sites.mjs';
import { loadAll } from './summary.mjs';
import { groundTruthText } from './review-gt.mjs';

const [site, ...flags] = process.argv.slice(2);
const opt = (k) => (flags.includes(`--${k}`) ? flags[flags.indexOf(`--${k}`) + 1] : null);
const { cases, answers, grades } = loadAll();
const key = (r) => `${r.sid}|${r.model}|${r.cap}`;
const F = loadFixture();
const ids = [...new Set(answers.filter((a) => a.site === site).map((a) => a.sid))].sort()
  .filter((id) => (!opt('from') || id >= opt('from')) && (!opt('to') || id <= opt('to')));
for (const id of ids) {
  const list = answers.filter((a) => a.sid === id && grades[key(a)]?.fact_issues.length).sort((x, y) => (key(x) < key(y) ? -1 : 1));
  if (!list.length) continue;
  console.log(`== ${id} (${cases[id].kind})`);
  if (flags.includes('--inputs')) {
    const a0 = await assemble(F, cases[id]);
    const k = a0.keyText.includes('UFF COMPLETE RULEBOOK') ? a0.keyText.replace(/═{10,}\nUFF COMPLETE RULEBOOK[\s\S]*$/, '[rulebook omitted]') : a0.keyText;
    console.log(k.split('\n').filter((l) => l.trim() && !/^(Give|Evaluate|Write|Re-rank|Respond|Format|No intro|Then give|Any player|Is this player|- Points|- Recent|- Whether|- Faction|#\d|\.\.\.continue|Voice:|\d\. \*\*)/.test(l.trim())).map((l) => '  > ' + l).join('\n'));
    const gt = groundTruthText(cases[id]);
    if (gt) console.log(gt.split('\n').map((l) => '  GT ' + l).join('\n'));
  }
  for (const a of list) {
    const g = grades[key(a)];
    console.log(`-- ${a.model} ${a.cap}${a.stop_reason === 'max_tokens' ? ' (cut)' : ''}`);
    g.fact_issues.forEach((i, n) => console.log(`   ${n}. [${i.kind}] "${i.claim.slice(0, 200)}" || ${i.input_silent ? 'silent' : `q${i.quoteFound === false ? ' NOT FOUND' : ''}: "${i.input_quote.slice(0, 110)}"`} || ${i.why.slice(0, 220)}`));
  }
}
