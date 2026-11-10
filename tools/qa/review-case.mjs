// One case at a time, for the reviewer: the inputs the model saw, the ground truth the grader saw,
// then every graded answer's FACT issues (and, with --text, the answer itself).
//   node tools/qa/review-case.mjs <sid> [--text] [--no-inputs]
import { loadFixture } from './cases.mjs';
import { assemble } from './sites.mjs';
import { loadAll } from './summary.mjs';
import { groundTruthText } from './review-gt.mjs';

const [sid, ...flags] = process.argv.slice(2);
const { cases, answers, grades } = loadAll();
const c = cases[sid];
const a0 = await assemble(loadFixture(), c);
if (!flags.includes('--no-inputs')) {
  const k = a0.keyText.includes('UFF COMPLETE RULEBOOK') ? a0.keyText.replace(/═{10,}\nUFF COMPLETE RULEBOOK[\s\S]*$/, '[rulebook omitted]') + '\nUSER TURNS:\n' + c.request.messages.map((m) => `${m.role}: ${m.content}`).join('\n') : a0.keyText;
  console.log(`== ${sid} (${c.kind})\n${k}\n`);
  const gt = groundTruthText(c);
  if (gt) console.log(`GROUND TRUTH:\n${gt}\n`);
}
const key = (r) => `${r.sid}|${r.model}|${r.cap}`;
for (const a of answers.filter((x) => x.sid === sid).sort((x, y) => (key(x) < key(y) ? -1 : 1))) {
  const g = grades[key(a)];
  if (!g) continue;
  const head = `-- ${a.model} ${a.cap} | stop ${a.stop_reason} | ${g.fact_issues.length} issue(s) | voice ${g.voice.pass ? 'pass' : 'FAIL: ' + g.voice.note}`;
  if (!g.fact_issues.length && !flags.includes('--text')) { console.log(head); continue; }
  console.log(head);
  if (flags.includes('--text')) console.log(a.shownFixed.split('\n').map((l) => '   | ' + l).join('\n'));
  g.fact_issues.forEach((i, n) => console.log(`   ${n}. [${i.kind}] "${i.claim}" || ${i.input_silent ? 'inputs silent' : `quote${i.quoteFound === false ? ' NOT FOUND' : ''}: "${i.input_quote.slice(0, 160)}"`} || ${i.why}`));
}
