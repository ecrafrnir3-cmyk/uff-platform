# UFF's twelve AI call sites on three models: evaluation and proposed swap (2026-11-10)

**Status: a draft pull request for REVEILLE. Nothing is deployed, nothing merged, nothing written to the database.**
Merge only after Week 9 is FINAL (the Wednesday 2026-11-11 finalize cron) and REVEILLE has checked the pull request
against live (section 9). The evaluation is the earlier commits of the branch; the swap itself (models, caps, effort,
reply reading) is the last commit alone, so it can be taken or dropped on its own.

This repository is public. Nothing below names a member, a team or a player, or quotes a score: teams appear as
T01-T14 (member-id order), players as [player], decimal scores as N. The case set, fixtures and raw results stay in the
gitignored `tools/qa/fixtures/` and `tools/qa/results/`.

## 1. The answer in brief

- **A swap that changes only the model string breaks nearly every site.** At today's `max_tokens` caps, the page shows
  a usable reply on 116 of 130 cases with Haiku 4.5 (today), but on **25 of 130 with Haiku 5.5** and **29 of 130 with
  Sonnet 5.5**. Two causes, as the two earlier evaluations found: thinking counts against `max_tokens` (Haiku 5.5 spent
  all 300 start-sit tokens thinking on 15 of 15 cases), and eleven sites read only `content[0].text`, which is the empty
  thinking block on a 5.x reply. Even with room to finish, today's reader shows nothing on **85 of 130** Haiku 5.5
  replies.
- **With the fix (read every text block, raise each cap to what was measured, `output_config: {effort: "low"}`, no
  sampling parameters):**

  | at the 8,000-token measuring cap, all 130 cases | FACT pass, after review | FORMAT pass | VOICE | LENGTH | $ per call |
  |---|---|---|---|---|---|
  | Haiku 4.5 (today) | 49% | 93% | 47% | 95% | $0.00201 |
  | **Haiku 5.5** | **83%** | 100% | **94%** | 88% | **$0.00046** |
  | Sonnet 5.5 | 76% | 100% | 67% | 48% | $0.00619 |

  Haiku 5.5 is the most accurate and best-voiced model on ten of the twelve sites at under a quarter of today's cost
  per call. Sonnet 5.5 is clearly better on the two long, number-heavy write-ups (power rankings: 6 of 8 pass against
  1 of 8; newsletter: 7 of 8 against 4 of 8), and it brings in more stale outside knowledge and runs long on the
  short advisors.
- **Recommendation:** Haiku 5.5 on ten sites, Sonnet 5.5 for power rankings and the newsletter, effort `low`
  everywhere, every text block read, caps set at twice the longest reply measured (section 7). The pull request's last
  commit does exactly this.
- **What the swap does not fix (section 6):** the BYE blindness of five advisors (#107), start-sit's empty projections,
  the draft advisor's Jacksonville bug, and several prompt defects. It does fix two live defects of today's model:
  Power Rankings is cut off on 8 of 8 calls at its 600-token cap (the card shows 8 to 13 of 14 teams), and the Trade
  Evaluator's verdict is wrapped in markdown on 17 of 18 calls, so the page never colours it.
- **The swap as shipped was run on all 130 cases** (each route's request exactly as the last commit builds it, read
  with the new reader): **130 of 130 replies shown and parsed, none cut off**, the longest using 54% of its cap.
- **Spend: $4.93** of the $15 credit cap (answers $2.07, grading $2.14, Opus cross-check $0.40, the as-built check of
  the swap $0.26, grader self-test $0.05).

## 2. What was measured, and how

**Sites.** All twelve places that call the Messages API with `claude-haiku-4-5-20251001`: `/api/start-sit`, `/api/chat`
(streamed), `/api/oracle`, `/api/matchup-preview`, `/api/power-rankings`, `/api/draft-advisor`, `/api/token-advisor`,
`/api/trade-eval`, `/api/trade-veto-analysis`, `/api/waiver-intel`, the Oracle analysis inside `proposeTrade`
(`dashboard/league/[id]/trade-actions.ts`, it goes into the trade-offer email) and the weekly newsletter cron
(`/api/cron/generate-newsletter`, which emails the league; it was never called).

**Real requests, proven.** Each site's prompt, request literal and reply reader were moved verbatim into
`src/lib/ai-prompts/` and the handler now calls them (no behaviour change; `tsc --noEmit` clean, lint clean on every
touched file). The harness (`tools/qa/sites.mjs`) runs the route's own query chains over a per-case snapshot of the
database and calls the same builders. `tools/qa/check-parity.mjs --all` runs every real handler in-process (fake
Supabase and Next.js modules over the same snapshot, `fetch` replaced by a recorder) and compares the body it would
POST with the harness's, byte for byte, plus four reply shapes: **174 comparisons, 0 mismatches against the refactored
code and 0 against the original files at `b01a33f`; all 24 deliberately altered copies (two per site) are caught.**

**Inputs.** Real data from final weeks only, read once with HTTP GET (SELECT) into the gitignored fixture: weeks 1-8 of
matchups, tokens, lineups, rosters (reconstructed as they stood at each week's kickoff), the schedule, players and the
draft. 130 cases: start-sit 15 (Week 8 teams with starters who score 0, clean lineups, Weeks 6-7, no lineup set, an
unloaded schedule), chat 18 (standings, records, rules, arithmetic, questions the data cannot answer, two multi-turn),
oracle 12 (all of Week 8, Week 7's closest, widest and token games, a tie), matchup preview 10 (Week 8 pre-game, a
viewer outside the matchup, a Recon holder), power rankings 8 (after each of Weeks 1-8), draft advisor 10 (states
replayed from the real draft), token advisor 12 (real tokens of Weeks 6-8), trade evaluator, veto analyzer and the
trade email 9 each (the league has made no trades, so nine proposals were built from real rosters: lopsided, fair,
2-for-1, 3-for-1, kicker for kicker, QB for QB, an injured-reserve player, TE for TE, a player with no NFL team),
waiver intel 10 (best free agent, a free agent on bye, injured, a no-team player, an empty roster), newsletter 8
(Weeks 1-8). Synthetic cases change one thing in a real snapshot and say so.

**Models.** `claude-haiku-4-5-20251001` as sent today; `claude-haiku-5-5` and `claude-sonnet-5-5` with
`output_config: {effort: "low"}` and no `temperature`, `top_p` or `top_k` (the routes send none). Each site's own body,
with only the model, `max_tokens` and effort changed, was sent at the site's own cap and at 8,000. The model is not
told `max_tokens`, so a reply that ends below 8,000 is the reply any cap above its length would give; the proposed caps
are derived from those lengths. 780 answers, 0 errors.

**Grading.** `claude-sonnet-5-5` (effort low, structured output) graded each case's answers together under shuffled
letters, with the case's full prompt as the key and, for the five advisors that speak about "this week", the true bye
list and the manager's zero-scoring players as ground truth the model never saw. FACT: a claim the inputs contradict,
a specific fact not in the inputs (player, stat, result, injury, schedule, depth chart), wrong arithmetic, or
recommending a player who scores 0 that week without saying so (`bye`). VOICE: the register the site's own prompt asks
for. FORMAT and LENGTH were measured by the harness, not the grader. The grader passed 4 of 4 planted answers first.
**I read all 878 FACT issues the grader raised (on 491 answers) and every FORMAT failure and recorded a verdict on
each: 306 issues confirmed, 572 overruled; 215 answers still fail.** The tables use the reviewed verdicts. Overruled
issues were mostly widely known player judgments, rhetorical estimates, Oracle drama, and claims the grader got wrong
(for example a correct "Jacksonville is in the AFC"; section 6). An Opus 5.5 cross-check (effort medium) re-graded a
fixed 30-answer sample: it agreed with my reviewed verdict on 24 of 30, the Sonnet grader on 15 of 30, and the two
graders with each other on 19 of 30 (VOICE 23 of 30). The raw grader overstates failures; the review is the number.

**Prices** (platform.claude.com pricing page, read 2026-11-10; USD per million tokens, input / output): Haiku 4.5
$1 / $5; Haiku 5.5 $0.10 / $0.50 for prompts up to 100,000 tokens; Sonnet 5.5 $2 / $10; Opus 5.5 $4 / $20. Every cost
here is computed from each reply's `usage`. The 5.x tokenizer counts the same prompts as about 36% more tokens
(138K against 101K for one pass of the 130 cases), which the per-call costs include.

## 3. What breaks a swap, site by site

| site | how the reply is read today | what parses it | cap | page shows a reply at today's cap (4.5 / Haiku 5.5 / Sonnet 5.5) | today's reader at 8,000 (Haiku 5.5 / Sonnet 5.5) |
|---|---|---|---|---|---|
| start-sit | `content?.[0]?.text` | nothing (plain text) | 300 | 12/15 · 0/15 · 0/15 | 0/15 · 15/15 |
| chat | SSE stream forwarded; the page appends every `delta.text` | nothing | 400 | 16/18 · 14/18 · 12/18 | 18/18 · 18/18 |
| oracle | `content?.[0]?.text`, then **saved to `uff_matchups.oracle_recap` for good** | nothing | 200 | 12/12 · 8/12 · 1/12 | 11/12 · 12/12 |
| matchup-preview | `content?.[0]?.text` | nothing | 200 | 9/10 · 3/10 · 0/10 | 10/10 · 10/10 |
| power-rankings | `content?.[0]?.text` | the card keeps lines matching `^#(\d+)\.` and splits at the first dash | 600 | 0/8 · 0/8 · 0/8 (every reply cut off) | 1/8 · 8/8 |
| draft-advisor | `content?.[0]?.text` | the room highlights `PICK:\s*(.+)` | 200 | 10/10 · 0/10 · 7/10 | 0/10 · 10/10 |
| token-advisor | `content?.[0]?.text` | nothing | 200 | 12/12 · 0/12 · 0/12 | 0/12 · 12/12 |
| trade-eval | `content?.[0]?.text` | the page colours the line that `startsWith("VERDICT:")` | 250 | 9/9 · 0/9 · 0/9 | 0/9 · 9/9 |
| trade-veto | `content?.[0]?.text` | the route extracts `/VERDICT:\s*(APPROVE\|VETO)/i` | 250 | 9/9 · 0/9 · 1/9 | 1/9 · 9/9 |
| trade-actions (email) | `content?.[0]?.text ?? undefined` | nothing (escaped into the email) | 200 | 9/9 · 0/9 · 0/9 | 0/9 · 9/9 |
| waiver-intel | `content?.[0]?.text?.trim()` | nothing | 120 | 10/10 · 0/10 · 2/10 | 4/10 · 10/10 |
| newsletter | `content?.[0]?.text`, then refuses to store a reply cut off by `max_tokens` or not ending a sentence | the cron's store-or-refuse rule | 1200 | 8/8 · 0/8 · 6/8 stored | 0/8 · 7/8 |

What a broken reply looks like to a manager: "No advice returned", "Oracle returned no vision", "Oracle returned no
guidance", "No intel returned", a room with no PICK, a trade email with no analysis, a newsletter the cron refuses (and
retries next run). The oracle is the worst case: a recap cut off mid-sentence is **stored permanently** and shown to
both managers. No route parses JSON, so a JSON break is not a risk here; the parsed formats are the `#N.` lines, the
`PICK:` line and the two `VERDICT:` forms, and with every text block read Haiku 5.5 and Sonnet 5.5 pass all of them.

## 4. Per-site results

FACT is after review (passes / graded); FORMAT is shown with today's reader and with every text block joined; VOICE is
the grader's; LENGTH is the words the site's prompt asks for; cost is per call from `usage`. At today's caps FACT and
VOICE count only the answers that had any text to grade (a reply that was only a thinking block has none), so read
them next to the "shown" and "cut off" columns: a 100% there can rest on very few answers.

### At each site's own cap (today's max_tokens)

| site | model | n | shown by today's reader | FORMAT, today's reader | FORMAT, text blocks joined | FACT pass (reviewed) | VOICE | LENGTH | cut off | $ per call |
|---|---|---|---|---|---|---|---|---|---|---|
| **all sites** | Haiku 4.5 (today) | 130 | 116/130 | 83% | 83% | 57% (74/130) | 53% | 93% | 14 | $0.00188 |
| **all sites** | Haiku 5.5 | 130 | 25/130 | 19% | 19% | 90% (54/60) | 75% | 42% | 105 | $0.00026 |
| **all sites** | Sonnet 5.5 | 130 | 29/130 | 22% | 22% | 74% (96/130) | 58% | 82% | 101 | $0.00513 |
| start-sit | Haiku 4.5 (today) | 15 | 12/15 | 80% | 80% | 33% (5/15) | 33% | 93% | 3 | $0.00200 |
| start-sit | Haiku 5.5 | 15 | 0/15 | 0% | 0% | n/a (0/0) | n/a | 0% | 15 | $0.00024 |
| start-sit | Sonnet 5.5 | 15 | 0/15 | 0% | 0% | 67% (10/15) | 87% | 100% | 15 | $0.00474 |
| chat | Haiku 4.5 (today) | 18 | 16/18 | 89% | 89% | 78% (14/18) | 78% | 94% | 2 | $0.00377 |
| chat | Haiku 5.5 | 18 | 14/18 | 78% | 78% | 100% (17/17) | 82% | 83% | 4 | $0.00052 |
| chat | Sonnet 5.5 | 18 | 12/18 | 67% | 67% | 72% (13/18) | 89% | 89% | 6 | $0.01115 |
| oracle | Haiku 4.5 (today) | 12 | 12/12 | 100% | 100% | 50% (6/12) | 67% | 100% | 0 | $0.00110 |
| oracle | Haiku 5.5 | 12 | 8/12 | 67% | 67% | 100% (11/11) | 100% | 92% | 4 | $0.00013 |
| oracle | Sonnet 5.5 | 12 | 1/12 | 8% | 8% | 100% (12/12) | 92% | 100% | 11 | $0.00261 |
| matchup-preview | Haiku 4.5 (today) | 10 | 9/10 | 90% | 90% | 80% (8/10) | 0% | 100% | 1 | $0.00113 |
| matchup-preview | Haiku 5.5 | 10 | 3/10 | 30% | 30% | 100% (10/10) | 90% | 100% | 7 | $0.00013 |
| matchup-preview | Sonnet 5.5 | 10 | 0/10 | 0% | 0% | 90% (9/10) | 90% | 100% | 10 | $0.00254 |
| power-rankings | Haiku 4.5 (today) | 8 | 0/8 | 0% | 0% | 38% (3/8) | 13% | 100% | 8 | $0.00403 |
| power-rankings | Haiku 5.5 | 8 | 0/8 | 0% | 0% | 100% (2/2) | 50% | 25% | 8 | $0.00042 |
| power-rankings | Sonnet 5.5 | 8 | 0/8 | 0% | 0% | 38% (3/8) | 25% | 100% | 8 | $0.00846 |
| draft-advisor | Haiku 4.5 (today) | 10 | 10/10 | 100% | 100% | 70% (7/10) | 100% | 100% | 0 | $0.00135 |
| draft-advisor | Haiku 5.5 | 10 | 0/10 | 0% | 0% | 100% (3/3) | 0% | 30% | 10 | $0.00021 |
| draft-advisor | Sonnet 5.5 | 10 | 7/10 | 70% | 70% | 90% (9/10) | 30% | 30% | 3 | $0.00418 |
| token-advisor | Haiku 4.5 (today) | 12 | 12/12 | 100% | 100% | 67% (8/12) | 58% | 92% | 0 | $0.00105 |
| token-advisor | Haiku 5.5 | 12 | 0/12 | 0% | 0% | n/a (0/0) | n/a | 0% | 12 | $0.00014 |
| token-advisor | Sonnet 5.5 | 12 | 0/12 | 0% | 0% | 83% (10/12) | 58% | 83% | 12 | $0.00289 |
| trade-eval | Haiku 4.5 (today) | 9 | 9/9 | 11% | 11% | 44% (4/9) | 33% | 56% | 0 | $0.00120 |
| trade-eval | Haiku 5.5 | 9 | 0/9 | 0% | 0% | n/a (0/0) | n/a | 0% | 9 | $0.00015 |
| trade-eval | Sonnet 5.5 | 9 | 0/9 | 0% | 0% | 56% (5/9) | 11% | 100% | 9 | $0.00307 |
| trade-veto | Haiku 4.5 (today) | 9 | 9/9 | 100% | 100% | 33% (3/9) | 100% | 100% | 0 | $0.00083 |
| trade-veto | Haiku 5.5 | 9 | 0/9 | 0% | 0% | 75% (3/4) | 75% | 22% | 9 | $0.00015 |
| trade-veto | Sonnet 5.5 | 9 | 1/9 | 11% | 11% | 67% (6/9) | 22% | 11% | 8 | $0.00296 |
| trade-actions | Haiku 4.5 (today) | 9 | 9/9 | 100% | 100% | 44% (4/9) | 22% | 100% | 0 | $0.00065 |
| trade-actions | Haiku 5.5 | 9 | 0/9 | 0% | 0% | 100% (1/1) | 0% | 11% | 9 | $0.00012 |
| trade-actions | Sonnet 5.5 | 9 | 0/9 | 0% | 0% | 56% (5/9) | 0% | 100% | 9 | $0.00239 |
| waiver-intel | Haiku 4.5 (today) | 10 | 10/10 | 100% | 100% | 80% (8/10) | 100% | 100% | 0 | $0.00043 |
| waiver-intel | Haiku 5.5 | 10 | 0/10 | 0% | 0% | 100% (4/4) | 25% | 20% | 10 | $0.00008 |
| waiver-intel | Sonnet 5.5 | 10 | 2/10 | 20% | 20% | 70% (7/10) | 50% | 50% | 8 | $0.00169 |
| newsletter | Haiku 4.5 (today) | 8 | 8/8 | 100% | 100% | 50% (4/8) | 0% | 75% | 0 | $0.00449 |
| newsletter | Haiku 5.5 | 8 | 0/8 | 0% | 0% | 38% (3/8) | 75% | 100% | 8 | $0.00073 |
| newsletter | Sonnet 5.5 | 8 | 6/8 | 75% | 75% | 88% (7/8) | 88% | 100% | 2 | $0.01261 |

### At the 8,000-token measuring cap

| site | model | n | shown by today's reader | FORMAT, today's reader | FORMAT, text blocks joined | FACT pass (reviewed) | VOICE | LENGTH | cut off | $ per call |
|---|---|---|---|---|---|---|---|---|---|---|
| **all sites** | Haiku 4.5 (today) | 130 | 130/130 | 93% | 93% | 49% (64/130) | 47% | 95% | 0 | $0.00201 |
| **all sites** | Haiku 5.5 | 130 | 45/130 | 35% | 100% | 83% (108/130) | 94% | 88% | 0 | $0.00046 |
| **all sites** | Sonnet 5.5 | 130 | 129/130 | 99% | 100% | 76% (99/130) | 67% | 48% | 0 | $0.00619 |
| start-sit | Haiku 4.5 (today) | 15 | 15/15 | 100% | 100% | 40% (6/15) | 40% | 93% | 0 | $0.00202 |
| start-sit | Haiku 5.5 | 15 | 0/15 | 0% | 100% | 87% (13/15) | 93% | 73% | 0 | $0.00073 |
| start-sit | Sonnet 5.5 | 15 | 15/15 | 100% | 100% | 60% (9/15) | 73% | 7% | 0 | $0.00604 |
| chat | Haiku 4.5 (today) | 18 | 18/18 | 100% | 100% | 61% (11/18) | 83% | 94% | 0 | $0.00383 |
| chat | Haiku 5.5 | 18 | 18/18 | 100% | 100% | 78% (14/18) | 100% | 83% | 0 | $0.00055 |
| chat | Sonnet 5.5 | 18 | 18/18 | 100% | 100% | 72% (13/18) | 83% | 61% | 0 | $0.01212 |
| oracle | Haiku 4.5 (today) | 12 | 12/12 | 100% | 100% | 58% (7/12) | 17% | 100% | 0 | $0.00108 |
| oracle | Haiku 5.5 | 12 | 11/12 | 92% | 100% | 100% (12/12) | 100% | 100% | 0 | $0.00014 |
| oracle | Sonnet 5.5 | 12 | 12/12 | 100% | 100% | 100% (12/12) | 92% | 92% | 0 | $0.00273 |
| matchup-preview | Haiku 4.5 (today) | 10 | 10/10 | 100% | 100% | 80% (8/10) | 0% | 90% | 0 | $0.00115 |
| matchup-preview | Haiku 5.5 | 10 | 10/10 | 100% | 100% | 100% (10/10) | 100% | 90% | 0 | $0.00014 |
| matchup-preview | Sonnet 5.5 | 10 | 10/10 | 100% | 100% | 100% (10/10) | 100% | 90% | 0 | $0.00296 |
| power-rankings | Haiku 4.5 (today) | 8 | 8/8 | 100% | 100% | 0% (0/8) | 50% | 100% | 0 | $0.00594 |
| power-rankings | Haiku 5.5 | 8 | 1/8 | 13% | 100% | 13% (1/8) | 50% | 88% | 0 | $0.00127 |
| power-rankings | Sonnet 5.5 | 8 | 8/8 | 100% | 100% | 75% (6/8) | 100% | 100% | 0 | $0.01505 |
| draft-advisor | Haiku 4.5 (today) | 10 | 10/10 | 100% | 100% | 60% (6/10) | 100% | 100% | 0 | $0.00133 |
| draft-advisor | Haiku 5.5 | 10 | 0/10 | 0% | 100% | 90% (9/10) | 100% | 100% | 0 | $0.00031 |
| draft-advisor | Sonnet 5.5 | 10 | 10/10 | 100% | 100% | 90% (9/10) | 70% | 60% | 0 | $0.00411 |
| token-advisor | Haiku 4.5 (today) | 12 | 12/12 | 100% | 100% | 58% (7/12) | 50% | 92% | 0 | $0.00105 |
| token-advisor | Haiku 5.5 | 12 | 0/12 | 0% | 100% | 83% (10/12) | 100% | 92% | 0 | $0.00035 |
| token-advisor | Sonnet 5.5 | 12 | 12/12 | 100% | 100% | 58% (7/12) | 33% | 0% | 0 | $0.00451 |
| trade-eval | Haiku 4.5 (today) | 9 | 9/9 | 0% | 0% | 11% (1/9) | 11% | 78% | 0 | $0.00113 |
| trade-eval | Haiku 5.5 | 9 | 0/9 | 0% | 100% | 89% (8/9) | 100% | 100% | 0 | $0.00041 |
| trade-eval | Sonnet 5.5 | 9 | 9/9 | 100% | 100% | 67% (6/9) | 44% | 11% | 0 | $0.00432 |
| trade-veto | Haiku 4.5 (today) | 9 | 9/9 | 100% | 100% | 44% (4/9) | 67% | 100% | 0 | $0.00087 |
| trade-veto | Haiku 5.5 | 9 | 1/9 | 11% | 100% | 100% (9/9) | 89% | 56% | 0 | $0.00034 |
| trade-veto | Sonnet 5.5 | 9 | 9/9 | 100% | 100% | 89% (8/9) | 33% | 11% | 0 | $0.00355 |
| trade-actions | Haiku 4.5 (today) | 9 | 9/9 | 100% | 100% | 44% (4/9) | 11% | 100% | 0 | $0.00072 |
| trade-actions | Haiku 5.5 | 9 | 0/9 | 0% | 100% | 100% (9/9) | 89% | 100% | 0 | $0.00030 |
| trade-actions | Sonnet 5.5 | 9 | 9/9 | 100% | 100% | 56% (5/9) | 22% | 67% | 0 | $0.00276 |
| waiver-intel | Haiku 4.5 (today) | 10 | 10/10 | 100% | 100% | 80% (8/10) | 100% | 100% | 0 | $0.00043 |
| waiver-intel | Haiku 5.5 | 10 | 4/10 | 40% | 100% | 90% (9/10) | 90% | 80% | 0 | $0.00015 |
| waiver-intel | Sonnet 5.5 | 10 | 10/10 | 100% | 100% | 70% (7/10) | 40% | 10% | 0 | $0.00197 |
| newsletter | Haiku 4.5 (today) | 8 | 8/8 | 100% | 100% | 25% (2/8) | 0% | 88% | 0 | $0.00452 |
| newsletter | Haiku 5.5 | 8 | 0/8 | 0% | 100% | 50% (4/8) | 100% | 100% | 0 | $0.00090 |
| newsletter | Sonnet 5.5 | 8 | 7/8 | 88% | 100% | 88% (7/8) | 100% | 100% | 0 | $0.01280 |

### Output length and the cap each site needs

Output tokens (thinking included) at the 8,000-token measuring cap: median / 95th percentile / longest, and the proposed cap (twice the longest reply, rounded up to 100, never below today's).

| site | today's cap | Haiku 4.5 | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|---|---|
| start-sit | 300 | 275 / 326 / 326 → 700 | 1246 / 1831 / 1831 → 3700 | 427 / 471 / 471 → 1000 |
| chat | 400 | 117 / 587 / 587 → 1200 | 203 / 923 / 923 → 1900 | 312 / 900 / 900 → 1800 |
| oracle | 200 | 172 / 192 / 192 → 400 | 204 / 468 / 468 → 1000 | 206 / 283 / 283 → 600 |
| matchup-preview | 200 | 186 / 230 / 230 → 500 | 225 / 264 / 264 → 600 | 242 / 260 / 260 → 600 |
| power-rankings | 600 | 940 / 1099 / 1099 → 2200 | 2392 / 2973 / 2973 → 6000 | 1251 / 1412 / 1412 → 2900 |
| draft-advisor | 200 | 98 / 115 / 115 → 300 | 330 / 524 / 524 → 1100 | 182 / 239 / 239 → 500 |
| token-advisor | 200 | 148 / 184 / 184 → 400 | 618 / 734 / 734 → 1500 | 351 / 481 / 481 → 1000 |
| trade-eval | 250 | 191 / 241 / 241 → 500 | 679 / 1110 / 1110 → 2300 | 328 / 562 / 562 → 1200 |
| trade-veto | 250 | 145 / 165 / 165 → 400 | 604 / 949 / 949 → 1900 | 321 / 385 / 385 → 800 |
| trade-actions | 200 | 121 / 137 / 137 → 300 | 580 / 689 / 689 → 1400 | 221 / 317 / 317 → 700 |
| waiver-intel | 120 | 52 / 73 / 73 → 200 | 230 / 450 / 450 → 900 | 142 / 186 / 186 → 400 |
| newsletter | 1200 | 718 / 767 / 767 → 1600 | 1528 / 1735 / 1735 → 3500 | 946 / 1488 / 1488 → 3000 |

### Latency (milliseconds, at the measuring cap: median / 95th percentile)

| site | Haiku 4.5 | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|---|
| start-sit | 3511 / 4219 | 6304 / 8913 | 4007 / 4588 |
| chat | 1951 / 6136 | 1673 / 4534 | 3230 / 8418 |
| oracle | 2499 / 3043 | 1759 / 3043 | 2728 / 3273 |
| matchup-preview | 2783 / 3142 | 2086 / 2361 | 3458 / 4135 |
| power-rankings | 11347 / 12593 | 11261 / 14691 | 10986 / 12894 |
| draft-advisor | 1651 / 2116 | 2356 / 3924 | 2094 / 2885 |
| token-advisor | 2324 / 2916 | 4005 / 4883 | 3922 / 5417 |
| trade-eval | 2887 / 3439 | 4454 / 6370 | 3867 / 6235 |
| trade-veto | 2276 / 2682 | 3587 / 5888 | 3381 / 4888 |
| trade-actions | 1921 / 2161 | 3221 / 4802 | 2742 / 4029 |
| waiver-intel | 1115 / 1303 | 2047 / 3206 | 1961 / 2893 |
| newsletter | 8613 / 9159 | 7794 / 9035 | 8985 / 12322 |

### Cost per call (USD, from each reply's `usage` at the 2026-11-10 list prices)

| site | Haiku 4.5, today's cap | Haiku 5.5, measuring cap | Sonnet 5.5, measuring cap | avg input tokens (4.5 / 5.5 tokenizer) |
|---|---|---|---|---|
| start-sit | $0.00200 | $0.00073 | $0.00604 | 659 / 872 |
| chat | $0.00377 | $0.00055 | $0.01212 | 2936 / 4007 |
| oracle | $0.00110 | $0.00014 | $0.00273 | 206 / 309 |
| matchup-preview | $0.00113 | $0.00014 | $0.00296 | 189 / 273 |
| power-rankings | $0.00403 | $0.00127 | $0.01505 | 1029 / 1232 |
| draft-advisor | $0.00135 | $0.00031 | $0.00411 | 834 / 1147 |
| token-advisor | $0.00105 | $0.00035 | $0.00451 | 309 / 445 |
| trade-eval | $0.00120 | $0.00041 | $0.00432 | 191 / 286 |
| trade-veto | $0.00083 | $0.00034 | $0.00355 | 176 / 253 |
| trade-actions | $0.00065 | $0.00030 | $0.00276 | 125 / 197 |
| waiver-intel | $0.00043 | $0.00015 | $0.00197 | 164 / 246 |
| newsletter | $0.00449 | $0.00090 | $0.01280 | 964 / 1309 |

## 5. What the failures were (summary of section 10)

- **Haiku 4.5 (today)** fails mostly on reading its own inputs: ranks and PF comparisons stated wrong in power rankings
  (0 of 8 pass) and chat; trade direction reversed (who sends whom) in a third of the trade answers; points called
  "power tokens"; the token bonus **added a second time** on top of scores that already include it (oracle and
  newsletter: "N (+18 bonus)" becomes N + 18); a 6-1 team called undefeated; slot errors in start-sit (a running back
  for the kicker slot, a defense for the kicker slot, a receiver at tight end); markdown on 100 of 130 replies,
  including 8 of 8 newsletters whose prompt says "no markdown" (the pages render plain text, so the asterisks show).
- **Haiku 5.5** fails least: a handful of misread rankings (7 of 8 power-rankings answers have at least one), invented
  game flow in newsletters ("a late charge", "a furious comeback", a "record" week that was not one), and two leanings
  on a zero-scoring player.
- **Sonnet 5.5** reads the inputs well but brings in outside knowledge that is out of date for this season (teammates
  who have moved, players called rookies in their second year, a free-agent kicker "on the Raiders"), invents
  matchups, and runs long: 48% of its replies fit the length their prompt asks for (start-sit 1 of 15, token advisor
  0 of 12).
- **Bye misses** (answers that lean on a player who scores 0 that week without saying so): Haiku 4.5 6, Haiku 5.5 2,
  Sonnet 5.5 5 at the measuring cap. Most come from prompts that carry no bye information (section 6, item 4).

## 6. Found on the way: defects a model change does not fix

None of these is fixed in this branch (run the game, don't rebuild the engine); each is a candidate follow-up.

1. **Power Rankings is truncated in production today.** Haiku 4.5 at 600 tokens is cut off on 8 of 8 calls; the card
   parses 13, 8, 10, 9, 9, 9, 8 and 8 of 14 teams. The swap's cap (2,900 on Sonnet 5.5) fixes it.
2. **The Trade Evaluator never colours Haiku 4.5's verdict.** It writes `**VERDICT: …**` on 17 of 18 replies;
   `TradeEvaluator.tsx` looks for a line that `startsWith("VERDICT:")`, so the verdict shows uncoloured, with asterisks,
   inside the body. Haiku 5.5 and Sonnet 5.5 wrote it plainly every time; stripping `*` before the match would make the
   page robust anyway.
3. **Start-sit has no projections at all.** It fetches Sleeper's `/v1/projections/nfl/{season}/{week}`, which answers
   200 with 7,630 players and no stats (checked for weeks 6, 7 and 8; the same trap Session 39 found and fixed for the
   lineup page). All 216 player lines in the 15 prompts read "(no projection available)", so "flag a bench player
   projecting higher than the starter" can never fire. The populated `player_projections` table is not used here.
4. **BYE blindness (#107) is unchanged** in token-advisor, waiver-intel, chat and matchup-preview: their prompts carry
   no bye data, so no model can know. Confirmed misses include Iron Will advised on a Jaguars player in the Jaguars' bye
   week and "your WR1 will carry the workload" in his team's bye week. The fix is the shared bye derivation #107 asks
   for, in `src/lib/`.
5. **The draft advisor marks every Jaguars player NFC.** Its AFC table spells Jacksonville `JAC`; the data uses `JAX`
   (26 players). Each Jaguar is shown as NFC and as a faction match for Villains, the opposite of the truth. Players
   with no NFL team (retired names that carry an ADP) also sit at the top of the late-round "available" list; no model
   picked one in this test.
6. **The oracle names a winner on a tie.** `aWins = a.points > b.points`, so a tie prints "Winner: [second team]" with
   "Margin: 0.00".
7. **The chat's "recent matchups" shows six of a week's seven games** (`.slice(0, 6)`), so "who scored most this week"
   can be answered from an incomplete list. Its rulebook also says the faction bonus counts "starting players", while
   the engine counts the whole active roster (Session 40).
8. **The token advisor invites "hold it"** although weekly tokens are use-it-or-lose-it (hero-villain-system §6), and
   its prompt carries no week number; models told managers to "save it for Week 8-9".
9. **The trade email's prompt has names only** (no positions, no NFL teams), so "a WR, a defense" reads as one player
   on one team.
10. **"N pts (+X token bonus)" is ambiguous**: Haiku 4.5 read it as additive in the oracle and the newsletter. Writing
    "(includes +X from tokens)" would remove the trap; the 5.x models did not fall into it.

## 7. Recommendation, per site and overall

| site | model | cap (today → proposed) | effort | reply reading | evidence at the measuring cap (FACT reviewed · VOICE · $ per call) |
|---|---|---|---|---|---|
| start-sit | Haiku 5.5 | 300 → 3,700 | low | join text blocks | 13/15 · 14/15 · $0.00073 (4.5: 6/15 · 6/15 · $0.00202) |
| chat | Haiku 5.5 | 400 → 1,900 | low | unchanged (the page already joins every text delta) | 14/18 · 18/18 · $0.00055 (4.5: 11/18 · 15/18 · $0.00383) |
| oracle | Haiku 5.5 | 200 → 1,000 | low | join text blocks (mandatory: recaps are stored for good) | 12/12 · 12/12 · $0.00014 (4.5: 7/12 · 2/12) |
| matchup-preview | Haiku 5.5 | 200 → 600 | low | join text blocks | 10/10 · 10/10 · $0.00014 (4.5: 8/10 · 0/10) |
| power-rankings | **Sonnet 5.5** | 600 → 2,900 | low | join text blocks | 6/8 · 8/8 · $0.01505 (Haiku 5.5 1/8; 4.5 0/8 and cut off today) |
| draft-advisor | Haiku 5.5 | 200 → 1,100 | low | join text blocks | 9/10 · 10/10 · $0.00031 (4.5: 6/10) |
| token-advisor | Haiku 5.5 | 200 → 1,500 | low | join text blocks | 10/12 · 12/12 · $0.00035 (4.5: 7/12; Sonnet 7/12) |
| trade-eval | Haiku 5.5 | 250 → 2,300 | low | join text blocks | 8/9 · 9/9 · $0.00041 (4.5: 1/9, verdict uncoloured 9/9) |
| trade-veto | Haiku 5.5 | 250 → 1,900 | low | join text blocks | 9/9 · 8/9 · $0.00034 (4.5: 4/9) |
| trade-actions | Haiku 5.5 | 200 → 1,400 | low | join text blocks | 9/9 · 8/9 · $0.00030 (4.5: 4/9) |
| waiver-intel | Haiku 5.5 | 120 → 900 | low | join text blocks, then trim | 9/10 · 9/10 · $0.00015 (4.5: 8/10) |
| newsletter | **Sonnet 5.5** | 1,200 → 3,000 | low | join text blocks; the store-or-refuse rule unchanged | 7/8 · 8/8 · $0.01280 (Haiku 5.5 4/8; 4.5 2/8) |

Caps are twice the longest reply measured at 8,000 (thinking included), rounded up to 100. Cost is per token used, so
the headroom costs nothing unless a reply needs it, and a cut reply is the failure being fixed. Haiku 5.5 thinks a lot
even at effort low on start-sit (median 1,246 output tokens, longest 1,831), which makes it the slowest start-sit model
(median 6.3 s against 3.5 s today); it is faster than or level with today's model on chat, oracle, preview and the
newsletter. If start-sit's latency matters more than its accuracy, Sonnet 5.5 answers in 4.0 s but passes 9 of 15.
Haiku 5.5 with thinking disabled was not measured and is not recommended here.

**Overall:** one shared reader that joins every `text` block, Haiku 5.5 as the default model, Sonnet 5.5 for the two
long write-ups, effort `low`, the caps above. **Cost:** real call volume is unmeasured (Vercel's Hobby plan keeps one
hour of runtime logs; `rate_limits` keeps only each user's last window and prunes itself). What the database does show
since 2026-09-26: start-sit used by at least 2 managers, matchup preview by 3, waiver intel by 4; no rows at all for
chat, power rankings, the token advisor, the draft advisor or the trade tools; 0 oracle recaps ever stored; 0 trades
ever proposed; one newsletter a week. Priced on a generous stated scenario (every manager uses each weekly advisor
about once a week: 42 chat messages, 28 waiver checks, 14 each of start-sit, previews and power rankings, 7 recaps,
5 token checks, 4 trade calls and 1 newsletter a week), a month costs **$1.26 today, $1.16 with the recommended mix,
$0.27 all on Haiku 5.5 and $4.20 all on Sonnet 5.5**. Power rankings dominates the mix at 14 calls a week; at one call
a week the mix is about $0.31. Either way the change is about quality and working pages, not money.

## 8. The swap (the last commit of the pull request)

- `src/lib/ai-prompts/anthropic.ts` (new): the two model ids, `OUTPUT_LOW = {effort: "low"}`, and `replyText()`,
  which joins every `text` block.
- Each builder in `src/lib/ai-prompts/`: its model, its cap from the table above, `output_config: OUTPUT_LOW`; each
  reader through `replyText()` (waiver intel keeps its `.trim()`, the trade email its `?? undefined`, the newsletter its
  store-or-refuse rule; chat's stream needs no reader change).
- No route, query, prompt text or page changes. `node tools/qa/check-parity.mjs --all` still passes on the swap commit:
  the routes send exactly what the harness builds, and against `b01a33f` every prompt byte is unchanged once the model,
  the cap and the effort are mapped back (the four reply shapes are checked against the original first-block reader).
  `tsc --noEmit` and eslint are clean on it.
- **As-built check** (`node tools/qa/eval.mjs run --cap built`, all 130 cases, each request exactly as the swapped
  builders make it, read by the swapped readers):

  | site | model | cap | shown and parsed | cut off | longest reply (tokens) | $ per call |
  |---|---|---|---|---|---|---|
  | start-sit | Haiku 5.5 | 3,700 | 15/15 | 0 | 1,407 | $0.00065 |
  | chat | Haiku 5.5 | 1,900 | 18/18 | 0 | 918 | $0.00055 |
  | oracle | Haiku 5.5 | 1,000 | 12/12 | 0 | 462 | $0.00014 |
  | matchup-preview | Haiku 5.5 | 600 | 10/10 | 0 | 263 | $0.00014 |
  | power-rankings | Sonnet 5.5 | 2,900 | 8/8 | 0 | 1,287 | $0.01460 |
  | draft-advisor | Haiku 5.5 | 1,100 | 10/10 | 0 | 469 | $0.00030 |
  | token-advisor | Haiku 5.5 | 1,500 | 12/12 | 0 | 806 | $0.00034 |
  | trade-eval | Haiku 5.5 | 2,300 | 9/9 | 0 | 1,129 | $0.00043 |
  | trade-veto | Haiku 5.5 | 1,900 | 9/9 | 0 | 892 | $0.00028 |
  | trade-actions | Haiku 5.5 | 1,400 | 9/9 | 0 | 733 | $0.00029 |
  | waiver-intel | Haiku 5.5 | 900 | 10/10 | 0 | 378 | $0.00015 |
  | newsletter | Sonnet 5.5 | 3,000 | 8/8 (all would be stored) | 0 | 1,518 | $0.01333 |

  These replies were not graded again; their quality is the measuring-cap run's above (same models, same effort, same
  prompts; only the cap differs, and no reply came near it).

## 9. Deploy path

1. **Wait for Week 9 to be FINAL**: the finalize cron (Wednesday 2026-11-11 07:00 UTC, which runs 5-7 hours late) has
   marked 14 of 14 Week 9 rows `is_complete`, and `story_battles` holds Week 9. Do not merge before that.
2. **REVEILLE reviews this pull request against live**: re-read the twelve call sites on `main` against this branch
   (nothing else on `main` should touch them); `npx tsc --noEmit` and `npm run build` on the branch;
   `node tools/qa/check-parity.mjs --all` (no key, no network); confirm in the Console that the production key's
   organization can call `claude-haiku-5-5` and `claude-sonnet-5-5`; read the prepaid balance (#90: auto-reload is off;
   the Story Engine runs inside Finalize and fails silently on an empty balance).
3. **Merge = deploy** (a push to `main`). Then, in the app, run start-sit, the chat and one waiver-intel check once each
   and read the replies; never call a cron, never press Finalize. The first newsletter on Sonnet 5.5 is the Week 10 run
   (Wednesday 2026-11-18, 07:30 UTC): confirm it was stored whole.
4. **Roll back** by reverting the swap commit alone; the evaluation commits are behaviour-neutral.
5. Afterwards: revoke the `uff-qa` key and delete this worktree's `.env.local` (left in place on purpose; it is
   gitignored and holds only that key).

## 10. Every failure, with the reviewer's verdict

One line per answer that had a grader FACT issue or a FORMAT failure: case, model, cap (`today` = the site's own cap,
`raised` = 8,000), the team label and case kind, then each FACT issue as `kind:C` (confirmed) or `kind:O` (overruled)
with my note, and the FORMAT result with today's reader and with every text block joined. Notes are redacted as
described at the top. The full, unredacted record (replies, grader quotes, quote checks) is in `tools/qa/results/` on
the machine that ran it.

### start-sit

- `start-sit-01 haiku45 raised` (T02, starter-scores-zero x3): FACT contradicts:C, bye:O — 0: tells the manager to fill the K slot with an RB (K is not FLEX-eligible). 1: overruled, the reply does say [player] is on bye (it names no replacement: instruction miss, not a fact)
- `start-sit-01 haiku45 today` (T02, starter-scores-zero x3): FACT invented:O, bye:C, invented:C, contradicts:C — 0 overruled (duplicate of 1); 1: recommends a 49ers kicker, SF on bye; 2: names waiver TEs not in the inputs; 3: suggests a pivot to an IR player
- `start-sit-01 haiku55 raised` (T02, starter-scores-zero x3): FACT contradicts:O — grader placeholder; the three named starters have no flags | FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-01 haiku55 today` (T02, starter-scores-zero x3): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-01 sonnet55 raised` (T02, starter-scores-zero x3): FACT contradicts:O — the grader itself calls it not an issue; muddled FLEX advice, no false fact
- `start-sit-01 sonnet55 today` (T02, starter-scores-zero x3): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-02 haiku45 raised` (T07, starter-scores-zero x3): FACT arithmetic:O, invented:O — count is right; "20+ points on the table" is a rhetorical estimate
- `start-sit-02 haiku45 today` (T07, starter-scores-zero x3): FACT contradicts:C, contradicts:O — says only [player] starts and tells him to start [player], who is already starting; 1 duplicates 0
- `start-sit-02 haiku55 raised` (T07, starter-scores-zero x3): FACT contradicts:O — grader says no contradiction | FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-02 haiku55 today` (T07, starter-scores-zero x3): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-02 sonnet55 raised` (T07, starter-scores-zero x3): FACT invented:O — player-quality judgment
- `start-sit-02 sonnet55 today` (T07, starter-scores-zero x3): FACT invented:C — claims a good matchup; no opponent or schedule is in the inputs | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-03 haiku45 raised` (T03, starter-scores-zero x2): FACT contradicts:O, invented:O — RB at FLEX is legal; the double use of one bench RB is a logic slip, not a false fact; "league-winners" is a judgment
- `start-sit-03 haiku45 today` (T03, starter-scores-zero x2): FACT invented:O, contradicts:O — rhetorical estimate; "monitor injury reports" claims no injury
- `start-sit-03 haiku55 raised` (T03, starter-scores-zero x2): FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-03 haiku55 today` (T03, starter-scores-zero x2): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-03 sonnet55 raised` (T03, starter-scores-zero x2): FACT invented:O — judgment
- `start-sit-03 sonnet55 today` (T03, starter-scores-zero x2): FACT invented:O, invented:O — judgment; the grader says the backfield claim is supported | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-04 haiku45 raised` (T05, starter-scores-zero x2): FACT invented:O — judgment
- `start-sit-04 haiku45 today` (T05, starter-scores-zero x2): FACT invented:C, contradicts:C — invents a Detroit bye in week 9 (DET's bye was week 6; no schedule in the inputs); calls [player] the only healthy RB2 with two healthy bench RBs
- `start-sit-04 haiku55 raised` (T05, starter-scores-zero x2): FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-04 haiku55 today` (T05, starter-scores-zero x2): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-04 sonnet55 raised` (T05, starter-scores-zero x2): FACT bye:O — grader: not a real issue
- `start-sit-04 sonnet55 today` (T05, starter-scores-zero x2): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-05 haiku45 raised` (T08, starter-scores-zero x2): FACT contradicts:O — a TE at FLEX is legal
- `start-sit-05 haiku45 today` (T08, starter-scores-zero x2): FACT contradicts:C, invented:O — moves a TE into an RB slot (not eligible); 1 is an opinion
- `start-sit-05 haiku55 raised` (T08, starter-scores-zero x2): FACT contradicts:O — grader: not a real error | FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-05 haiku55 today` (T08, starter-scores-zero x2): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-05 sonnet55 raised` (T08, starter-scores-zero x2): FACT contradicts:C, contradicts:O — says no FLEX is listed while a third WR fills it; 1 grader: consistent
- `start-sit-05 sonnet55 today` (T08, starter-scores-zero x2): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-06 haiku45 raised` (T01, starter-scores-zero x1): FACT invented:O, contradicts:C — "watch injury report" claims no injury; calls an Out RB a bye
- `start-sit-06 haiku45 today` (T01, starter-scores-zero x1): FACT contradicts:O, contradicts:O — moving [player] into [player]'s RB slot and flexing a WR is a valid fix if [player] holds FLEX; bench RBs are indeed unavailable
- `start-sit-06 haiku55 raised` (T01, starter-scores-zero x1): FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-06 haiku55 today` (T01, starter-scores-zero x1): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-06 sonnet55 today` (T01, starter-scores-zero x1): FACT contradicts:C — says FLEX is empty while a third RB fills it | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-07 haiku45 raised` (T10, starter-scores-zero x1): FACT contradicts:C, contradicts:O — recommends starting a player marked Out
- `start-sit-07 haiku45 today` (T10, starter-scores-zero x1): FACT contradicts:C, contradicts:C — replacement is already a starter; treats a benched bye DEF as the starter and swaps to the DEF already starting
- `start-sit-07 haiku55 raised` (T10, starter-scores-zero x1): FACT contradicts:O — grader: consistent | FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-07 haiku55 today` (T10, starter-scores-zero x1): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-07 sonnet55 raised` (T10, starter-scores-zero x1): FACT contradicts:C, contradicts:O — says FLEX is empty while a third WR fills it
- `start-sit-07 sonnet55 today` (T10, starter-scores-zero x1): FACT contradicts:C, invented:O — same FLEX misread; "target volume" is a judgment here | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-08 haiku45 today` (T04, clean lineup): FACT invented:O — "Wadlow" is a misspelling of [player]; the move itself is right
- `start-sit-08 haiku55 raised` (T04, clean lineup): FACT contradicts:O — muddled FLEX wording, no false fact | FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-08 haiku55 today` (T04, clean lineup): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-08 sonnet55 today` (T04, clean lineup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-09 haiku45 raised` (T06, clean lineup): FACT invented:C, contradicts:C — invents a weak matchup; claims a projection comparison when no projections exist
- `start-sit-09 haiku45 today` (T06, clean lineup): FACT contradicts:C, contradicts:O, invented:O, contradicts:C — puts a bench RB "in the WR slot"; Out = scores 0 is fair; scheme remark is a judgment; invents depth-chart roles ("third-string")
- `start-sit-09 haiku55 raised` (T06, clean lineup): FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-09 haiku55 today` (T06, clean lineup): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-09 sonnet55 raised` (T06, clean lineup): FACT invented:C, invented:O — invents a usage stat ("heavy-target rookie"); draft capital is general knowledge
- `start-sit-09 sonnet55 today` (T06, clean lineup): FACT invented:C — invents a target-volume comparison | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-10 haiku45 raised` (T02, starter-scores-zero x2): FACT contradicts:C, contradicts:C, invented:C — an RB for the K slot; a WR for the DEF slot; invents an injury for a player with no tag
- `start-sit-10 haiku45 today` (T02, starter-scores-zero x2): FACT contradicts:C, contradicts:C, invented:O — a WR "TE-eligible" for the K slot; an RB to cover the Out TE (not TE-eligible); "CHI plays" is true
- `start-sit-10 haiku55 raised` (T02, starter-scores-zero x2): FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-10 haiku55 today` (T02, starter-scores-zero x2): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-10 sonnet55 raised` (T02, starter-scores-zero x2): FACT contradicts:C — says FLEX is empty while a starter fills it
- `start-sit-10 sonnet55 today` (T02, starter-scores-zero x2): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-11 haiku45 raised` (T05, starter-scores-zero x2): FACT invented:O — judgment
- `start-sit-11 haiku45 today` (T05, starter-scores-zero x2): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-11 haiku55 raised` (T05, starter-scores-zero x2): FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-11 haiku55 today` (T05, starter-scores-zero x2): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-11 sonnet55 raised` (T05, starter-scores-zero x2): FACT contradicts:C — "four starters who can't produce (two Out/IR)": three are Out/IR, so five
- `start-sit-11 sonnet55 today` (T05, starter-scores-zero x2): FACT contradicts:O — "only healthy RB left" after [player] is used: consistent | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-12 haiku45 raised` (T10, starter-scores-zero x4): FACT contradicts:O, contradicts:C — 0 says outright [player] is Out (confused, not false); swaps a benched DEF for the DEF already starting
- `start-sit-12 haiku45 today` (T10, starter-scores-zero x4): FACT contradicts:C, contradicts:O — puts a WR in the TE slot, leaving the zero-scoring TE; [player] is indeed the only healthy RB
- `start-sit-12 haiku55 raised` (T10, starter-scores-zero x4): FACT contradicts:C — says three starters score zero, then lists four | FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-12 haiku55 today` (T10, starter-scores-zero x4): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-12 sonnet55 raised` (T10, starter-scores-zero x4): FACT contradicts:O — count right; slot shuffle muddled, no false fact
- `start-sit-12 sonnet55 today` (T10, starter-scores-zero x4): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-13 haiku45 raised` (T03, starter-scores-zero x3): FACT contradicts:C, contradicts:C — a DEF for the K slot; a TE for the DEF slot
- `start-sit-13 haiku45 today` (T03, starter-scores-zero x3): FACT contradicts:C, contradicts:C — reverses both swaps: keeps the bye WR and the bye DEF starting and benches the replacements | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-13 haiku55 raised` (T03, starter-scores-zero x3): FACT invented:O — judgment | FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-13 haiku55 today` (T03, starter-scores-zero x3): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-13 sonnet55 raised` (T03, starter-scores-zero x3): FACT invented:O — conditional, not asserted
- `start-sit-13 sonnet55 today` (T03, starter-scores-zero x3): FACT invented:O — both are SEA: a fair inference | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-14 haiku45 raised` (T02, no lineup set (synthetic)): FACT contradicts:C, contradicts:C, contradicts:O — calls a WR with no tag injured; starts a WR at TE; 2 is ordering, not a fact
- `start-sit-14 haiku45 today` (T02, no lineup set (synthetic)): FACT contradicts:O — [player] is Questionable, so "only healthy WR" is defensible | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-14 haiku55 raised` (T02, no lineup set (synthetic)): FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-14 haiku55 today` (T02, no lineup set (synthetic)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-14 sonnet55 today` (T02, no lineup set (synthetic)): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `start-sit-15 haiku45 raised` (T07, schedule not loaded: bye data unavailable (synthetic)): FACT invented:O, bye:C, invented:C — WR1/high-volume is a widely known role; bye: the schedule was unloaded (synthetic) so the model could not know SF was on bye (data limit, scored as harm); invents a projection
- `start-sit-15 haiku45 today` (T07, schedule not loaded: bye data unavailable (synthetic)): FACT invented:O, bye:C, contradicts:O — judgment; bye (data limit, as above); "[player] is the only functional kicker" is TRUE ([player]'s SF is on bye)
- `start-sit-15 haiku55 raised` (T07, schedule not loaded: bye data unavailable (synthetic)): FACT bye:C, bye:C, contradicts:O — bye x2 (data limit); "only healthy WR option" means the bench, which is true | FORMAT today: empty: the page shows the error "…"; joined: ok → C
- `start-sit-15 haiku55 today` (T07, schedule not loaded: bye data unavailable (synthetic)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `start-sit-15 sonnet55 raised` (T07, schedule not loaded: bye data unavailable (synthetic)): FACT bye:C, bye:C, invented:O — bye x2 (data limit); widely known role
- `start-sit-15 sonnet55 today` (T07, schedule not loaded: bye data unavailable (synthetic)): FACT bye:C, bye:C — bye x2 (data limit) | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C

### chat

- `chat-01 haiku45 raised` (T01, standings): FACT contradicts:C — says T11 leads in points; T09 has more PF
- `chat-01 haiku45 today` (T01, standings): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `chat-01 haiku55 raised` (T01, standings): FACT contradicts:C — "sixth, a few games from the top half": 6th of 14 is the top half (grader filed it as bye)
- `chat-01 haiku55 today` (T01, standings): FACT contradicts:O — true | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `chat-01 sonnet55 raised` (T01, standings): FACT arithmetic:C, contradicts:C, arithmetic:O — N PF is 4th, not 3rd; lists a villain team as Hero; one game behind 5-3 is right
- `chat-01 sonnet55 today` (T01, standings): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `chat-02 haiku45 raised` (T02, own record): FACT arithmetic:C — "1.6 points back" of teams 175 PF ahead
- `chat-02 haiku55 raised` (T02, own record): FACT arithmetic:C — "five weeks left": six are left, and the prompt gives no season length
- `chat-02 haiku55 today` (T02, own record): FACT invented:O — "6 left" is true (not in the prompt, but right)
- `chat-02 sonnet55 raised` (T02, own record): FACT arithmetic:O — grader: correct
- `chat-02 sonnet55 today` (T02, own record): FACT contradicts:O — faction company is accurate
- `chat-03 haiku55 today` (T03, start advice (no roster data)): FACT contradicts:O — opinion
- `chat-03 sonnet55 raised` (T03, start advice (no roster data)): FACT invented:O — opinion
- `chat-03 sonnet55 today` (T03, start advice (no roster data)): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `chat-04 haiku45 today` (T04, factions): FACT invented:O — the Standings page has a faction-war section; "tab" is close enough
- `chat-04 haiku55 raised` (T04, factions): FACT contradicts:O, contradicts:O, invented:C — 2-1 for Villains is right; counts right; "T04 is the only villain who won a cross-faction game" (T09 did too)
- `chat-04 haiku55 today` (T04, factions): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `chat-04 sonnet55 raised` (T04, factions): FACT arithmetic:C, arithmetic:C — villain PF sum 6,593 (it is 6,N); hero PF sum 6,303 (it is 6,N)
- `chat-04 sonnet55 today` (T04, factions): FACT contradicts:C — "Villains (8)": seven are listed | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `chat-05 haiku45 raised` (T05, transactions): FACT contradicts:C, contradicts:O — credits a Blessed Defender add to T11; ambiguous "previous"
- `chat-05 haiku45 today` (T05, transactions): FACT invented:C, invented:C, invented:C — "he's been solid" with no data; "rough season" with no data; pins T06's drop on T01 | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `chat-05 haiku55 raised` (T05, transactions): FACT invented:O — opinion
- `chat-05 haiku55 today` (T05, transactions): FACT invented:O — speculation, flagged as such | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `chat-05 sonnet55 raised` (T05, transactions): FACT arithmetic:C, contradicts:C, contradicts:O, invented:O, invented:C — 3rd for 4th in PF; "5 moves" (4 listed); all heroes is TRUE; AFC = Hero is the rule; asserts T11 plays Fortress (tokens are hidden)
- `chat-05 sonnet55 today` (T05, transactions): FACT arithmetic:C — 3rd for 4th in PF | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `chat-06 haiku45 today` (T06, top scorer PF): FACT invented:O — 7-1 is one loss
- `chat-06 sonnet55 today` (T06, top scorer PF): FACT arithmetic:O — grader: correct
- `chat-07 haiku45 today` (T07, arithmetic gap): FACT invented:O — judgment
- `chat-07 sonnet55 today` (T07, arithmetic gap): FACT invented:C, arithmetic:O — "eight weeks left" (six); averages are right
- `chat-08 haiku45 raised` (T08, rule: Vampire Bite): FACT contradicts:C — "drain points from any opponent": the bite adds to the holder, takes nothing, and can target your own player
- `chat-08 haiku45 today` (T08, rule: Vampire Bite): FACT invented:O — follows from the rule
- `chat-08 sonnet55 raised` (T08, rule: Vampire Bite): FACT contradicts:O — consistent
- `chat-08 sonnet55 today` (T08, rule: Vampire Bite): FACT contradicts:O — roughly consistent
- `chat-09 haiku55 today` (T09, rule: Insurance): FACT contradicts:O — accurate
- `chat-09 sonnet55 today` (T09, rule: Insurance): FACT contradicts:O — placeholder
- `chat-10 haiku45 raised` (T10, rule arithmetic: Last Stand): FACT contradicts:C — opens "Yes, you get your bench points" at 18 down (Last Stand needs 20+)
- `chat-10 haiku45 today` (T10, rule arithmetic: Last Stand): FACT contradicts:C — same "Yes"
- `chat-10 sonnet55 raised` (T10, rule arithmetic: Last Stand): FACT contradicts:C — states a 20-point deficit "would actually flip the matchup": depends on the bench total
- `chat-11 haiku55 raised` (T11, rule: Draft Heist status): FACT invented:C — invents a Week 9 opponent
- `chat-11 sonnet55 today` (T11, rule: Draft Heist status): FACT arithmetic:O — N: correct
- `chat-12 haiku45 raised` (T12, byes (not in data)): FACT invented:O — true app behaviour
- `chat-12 haiku45 today` (T12, byes (not in data)): FACT invented:O, invented:O — true app behaviour
- `chat-12 haiku55 raised` (T12, byes (not in data)): FACT invented:O — true
- `chat-12 haiku55 today` (T12, byes (not in data)): FACT invented:O — true
- `chat-12 sonnet55 raised` (T12, byes (not in data)): FACT invented:O, invented:O — true
- `chat-12 sonnet55 today` (T12, byes (not in data)): FACT invented:O, invented:O — close to true
- `chat-13 haiku45 raised` (T13, live score (not in data)): FACT invented:O — the Matchups page does have a live score breakdown
- `chat-14 haiku45 raised` (T14, week 8 high score (partial data)): FACT contradicts:C — names a N as Week 8's top score; N is listed
- `chat-14 haiku45 today` (T14, week 8 high score (partial data)): FACT contradicts:C — same
- `chat-14 sonnet55 raised` (T14, week 8 high score (partial data)): FACT contradicts:O — correct: 6 of 7 matchups are listed
- `chat-14 sonnet55 today` (T14, week 8 high score (partial data)): FACT contradicts:C, contradicts:O — N is the HIGHEST losing score listed, not second; "beaten almost everyone" holds (3rd of 12)
- `chat-15 haiku45 raised` (T01, player trade (no player data)): FACT invented:C — invents a player's health and form
- `chat-15 haiku55 today` (T01, player trade (no player data)): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `chat-15 sonnet55 raised` (T01, player trade (no player data)): FACT contradicts:C, arithmetic:C — N is 4th, not 2nd; "1.5 games behind" 6-2 and 5-3 from 4-4 (2 and 1), records swapped
- `chat-15 sonnet55 today` (T01, player trade (no player data)): FACT contradicts:C — 2nd for 4th in PF | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `chat-16 haiku45 today` (T02, clutch gene arithmetic): FACT arithmetic:C — "within 3 points to tie with the +1" (within 1)
- `chat-16 haiku55 raised` (T02, clutch gene arithmetic): FACT arithmetic:O — 1.6+ to win from 1.5 down is right
- `chat-16 sonnet55 raised` (T02, clutch gene arithmetic): FACT contradicts:O — true (one token a week)
- `chat-16 sonnet55 today` (T02, clutch gene arithmetic): FACT invented:O — advice
- `chat-17 haiku45 today` (T03, multi-turn follow-up): FACT arithmetic:O — loose but fair (6 of 14 weeks left)
- `chat-17 sonnet55 raised` (T03, multi-turn follow-up): FACT invented:O — judgment
- `chat-17 sonnet55 today` (T03, multi-turn follow-up): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C

### oracle

- `oracle-01 haiku45 raised` (T11, week 8 margin 56): FACT invented:C — credits a token to a team that had none
- `oracle-01 haiku45 today` (T11, week 8 margin 56): FACT invented:O — an epithet: drama
- `oracle-01 sonnet55 today` (T11, week 8 margin 56): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-02 haiku45 raised` (T03, week 8 margin 22): FACT invented:O, contradicts:C — "Cincinnati" is read off the team name: drama; calls N points "power tokens"
- `oracle-02 haiku55 today` (T03, week 8 margin 22): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-02 sonnet55 raised` (T03, week 8 margin 22): FACT invented:O — no token line: supported
- `oracle-02 sonnet55 today` (T03, week 8 margin 22): FACT invented:O, invented:O — drama; supported | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-03 haiku45 today` (T04, week 8 margin 32): FACT invented:C, invented:O — credits a token to a team that had none; "Sunday" is drama
- `oracle-03 sonnet55 raised` (T04, week 8 margin 32): FACT invented:O — supported
- `oracle-03 sonnet55 today` (T04, week 8 margin 32): FACT invented:O — supported | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-04 sonnet55 raised` (T02, week 8 margin 21): FACT invented:O — supported
- `oracle-04 sonnet55 today` (T02, week 8 margin 21): FACT invented:O — supported | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-05 haiku45 today` (T14, week 8 margin 15): FACT contradicts:C, contradicts:C — adds the token bonus on top of both scores (N, N); the Winner line shows the bonus is already in
- `oracle-05 haiku55 today` (T14, week 8 margin 15): FACT arithmetic:O — "forty" for N is rounding | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-05 sonnet55 today` (T14, week 8 margin 15): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-07 haiku45 raised` (T05, week 8 margin 9): FACT contradicts:C — calls a 7-point bonus "7 power tokens"
- `oracle-07 haiku45 today` (T05, week 8 margin 9): FACT contradicts:C — same
- `oracle-07 sonnet55 raised` (T05, week 8 margin 9): FACT arithmetic:O — the grader shows it holds (N > N)
- `oracle-07 sonnet55 today` (T05, week 8 margin 9): FACT arithmetic:O — correct: 7.00 of 9.25 | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-08 haiku45 raised` (T04, week 7 closest): FACT arithmetic:C, contradicts:C — N adds the bonus twice; "ten power tokens"
- `oracle-08 haiku45 today` (T04, week 7 closest): FACT arithmetic:C — N
- `oracle-08 haiku55 today` (T04, week 7 closest): FACT invented:O — prophecy | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-08 sonnet55 today` (T04, week 7 closest): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-09 haiku45 raised` (T06, week 7 blowout): FACT contradicts:C, contradicts:C, contradicts:C — scores and margin all called "tokens"
- `oracle-09 sonnet55 raised` (T06, week 7 blowout): FACT invented:O — supported
- `oracle-09 sonnet55 today` (T06, week 7 blowout): FACT invented:O — supported | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-10 haiku45 raised` (T12, week 7 token game): FACT invented:O — flowery gloss, no false effect
- `oracle-10 haiku45 today` (T12, week 7 token game): FACT invented:C — calls a 4.30 bonus the deciding factor in an N margin
- `oracle-10 haiku55 raised` (T12, week 7 token game): FACT invented:O — drama
- `oracle-10 sonnet55 today` (T12, week 7 token game): FACT contradicts:O — the margin exceeds the bonus, so the win stands without it | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-11 haiku45 today` (T10, week 7 token game): FACT contradicts:C, arithmetic:C — N adds the bonus twice; "twenty-one" for N
- `oracle-11 sonnet55 today` (T10, week 7 token game): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `oracle-12 haiku55 raised` (T05, tie (synthetic): both scores equal): FACT contradicts:O — tie case: "N for both" is what the inputs say (the prompt itself names a winner on a tie) | FORMAT today: empty: the page shows "…"; joined: ok → C
- `oracle-12 haiku55 today` (T05, tie (synthetic): both scores equal): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `oracle-12 sonnet55 today` (T05, tie (synthetic): both scores equal): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C

### matchup-preview

- `preview-01 haiku45 raised` (T11, viewer in matchup): FACT invented:O — drama
- `preview-01 haiku45 today` (T11, viewer in matchup): FACT contradicts:C — calls a Hero team a villain
- `preview-01 sonnet55 today` (T11, viewer in matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-02 haiku55 today` (T03, viewer in matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-02 sonnet55 today` (T03, viewer in matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-03 haiku45 raised` (T04, viewer in matchup): FACT invented:O — drama
- `preview-03 haiku45 today` (T04, viewer in matchup): FACT invented:O — "Token: unknown" leaves room for prophecy about it
- `preview-03 haiku55 raised` (T04, viewer in matchup): FACT invented:O — drama (the team name is T04)
- `preview-03 haiku55 today` (T04, viewer in matchup): FACT invented:O — drama | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-03 sonnet55 raised` (T04, viewer in matchup): FACT invented:O — 0-7 is seven straight losses
- `preview-03 sonnet55 today` (T04, viewer in matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-04 haiku45 today` (T02, viewer in matchup): FACT invented:O — drama
- `preview-04 haiku55 today` (T02, viewer in matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-04 sonnet55 today` (T02, viewer in matchup): FACT invented:O — hyperbole framed as "could" | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-05 haiku55 raised` (T14, viewer in matchup): FACT invented:O — tokens are secret pre-lock; drama
- `preview-05 sonnet55 today` (T14, viewer in matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-06 haiku45 raised` (T09, viewer in matchup): FACT contradicts:C — calls a 6-1 team undefeated
- `preview-06 haiku45 today` (T09, viewer in matchup): FACT contradicts:C — calls a 6-1 team unblemished
- `preview-06 haiku55 today` (T09, viewer in matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-06 sonnet55 raised` (T09, viewer in matchup): FACT invented:O — flowery gloss
- `preview-06 sonnet55 today` (T09, viewer in matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-07 haiku45 raised` (T05, viewer in matchup): FACT invented:O — the 4-3 team is the higher seed
- `preview-07 haiku45 today` (T05, viewer in matchup): FACT arithmetic:O — 7 for 7.7 is rounding
- `preview-07 sonnet55 today` (T05, viewer in matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-08 haiku45 raised` (T01, viewer outside the matchup): FACT contradicts:C — calls a Hero team a villain
- `preview-08 haiku55 today` (T01, viewer outside the matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-08 sonnet55 today` (T01, viewer outside the matchup): FACT invented:C — invents a brother/sister relationship between the managers | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-09 haiku55 raised` (T03, viewer holds Recon (synthetic)): FACT invented:O — metaphor
- `preview-09 haiku55 today` (T03, viewer holds Recon (synthetic)): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-09 sonnet55 today` (T03, viewer holds Recon (synthetic)): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-10 haiku45 raised` (T06, week 7 viewer in matchup): FACT arithmetic:O — 17 for N is rounding
- `preview-10 haiku45 today` (T06, week 7 viewer in matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-10 haiku55 raised` (T06, week 7 viewer in matchup): FACT invented:O — drama
- `preview-10 haiku55 today` (T06, week 7 viewer in matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `preview-10 sonnet55 today` (T06, week 7 viewer in matchup): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C

### power-rankings

- `rankings-01 haiku45 raised` (T02, after week 1): FACT contradicts:C, invented:C, contradicts:C — ranks N below N "on firepower"; invents an injury plague; calls N the weakest unbeaten score (N is)
- `rankings-01 haiku45 today` (T02, after week 1): FACT invented:O, contradicts:O — judgment; true | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-01 haiku55 raised` (T02, after week 1): FACT contradicts:C, invented:O — N is 5th-highest, not 3rd; speculation | FORMAT today: empty: the card shows "…"; joined: ok → C
- `rankings-01 haiku55 today` (T02, after week 1): FACT contradicts:O — grader: consistent | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-01 sonnet55 raised` (T02, after week 1): FACT contradicts:C — "four Heroes in the top four" of its own list, whose
- `rankings-01 sonnet55 today` (T02, after week 1): FACT invented:C — "won comfortably": margins are not given | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-02 haiku45 raised` (T03, after week 2): FACT contradicts:O, contradicts:C, contradicts:C, invented:O, contradicts:C — N was Week 1's lowest; N is the LOWEST PF, not second; N is 7th, not 8th; conditional; T04 was not the only 170+ week
- `rankings-02 haiku45 today` (T03, after week 2): FACT contradicts:O, contradicts:O — true; judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-02 haiku55 raised` (T03, after week 2): FACT invented:C, invented:C, contradicts:C — invents close margins; invents opponents; N was the third-highest week | FORMAT today: empty: the card shows "…"; joined: ok → C
- `rankings-02 haiku55 today` (T03, after week 2): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `rankings-02 sonnet55 raised` (T03, after week 2): FACT invented:O, contradicts:O, arithmetic:O — the league average IS about 120 (N / 28); true of its own bottom three; correct
- `rankings-02 sonnet55 today` (T03, after week 2): FACT contradicts:O — correct | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-03 haiku45 raised` (T04, after week 3): FACT contradicts:C, contradicts:C, contradicts:C, invented:O — N is not the lowest PF; N is 7th, not 4th; N is lower than N among 1-2 teams; speculation
- `rankings-03 haiku45 today` (T04, after week 3): FACT contradicts:C, contradicts:O, invented:C, invented:O, arithmetic:O — T06's N tops T04's N; consistent; invents a "strong opponent"; speculation; true | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-03 haiku55 raised` (T04, after week 3): FACT contradicts:O, arithmetic:C, invented:C, arithmetic:O — correct; N is 7th-lowest of that group, not 4th; invents close margins; correct | FORMAT today: empty: the card shows "…"; joined: ok → C
- `rankings-03 haiku55 today` (T04, after week 3): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `rankings-03 sonnet55 raised` (T04, after week 3): FACT contradicts:C, contradicts:O, contradicts:O, contradicts:O — N is 4th, not 3rd; the rest are opinion or consistent
- `rankings-03 sonnet55 today` (T04, after week 3): FACT contradicts:C, contradicts:C, contradicts:O — T04 is 3rd, not 2nd; T06 is 2nd, not 3rd; consistent | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-04 haiku45 raised` (T05, after week 4): FACT invented:C, contradicts:C, contradicts:C, contradicts:C, invented:O — "five games" for a team with three decided; N is not sub-100; N is lower among 1-win teams; N breaks "three straight 130+"; judgment
- `rankings-04 haiku45 today` (T05, after week 4): FACT contradicts:O, invented:O — Week 1 is derivable (N minus the three listed = N); opinion | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-04 haiku55 raised` (T05, after week 4): FACT invented:C, contradicts:C, contradicts:O, contradicts:O, contradicts:C, contradicts:O — invents the schedule; N is the 2nd-highest PF, not "middling"; roughly right; true; N is the LOWEST of the 2-2 group; different week | FORMAT today: empty: the card shows "…"; joined: ok → C
- `rankings-04 haiku55 today` (T05, after week 4): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `rankings-04 sonnet55 raised` (T05, after week 4): FACT invented:O, invented:O, invented:O — the average is right; advice; advice
- `rankings-04 sonnet55 today` (T05, after week 4): FACT contradicts:O, contradicts:O, invented:O — true; correct; judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-05 haiku45 raised` (T06, after week 5): FACT contradicts:C, contradicts:C, contradicts:C, contradicts:C, contradicts:C, contradicts:C, invented:C, invented:O — calls 119->130->134 "downward"; T06 5th not 4th; Dark Night 2nd not 3rd; T09 3rd not 2nd; Angel is not the lowest PF; N is not "exactly average" (N); invents a 2025 dynasty format; speculation
- `rankings-05 haiku45 today` (T06, after week 5): FACT contradicts:C, contradicts:C, contradicts:C — "consistent 150+" with a N week; T09 3rd not 2nd; Dark Night 2nd not 3rd | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-05 haiku55 raised` (T06, after week 5): FACT arithmetic:O, arithmetic:O, contradicts:O, contradicts:O, contradicts:O, contradicts:O — all correct (grader agrees) | FORMAT today: empty: the card shows "…"; joined: ok → C
- `rankings-05 haiku55 today` (T06, after week 5): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `rankings-05 sonnet55 raised` (T06, after week 5): FACT contradicts:O, contradicts:O, invented:O, contradicts:O — true (N vs N); accurate; suggestion; true
- `rankings-05 sonnet55 today` (T06, after week 5): FACT contradicts:O — judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-06 haiku45 raised` (T07, after week 6): FACT contradicts:C, invented:O, contradicts:C, contradicts:C — calls N->N "deterioration"; speculation; calls a 3-3 team "undefeated-ish"; puts the 4th-highest PF "ahead of the field"
- `rankings-06 haiku45 today` (T07, after week 6): FACT contradicts:C, contradicts:O, contradicts:C, contradicts:C — T04 4th in PF, not 2nd; ambiguous phrase; N was not Week 4's high (N); N is not the lowest PF | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-06 haiku55 raised` (T07, after week 6): FACT contradicts:C — N was not Week 4's top score (N) | FORMAT today: empty: the card shows "…"; joined: ok → C
- `rankings-06 haiku55 today` (T07, after week 6): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `rankings-06 sonnet55 raised` (T07, after week 6): FACT contradicts:O, contradicts:O — correct; fine
- `rankings-06 sonnet55 today` (T07, after week 6): FACT contradicts:O, contradicts:C, contradicts:C — true; N is 4th, not 3rd; N is 3rd, not 4th | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-07 haiku45 raised` (T08, after week 7): FACT contradicts:C, invented:O, invented:O, contradicts:C, contradicts:O — "floor higher than anyone's ceiling" (N and N top N); speculation; speculation; reorders the weeks; overall down is defensible
- `rankings-07 haiku45 today` (T08, after week 7): FACT invented:C, contradicts:C, invented:O — invents improving playoff matchups; N is 4th, not 2nd; luck inferred from PF vs record | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-07 haiku55 raised` (T08, after week 7): FACT contradicts:C, contradicts:C — "sub-100 except Week 5" when Week 5 was N; another team rose more, so not "strongest momentum"
- `rankings-07 haiku55 today` (T08, after week 7): FACT contradicts:O — N vs "above 118": rounding nitpick | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-07 sonnet55 raised` (T08, after week 7): FACT contradicts:O, invented:O — N / 6 decided games, as the inputs show; suggestion
- `rankings-07 sonnet55 today` (T08, after week 7): FACT contradicts:C — "unlucky in close games": margins are not given | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-08 haiku45 raised` (T09, after week 8): FACT invented:C, contradicts:C, contradicts:C, contradicts:C — invents "the most brutal schedule"; calls 6-2 mediocre; N is 3rd-worst, not 2nd; calls 3-5 respectable
- `rankings-08 haiku45 today` (T09, after week 8): FACT contradicts:C, invented:O — calls a 7-1 team undefeated; speculation | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `rankings-08 haiku55 raised` (T09, after week 8): FACT contradicts:O, invented:C, contradicts:O, contradicts:O — consistent; invents a three-game losing stretch; consistent; rounding | FORMAT today: empty: the card shows "…"; joined: ok → C
- `rankings-08 haiku55 today` (T09, after week 8): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `rankings-08 sonnet55 raised` (T09, after week 8): FACT contradicts:O, invented:O, contradicts:O — correct; suggestion; consistent
- `rankings-08 sonnet55 today` (T09, after week 8): FACT contradicts:C, contradicts:O — N is 2nd-best, not 3rd; fine | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C

### draft-advisor

- `draft-01 haiku45 raised` (T01, before pick 1 (round 1)): FACT invented:C — says a player listed as available is not available
- `draft-01 haiku55 raised` (T01, before pick 1 (round 1)): FORMAT today: empty: the room shows "…"; joined: ok → C
- `draft-01 haiku55 today` (T01, before pick 1 (round 1)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `draft-01 sonnet55 raised` (T01, before pick 1 (round 1)): FACT invented:O, contradicts:O — general judgment; the pool really has 8 WRs to 14 RBs, so "WR is thinner" is TRUE (grader wrong)
- `draft-02 haiku55 raised` (T02, before pick 14 (round 1)): FORMAT today: empty: the room shows "…"; joined: ok → C
- `draft-02 haiku55 today` (T02, before pick 14 (round 1)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `draft-02 sonnet55 raised` (T02, before pick 14 (round 1)): FACT invented:C — calls pick 14 "pick 1" (13 picks are made)
- `draft-02 sonnet55 today` (T02, before pick 14 (round 1)): FACT invented:O, invented:O — judgment; conditional
- `draft-03 haiku45 raised` (T02, before pick 42 (round 3)): FACT invented:O — speculation about the draft flow
- `draft-03 haiku45 today` (T02, before pick 42 (round 3)): FACT invented:O — speculation
- `draft-03 haiku55 raised` (T02, before pick 42 (round 3)): FORMAT today: empty: the room shows "…"; joined: ok → C
- `draft-03 haiku55 today` (T02, before pick 42 (round 3)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `draft-03 sonnet55 raised` (T02, before pick 42 (round 3)): FACT invented:O — "Jacksonville is in the AFC" is TRUE; the inputs are wrong (the route's AFC table spells it JAC, the data JAX)
- `draft-03 sonnet55 today` (T02, before pick 42 (round 3)): FACT invented:O — speculation | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `draft-04 haiku55 raised` (T02, before pick 71 (round 6)): FACT contradicts:O — he is the first TE listed | FORMAT today: empty: the room shows "…"; joined: ok → C
- `draft-04 haiku55 today` (T02, before pick 71 (round 6)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `draft-04 sonnet55 raised` (T02, before pick 71 (round 6)): FACT contradicts:O — "comparable" is a judgment (11th vs 20th)
- `draft-04 sonnet55 today` (T02, before pick 71 (round 6)): FACT invented:O, contradicts:O — widely known trait; grader: not an error | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `draft-05 haiku45 raised` (T03, before pick 100 (round 8)): FACT invented:O — judgment
- `draft-05 haiku45 today` (T03, before pick 100 (round 8)): FACT invented:O — widely known
- `draft-05 haiku55 raised` (T03, before pick 100 (round 8)): FORMAT today: empty: the room shows "…"; joined: ok → C
- `draft-05 haiku55 today` (T03, before pick 100 (round 8)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `draft-05 sonnet55 today` (T03, before pick 100 (round 8)): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `draft-06 haiku45 today` (T03, before pick 128 (round 10)): FACT contradicts:O — "3 starters" can exclude the WR with no NFL team
- `draft-06 haiku55 raised` (T03, before pick 128 (round 10)): FORMAT today: empty: the room shows "…"; joined: ok → C
- `draft-06 haiku55 today` (T03, before pick 128 (round 10)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `draft-06 sonnet55 today` (T03, before pick 128 (round 10)): FACT invented:O — judgment
- `draft-07 haiku45 raised` (T10, before pick 157 (round 12)): FACT invented:O — judgment
- `draft-07 haiku45 today` (T10, before pick 157 (round 12)): FACT contradicts:C, contradicts:O — counts 5 WRs on a roster listing 6; "depleted" at QB with one QB is a judgment
- `draft-07 haiku55 raised` (T10, before pick 157 (round 12)): FACT invented:O, invented:C — widely known role; calls a second-year TE a rookie | FORMAT today: empty: the room shows "…"; joined: ok → C
- `draft-07 haiku55 today` (T10, before pick 157 (round 12)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `draft-08 haiku45 raised` (T09, before pick 186 (round 14)): FACT arithmetic:C, contradicts:O, invented:O — "9/15 NFC" on a 12-man roster with 6 NFC; judgments
- `draft-08 haiku45 today` (T09, before pick 186 (round 14)): FACT arithmetic:C — "6 AFC vs 5 NFC" (it is 6 and 6)
- `draft-08 haiku55 raised` (T09, before pick 186 (round 14)): FORMAT today: empty: the room shows "…"; joined: ok → C
- `draft-08 haiku55 today` (T09, before pick 186 (round 14)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `draft-08 sonnet55 raised` (T09, before pick 186 (round 14)): FACT contradicts:O — grader: consistent
- `draft-08 sonnet55 today` (T09, before pick 186 (round 14)): FACT invented:C, invented:O — invents a "committed timeshare" role; hedged
- `draft-09 haiku45 raised` (T08, before pick 206 (round 15)): FACT contradicts:C, contradicts:C — 3 TEs (2 listed); 4 WRs (5 listed)
- `draft-09 haiku45 today` (T08, before pick 206 (round 15)): FACT contradicts:C, contradicts:O — 3 TEs (2 listed); judgment
- `draft-09 haiku55 raised` (T08, before pick 206 (round 15)): FACT invented:O — grader: no issue | FORMAT today: empty: the room shows "…"; joined: ok → C
- `draft-09 haiku55 today` (T08, before pick 206 (round 15)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `draft-09 sonnet55 raised` (T08, before pick 206 (round 15)): FACT invented:O, contradicts:O — judgment; grader: not real
- `draft-10 haiku45 raised` (T06, before pick 223 (round 16)): FACT contradicts:C, invented:O — calls a roster with two TEs thin at TE; judgment
- `draft-10 haiku45 today` (T06, before pick 223 (round 16)): FACT contradicts:O — "only reliable option" is a judgment about the other TE
- `draft-10 haiku55 raised` (T06, before pick 223 (round 16)): FORMAT today: empty: the room shows "…"; joined: ok → C
- `draft-10 haiku55 today` (T06, before pick 223 (round 16)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `draft-10 sonnet55 raised` (T06, before pick 223 (round 16)): FACT invented:O, invented:O — advice; widely known starter

### token-advisor

- `token-01 haiku45 raised` (T14, token 2, week 8, 1 starter(s) score 0): FACT invented:O — estimate
- `token-01 haiku45 today` (T14, token 2, week 8, 1 starter(s) score 0): FACT invented:O — hypothetical
- `token-01 haiku55 raised` (T14, token 2, week 8, 1 starter(s) score 0): FACT invented:O, invented:O, invented:O — estimate; "rivalry" is drama; grader: fine | FORMAT today: empty: the page shows "…"; joined: ok → C
- `token-01 haiku55 today` (T14, token 2, week 8, 1 starter(s) score 0): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `token-01 sonnet55 raised` (T14, token 2, week 8, 1 starter(s) score 0): FACT invented:O, invented:O, arithmetic:O — true (use it or lose it); estimate; arithmetic on the estimate
- `token-01 sonnet55 today` (T14, token 2, week 8, 1 starter(s) score 0): FACT invented:O, invented:O, invented:O, bye:O — estimates; true; [player] and [player] play | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `token-02 haiku45 today` (T08, token 3, week 8, 2 starter(s) score 0): FACT bye:C, invented:O — names a player with no NFL team as the likely Bench Vault scorer; judgment
- `token-02 haiku55 raised` (T08, token 3, week 8, 2 starter(s) score 0): FORMAT today: empty: the page shows "…"; joined: ok → C
- `token-02 haiku55 today` (T08, token 3, week 8, 2 starter(s) score 0): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `token-02 sonnet55 raised` (T08, token 3, week 8, 2 starter(s) score 0): FACT bye:C, invented:O — counts on two players with no NFL team as bench scorers; estimate
- `token-02 sonnet55 today` (T08, token 3, week 8, 2 starter(s) score 0): FACT invented:O, bye:C — estimate; same reliance on two zero-scorers | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `token-03 haiku45 raised` (T07, token 6, week 8, 3 starter(s) score 0): FACT invented:O, bye:O — estimate; faction bonus counts the roster, not who plays
- `token-03 haiku45 today` (T07, token 6, week 8, 3 starter(s) score 0): FACT invented:O — estimate
- `token-03 haiku55 raised` (T07, token 6, week 8, 3 starter(s) score 0): FACT arithmetic:O, bye:O — grader: correct; faction bonus counts the roster | FORMAT today: empty: the page shows "…"; joined: ok → C
- `token-03 haiku55 today` (T07, token 6, week 8, 3 starter(s) score 0): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `token-03 sonnet55 raised` (T07, token 6, week 8, 3 starter(s) score 0): FACT invented:C, invented:O — calls a Philadelphia TE a Lions player; counts right
- `token-03 sonnet55 today` (T07, token 6, week 8, 3 starter(s) score 0): FACT invented:O, bye:O — speculation; faction bonus counts the roster | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `token-04 haiku45 raised` (T02, token 7, week 8, 3 starter(s) score 0): FACT invented:O, invented:O, bye:O — estimate; judgment; [player] plays
- `token-04 haiku45 today` (T02, token 7, week 8, 3 starter(s) score 0): FACT invented:C, invented:O, bye:O — invents a matchup; estimate; steers away from WR, does not recommend the bye WR
- `token-04 haiku55 raised` (T02, token 7, week 8, 3 starter(s) score 0): FACT invented:O, invented:C, arithmetic:O — estimate; tells a Bears QB to check "the Bears' pass defense" (his own team); the path-to-33 reasoning holds | FORMAT today: empty: the page shows "…"; joined: ok → C
- `token-04 haiku55 today` (T02, token 7, week 8, 3 starter(s) score 0): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `token-04 sonnet55 raised` (T02, token 7, week 8, 3 starter(s) score 0): FACT invented:O, invented:O, invented:O, arithmetic:O — widely known; illustrative; judgment; estimate
- `token-04 sonnet55 today` (T02, token 7, week 8, 3 starter(s) score 0): FACT invented:O, invented:O — conditional; widely known | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `token-05 haiku45 today` (T09, token 18, week 8): FACT invented:O — grader: not real
- `token-05 haiku55 raised` (T09, token 18, week 8): FACT bye:O — names him for future weeks | FORMAT today: empty: the page shows "…"; joined: ok → C
- `token-05 haiku55 today` (T09, token 18, week 8): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `token-05 sonnet55 raised` (T09, token 18, week 8): FACT bye:C — counts a Houston WR as this week's depth in Houston's bye week
- `token-05 sonnet55 today` (T09, token 18, week 8): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `token-06 haiku55 raised` (T04, token 3, week 7): FORMAT today: empty: the page shows "…"; joined: ok → C
- `token-06 haiku55 today` (T04, token 3, week 7): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `token-06 sonnet55 raised` (T04, token 3, week 7): FACT invented:O, invented:O — estimate; standard concept
- `token-06 sonnet55 today` (T04, token 3, week 7): FACT invented:O, bye:C — estimate; the Bench Vault plan assumes [player] starts, but BUF is on bye | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `token-07 haiku45 raised` (T07, token 4, week 7, 2 starter(s) score 0): FACT invented:O, bye:C, invented:O — judgment; leans on a Jaguars WR in the Jaguars' bye week; hypothetical
- `token-07 haiku45 today` (T07, token 4, week 7, 2 starter(s) score 0): FACT invented:O, bye:C — "save it" (prompt invites); leans on the same bye WR
- `token-07 haiku55 raised` (T07, token 4, week 7, 2 starter(s) score 0): FACT invented:O, invented:O — estimate; judgment | FORMAT today: empty: the page shows "…"; joined: ok → C
- `token-07 haiku55 today` (T07, token 4, week 7, 2 starter(s) score 0): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `token-07 sonnet55 raised` (T07, token 4, week 7, 2 starter(s) score 0): FACT bye:O, invented:O — the players it says to start all play; "against projection" is the real rule
- `token-07 sonnet55 today` (T07, token 4, week 7, 2 starter(s) score 0): FACT invented:O — fair inference (Mulligan swaps by position) | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `token-08 haiku45 raised` (T02, token 6, week 7, 2 starter(s) score 0): FACT invented:O — no week in the inputs
- `token-08 haiku45 today` (T02, token 6, week 7, 2 starter(s) score 0): FACT invented:O, invented:O — prompt invites holding; estimate
- `token-08 haiku55 raised` (T02, token 6, week 7, 2 starter(s) score 0): FACT invented:O — TRUE: tokens are use-it-or-lose-it | FORMAT today: empty: the page shows "…"; joined: ok → C
- `token-08 haiku55 today` (T02, token 6, week 7, 2 starter(s) score 0): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `token-08 sonnet55 raised` (T02, token 6, week 7, 2 starter(s) score 0): FACT invented:O, invented:O — judgment; speculation
- `token-08 sonnet55 today` (T02, token 6, week 7, 2 starter(s) score 0): FACT arithmetic:O — correct arithmetic | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `token-09 haiku45 raised` (T09, token 16, week 7): FACT bye:C, invented:C, invented:O — Iron Will on a Jaguars WR in the Jaguars' bye; claims a projection ranking it was not given; widely known role
- `token-09 haiku45 today` (T09, token 16, week 7): FACT invented:O, invented:O — prompt invites holding; speculation
- `token-09 haiku55 raised` (T09, token 16, week 7): FACT contradicts:C, invented:O, bye:C — "already favored to win" when projected to lose by 1.4; estimate; leans on a bye kicker | FORMAT today: empty: the page shows "…"; joined: ok → C
- `token-09 haiku55 today` (T09, token 16, week 7): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `token-09 sonnet55 raised` (T09, token 16, week 7): FACT bye:C, invented:O — tells him to start a Jaguars kicker in the Jaguars' bye; general knowledge
- `token-09 sonnet55 today` (T09, token 16, week 7): FACT invented:O — estimate | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `token-10 haiku45 raised` (T04, token 4, week 6, 1 starter(s) score 0): FACT contradicts:C, invented:O, bye:C, invented:O — "0-5" for a 4-1 team; no week given; leans on a Bengals RB in the Bengals' bye; judgment
- `token-10 haiku45 today` (T04, token 4, week 6, 1 starter(s) score 0): FACT invented:O, invented:O — no week given; judgment
- `token-10 haiku55 raised` (T04, token 4, week 6, 1 starter(s) score 0): FORMAT today: empty: the page shows "…"; joined: ok → C
- `token-10 haiku55 today` (T04, token 4, week 6, 1 starter(s) score 0): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `token-10 sonnet55 raised` (T04, token 4, week 6, 1 starter(s) score 0): FACT invented:O, invented:O — assumption; conditional
- `token-10 sonnet55 today` (T04, token 4, week 6, 1 starter(s) score 0): FACT invented:O — assumption | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `token-11 haiku45 raised` (T08, token 6, week 6, 1 starter(s) score 0): FACT invented:O, bye:C — estimate; says a Bengals WR will carry the workload in the Bengals' bye
- `token-11 haiku45 today` (T08, token 6, week 6, 1 starter(s) score 0): FACT invented:O — estimate
- `token-11 haiku55 raised` (T08, token 6, week 6, 1 starter(s) score 0): FACT invented:O — roughly true | FORMAT today: empty: the page shows "…"; joined: ok → C
- `token-11 haiku55 today` (T08, token 6, week 6, 1 starter(s) score 0): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `token-11 sonnet55 raised` (T08, token 6, week 6, 1 starter(s) score 0): FACT bye:C, invented:O — leans on the same bye WR; judgment
- `token-11 sonnet55 today` (T08, token 6, week 6, 1 starter(s) score 0): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `token-12 haiku45 raised` (T14, token 7, week 6, 1 starter(s) score 0): FACT invented:O, invented:C — estimate; "none are featured backs" invents depth-chart roles
- `token-12 haiku45 today` (T14, token 7, week 6, 1 starter(s) score 0): FACT invented:C, invented:O — invents a matchup; estimate
- `token-12 haiku55 raised` (T14, token 7, week 6, 1 starter(s) score 0): FACT invented:O — estimate | FORMAT today: empty: the page shows "…"; joined: ok → C
- `token-12 haiku55 today` (T14, token 7, week 6, 1 starter(s) score 0): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `token-12 sonnet55 raised` (T14, token 7, week 6, 1 starter(s) score 0): FACT invented:O, invented:O — illustrative; true
- `token-12 sonnet55 today` (T14, token 7, week 6, 1 starter(s) score 0): FACT invented:O — conditional | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C

### trade-eval

- `trade-eval-01 haiku45 raised` (T01, lopsided: bench WR for their best player): FACT invented:C, invented:O, contradicts:C — claims a proven role "with [player]" (listed inactive free agent this season); judgment; reverses who gets the star | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-01 haiku45 today` (T01, lopsided: bench WR for their best player): FACT invented:O, invented:O — judgments | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-01 haiku55 raised` (T01, lopsided: bench WR for their best player): FACT invented:O — judgment | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-eval-01 haiku55 today` (T01, lopsided: bench WR for their best player): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-eval-01 sonnet55 raised` (T01, lopsided: bench WR for their best player): FACT invented:C — names a teammate who plays for New England this season
- `trade-eval-01 sonnet55 today` (T01, lopsided: bench WR for their best player): FACT invented:C — same stale depth chart | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-eval-02 haiku45 raised` (T01, fair: like-for-like RBs): FACT invented:C, invented:O — claims recent usage it has no data for; judgment | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-02 haiku45 today` (T01, fair: like-for-like RBs): FACT contradicts:O, invented:C, invented:C — direction consistent; invents strength of schedule; invents a committee backfield | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-02 haiku55 raised` (T01, fair: like-for-like RBs): FACT invented:O — widely known | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-eval-02 haiku55 today` (T01, fair: like-for-like RBs): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-eval-02 sonnet55 raised` (T01, fair: like-for-like RBs): FACT invented:C, contradicts:O — names a backfield mate who plays for Houston this season; consistent
- `trade-eval-02 sonnet55 today` (T01, fair: like-for-like RBs): FACT invented:C — same | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-eval-03 haiku45 raised` (T05, 2-for-1: two mid players for a top WR): FACT contradicts:C, invented:C — reverses who gives up the QB; invents a schedule | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-03 haiku45 today` (T05, 2-for-1: two mid players for a top WR): FACT invented:O, contradicts:C — judgment; says the team receiving [player] surrenders him | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-03 haiku55 raised` (T05, 2-for-1: two mid players for a top WR): FACT contradicts:O, invented:O — grader: right; judgment | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-eval-03 haiku55 today` (T05, 2-for-1: two mid players for a top WR): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-eval-03 sonnet55 raised` (T05, 2-for-1: two mid players for a top WR): FACT invented:O, invented:O — hedged and true (the player is listed Out this season); judgment
- `trade-eval-03 sonnet55 today` (T05, 2-for-1: two mid players for a top WR): FACT invented:C, invented:O — "season-ending" injury: he is listed Out, not on IR; judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-eval-04 haiku45 raised` (T01, kicker for kicker): FACT contradicts:C, invented:O — says a kicker with no NFL team projects like an active one; judgment | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-04 haiku45 today` (T01, kicker for kicker): FACT invented:O, invented:O, invented:O — judgments | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-04 haiku55 raised` (T01, kicker for kicker): FACT invented:O, invented:O, contradicts:O, invented:O — a no-team kicker is worth nothing; grader muddled | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-eval-04 haiku55 today` (T01, kicker for kicker): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-eval-04 sonnet55 raised` (T01, kicker for kicker): FACT invented:O — judgment
- `trade-eval-04 sonnet55 today` (T01, kicker for kicker): FACT invented:O — judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-eval-05 haiku45 raised` (T07, QB for QB): FACT invented:O, invented:C — judgment; gives a pocket backup QB "dual-threat ability" | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-05 haiku45 today` (T07, QB for QB): FACT invented:C, invented:O, invented:O — invents a playoff schedule; judgment; judgment | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-05 haiku55 raised` (T07, QB for QB): FACT invented:O — true: he backs up the starter | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-eval-05 haiku55 today` (T07, QB for QB): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-eval-05 sonnet55 raised` (T07, QB for QB): FACT invented:O — true
- `trade-eval-05 sonnet55 today` (T07, QB for QB): FACT invented:O, invented:O — true; widely known | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-eval-06 haiku45 raised` (T01, an injured-reserve player plus a bench piece for a healthy starter): FACT invented:O, contradicts:C — judgment; says the side receiving two players for one is "mortgaging depth" | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-06 haiku45 today` (T01, an injured-reserve player plus a bench piece for a healthy starter): FACT invented:C, invented:O, invented:O — invents a teammate ("[player]"); judgments | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-06 haiku55 raised` (T01, an injured-reserve player plus a bench piece for a healthy starter): FACT invented:C, invented:O — "has struggled to find steady volume": a performance claim with no data; judgment | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-eval-06 haiku55 today` (T01, an injured-reserve player plus a bench piece for a healthy starter): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-eval-06 sonnet55 raised` (T01, an injured-reserve player plus a bench piece for a healthy starter): FACT contradicts:O — grader: not an issue
- `trade-eval-06 sonnet55 today` (T01, an injured-reserve player plus a bench piece for a healthy starter): FACT invented:O — widely known | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-eval-07 haiku45 raised` (T09, 3-for-1 lopsided: three low-value players for their best): FACT contradicts:C, contradicts:C — "2-7" for 2-6; reverses who trades away the star | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-07 haiku45 today` (T09, 3-for-1 lopsided: three low-value players for their best): FACT invented:O — widely known | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-07 haiku55 raised` (T09, 3-for-1 lopsided: three low-value players for their best): FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-eval-07 haiku55 today` (T09, 3-for-1 lopsided: three low-value players for their best): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-eval-07 sonnet55 raised` (T09, 3-for-1 lopsided: three low-value players for their best): FACT invented:O — widely known
- `trade-eval-07 sonnet55 today` (T09, 3-for-1 lopsided: three low-value players for their best): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-eval-08 haiku45 raised` (T11, TE for TE): FACT invented:C, invented:C, invented:C — invents a stat line; invents a playoff schedule; invents the partner's roster needs | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-08 haiku45 today` (T11, TE for TE): FACT invented:O — widely known | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-08 haiku55 raised` (T11, TE for TE): FACT invented:O, invented:O — widely known; judgment | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-eval-08 haiku55 today` (T11, TE for TE): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-eval-08 sonnet55 raised` (T11, TE for TE): FACT invented:O, invented:O, contradicts:O — judgments; grader muddled
- `trade-eval-08 sonnet55 today` (T11, TE for TE): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-eval-09 haiku45 raised` (T02, a player with no NFL team for a like-position player): FACT invented:O, invented:O — judgments | FORMAT today: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body; joined: verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body → C
- `trade-eval-09 haiku45 today` (T02, a player with no NFL team for a like-position player): FACT invented:C — calls two kickers with no NFL team "mid-tier options"
- `trade-eval-09 haiku55 raised` (T02, a player with no NFL team for a like-position player): FACT invented:O — true | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-eval-09 haiku55 today` (T02, a player with no NFL team for a like-position player): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-eval-09 sonnet55 raised` (T02, a player with no NFL team for a like-position player): FACT invented:C, invented:O, contradicts:O — puts a no-team kicker "backed by a steady Raiders offense"; muddled; rhetorical
- `trade-eval-09 sonnet55 today` (T02, a player with no NFL team for a like-position player): FACT invented:C, invented:O, contradicts:C — says a no-team kicker "plays on an offense"; muddled; reverses who gains the edge | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C

### trade-veto

- `trade-veto-01 haiku45 raised` (-, lopsided: bench WR for their best player): FACT contradicts:C, contradicts:C — says the deal favors the side giving up the star; says the side receiving him is weakened
- `trade-veto-01 haiku45 today` (-, lopsided: bench WR for their best player): FACT contradicts:C, contradicts:C — reverses who receives the star; invents a standings gap ("one game back")
- `trade-veto-01 haiku55 raised` (-, lopsided: bench WR for their best player): FACT invented:O — judgment | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-veto-01 haiku55 today` (-, lopsided: bench WR for their best player): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-veto-01 sonnet55 raised` (-, lopsided: bench WR for their best player): FACT invented:O — widely known (contract talk is irrelevant but not false)
- `trade-veto-01 sonnet55 today` (-, lopsided: bench WR for their best player): FACT invented:O — widely known | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-veto-02 haiku45 raised` (-, fair: like-for-like RBs): FACT invented:C, invented:O, invented:O — "has dealt with usage inconsistency": a performance claim with no data; judgments
- `trade-veto-02 haiku45 today` (-, fair: like-for-like RBs): FACT invented:C, invented:O — "this season" production claims with no data; judgment
- `trade-veto-02 haiku55 raised` (-, fair: like-for-like RBs): FACT invented:O — consensus judgment | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-veto-02 haiku55 today` (-, fair: like-for-like RBs): FACT contradicts:O, invented:C, invented:O — direction right; a committee backfield with a back who now plays for Houston (stale); widely known | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-veto-02 sonnet55 raised` (-, fair: like-for-like RBs): FACT invented:O, invented:O — widely known
- `trade-veto-02 sonnet55 today` (-, fair: like-for-like RBs): FACT invented:O — widely known
- `trade-veto-03 haiku45 raised` (-, 2-for-1: two mid players for a top WR): FACT contradicts:C, invented:C — says the side receiving two starters "gets almost nothing"; "has been injured" with no data
- `trade-veto-03 haiku45 today` (-, 2-for-1: two mid players for a top WR): FACT contradicts:O, invented:O, contradicts:C — direction right; judgment; calls a starting QB a backup
- `trade-veto-03 haiku55 raised` (-, 2-for-1: two mid players for a top WR): FACT contradicts:O, invented:O — direction right; judgment | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-veto-03 haiku55 today` (-, 2-for-1: two mid players for a top WR): FACT invented:O, contradicts:O — judgments; muddled wording | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-veto-03 sonnet55 raised` (-, 2-for-1: two mid players for a top WR): FACT invented:O, contradicts:O — hedged and true (a 2025 injury); consistent
- `trade-veto-03 sonnet55 today` (-, 2-for-1: two mid players for a top WR): FACT invented:O, invented:C — true; calls a second-year RB a rookie | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-veto-04 haiku45 raised` (-, kicker for kicker): FACT invented:C, invented:C — credits "this season" performance to a kicker with no NFL team
- `trade-veto-04 haiku45 today` (-, kicker for kicker): FACT invented:O, invented:C, contradicts:O — judgment; calls a no-team kicker "a capable option"; consistent
- `trade-veto-04 haiku55 raised` (-, kicker for kicker): FACT invented:O — widely known | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-veto-04 haiku55 today` (-, kicker for kicker): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-veto-04 sonnet55 raised` (-, kicker for kicker): FACT invented:O, invented:O — judgment; true
- `trade-veto-04 sonnet55 today` (-, kicker for kicker): FACT invented:O, invented:O — true; judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-veto-05 haiku55 raised` (-, QB for QB): FACT invented:O — true
- `trade-veto-05 haiku55 today` (-, QB for QB): FACT invented:O — true | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-veto-05 sonnet55 raised` (-, QB for QB): FACT invented:O, invented:O, contradicts:O — judgments; "in [player]'s favor" means the [player] side is worth more: ambiguous wording, not a false fact
- `trade-veto-05 sonnet55 today` (-, QB for QB): FACT invented:O, invented:O — widely known | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-veto-06 haiku45 today` (-, an injured-reserve player plus a bench piece for a healthy starter): FACT contradicts:O, contradicts:C, contradicts:O — the quoted claim is right; says the side sending two for one "gains depth"; judgment
- `trade-veto-06 haiku55 raised` (-, an injured-reserve player plus a bench piece for a healthy starter): FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-veto-06 haiku55 today` (-, an injured-reserve player plus a bench piece for a healthy starter): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-veto-06 sonnet55 raised` (-, an injured-reserve player plus a bench piece for a healthy starter): FACT invented:O, contradicts:O — widely known; judgment
- `trade-veto-06 sonnet55 today` (-, an injured-reserve player plus a bench piece for a healthy starter): FACT invented:C, invented:O — names teammates who are not on that team this season (stale); widely known | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-veto-07 haiku45 today` (-, 3-for-1 lopsided: three low-value players for their best): FACT invented:O — judgment
- `trade-veto-07 haiku55 raised` (-, 3-for-1 lopsided: three low-value players for their best): FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-veto-07 haiku55 today` (-, 3-for-1 lopsided: three low-value players for their best): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-veto-07 sonnet55 today` (-, 3-for-1 lopsided: three low-value players for their best): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-veto-08 haiku45 raised` (-, TE for TE): FACT invented:C, contradicts:C — invents "cap relief" (the league has no salary cap); says the side receiving the better TE is downgraded
- `trade-veto-08 haiku45 today` (-, TE for TE): FACT invented:O — widely known
- `trade-veto-08 haiku55 raised` (-, TE for TE): FACT invented:O — widely known | FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-veto-08 haiku55 today` (-, TE for TE): FACT invented:O — widely known | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-veto-08 sonnet55 raised` (-, TE for TE): FACT invented:O — widely known
- `trade-veto-08 sonnet55 today` (-, TE for TE): FACT invented:O — widely known | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-veto-09 haiku45 today` (-, a player with no NFL team for a like-position player): FACT invented:C — calls two kickers with no NFL team "mid-tier kickers with similar scoring profiles"
- `trade-veto-09 haiku55 raised` (-, a player with no NFL team for a like-position player): FORMAT today: empty: the page shows "…"; joined: ok → C
- `trade-veto-09 haiku55 today` (-, a player with no NFL team for a like-position player): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-veto-09 sonnet55 raised` (-, a player with no NFL team for a like-position player): FACT invented:C, invented:O, invented:O — puts a no-team kicker on "a steady offense"; true; judgment
- `trade-veto-09 sonnet55 today` (-, a player with no NFL team for a like-position player): FACT invented:C, invented:O — same; judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C

### trade-actions

- `trade-oracle-01 haiku45 raised` (T01, lopsided: bench WR for their best player): FACT contradicts:O, invented:O — the quoted direction is right; judgment
- `trade-oracle-01 haiku45 today` (T01, lopsided: bench WR for their best player): FACT invented:O, invented:O — judgments
- `trade-oracle-01 haiku55 raised` (T01, lopsided: bench WR for their best player): FACT invented:O — judgment | FORMAT today: empty: the email goes out with no Oracle analysis; joined: ok → C
- `trade-oracle-01 haiku55 today` (T01, lopsided: bench WR for their best player): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-oracle-01 sonnet55 today` (T01, lopsided: bench WR for their best player): FACT invented:O — judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-oracle-02 haiku45 raised` (T01, fair: like-for-like RBs): FACT invented:O, invented:C, contradicts:O — widely known; puts an Atlanta back in "Austin" in a committee (false); judgment
- `trade-oracle-02 haiku45 today` (T01, fair: like-for-like RBs): FACT invented:O, invented:C — widely known; "timeshare with health concerns" for a healthy workhorse (false)
- `trade-oracle-02 haiku55 raised` (T01, fair: like-for-like RBs): FACT invented:O — true | FORMAT today: empty: the email goes out with no Oracle analysis; joined: ok → C
- `trade-oracle-02 haiku55 today` (T01, fair: like-for-like RBs): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-oracle-02 sonnet55 raised` (T01, fair: like-for-like RBs): FACT invented:C, contradicts:O — backfield mate now plays for Houston (stale); consistent (grader misread)
- `trade-oracle-02 sonnet55 today` (T01, fair: like-for-like RBs): FACT invented:O, invented:C — widely known; same stale backfield mate | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-oracle-03 haiku45 raised` (T05, 2-for-1: two mid players for a top WR): FACT invented:C, contradicts:O — calls the Giants' lead RB a backup; consistent
- `trade-oracle-03 haiku45 today` (T05, 2-for-1: two mid players for a top WR): FACT invented:O, contradicts:O — widely known; the verdict is consistent with the text
- `trade-oracle-03 haiku55 raised` (T05, 2-for-1: two mid players for a top WR): FACT invented:O, invented:O — judgments | FORMAT today: empty: the email goes out with no Oracle analysis; joined: ok → C
- `trade-oracle-03 haiku55 today` (T05, 2-for-1: two mid players for a top WR): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-oracle-03 sonnet55 raised` (T05, 2-for-1: two mid players for a top WR): FACT invented:O, invented:C, invented:O — true (a 2025 injury); calls a second-year Giants RB a Cowboys rookie; widely known
- `trade-oracle-03 sonnet55 today` (T05, 2-for-1: two mid players for a top WR): FACT invented:C, invented:C, invented:O — a season-ending injury it has no data for; "rookie" again; judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-oracle-04 haiku45 raised` (T01, kicker for kicker): FACT invented:O, invented:O — judgment; judgment
- `trade-oracle-04 haiku45 today` (T01, kicker for kicker): FACT invented:C — "has underperformed this season" for a kicker with no NFL team
- `trade-oracle-04 haiku55 raised` (T01, kicker for kicker): FACT invented:O, invented:O — widely known; true | FORMAT today: empty: the email goes out with no Oracle analysis; joined: ok → C
- `trade-oracle-04 haiku55 today` (T01, kicker for kicker): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-oracle-04 sonnet55 raised` (T01, kicker for kicker): FACT invented:O, invented:O — true
- `trade-oracle-04 sonnet55 today` (T01, kicker for kicker): FACT invented:O, invented:O — true | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-oracle-05 haiku45 raised` (T07, QB for QB): FACT contradicts:C, invented:O — reverses who sends the QB; judgment
- `trade-oracle-05 haiku45 today` (T07, QB for QB): FACT contradicts:C, invented:O — reverses it; speculation
- `trade-oracle-05 haiku55 raised` (T07, QB for QB): FORMAT today: empty: the email goes out with no Oracle analysis; joined: ok → C
- `trade-oracle-05 haiku55 today` (T07, QB for QB): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-oracle-05 sonnet55 raised` (T07, QB for QB): FACT invented:C — "among the most productive this season": no data
- `trade-oracle-05 sonnet55 today` (T07, QB for QB): FACT invented:O, invented:O — generic; conditional | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-oracle-06 haiku45 raised` (T01, an injured-reserve player plus a bench piece for a healthy starter): FACT invented:C, contradicts:O — "inconsistent this season": no data; [player] IS an Eagle (grader misread)
- `trade-oracle-06 haiku45 today` (T01, an injured-reserve player plus a bench piece for a healthy starter): FACT contradicts:O, invented:O, invented:O — true; judgment; judgment
- `trade-oracle-06 haiku55 raised` (T01, an injured-reserve player plus a bench piece for a healthy starter): FACT contradicts:O, invented:O — TRUE: two assets (a WR and a defense); judgment | FORMAT today: empty: the email goes out with no Oracle analysis; joined: ok → C
- `trade-oracle-06 haiku55 today` (T01, an injured-reserve player plus a bench piece for a healthy starter): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-oracle-06 sonnet55 raised` (T01, an injured-reserve player plus a bench piece for a healthy starter): FACT contradicts:O, contradicts:O, invented:O — TRUE: [player] plus the Panthers defense; true; widely known
- `trade-oracle-06 sonnet55 today` (T01, an injured-reserve player plus a bench piece for a healthy starter): FACT contradicts:O, invented:C — true; names a teammate who plays for New England this season | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-oracle-07 haiku45 raised` (T09, 3-for-1 lopsided: three low-value players for their best): FACT invented:O — widely known; "backup kicker" is a fantasy bench role
- `trade-oracle-07 haiku45 today` (T09, 3-for-1 lopsided: three low-value players for their best): FACT invented:O, contradicts:C, contradicts:O — judgment; says the side receiving the star is giving production away; covered by 1
- `trade-oracle-07 haiku55 raised` (T09, 3-for-1 lopsided: three low-value players for their best): FACT invented:O — widely known | FORMAT today: empty: the email goes out with no Oracle analysis; joined: ok → C
- `trade-oracle-07 haiku55 today` (T09, 3-for-1 lopsided: three low-value players for their best): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-oracle-07 sonnet55 raised` (T09, 3-for-1 lopsided: three low-value players for their best): FACT invented:O, invented:O — judgments
- `trade-oracle-07 sonnet55 today` (T09, 3-for-1 lopsided: three low-value players for their best): FACT invented:O — judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-oracle-08 haiku55 raised` (T11, TE for TE): FACT invented:O, invented:O — widely known | FORMAT today: empty: the email goes out with no Oracle analysis; joined: ok → C
- `trade-oracle-08 haiku55 today` (T11, TE for TE): FACT invented:O — widely known | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-oracle-08 sonnet55 raised` (T11, TE for TE): FACT invented:O — judgment
- `trade-oracle-08 sonnet55 today` (T11, TE for TE): FACT invented:O — judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `trade-oracle-09 haiku45 raised` (T02, a player with no NFL team for a like-position player): FACT invented:C, invented:C, contradicts:C — invents an injury; "most consistent this season" for a kicker with no NFL team; reverses who acquires him
- `trade-oracle-09 haiku45 today` (T02, a player with no NFL team for a like-position player): FACT invented:C, contradicts:O — "more consistent this season" for a no-team kicker; ambiguous "team holding"
- `trade-oracle-09 haiku55 raised` (T02, a player with no NFL team for a like-position player): FACT invented:O — true | FORMAT today: empty: the email goes out with no Oracle analysis; joined: ok → C
- `trade-oracle-09 haiku55 today` (T02, a player with no NFL team for a like-position player): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `trade-oracle-09 sonnet55 raised` (T02, a player with no NFL team for a like-position player): FACT invented:C, invented:O, invented:O — puts a free-agent kicker on the Raiders (stale); true; widely known
- `trade-oracle-09 sonnet55 today` (T02, a player with no NFL team for a like-position player): FACT invented:C, invented:O — same; true | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C

### waiver-intel

- `waiver-01 haiku45 raised` (T03, best-ranked free agent): FACT invented:O — judgment
- `waiver-01 haiku45 today` (T03, best-ranked free agent): FACT invented:O — judgment
- `waiver-01 haiku55 raised` (T03, best-ranked free agent): FORMAT today: empty: the page shows "…"; joined: ok → C
- `waiver-01 haiku55 today` (T03, best-ranked free agent): FACT invented:O — cut off; judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `waiver-01 sonnet55 today` (T03, best-ranked free agent): FACT bye:O — grader: no bye issue
- `waiver-02 haiku45 raised` (T04, free agent whose team is on bye this week): FACT invented:C — invents an injury for a player with no status flag
- `waiver-02 haiku45 today` (T04, free agent whose team is on bye this week): FACT invented:O, bye:O — widely known role; "add" is not "start this week"
- `waiver-02 haiku55 raised` (T04, free agent whose team is on bye this week): FORMAT today: empty: the page shows "…"; joined: ok → C
- `waiver-02 haiku55 today` (T04, free agent whose team is on bye this week): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `waiver-02 sonnet55 raised` (T04, free agent whose team is on bye this week): FACT invented:O — widely known
- `waiver-02 sonnet55 today` (T04, free agent whose team is on bye this week): FACT invented:O — judgment
- `waiver-03 haiku45 raised` (T05, injured free agent): FACT invented:O — judgment
- `waiver-03 haiku45 today` (T05, injured free agent): FACT invented:O, invented:O — consistent with practice-squad status; judgment
- `waiver-03 haiku55 today` (T05, injured free agent): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `waiver-03 sonnet55 today` (T05, injured free agent): FACT invented:O — judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `waiver-04 haiku45 raised` (T01, kicker for a team that already has two or more): FACT invented:O — true for this league (one K slot)
- `waiver-04 haiku45 today` (T01, kicker for a team that already has two or more): FACT invented:O — judgment
- `waiver-04 haiku55 raised` (T01, kicker for a team that already has two or more): FORMAT today: empty: the page shows "…"; joined: ok → C
- `waiver-04 haiku55 today` (T01, kicker for a team that already has two or more): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `waiver-04 sonnet55 raised` (T01, kicker for a team that already has two or more): FACT invented:O — widely known
- `waiver-04 sonnet55 today` (T01, kicker for a team that already has two or more): FACT invented:O, invented:O — widely known ([player] is a Viking); judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `waiver-05 haiku45 raised` (T07, defense (no team matched "a team with none")): FACT invented:O — harmless roster remark
- `waiver-05 haiku45 today` (T07, defense (no team matched "a team with none")): FACT invented:O — suggestion
- `waiver-05 haiku55 raised` (T07, defense (no team matched "a team with none")): FACT invented:O — grader: fine
- `waiver-05 haiku55 today` (T07, defense (no team matched "a team with none")): FACT contradicts:O — judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `waiver-05 sonnet55 raised` (T07, defense (no team matched "a team with none")): FACT invented:C — "has been a below-average fantasy unit": a performance claim with no data in the inputs
- `waiver-05 sonnet55 today` (T07, defense (no team matched "a team with none")): FACT invented:C — same | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `waiver-06 haiku45 raised` (T08, player with no NFL team): FACT invented:O — consistent with FA
- `waiver-06 haiku45 today` (T08, player with no NFL team): FACT invented:C, invented:O — puts a free agent on the Commanders; judgment
- `waiver-06 haiku55 raised` (T08, player with no NFL team): FACT invented:C — speaks of "his NFL team" for a player listed FA | FORMAT today: empty: the page shows "…"; joined: ok → C
- `waiver-06 haiku55 today` (T08, player with no NFL team): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `waiver-06 sonnet55 raised` (T08, player with no NFL team): FACT invented:C — says a rostered player listed as WR "is a running back" (conflates two different players)
- `waiver-06 sonnet55 today` (T08, player with no NFL team): FACT invented:C — same | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `waiver-07 haiku45 raised` (T09, deep unranked running back): FACT contradicts:O, bye:C, invented:O — judgment; "immediate flex/RB2 upside" relies this week on a Giants RB in the Giants' bye; judgment
- `waiver-07 haiku45 today` (T09, deep unranked running back): FACT invented:C — invents a depth chart (behind a named back who is not in the inputs)
- `waiver-07 haiku55 raised` (T09, deep unranked running back): FACT invented:O — judgment | FORMAT today: empty: the page shows "…"; joined: ok → C
- `waiver-07 haiku55 today` (T09, deep unranked running back): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `waiver-07 sonnet55 raised` (T09, deep unranked running back): FACT bye:O — grader withdrew it
- `waiver-07 sonnet55 today` (T09, deep unranked running back): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `waiver-08 haiku45 raised` (T10, tight end (no team matched "a team whose starting TE is on bye")): FACT invented:O — judgment
- `waiver-08 haiku55 today` (T10, tight end (no team matched "a team whose starting TE is on bye")): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `waiver-08 sonnet55 raised` (T10, tight end (no team matched "a team whose starting TE is on bye")): FACT invented:C, contradicts:O — calls a second-year TE a rookie; "old role" is consistent
- `waiver-08 sonnet55 today` (T10, tight end (no team matched "a team whose starting TE is on bye")): FACT invented:C — rookie again, and puts him behind a TE who plays for New England | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `waiver-09 haiku45 raised` (T01, quarterback for a team that already has two): FACT contradicts:O — judgment
- `waiver-09 haiku55 raised` (T01, quarterback for a team that already has two): FACT invented:O, invented:O — judgment
- `waiver-09 haiku55 today` (T01, quarterback for a team that already has two): FACT contradicts:O, invented:O — muddled judgment | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `waiver-09 sonnet55 raised` (T01, quarterback for a team that already has two): FACT invented:O — hypothetical
- `waiver-09 sonnet55 today` (T01, quarterback for a team that already has two): FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C
- `waiver-10 haiku45 raised` (T12, empty roster (synthetic)): FACT invented:O — widely known role
- `waiver-10 haiku45 today` (T12, empty roster (synthetic)): FACT invented:O — judgment
- `waiver-10 haiku55 raised` (T12, empty roster (synthetic)): FORMAT today: empty: the page shows "…"; joined: ok → C
- `waiver-10 haiku55 today` (T12, empty roster (synthetic)): FORMAT today: cut off by max_tokens (nothing shown); joined: cut off by max_tokens → C
- `waiver-10 sonnet55 raised` (T12, empty roster (synthetic)): FACT invented:O, invented:O — both true and widely known
- `waiver-10 sonnet55 today` (T12, empty roster (synthetic)): FACT invented:O — widely known | FORMAT today: cut off by max_tokens; joined: cut off by max_tokens → C

### newsletter

- `newsletter-01 haiku45 raised` (-, week 1): FACT contradicts:O, contradicts:O, arithmetic:O — judgment; fine; 84 matches the N blowout
- `newsletter-01 haiku45 today` (-, week 1): FACT arithmetic:O, contradicts:O — correct; drama
- `newsletter-01 haiku55 raised` (-, week 1): FACT contradicts:C, contradicts:O — Angel's N was not the bottom (N, N, N were lower); fine | FORMAT today: Anthropic returned empty content; joined: ok → C
- `newsletter-01 haiku55 today` (-, week 1): FACT contradicts:C — N was the 5th-highest score, not 2nd | FORMAT today: Anthropic returned empty content; joined: Newsletter was cut off by max_tokens (2069 chars). Raise max_tokens or shorten the prompt target. → C
- `newsletter-01 sonnet55 raised` (-, week 1): FACT invented:O, contradicts:O — drama (the team is T04); fine
- `newsletter-01 sonnet55 today` (-, week 1): FACT contradicts:O, contradicts:O — true; framing
- `newsletter-02 haiku45 raised` (-, week 2): FACT contradicts:C, contradicts:C, contradicts:O — T08 N written as N; Bengals N written as N (adds the +12 token bonus again); "claiming" Recon is drama
- `newsletter-02 haiku45 today` (-, week 2): FACT contradicts:O, invented:O — no contradiction; drama
- `newsletter-02 haiku55 raised` (-, week 2): FACT contradicts:O, contradicts:O — drama; muddled phrase | FORMAT today: Anthropic returned empty content; joined: ok → C
- `newsletter-02 haiku55 today` (-, week 2): FACT invented:O, invented:C — true; invents a late charge | FORMAT today: Anthropic returned empty content; joined: Newsletter was cut off by max_tokens (1484 chars). Raise max_tokens or shorten the prompt target. → C
- `newsletter-02 sonnet55 raised` (-, week 2): FACT contradicts:O, contradicts:C, contradicts:O — two hero-vs-hero games is right; N is 3rd, not 2nd; correct
- `newsletter-02 sonnet55 today` (-, week 2): FACT contradicts:O, contradicts:O, invented:O — the climb is true; correct; drama
- `newsletter-03 haiku45 raised` (-, week 3): FACT contradicts:C, contradicts:O, contradicts:O, contradicts:C — says T05 took a second loss (they won, 2-1); Angel's second straight loss is true; fine; Dark Night's N tops T06
- `newsletter-03 haiku45 today` (-, week 3): FACT arithmetic:O, invented:O, contradicts:O — correct; ambiguous; Villains did win weeks 2 and 3
- `newsletter-03 haiku55 raised` (-, week 3): FACT contradicts:O, invented:O, invented:C, invented:C — true; drama; "record-setting" (N in Week 1 is higher); invents a rematch next week | FORMAT today: Anthropic returned empty content; joined: ok → C
- `newsletter-03 haiku55 today` (-, week 3): FORMAT today: Anthropic returned empty content; joined: Newsletter was cut off by max_tokens (1688 chars). Raise max_tokens or shorten the prompt target. → C
- `newsletter-03 sonnet55 raised` (-, week 3): FACT invented:O, invented:O — drama; TRUE (the two unbeatens did meet in Week 4)
- `newsletter-03 sonnet55 today` (-, week 3): FACT invented:O, contradicts:O — plausible speculation; correct
- `newsletter-04 haiku45 raised` (-, week 4): FACT contradicts:C, invented:O, contradicts:O — calls points-for "projected points"; generic drama; fine
- `newsletter-04 haiku45 today` (-, week 4): FACT contradicts:O, contradicts:O — tokens are awarded, so "winning" is fair; judgment
- `newsletter-04 haiku55 raised` (-, week 4): FACT contradicts:O — fine | FORMAT today: Anthropic returned empty content; joined: ok → C
- `newsletter-04 haiku55 today` (-, week 4): FACT invented:O, invented:C — N WAS the season high; invents a comeback | FORMAT today: Anthropic returned empty content; joined: Newsletter was cut off by max_tokens (1151 chars). Raise max_tokens or shorten the prompt target. → C
- `newsletter-04 sonnet55 raised` (-, week 4): FACT invented:O, contradicts:O — drama; consistent | FORMAT today: Anthropic returned empty content; joined: ok → C
- `newsletter-04 sonnet55 today` (-, week 4): FACT contradicts:O — consistent | FORMAT today: Anthropic returned empty content; joined: Newsletter was cut off by max_tokens (1677 chars). Raise max_tokens or shorten the prompt target. → C
- `newsletter-05 haiku45 raised` (-, week 5): FACT contradicts:C, contradicts:O, invented:O — says T06 "stumbles further" in a week it won N-N; muddled; drama
- `newsletter-05 haiku45 today` (-, week 5): FACT contradicts:C, contradicts:O, contradicts:O — "three teams armed with Mulligan" (two); fine; "narrow" is a judgment
- `newsletter-05 haiku55 raised` (-, week 5): FACT contradicts:O, contradicts:O — correct (5 villain wins); consistent | FORMAT today: Anthropic returned empty content; joined: ok → C
- `newsletter-05 haiku55 today` (-, week 5): FACT invented:O, contradicts:C — true (Heroes won Week 4); N is not the most PF (N) | FORMAT today: Anthropic returned empty content; joined: Newsletter was cut off by max_tokens (1779 chars). Raise max_tokens or shorten the prompt target. → C
- `newsletter-05 sonnet55 raised` (-, week 5): FACT contradicts:O — consistent
- `newsletter-05 sonnet55 today` (-, week 5): FACT contradicts:C, contradicts:C, contradicts:O — "six of seven" (five); N is 5th, not 4th; fine
- `newsletter-06 haiku45 raised` (-, week 6): FACT contradicts:O, contradicts:O — accurate; real PF gap
- `newsletter-06 haiku45 today` (-, week 6): FACT contradicts:C, invented:O, contradicts:C, contradicts:O, contradicts:O — invents a 1-5 record (they were 2-4); flourish; calls a 4-2 team a losing campaign; token wording loose
- `newsletter-06 haiku55 raised` (-, week 6): FACT invented:O, contradicts:O, contradicts:O — drama; judgments | FORMAT today: Anthropic returned empty content; joined: ok → C
- `newsletter-06 haiku55 today` (-, week 6): FACT invented:C — calls N the season high (N in Week 4) | FORMAT today: Anthropic returned empty content; joined: Newsletter was cut off by max_tokens (1443 chars). Raise max_tokens or shorten the prompt target. → C
- `newsletter-06 sonnet55 raised` (-, week 6): FACT arithmetic:O — correct
- `newsletter-07 haiku45 raised` (-, week 7): FACT contradicts:C, invented:O — N is the HIGHEST PF, not second; framing
- `newsletter-07 haiku45 today` (-, week 7): FACT invented:O, contradicts:C — true (Villains won Week 6 too); four villain token bonuses, not three
- `newsletter-07 haiku55 raised` (-, week 7): FACT invented:C, contradicts:O, contradicts:C — "rose from the ashes of Week 6" (Villains won Week 6); rhetorical; calls a team that lost this week "rising" | FORMAT today: Anthropic returned empty content; joined: ok → C
- `newsletter-07 haiku55 today` (-, week 7): FACT invented:O — drama | FORMAT today: Anthropic returned empty content; joined: Newsletter was cut off by max_tokens (1608 chars). Raise max_tokens or shorten the prompt target. → C
- `newsletter-07 sonnet55 raised` (-, week 7): FACT arithmetic:O — correct
- `newsletter-07 sonnet55 today` (-, week 7): FACT invented:O — drama | FORMAT today: Anthropic returned empty content; joined: Newsletter was cut off by max_tokens (1560 chars). Raise max_tokens or shorten the prompt target. → C
- `newsletter-08 haiku45 raised` (-, week 8): FACT arithmetic:C, contradicts:O — credits Second Wind with lifting a margin where no token bonus is listed; consistent
- `newsletter-08 haiku45 today` (-, week 8): FACT contradicts:C, invented:C, contradicts:C, contradicts:C, contradicts:O — gives T08 the opponent's Triple Threat; "season-high" N (N in Week 4); "Heroes won the regular-season battle" (Villains won six of eight weeks); says the winning team's token was its undoing; drama
- `newsletter-08 haiku55 raised` (-, week 8): FACT invented:O, invented:C — drama; "record-setting" N | FORMAT today: Anthropic returned empty content; joined: ok → C
- `newsletter-08 haiku55 today` (-, week 8): FACT invented:O — drama | FORMAT today: Anthropic returned empty content; joined: Newsletter was cut off by max_tokens (1491 chars). Raise max_tokens or shorten the prompt target. → C
- `newsletter-08 sonnet55 today` (-, week 8): FACT invented:O — flavour
