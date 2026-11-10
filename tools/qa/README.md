# tools/qa: the AI call-site evaluation

Measures what UFF's twelve Anthropic call sites say, on the production prompts and requests, across
three models (Claude Haiku 4.5, today; Claude Haiku 5.5; Claude Sonnet 5.5), at today's `max_tokens`
caps and at a raised cap, with a second model grading every answer and a person reviewing every FACT
and FORMAT failure. First run 2026-11-10; the report is `docs/model-eval-2026-11-10.md`.

Nothing here deploys, calls a route, a cron, the Story Engine or Finalize, or writes to the database.
The fixture capture is read-only (HTTP GET to PostgREST only). The repository is public: everything read
from the database lives in `fixtures/` and everything produced from it in `results/`, both gitignored.

| file | what it is |
|---|---|
| `capture-fixtures.mjs` | reads, once, the rows the call sites read (weeks 1-8, all final) and Sleeper's projections, into `fixtures/db.json` |
| `cases.mjs` | the case set as rules (no names); resolves them into `fixtures/cases.json` (130 cases) and builds each case's database snapshot |
| `sites.mjs` | per site: the same query chains the route runs (over the snapshot, through `fakes/supabase.mjs`), then the route's own builder from `src/lib/ai-prompts/`; the route's reader; the format, length and voice rules |
| `check-parity.mjs` | proves the harness sends byte for byte what each handler sends and reads replies the way it does (see below) |
| `eval.mjs` | `estimate`, `ping`, `run`, `selftest`, `grade`, `crosscheck`, `summary`, `ledger` |
| `summary.mjs`, `review.mjs` | tables (applying `results/verdicts.json`), and the lists of every FACT issue and FORMAT failure to review |
| `loader/` | Node hooks: compile the app's TypeScript with the project's `typescript`, resolve `@/`, and in parity mode swap in `fakes/` |
| `fakes/` | in-memory stand-ins for Next.js, Supabase, the rate limiter, email, notifications and the clock (parity check only) |
| `env.mjs` | reads one named variable from a `.env.local` without printing it |

## Run it

Node 22+ and the project's dev dependencies (`typescript`). Keys: `QA_ANTHROPIC_API_KEY` (the `uff-qa`
Console key) and, for the capture only, `SUPABASE_SERVICE_ROLE_KEY`, each in a `.env.local` (this
worktree's or the main checkout's; `env.mjs` looks in both). No key value is ever printed.

```bash
node tools/qa/capture-fixtures.mjs          # read-only; once
node tools/qa/cases.mjs                     # resolve the case rules
node tools/qa/check-parity.mjs --all        # no key, no network
node tools/qa/eval.mjs estimate             # free (count_tokens)
node tools/qa/eval.mjs run --cap today --models haiku55 --sites start-sit   # smoke test
node tools/qa/eval.mjs run --cap today
node tools/qa/eval.mjs run --cap raised
node tools/qa/eval.mjs selftest
node tools/qa/eval.mjs grade
node tools/qa/eval.mjs crosscheck
node tools/qa/review.mjs fact ; node tools/qa/review.mjs format
node tools/qa/summary.mjs
```

`--budget USD` stops a command when the job's running total (summed from the cost on every saved row)
reaches it; nothing goes past $15. Runs resume: finished (case, model, cap) rows are skipped unless
`--redo`.

## What parity proves

The twelve call sites build their prompts inline, so on 2026-11-10 each prompt, request literal and reply
reader was moved verbatim into `src/lib/ai-prompts/` and the handler now calls it (no behaviour change).
`check-parity.mjs` runs every handler in-process against each case's snapshot, with fake Supabase and
Next.js modules and `fetch` replaced by a recorder, and compares the body it would POST to
`/v1/messages` with the harness's, byte for byte, plus the headers; then, for four reply shapes, what the
route returns or stores with what the harness says it shows. `--all` does the same against the original
files at `b01a33f` (model, cap and effort mapped back to Haiku 4.5 and each site's original cap, so the
prompts are compared exactly even after the swap) and requires two altered copies of each original to fail.

## What a grade means

- **FACT** (grader, then a person): a claim the inputs contradict, a specific fact not in the inputs
  (player, stat, score, result, injury, schedule), wrong arithmetic, or **bye**: recommending a player
  who scores 0 that week (team on bye, or no NFL team) without saying so. The grader is given the true
  bye list as ground truth the model never saw. Every issue quotes the input line; the harness checks the
  quote is really there. Verdicts: `results/verdicts.json`.
- **FORMAT** (measured): does the reply parse the way the route and page expect (non-empty; not cut off;
  power rankings' `#N.` lines; the draft room's `PICK:` line; the trade tools' `VERDICT:` line; the
  newsletter's store-or-refuse rule), once with today's reader (first content block) and once with every
  text block joined.
- **VOICE** (grader): the register the site's own prompt asks for.
- **LENGTH** (measured): within the words the prompt asks for.

The grader is `claude-sonnet-5-5` (effort low, structured output), shown each case's inputs and up to six
answers under shuffled letters; `crosscheck` has `claude-opus-5-5` (effort medium) re-grade a fixed
30-answer sample; `selftest` checks the grader on planted answers first.
