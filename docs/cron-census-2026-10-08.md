# Cron census — the five GitHub Actions schedules, counted

Measured **2026-10-13 16:58Z** from the public Actions API (`scripts/cron-census.mjs`, 42 GET requests, no token). Covers every run GitHub still lists: 2,621 runs across the five workflows, from 2026-06-23 to the measurement time. Nothing was triggered, re-run or cancelled to produce this; the script is read-only and re-runnable with `node scripts/cron-census.mjs`.

Counts and statuses only. A green run means one `curl` got a 2xx. It does not mean the route did what the week needed.

---

## Findings, in the order they matter

**1. The three Wednesday jobs are late every week, and the delay is still growing.** `finalize-week` has run on all 11 scheduled Wednesdays since its YAML became valid (2026-07-29 onward) and was late on all 11. The delay was 38–46 minutes in mid-August, jumped to 4h58m on 09-02, and has grown every single week since: 5h10m, 5h27m, 5h35m, 6h22m, **7h15m on 10-07**. The last two weekly increments were +47 and +53 minutes, so it is accelerating, not plateauing. `generate-newsletter` and `sync-projections` track it exactly (7h08m and 7h28m late on 10-07). Finalize for 10-07 ran at 14:14Z, which is 10:14 Eastern. Nothing missed a week, and nothing ran out of order (see finding 4), but the margin before Thursday-night lock is shrinking by about an hour a week.

**2. Live scoring has holes, and the workflow's own claim that "there is always exactly one active looper" is false about half the time.** Since the loop commit `dfacef2` (2026-09-27), GitHub has started 80 runs against 1,600 declared slots (5.0%). The median gap between consecutive run starts is **5h09m**, the 90th percentile **7h00m**, the worst **8h58m** (2026-10-12 11:22Z → 20:20Z). Each run covers at most 5h18m, so 39 of the 79 run-to-run transitions were a hole, not a replacement. In total **12.6% of wall-clock time since 09-27 had no scoring run in progress** (35 holes longer than 15 minutes, 50h21m of 400h). Inside NFL game windows the luck was better: 2 holes in 8 windows, totalling 1h41m of 56h:

| window | no run in progress | length | what ended the run before it |
|---|---|---|---|
| Monday night 2026-10-06 | 00:15Z (kickoff) → 01:26Z | **1h11m** | the previous run "failed" at 20:54Z on 10-05, but it never ran a tick: GitHub's annotation says the job was not acquired by a hosted runner after multiple attempts |
| Monday night 2026-10-13 | 01:37Z → 02:07Z | 30m | the previous run finished its 5h30m loop on its own |

So the 71-minute Monday Night hole reported on 10-07 is confirmed, and it happened again the following Monday night. Two of the three Monday nights since the loop went in had a hole; both Thursday nights and all three Sundays were covered.

**3. There have been about 390 failed scheduled runs, all in three streaks before the season, and all of them were HTTP errors from the app, not GitHub.** `score-matchups` failed 155 times and `process-waivers` 243 times. GitHub's failure annotations (readable; the logs are not, see section 7) say: 149 + 241 ended with curl's exit code for a non-2xx reply (the July version of the score workflow exited 1 on any non-200; the waiver workflow exits 22 under `--fail`), 5 never got a runner, 1 loop was killed by SIGTERM. The streaks: **2026-07-11 to 07-21** (both workflows, every run, 11 days), **2026-08-14 to 08-17** (waivers only, every run), **2026-09-01 to 09-06** (waivers, 32 runs) plus singletons on 08-06, 08-24, 09-12 and 09-13. Since the single failure on 2026-09-13, `process-waivers` has not failed once, and `score-matchups` has failed twice (10-02 killed, 10-05 no runner), neither of them a bad reply from the app. What the routes replied in those streaks is not established (section 10).

**4. The order held every week, by luck, not by design.** On all 11 Wednesdays the newsletter started 13 to 39 minutes *after* finalize had finished, and `sync-projections` 43 minutes to 1h28m after. No `process-waivers` run overlapped a finalize run. Nothing enforces this: the three delays are independent draws from the same GitHub queue that happen to come out in cron order. If the newsletter ever starts first, it fails loudly for every league and the week's newsletter is never generated automatically (section 3 has the lines).

**5. GitHub delivers a small and shrinking fraction of the declared slots, and the fraction fell off a cliff at the start of the season.** Monthly delivery for the two frequent jobs:

| period | score-matchups (slots → runs) | process-waivers (slots → runs) |
|---|---|---|
| 2026-07 | 2,496 → 378 (15.1%) | 744 → 333 (44.8%) |
| 2026-08 | 2,592 → 760 (29.3%) | 744 → 495 (66.5%) |
| 2026-09-01 → 09-23 (P1 ends) | 1,824 → 139 (7.6%) | 720 → 179 (24.9%) for the whole of September |
| 2026-09-23 → 09-27 (P2) | 335 → 22 (6.6%) | |
| 2026-09-27 → 10-13 (P3) | 1,600 → 80 (5.0%) | 306 → 54 (17.6%) for 10-01 → 10-13 |

September is when the Wednesday delays jumped too. The history cannot say why GitHub throttled harder from September; it only shows that it did.

**6. `finalize-week`'s 91 runs are 79 push-event parse failures (2026-06-23 to 07-22, the invalid-YAML period the file's own header explains) + 1 `workflow_dispatch` + 11 scheduled, as previously measured.** Nothing to chase.

**7. Where `CLAUDE.md` disagrees with the measurement (not fixed here):** it lists four cron workflows (score, newsletter, waivers, finalize); there are five, `sync-projections` (Wednesday 08:00Z) is missing. It says score-matchups runs "every 15min game days"; the cron has been every day since 09-23 and GitHub fires it 2 to 7 times a day, never 96. Its key-file list has four cron routes; `src/app/api/cron/` has six (`sync-projections` and `story-engine` are missing).

---

## How it was measured

- `scripts/cron-census.mjs` reads `/actions/workflows/<file>/runs` with `per_page=100` and the `created` filter, one calendar month per window, paging each window, splitting any window the API would cap at 1,000 results. 42 requests for the whole census.
- From this sandbox, node reaches `api.github.com` only through the sandbox proxy (`NODE_USE_ENV_PROXY=1 node scripts/cron-census.mjs`); a direct call from node hits the shared egress IP's exhausted unauthenticated limit. `gh api` worked. The script also accepts `--from DIR` to read saved `gh api` output, and `--cache DIR` to save raw pages for offline re-analysis; neither output is committed.
- Expected slots come from the cron line in force on each date. Git history only starts 2026-09-08 (the repo was re-rooted), so the pre-September line was read from the Contents API at nine older commits that the runs' `head_sha` point to (06-25 through 09-23); every one of them carries `0,15,30,45 * * * 0,1,2,4,5,6`. Period boundaries are the commit times of `7b36bbb` (2026-09-23 13:02:57Z) and `dfacef2` (2026-09-27 00:54:39Z).
- Delay for a Wednesday job = `run_started_at` minus the cron slot that precedes the run's `created_at`. A run's coverage = `run_started_at` to `updated_at`. Durations are `updated_at` minus `run_started_at` for completed runs.
- Game windows (UTC, Eastern = UTC-4 until November 1): Thursday night = Friday 00:15Z–04:15Z; Sunday = 17:00Z–Monday 05:00Z; Monday night = Tuesday 00:15Z–04:15Z.

---

## 1. Per workflow: runs by event and by conclusion

| workflow | runs | by event | by conclusion |
|---|---|---|---|
| score-matchups | 1,434 | schedule 1,430 · workflow_dispatch 4 | success 1,239 · failure 155 · cancelled 40 |
| process-waivers | 1,074 | schedule 1,074 | success 831 · failure 243 |
| finalize-week | 91 | push 79 · schedule 11 · workflow_dispatch 1 | success 12 · failure 79 (all push) |
| generate-newsletter | 17 | schedule 15 · workflow_dispatch 2 | success 16 · failure 1 |
| sync-projections | 5 | schedule 5 | success 5 |

`score-matchups` by period (never mixed):

| period | cron | runs | events | conclusions |
|---|---|---|---|---|
| P1 one curl, no Wednesday slots (to 2026-09-23 13:02Z) | `0,15,30,45 * * * 0,1,2,4,5,6` | 1,332 | schedule 1,329 · dispatch 3 | success 1,179 · failure 153 |
| P2 one curl, every day (to 2026-09-27 00:54Z) | `0,15,30,45 * * * *` | 22 | schedule 22 | success 22 |
| P3 5h30m loop + `concurrency` (since `dfacef2`) | `0,15,30,45 * * * *` | 80 | schedule 79 · dispatch 1 | success 38 · cancelled 40 · failure 2 |

**Failed or timed-out runs on `schedule` / `workflow_dispatch`** (every one is linked in Appendix A): score-matchups 155, process-waivers 243, generate-newsletter 1 (2026-07-15 09:27Z, exit 1 = the route answered something other than 200/207), finalize-week 0, sync-projections 0. No run of any workflow ever `timed_out`.

**`finalize-week` push failures:** 79, from 2026-06-23 to 2026-07-22, counted not linked.

**`score-matchups` cancelled runs:** 40, all in P3. **All 40 were followed by a new run that started within a minute of the cancellation** (the replacement usually starts one to two minutes *before* the cancel is recorded, because the new run is what cancels the old one). None were orphaned, so none are linked.

---

## 2. The three Wednesday jobs: slot → `run_started_at`

No Wednesday is missing a run for any of the three. Every scheduled run was matched to exactly one slot.

### finalize-week (`0 7 * * 3`), 11 slots since the YAML became valid, 11 runs

| slot (UTC) | run started | delay | ran for | conclusion |
|---|---|---|---|---|
| 2026-07-29 07:00Z | 09:37Z | 2h38m | 9s | success |
| 2026-08-05 07:00Z | 09:37Z | 2h37m | 9s | success |
| 2026-08-12 07:00Z | 08:17Z | 1h17m | 8s | success |
| 2026-08-19 07:00Z | 07:37Z | 38m | 8s | success |
| 2026-08-26 07:00Z | 07:46Z | 46m | 9s | success |
| 2026-09-02 07:00Z | 11:57Z | 4h58m | 14s | success |
| 2026-09-09 07:00Z | 12:10Z | 5h10m | 10s | success |
| 2026-09-16 07:00Z | 12:26Z | 5h27m | 46s | success |
| 2026-09-23 07:00Z | 12:35Z | 5h35m | 9s | success |
| 2026-09-30 07:00Z | 13:21Z | 6h22m | 9s | success |
| 2026-10-07 07:00Z | 14:14Z | **7h15m** | 9s | success |

The previous count (37–46 min in late August, 4h57m on 09-02, 7h14m on 10-07) is confirmed to the minute. **Is the delay still growing? Yes.** Six consecutive weekly increases since 09-02, and the increments are getting larger (+12, +17, +8, +47, +53 minutes).

### generate-newsletter (`30 7 * * 3`), 15 slots since creation, 15 runs

| slot (UTC) | run started | delay | conclusion |
|---|---|---|---|
| 2026-07-01 07:30Z | 16:41Z | 9h11m | success |
| 2026-07-08 07:30Z | 09:43Z | 2h14m | success |
| 2026-07-15 07:30Z | 09:27Z | 1h57m | **failure** |
| 2026-07-22 07:30Z | 09:55Z | 2h26m | success |
| 2026-07-29 07:30Z | 10:04Z | 2h35m | success |
| 2026-08-05 07:30Z | 10:04Z | 2h34m | success |
| 2026-08-12 07:30Z | 08:44Z | 1h15m | success |
| 2026-08-19 07:30Z | 08:01Z | 31m | success |
| 2026-08-26 07:30Z | 08:06Z | 36m | success |
| 2026-09-02 07:30Z | 12:12Z | 4h42m | success |
| 2026-09-09 07:30Z | 12:24Z | 4h55m | success |
| 2026-09-16 07:30Z | 12:41Z | 5h11m | success |
| 2026-09-23 07:30Z | 12:51Z | 5h21m | success |
| 2026-09-30 07:30Z | 14:01Z | 6h31m | success |
| 2026-10-07 07:30Z | 14:37Z | **7h08m** | success |

The July runs predate finalize-week being valid YAML and predate the season (the route no-ops out of season), so only the rows from 07-29 bear on the order question. The one 9h11m outlier on 07-01 shows that delays of this size are not new to September; what is new is that every week has one.

### sync-projections (`0 8 * * 3`), 5 slots since creation, 5 runs

| slot (UTC) | run started | delay | conclusion |
|---|---|---|---|
| 2026-09-09 08:00Z | 12:53Z | 4h54m | success |
| 2026-09-16 08:00Z | 13:23Z | 5h24m | success |
| 2026-09-23 08:00Z | 13:33Z | 5h33m | success |
| 2026-09-30 08:00Z | 14:50Z | 6h50m | success |
| 2026-10-07 08:00Z | 15:27Z | **7h28m** | success |

---

## 3. The order question

### What the history shows

| Wednesday | finalize ran (start → end) | newsletter started | after finalize finished? | sync-projections started | after finalize finished? | waiver runs overlapping finalize |
|---|---|---|---|---|---|---|
| 2026-07-29 | 09:37Z → 09:37Z | 10:04Z | yes, +27m | — | — | 0 |
| 2026-08-05 | 09:37Z → 09:37Z | 10:04Z | yes, +27m | — | — | 0 |
| 2026-08-12 | 08:17Z → 08:17Z | 08:44Z | yes, +27m | — | — | 0 |
| 2026-08-19 | 07:37Z → 07:37Z | 08:01Z | yes, +23m | — | — | 0 |
| 2026-08-26 | 07:46Z → 07:46Z | 08:06Z | yes, +20m | — | — | 0 |
| 2026-09-02 | 11:57Z → 11:58Z | 12:12Z | yes, +14m | — | — | 0 |
| 2026-09-09 | 12:10Z → 12:10Z | 12:24Z | yes, +14m | 12:53Z | yes, +43m | 0 |
| 2026-09-16 | 12:26Z → 12:27Z | 12:41Z | yes, +13m | 13:23Z | yes, +56m | 0 |
| 2026-09-23 | 12:35Z → 12:35Z | 12:51Z | yes, +16m | 13:33Z | yes, +58m | 0 |
| 2026-09-30 | 13:21Z → 13:21Z | 14:01Z | yes, +39m | 14:50Z | yes, +1h28m | 0 |
| 2026-10-07 | 14:14Z → 14:14Z | 14:37Z | yes, +23m | 15:27Z | yes, +1h13m | 0 |

Eleven for eleven, with margins as thin as 13 minutes. The three jobs are 30 minutes apart on the clock and GitHub has so far released them in that order, 13 to 40 minutes apart. Nothing in any workflow file ties one to another; each is a `schedule:` trigger and a single `curl`.

### What the code would do if the order broke

**Newsletter before finalize completes.** `src/app/api/cron/generate-newsletter/route.ts:83-85`: `generateLeagueNewsletter` throws `No complete matchups found` unless at least one row of the week has `is_complete = true`. `is_complete` is set only by the finalize RPC (`supabase/schema-snapshot/functions.sql:1255-1258`, inside `finalize_all_active_leagues`); the scoring edge function reads it (`supabase/functions/score-matchups/index.ts:313`) and never writes it. So with finalize not yet run, every league throws, every result is `ok: false`, and the route answers **500** (`route.ts:458-462`), which the workflow treats as a failure (`generate-newsletter.yml:52-55`). That is loud, but it is also final: the next scheduled run, a week later, targets `getRawNFLWeek() - 1` (`route.ts:311`), i.e. the *next* week, and the idempotency guard (`route.ts:337-357`) never looks back. The missed week is only recoverable by a `workflow_dispatch` with `week=N`. There is no catch-up loop like finalize's (`finalize-week/route.ts:40-61`). If finalize had *partially* run (one league finalized, the next in progress) the newsletter would go out for the finalized league only and the other would be `ok: false` under a 207, which the workflow accepts as green (`generate-newsletter.yml:51`).

**sync-projections before finalize.** `src/app/api/cron/sync-projections/route.ts:44` takes the week from `getRawNFLWeek()` alone and writes `player_projections` for the week about to be played (`route.ts:94-100`). It reads nothing finalize writes. The header's "after finalize-week" (`sync-projections.yml:3-4`) describes the clock, not a dependency; the only ordering that matters is the week rollover at Wednesday 00:00Z (`src/lib/nfl-utils.ts:3`), which every run so far has been 5 to 15 hours past.

**process-waivers during finalize.** `src/app/api/cron/process-waivers/route.ts:62-68` selects leagues by Eastern day/hour and calls `process_waiver_bids` / `process_priority_waivers` (`route.ts:87-96`), which move players between rosters. Finalize (`functions.sql:1248-1450`) marks `uff_matchups` complete, voids results, awards chips and inserts next week's `weekly_token_assignments`. The two touch different tables and neither reads the other's output, so overlapping is not a correctness problem in the code as written. The route's week is `getCurrentNFLWeek()` (`route.ts:55`), the clamped week, which on a Wednesday is already the new week, so a waiver run during finalize processes the *coming* week's bids while finalize settles the *finished* week. Whether a roster move between the last score tick and finalize could change a finalized score is a question for the scoring function, not these two routes, and is not established here.

---

## 4. `score-matchups` and `process-waivers`: slots declared vs runs started

No run is matched to a slot here: the API has no "scheduled for" field, and the gaps are longer than the slot spacing, so a per-slot delay is undefined. Per-day tables are in Appendix B.

| workflow / period | slots declared | runs started | median gap between run starts | p90 | worst gap (when) |
|---|---|---|---|---|---|
| score-matchups P1 (06-23 → 09-23) | 7,525 | 1,332 (17.7%) | 59m | 3h23m | **29h14m** (2026-08-25 23:56Z → 08-27 05:10Z) |
| score-matchups P2 (09-23 → 09-27) | 335 | 22 (6.6%) | 3h22m | 5h08m | 5h43m (2026-09-24 06:16Z → 11:59Z) |
| score-matchups P3 (09-27 → now) | 1,600 | 80 (5.0%) | 5h09m | 7h00m | **8h58m** (2026-10-12 11:22Z → 20:20Z) |
| process-waivers (06-29 → now) | 2,544 | 1,074 (42.2%) | 1h51m | 4h45m | **11h37m** (2026-08-28 09:26Z → 21:04Z) |

In P3 GitHub has fired the schedule 2 to 7 times per UTC day (median 5), against 96 declared. The 29-hour P1 gap on 08-25/27 coincides with 13 distinct commits to the workflow file on 08-25; whether the workflow was disabled, or GitHub simply stopped, is not established.

---

## 5. `score-matchups` coverage since `dfacef2` (the loop)

The file claims (`score-matchups.yml:16-21`) that because each run loops for 5h30m and the longest observed gap was about 5h, "there is always exactly one active looper" and "coverage is continuous". Measured against 80 runs:

- **Run-to-run:** 40 transitions were a replacement (the new run started while the old one was still looping, and cancelled it); **39 were a hole** (the new run started after the old one had already ended).
- **Holes longer than 15 minutes, any hour:** 35, totalling **50h21m of 399h57m (12.6%)**. Longest: 4h32m, 2026-10-05 20:54Z → 10-06 01:26Z.
- **Inside game windows** (8 windows, 56h of game time): 2 holes, 1h41m, both listed in finding 2. Every stretch longer than 15 minutes inside a game window with no run in progress:

| window | hole start | hole end | length | what ended the run before it | next run started |
|---|---|---|---|---|---|
| Mon night 2026-10-06 | 2026-10-06 00:15Z (open at kickoff) | 01:26Z | 1h11m | `failure` at 10-05 20:54Z, job never acquired a runner ([run](https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/37371048144)) | 01:26Z |
| Mon night 2026-10-13 | 2026-10-13 01:37Z | 02:07Z | 30m | finished on its own at 01:37Z ([run](https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/38303583231)) | 02:07Z |

- **The two P3 failures:** 10-05 20:39Z, no runner ever acquired the job (15 minutes of nothing, then marked failed); 10-02 15:21Z, the loop step was killed after 1h15m with exit code 143 (SIGTERM). Neither was a red-at-the-end-of-the-loop failure, so no scoring tick is known to have returned an error since the loop went in.
- Completed loop runs measured 5h12m median, 5h18m worst, never 5h30m, because the loop stops when fewer than 15 minutes remain (`score-matchups.yml:79`).

---

## 6. Run duration (completed runs, push events excluded)

| workflow | period | runs | median | worst |
|---|---|---|---|---|
| score-matchups | P1 | 1,332 | 8s | 15m (2026-08-06 18:45Z, the no-runner case) |
| score-matchups | P2 | 22 | 9s | 29s |
| score-matchups | P3 | 80 | 5h12m (success 5h16m · cancelled 3h37m · failure 1h15m) | 5h18m |
| process-waivers | all | 1,074 | 9s | 1h00m (2026-08-11 14:20Z, success) |
| finalize-week | scheduled + dispatch | 12 | 9s | 46s |
| generate-newsletter | all | 17 | 16s | 29s |
| sync-projections | all | 5 | 10s | 11s |

---

## 7. What the logs say

**The logs could not be read from this sandbox.** `gh run view <id> --log` was tried on all 113 runs of the three Wednesday jobs and all 398 failed runs of the other two (511 in total):

| outcome | runs |
|---|---|
| HTTP 410: log expired (GitHub's 90-day retention; everything before about 2026-07-15) | 127 |
| `Forbidden`: the download redirects to `results-receiver.actions.githubusercontent.com`, which this sandbox's network policy rejects at CONNECT | 384 |
| readable | **0** |

What *was* readable is the check-run annotations API (`/check-runs/{job}/annotations`, on `api.github.com`) and the jobs API, for every failed run. They settle the following and nothing more:

- The 390 non-2xx failures were the app answering an error status, not GitHub: 149 `score-matchups` runs exited 1 (the July workflow exited 1 on any status other than 200), 2 exited 22, and 241 `process-waivers` runs exited 22 (`curl --fail`). The status codes themselves are in the bodies, which are in the logs.
- 5 "failures" never ran: GitHub could not acquire a hosted runner (score-matchups 2026-08-06 ×2 and 10-05; process-waivers 08-06 ×2).
- 1 loop (10-02) was killed with SIGTERM after 1h15m.
- The single newsletter failure (2026-07-15) exited 1: the route answered something other than 200 or 207.

The logs would have settled: what every Wednesday reply said (`perWeek`, `weeksFinalized`, `storyLeagues`, `results[].ok`, `written`), which HTTP status each failed run got, and whether any tick inside a cancelled loop failed. None of that is established. To read them from a machine that can reach the download host:

```
node scripts/cron-census.mjs --cache /tmp/census > /dev/null
for id in $(jq -r '.[].workflow_runs[].id' /tmp/census/*.json); do
  gh run view "$id" -R ecrafrnir3-cmyk/uff-platform --log > "/tmp/census/log-$id.txt"
done
```

Only the last 90 days will answer; the rest are gone.

---

## 8. What would fail silently

From the five workflow files and the six routes under `src/app/api/cron/`. "Alert" means anything that reaches a person without them opening the Actions tab; none of the five has one beyond GitHub's own optional "workflow failed" email to the file's last committer, whose delivery is not established.

**score-matchups.** The run is red only at line 85 of the workflow, after the loop. A cancelled run (40 of 80, the design) never reaches it, so any failed tick inside a cancelled run is visible only in that run's log, under a grey "cancelled" badge. A run that never gets a runner (10-05) is red with zero ticks and no body. The route fails open on an empty or unreachable schedule (`score-matchups/route.ts:18-20, 36-43`) by design. To a manager: the live board stops moving; nothing in the app says when scores were last written. No alert.

**process-waivers.** `curl --silent --show-error --fail` (`process-waivers.yml:16`) discards the body on a non-2xx, so a red run's log holds only an exit code. On a 200 the route reports per-league RPC errors inside `results[].error` (`route.ts:97-102`) and still answers 200, so a league whose processing failed is a green run. A missed hour is caught by the same-day `lte("waiver_hour", …)` catch-up (`route.ts:57-68`), but a whole day with no run (worst gap 11h37m) can skip a league's window for the week. To a manager: bids stay pending, no results email (emails only go out on success, `route.ts:105-195`). No alert.

**finalize-week.** `--fail-with-body` (`finalize-week.yml:16`) only fails on status ≥ 400, and the route answers **207**, not 4xx, when a league was skipped (`finalize-week/route.ts:94-103`), so a skipped league is a green run. The story-engine block (`route.ts:64-90`) swallows every error on purpose; the only trace is `storyLeagues` in the body, and a league whose legends failed to recompute still gets `ok: true`. The catch-up loop (`route.ts:40-61`) does repair a missed Wednesday the following week, which is the one self-healing piece in the set. To a manager: standings freeze, and next week's token is missing, because the RPC inserts `weekly_token_assignments` for week+1 (`functions.sql:1401-1450`). No alert.

**generate-newsletter.** 207 is accepted (`generate-newsletter.yml:51-55`), so one league failing is green. An email failure is caught and logged (`route.ts:411-414`): the newsletter is stored, nobody receives it, the run is green. A week missed for any reason is never retried (section 3). To a manager: no email and no bell for the week; the newsletter page may or may not have it. No alert.

**sync-projections.** The loud one: an empty pull is a 502 and a red run (`sync-projections/route.ts:87-91`). But there is no catch-up: a Wednesday with no run leaves `player_projections` empty for the week, and every roster page shows no projected points until someone dispatches it by hand. No alert.

---

## 9. Recommendations, not implemented

**Kickoff holes.** Nothing on GitHub's free scheduler guarantees a run is alive at a given minute; the guarantee has to come from somewhere GitHub's queue is not.

- Vercel Cron on the Pro plan calling the route every 15 minutes: the route already accepts it, no code change; cost $20/month (previously rejected on cost).
- Supabase `pg_cron` + `pg_net` posting to the route with `CRON_SECRET` from Vault every 15 minutes: no GitHub involvement at all; cost is copying the secret into the database once (previously rejected on that ground).
- Self-chaining: the last tick of each loop dispatches the next run with `gh workflow run` under `permissions: actions: write`; cost is giving the workflow a write token, and the chain still breaks on a no-runner failure like 10-05, so it narrows the holes without closing them.
- Extend the loop to the 6-hour job ceiling (`timeout-minutes: 360`, loop 5h55m): one-line change, no cost, closes only the holes shorter than 40 minutes (about a third of them).
- An explicit `schedule:` line 30 minutes before each kickoff (Sun 16:30Z, Mon/Thu 23:45Z): no cost, but GitHub delays those fires exactly as it delays the others, so it is a bet, not a guarantee.

**The Wednesday delay.**

- Move the three crons off the top and bottom of the hour (for example `17 5 * * 3`): no cost, GitHub's queue is busiest at `:00` and `:30`, but the 7-hour delays are not explained by minute choice alone, so expect improvement, not a fix.
- Schedule finalize at Wednesday 00:30Z instead of 07:00Z: no cost; the route keys on the Wednesday 00:00Z rollover (`src/lib/nfl-utils.ts:3`, `finalize-week/route.ts:33`), Monday night is over by 04:15Z Tuesday, and a 7-hour delay then lands at 07:30Z, where the schedule was meant to run. It buys six and a half hours of margin, not a fix.
- Run finalize from `pg_cron` inside the database, where it already lives as an RPC: no GitHub queue at all; cost is the same secret-handling question as scoring, or none if the RPC is called directly from SQL.

**The newsletter's dependence on finalize.**

- Trigger `generate-newsletter` with `workflow_run: workflows: ["Finalize Week (Auto)"], types: [completed]` and gate the job on `conclusion == 'success'`: no cost, keeps `workflow_dispatch` for repairs; the newsletter then starts one queue delay after finalize ends instead of two independent delays apart, and never before it.
- Add a catch-up loop to the newsletter route like finalize's (generate every finalized week that has no newsletter row): small code change, makes a missed week self-heal next Wednesday instead of needing a manual dispatch.
- Chain `sync-projections` the same way, or leave it on the clock: it has no real dependency on finalize, only on the week rollover.

---

## 10. Not established

- **What any run's HTTP reply said.** Zero logs were readable here (127 expired, 384 blocked by the sandbox's network policy). Every `perWeek`, `weeksFinalized`, `storyLeagues`, `results[].ok` and `written` value is unknown; the annotations give exit codes only.
- **The HTTP status behind the 390 failed runs** in the July, August and September streaks, and therefore what was wrong with the app on those days.
- **Whether the ticks inside the 40 cancelled `score-matchups` runs succeeded.** A cancelled run never reaches its end-of-loop check and its log is the only record.
- **Whether a green `process-waivers` run processed anything.** The league has had no waiver bids; a 200 with `processed: 0` and a 200 with real claims look the same from outside.
- **Whether the newsletter e-mail reached anyone.** Resend's side is not visible from the run history, and an email failure is a green run.
- **Anything older than GitHub's 90-day log retention** (before about 2026-07-15), beyond counts and conclusions.
- **The nightly player sync** (`sync-players`, 4 AM `pg_cron` inside the database): not an Actions workflow, no run history here.
- **Why GitHub's delivery rate fell from September**, and whether it is this repository or GitHub-wide.
- **Why the 10-02 loop was SIGTERMed** after 1h15m, and whether its ticks up to then succeeded.
- **The 29-hour P1 gap on 08-25/27** and the 11h37m waiver gap on 08-28: a disabled workflow and a silent GitHub queue look identical in the run list.
- **Whether GitHub's "scheduled workflow failed" notification e-mails are enabled or reach the owner.**
- **The exact moment each workflow edit took effect** on GitHub's side; commit times are used as the period boundaries.
- **Whether a roster change between the last scoring tick and finalize can alter a finalized score**: a question for the scoring edge function, outside this census.

---

## Appendix A: every failed run on a `schedule` or `workflow_dispatch` event

Format: started (UTC), event, conclusion, duration, link. Push-event parse failures of `finalize-week` (79) are counted in section 1 and not listed; the 40 cancelled `score-matchups` runs were all replaced within a minute and are not listed.

<details><summary>score-matchups: 155 (153 in P1 2026-06-23 → 09-13, 2 in P3: 10-02 and 10-05)</summary>

  - 2026-06-23T14:39Z workflow_dispatch failure after 10s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/28033667309
  - 2026-07-11T01:07Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29134030240
  - 2026-07-11T04:24Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29139556381
  - 2026-07-11T06:30Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29142944921
  - 2026-07-11T08:25Z schedule failure after 10s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29146079860
  - 2026-07-11T09:53Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29148473197
  - 2026-07-11T10:49Z schedule failure after 6s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29149958338
  - 2026-07-11T11:40Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29151345620
  - 2026-07-11T12:37Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29152932374
  - 2026-07-11T14:07Z schedule failure after 6s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29155528480
  - 2026-07-11T15:11Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29157468102
  - 2026-07-11T16:07Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29159211767
  - 2026-07-11T17:11Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29161170432
  - 2026-07-11T18:05Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29162801943
  - 2026-07-11T19:22Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29165135842
  - 2026-07-11T20:13Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29166638450
  - 2026-07-11T21:04Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29168158419
  - 2026-07-11T22:03Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29169855112
  - 2026-07-11T23:06Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29171591205
  - 2026-07-12T00:06Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29173198410
  - 2026-07-12T03:50Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29178828519
  - 2026-07-12T06:22Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29182570328
  - 2026-07-12T08:34Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29186056794
  - 2026-07-12T10:11Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29188726076
  - 2026-07-12T11:24Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29190784903
  - 2026-07-12T12:09Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29192138489
  - 2026-07-12T13:51Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29195165659
  - 2026-07-12T14:44Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29196843485
  - 2026-07-12T15:41Z schedule failure after 6s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29198661117
  - 2026-07-12T16:32Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29200314355
  - 2026-07-12T17:39Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29202399736
  - 2026-07-12T18:32Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29204070824
  - 2026-07-12T19:46Z schedule failure after 10s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29206453172
  - 2026-07-12T20:32Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29207913144
  - 2026-07-12T21:29Z schedule failure after 31s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29209722170
  - 2026-07-12T22:22Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29211419273
  - 2026-07-12T23:12Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29212985649
  - 2026-07-13T00:08Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29214724532
  - 2026-07-13T03:53Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29222667847
  - 2026-07-13T06:41Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29229729669
  - 2026-07-13T09:56Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29240967336
  - 2026-07-13T12:26Z schedule failure after 6s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29249844270
  - 2026-07-13T15:18Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29261667876
  - 2026-07-13T17:25Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29270384631
  - 2026-07-13T18:52Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29276237834
  - 2026-07-13T20:03Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29280892182
  - 2026-07-13T21:10Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29285305912
  - 2026-07-13T22:05Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29288731440
  - 2026-07-13T23:08Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29292134154
  - 2026-07-14T00:02Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29294816761
  - 2026-07-14T03:28Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29303591007
  - 2026-07-14T05:49Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29309533326
  - 2026-07-14T07:30Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29314794451
  - 2026-07-14T09:28Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29321816239
  - 2026-07-14T11:04Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29327603947
  - 2026-07-14T12:21Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29332151532
  - 2026-07-14T14:19Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29340330490
  - 2026-07-14T15:52Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29347246132
  - 2026-07-14T16:58Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29351803887
  - 2026-07-14T17:58Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29355958263
  - 2026-07-14T19:11Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29360886772
  - 2026-07-14T20:20Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29365358791
  - 2026-07-14T21:26Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29369549667
  - 2026-07-14T22:27Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29373048703
  - 2026-07-14T23:23Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29375982133
  - 2026-07-15T00:10Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29378279882
  - 2026-07-16T01:12Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29463543252
  - 2026-07-16T04:23Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29471266628
  - 2026-07-16T06:37Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29477290947
  - 2026-07-16T08:58Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29485421981
  - 2026-07-16T10:55Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29492576943
  - 2026-07-16T12:13Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29497300731
  - 2026-07-16T14:20Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29506133317
  - 2026-07-16T15:51Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29513014739
  - 2026-07-16T16:58Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29517804401
  - 2026-07-16T18:01Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29522230246
  - 2026-07-16T19:31Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29528360585
  - 2026-07-16T20:31Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29532417930
  - 2026-07-16T21:41Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29536968410
  - 2026-07-16T22:35Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29540016821
  - 2026-07-16T23:33Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29542435457
  - 2026-07-17T01:08Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29546655930
  - 2026-07-17T04:20Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29554592086
  - 2026-07-17T06:32Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29560327721
  - 2026-07-17T08:53Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29567975334
  - 2026-07-17T10:27Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29573522582
  - 2026-07-17T11:48Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29578102090
  - 2026-07-17T12:53Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29581900364
  - 2026-07-17T14:21Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29587674807
  - 2026-07-17T15:50Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29593766925
  - 2026-07-17T16:54Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29598016093
  - 2026-07-17T17:53Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29601775196
  - 2026-07-17T18:45Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29605018465
  - 2026-07-17T19:54Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29609249512
  - 2026-07-17T20:39Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29611991398
  - 2026-07-17T21:28Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29614857881
  - 2026-07-17T22:13Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29617223600
  - 2026-07-17T23:06Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29619795172
  - 2026-07-18T00:04Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29622273541
  - 2026-07-18T03:25Z schedule failure after 10s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29628797547
  - 2026-07-18T05:39Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29632633510
  - 2026-07-18T07:16Z schedule failure after 10s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29635452000
  - 2026-07-18T09:05Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29638563480
  - 2026-07-18T10:37Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29641139801
  - 2026-07-18T11:33Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29642759143
  - 2026-07-18T12:33Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29644542086
  - 2026-07-18T14:04Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29647340020
  - 2026-07-18T15:10Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29649444069
  - 2026-07-18T16:07Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29651332372
  - 2026-07-18T17:09Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29653385311
  - 2026-07-18T18:04Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29655141687
  - 2026-07-18T19:20Z schedule failure after 6s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29657606763
  - 2026-07-18T20:09Z schedule failure after 5s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29659165570
  - 2026-07-18T21:01Z schedule failure after 10s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29660837386
  - 2026-07-18T22:03Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29662737018
  - 2026-07-18T23:05Z schedule failure after 6s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29664608760
  - 2026-07-19T00:04Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29666351073
  - 2026-07-19T03:47Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29672290969
  - 2026-07-19T06:19Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29676250518
  - 2026-07-19T08:38Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29680167405
  - 2026-07-19T10:11Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29682909117
  - 2026-07-19T11:21Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29684971080
  - 2026-07-19T12:09Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29686466244
  - 2026-07-19T13:47Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29689559681
  - 2026-07-19T14:44Z schedule failure after 10s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29691423137
  - 2026-07-19T15:37Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29693232362
  - 2026-07-19T16:31Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29695031459
  - 2026-07-19T17:38Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29697219256
  - 2026-07-19T18:33Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29698929897
  - 2026-07-19T19:49Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29701326680
  - 2026-07-19T20:34Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29702775897
  - 2026-07-19T21:30Z schedule failure after 23s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29704492045
  - 2026-07-19T22:30Z schedule failure after 47s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29706273875
  - 2026-07-19T23:36Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29708184062
  - 2026-07-20T01:10Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29710533128
  - 2026-07-20T04:48Z schedule failure after 10s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29717729801
  - 2026-07-20T07:48Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29725786460
  - 2026-07-20T10:35Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29735608550
  - 2026-07-20T12:37Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29742916395
  - 2026-07-20T14:52Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29752606556
  - 2026-07-20T16:17Z schedule failure after 10s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29758976468
  - 2026-07-20T18:25Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29767688802
  - 2026-07-20T20:01Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29774375452
  - 2026-07-20T21:20Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29779774756
  - 2026-07-20T22:26Z schedule failure after 9s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29783950359
  - 2026-07-20T23:28Z schedule failure after 7s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29787307948
  - 2026-07-21T00:56Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29791748011
  - 2026-07-21T04:09Z schedule failure after 8s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29800488800
  - 2026-07-21T06:38Z schedule failure after 6s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29807656087
  - 2026-08-06T17:16Z schedule failure after 15m → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31122658935
  - 2026-08-06T18:45Z schedule failure after 15m → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31126317157
  - 2026-09-12T09:00Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/34684713370
  - 2026-09-13T06:05Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/34741879943
  - 2026-10-02T15:21Z schedule failure after 1h15m → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/37026422087
  - 2026-10-05T20:39Z schedule failure after 15m → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/37371048144

</details>

<details><summary>process-waivers: 243 (2026-07-11 → 09-13)</summary>

  - 2026-07-11T02:26Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29136335736
  - 2026-07-11T05:38Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29141520721
  - 2026-07-11T07:51Z schedule failure after 13s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29145183747
  - 2026-07-11T09:26Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29147712209
  - 2026-07-11T11:02Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29150316727
  - 2026-07-11T13:12Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29153937567
  - 2026-07-11T14:50Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29156840986
  - 2026-07-11T15:53Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29158747215
  - 2026-07-11T16:54Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29160644045
  - 2026-07-11T17:53Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29162446454
  - 2026-07-11T18:58Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29164431012
  - 2026-07-11T20:07Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29166479809
  - 2026-07-11T21:46Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29169366072
  - 2026-07-11T22:43Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29170996399
  - 2026-07-11T23:52Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29172801863
  - 2026-07-12T02:30Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29176874411
  - 2026-07-12T05:55Z schedule failure after 45s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29181869054
  - 2026-07-12T08:13Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29185488782
  - 2026-07-12T10:25Z schedule failure after 46s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29189087107
  - 2026-07-12T11:57Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29191748090
  - 2026-07-12T13:34Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29194662112
  - 2026-07-12T14:53Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29197125376
  - 2026-07-12T15:57Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29199191440
  - 2026-07-12T17:02Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29201246420
  - 2026-07-12T19:01Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29204993281
  - 2026-07-12T20:41Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29208223980
  - 2026-07-12T21:46Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29210251171
  - 2026-07-12T22:43Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29212086337
  - 2026-07-12T23:51Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29214144146
  - 2026-07-13T02:32Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29219731170
  - 2026-07-13T06:14Z schedule failure after 13s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29228397251
  - 2026-07-13T10:23Z schedule failure after 18s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29242562877
  - 2026-07-13T13:21Z schedule failure after 18s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29253450306
  - 2026-07-13T16:30Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29266700809
  - 2026-07-13T18:41Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29275495425
  - 2026-07-13T20:12Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29281478438
  - 2026-07-13T21:53Z schedule failure after 13s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29288023262
  - 2026-07-13T22:54Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29291362789
  - 2026-07-13T23:52Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29294318782
  - 2026-07-14T02:11Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29300460156
  - 2026-07-14T05:27Z schedule failure after 20s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29308564168
  - 2026-07-14T07:59Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29316409948
  - 2026-07-14T10:06Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29324141488
  - 2026-07-14T12:09Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29331424223
  - 2026-07-14T14:47Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29342416764
  - 2026-07-14T16:12Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29348641762
  - 2026-07-14T18:00Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29356074881
  - 2026-07-14T20:08Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29364537058
  - 2026-07-14T21:54Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29371215220
  - 2026-07-14T22:54Z schedule failure after 13s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29374513035
  - 2026-07-14T23:51Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29377372949
  - 2026-07-15T02:10Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29383426657
  - 2026-07-15T05:28Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29391524122
  - 2026-07-15T08:04Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29399488401
  - 2026-07-15T10:46Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29409316413
  - 2026-07-15T12:12Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29414376678
  - 2026-07-15T14:47Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29425149564
  - 2026-07-15T16:19Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29431916696
  - 2026-07-15T18:04Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29439062729
  - 2026-07-15T20:06Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29447032098
  - 2026-07-15T21:57Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29453761991
  - 2026-07-15T23:00Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29457244992
  - 2026-07-16T02:23Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29466455567
  - 2026-07-16T05:37Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29474389279
  - 2026-07-16T08:08Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29482399480
  - 2026-07-16T10:56Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29492615112
  - 2026-07-16T12:20Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29497782251
  - 2026-07-16T14:58Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29509032524
  - 2026-07-16T16:23Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29515350735
  - 2026-07-16T18:04Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29522422404
  - 2026-07-16T20:00Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29530293961
  - 2026-07-16T22:01Z schedule failure after 38s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29538095818
  - 2026-07-16T23:56Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29543377603
  - 2026-07-17T02:46Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29550751870
  - 2026-07-17T05:40Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29557924978
  - 2026-07-17T08:05Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29565233818
  - 2026-07-17T10:44Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29574492896
  - 2026-07-17T12:07Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29579122621
  - 2026-07-17T14:41Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29589020474
  - 2026-07-17T16:13Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29595290334
  - 2026-07-17T18:03Z schedule failure after 55s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29602396351
  - 2026-07-17T20:03Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29609833462
  - 2026-07-17T21:50Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29616031683
  - 2026-07-17T22:46Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29618871054
  - 2026-07-17T23:49Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29621680242
  - 2026-07-18T02:11Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29626588114
  - 2026-07-18T05:22Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29632155581
  - 2026-07-18T07:44Z schedule failure after 25s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29636261987
  - 2026-07-18T09:21Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29639037086
  - 2026-07-18T11:00Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29641820801
  - 2026-07-18T13:08Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29645600590
  - 2026-07-18T14:49Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29648769210
  - 2026-07-18T15:53Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29650888187
  - 2026-07-18T16:54Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29652898827
  - 2026-07-18T17:54Z schedule failure after 13s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29654827250
  - 2026-07-18T18:59Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29656935034
  - 2026-07-18T20:06Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29659074035
  - 2026-07-18T21:47Z schedule failure after 13s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29662249896
  - 2026-07-18T22:44Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29664004820
  - 2026-07-18T23:51Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29665945839
  - 2026-07-19T02:28Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29670239250
  - 2026-07-19T05:49Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29675438001
  - 2026-07-19T08:12Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29679412748
  - 2026-07-19T10:25Z schedule failure after 32s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29683304304
  - 2026-07-19T11:55Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29686024067
  - 2026-07-19T13:14Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29688499991
  - 2026-07-19T14:52Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29691697241
  - 2026-07-19T15:55Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29693810437
  - 2026-07-19T16:56Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29695842099
  - 2026-07-19T17:57Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29697836962
  - 2026-07-19T19:11Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29700114263
  - 2026-07-19T20:42Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29703023744
  - 2026-07-19T21:50Z schedule failure after 13s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29705061705
  - 2026-07-19T22:49Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29706826530
  - 2026-07-19T23:54Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29708672090
  - 2026-07-20T02:43Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29713115246
  - 2026-07-20T06:15Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29721150228
  - 2026-07-20T09:57Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29733351564
  - 2026-07-20T12:20Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29741820168
  - 2026-07-20T15:09Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29753904735
  - 2026-07-20T17:59Z schedule failure after 18s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29765829421
  - 2026-07-20T19:52Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29773725314
  - 2026-07-20T21:09Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29779074516
  - 2026-07-20T22:57Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29785674044
  - 2026-07-21T00:00Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29789009987
  - 2026-07-21T04:13Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29800641899
  - 2026-07-21T07:30Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29810719988
  - 2026-08-06T16:45Z schedule failure after 15m → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31120948654
  - 2026-08-06T18:23Z schedule failure after 15m → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31125847261
  - 2026-08-14T14:17Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31808800964
  - 2026-08-14T15:48Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31816276503
  - 2026-08-14T16:48Z schedule failure after 32s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31821017991
  - 2026-08-14T17:49Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31825805362
  - 2026-08-14T18:49Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31830488450
  - 2026-08-14T19:45Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31834697115
  - 2026-08-14T20:27Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31837983916
  - 2026-08-14T21:21Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31842100742
  - 2026-08-14T22:19Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31846138251
  - 2026-08-14T23:18Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31849899423
  - 2026-08-15T01:04Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31855479189
  - 2026-08-15T02:49Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31860181456
  - 2026-08-15T03:35Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31862230513
  - 2026-08-15T04:26Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31864440560
  - 2026-08-15T05:21Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31866755147
  - 2026-08-15T06:32Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31869701203
  - 2026-08-15T07:27Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31871982955
  - 2026-08-15T08:23Z schedule failure after 20s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31874367426
  - 2026-08-15T09:22Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31876828132
  - 2026-08-15T10:18Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31879196873
  - 2026-08-15T11:16Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31881643480
  - 2026-08-15T12:31Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31884822999
  - 2026-08-15T13:26Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31887231058
  - 2026-08-15T14:19Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31889579113
  - 2026-08-15T15:16Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31892269277
  - 2026-08-15T16:20Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31895225355
  - 2026-08-15T17:17Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31897881618
  - 2026-08-15T18:23Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31901000321
  - 2026-08-15T19:19Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31903572498
  - 2026-08-15T20:18Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31906320718
  - 2026-08-15T21:17Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31909034433
  - 2026-08-15T22:18Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31911776432
  - 2026-08-15T23:16Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31914327515
  - 2026-08-16T01:07Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31918845018
  - 2026-08-16T02:56Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31923054753
  - 2026-08-16T03:49Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31925157139
  - 2026-08-16T04:32Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31926877282
  - 2026-08-16T05:24Z schedule failure after 13s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31928933418
  - 2026-08-16T06:34Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31931757084
  - 2026-08-16T07:28Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31933951487
  - 2026-08-16T08:24Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31936396677
  - 2026-08-16T09:23Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31938918655
  - 2026-08-16T10:19Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31941345028
  - 2026-08-16T11:17Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31943918961
  - 2026-08-16T12:33Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31947370714
  - 2026-08-16T13:27Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31949889074
  - 2026-08-16T14:19Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31952355720
  - 2026-08-16T15:17Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31955230911
  - 2026-08-16T16:20Z schedule failure after 13s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31958302803
  - 2026-08-16T17:16Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31961114798
  - 2026-08-16T18:23Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31964440943
  - 2026-08-16T19:19Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31967217827
  - 2026-08-16T20:17Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31970128454
  - 2026-08-16T21:16Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31973011605
  - 2026-08-16T22:17Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31975930399
  - 2026-08-16T23:16Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31978677286
  - 2026-08-17T01:05Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31983907186
  - 2026-08-17T02:56Z schedule failure after 13s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31989530397
  - 2026-08-17T03:50Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31992442152
  - 2026-08-17T04:37Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31995136483
  - 2026-08-17T05:32Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/31998243016
  - 2026-08-17T06:48Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32003143917
  - 2026-08-17T07:50Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32007559590
  - 2026-08-17T08:39Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32011379880
  - 2026-08-17T09:37Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32016169291
  - 2026-08-17T10:28Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32020325600
  - 2026-08-17T11:21Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32024565750
  - 2026-08-17T12:37Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32030782676
  - 2026-08-17T13:36Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32035938526
  - 2026-08-17T14:24Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32038905206
  - 2026-08-17T15:21Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32042068990
  - 2026-08-17T16:23Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32045348934
  - 2026-08-17T17:23Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32050093383
  - 2026-08-17T18:34Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32055566942
  - 2026-08-17T19:25Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32060216349
  - 2026-08-17T20:22Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32065442539
  - 2026-08-17T21:22Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32070770380
  - 2026-08-17T22:20Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32075599266
  - 2026-08-17T23:19Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32079959294
  - 2026-08-18T01:03Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32086823765
  - 2026-08-24T19:26Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/32768131902
  - 2026-09-01T07:13Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33481121781
  - 2026-09-01T13:03Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33511134410
  - 2026-09-01T17:34Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33538578728
  - 2026-09-01T20:30Z schedule failure after 20s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33555771830
  - 2026-09-01T22:59Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33568896604
  - 2026-09-02T00:57Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33577448952
  - 2026-09-02T05:34Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33595194947
  - 2026-09-02T10:36Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33620303810
  - 2026-09-02T14:57Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33645384352
  - 2026-09-03T12:34Z schedule failure after 21s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33756006837
  - 2026-09-03T16:54Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33781464168
  - 2026-09-03T19:37Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33797557414
  - 2026-09-03T22:15Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33812151756
  - 2026-09-04T00:44Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33823004913
  - 2026-09-04T05:28Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33840594655
  - 2026-09-04T10:33Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33863810548
  - 2026-09-04T14:45Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33885609977
  - 2026-09-04T18:03Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33903872637
  - 2026-09-04T21:13Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33920068745
  - 2026-09-04T23:42Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33930470568
  - 2026-09-05T02:53Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33940357152
  - 2026-09-05T07:23Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33952416728
  - 2026-09-05T11:36Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33963804429
  - 2026-09-05T14:32Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33972142450
  - 2026-09-05T17:07Z schedule failure after 17s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33979965565
  - 2026-09-05T19:54Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33988529425
  - 2026-09-05T21:54Z schedule failure after 14s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33994381080
  - 2026-09-05T23:32Z schedule failure after 13s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/33998956848
  - 2026-09-06T02:52Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/34007580195
  - 2026-09-06T07:36Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/34019619915
  - 2026-09-06T11:56Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/34031651969
  - 2026-09-06T15:02Z schedule failure after 15s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/34041070684
  - 2026-09-13T20:17Z schedule failure after 31s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/34780310689

</details>

generate-newsletter: 1

  - 2026-07-15T09:27Z schedule failure after 16s → https://github.com/ecrafrnir3-cmyk/uff-platform/actions/runs/29404540538

finalize-week and sync-projections: none.

## Appendix B: per UTC day, slots declared against runs started

"Other runs" are `workflow_dispatch`. "Longest gap" is the longest interval from a run start on that day to the next run start, whenever that was. Generated by the script; the four blocks are the four cron regimes and are never mixed.

#### score-matchups — P1 one curl, no Wednesday (cron `0,15,30,45 * * * 0,1,2,4,5,6`), 1332 runs from 2026-06-23T14:39Z to 2026-09-23T13:02Z
- gap between consecutive run starts: median 59m, p90 3h23m, worst 29h14m (from 2026-08-25T23:56Z to 2026-08-27T05:10Z)
- slots declared 7525, runs started 1332 (17.7%)

| UTC day | slots | scheduled runs | other runs | longest gap starting that day |
|---|---|---|---|---|
| 2026-06-23 | 37 | 2 | 2 | 10h59m |
| 2026-06-24 | 0 | 1 | 0 | 23h53m |
| 2026-06-25 | 96 | 3 | 0 | 11h38m |
| 2026-06-26 | 96 | 3 | 0 | 10h20m |
| 2026-06-27 | 96 | 11 | 0 | 4h06m |
| 2026-06-28 | 96 | 14 | 0 | 4h23m |
| 2026-06-29 | 96 | 9 | 0 | 5h04m |
| 2026-06-30 | 96 | 10 | 0 | 4h18m |
| 2026-07-01 | 0 | 1 | 0 | 25h36m |
| 2026-07-02 | 96 | 12 | 0 | 3h51m |
| 2026-07-03 | 96 | 13 | 0 | 3h48m |
| 2026-07-04 | 96 | 16 | 0 | 3h36m |
| 2026-07-05 | 96 | 15 | 0 | 3h52m |
| 2026-07-06 | 96 | 10 | 0 | 4h22m |
| 2026-07-07 | 96 | 11 | 0 | 4h19m |
| 2026-07-08 | 0 | 1 | 0 | 24h14m |
| 2026-07-09 | 96 | 11 | 0 | 3h52m |
| 2026-07-10 | 96 | 12 | 0 | 3h51m |
| 2026-07-11 | 96 | 18 | 0 | 3h17m |
| 2026-07-12 | 96 | 18 | 0 | 3h44m |
| 2026-07-13 | 96 | 12 | 0 | 3h45m |
| 2026-07-14 | 96 | 16 | 0 | 3h25m |
| 2026-07-15 | 0 | 1 | 0 | 25h02m |
| 2026-07-16 | 96 | 15 | 0 | 3h11m |
| 2026-07-17 | 96 | 17 | 0 | 3h12m |
| 2026-07-18 | 96 | 18 | 0 | 3h21m |
| 2026-07-19 | 96 | 18 | 0 | 3h42m |
| 2026-07-20 | 96 | 12 | 0 | 3h38m |
| 2026-07-21 | 96 | 14 | 0 | 3h13m |
| 2026-07-22 | 0 | 1 | 1 | 16h32m |
| 2026-07-23 | 96 | 14 | 0 | 3h23m |
| 2026-07-24 | 96 | 14 | 0 | 3h24m |
| 2026-07-25 | 96 | 17 | 0 | 3h16m |
| 2026-07-26 | 96 | 17 | 0 | 3h41m |
| 2026-07-27 | 96 | 12 | 0 | 3h37m |
| 2026-07-28 | 96 | 13 | 0 | 3h13m |
| 2026-07-29 | 0 | 1 | 0 | 24h11m |
| 2026-07-30 | 96 | 14 | 0 | 3h09m |
| 2026-07-31 | 96 | 13 | 0 | 3h30m |
| 2026-08-01 | 96 | 17 | 0 | 3h21m |
| 2026-08-02 | 96 | 17 | 0 | 3h23m |
| 2026-08-03 | 96 | 12 | 0 | 3h37m |
| 2026-08-04 | 96 | 12 | 0 | 3h18m |
| 2026-08-05 | 0 | 1 | 0 | 24h09m |
| 2026-08-06 | 96 | 9 | 0 | 5h49m |
| 2026-08-07 | 96 | 24 | 0 | 3h02m |
| 2026-08-08 | 96 | 38 | 0 | 1h56m |
| 2026-08-09 | 96 | 34 | 0 | 1h38m |
| 2026-08-10 | 96 | 23 | 0 | 2h16m |
| 2026-08-11 | 96 | 23 | 0 | 2h07m |
| 2026-08-12 | 0 | 1 | 0 | 24h45m |
| 2026-08-13 | 96 | 21 | 0 | 2h31m |
| 2026-08-14 | 96 | 29 | 0 | 2h38m |
| 2026-08-15 | 96 | 57 | 0 | 1h24m |
| 2026-08-16 | 96 | 57 | 0 | 1h35m |
| 2026-08-17 | 96 | 45 | 0 | 1h34m |
| 2026-08-18 | 96 | 46 | 0 | 24h31m |
| 2026-08-20 | 96 | 42 | 0 | 1h31m |
| 2026-08-21 | 96 | 44 | 0 | 1h30m |
| 2026-08-22 | 96 | 56 | 0 | 1h11m |
| 2026-08-23 | 96 | 54 | 0 | 1h40m |
| 2026-08-24 | 96 | 37 | 0 | 1h38m |
| 2026-08-25 | 96 | 39 | 0 | 29h14m |
| 2026-08-27 | 96 | 2 | 0 | 11h18m |
| 2026-08-28 | 96 | 3 | 0 | 11h41m |
| 2026-08-29 | 96 | 6 | 0 | 6h39m |
| 2026-08-30 | 96 | 6 | 0 | 5h30m |
| 2026-08-31 | 96 | 5 | 0 | 7h32m |
| 2026-09-01 | 96 | 7 | 0 | 25h48m |
| 2026-09-03 | 96 | 7 | 0 | 5h01m |
| 2026-09-04 | 96 | 8 | 0 | 4h45m |
| 2026-09-05 | 96 | 9 | 0 | 4h32m |
| 2026-09-06 | 96 | 9 | 0 | 4h19m |
| 2026-09-07 | 96 | 6 | 0 | 5h21m |
| 2026-09-08 | 96 | 7 | 0 | 4h40m |
| 2026-09-09 | 0 | 1 | 0 | 24h59m |
| 2026-09-10 | 96 | 7 | 0 | 5h10m |
| 2026-09-11 | 96 | 7 | 0 | 4h54m |
| 2026-09-12 | 96 | 9 | 0 | 4h23m |
| 2026-09-13 | 96 | 7 | 0 | 5h39m |
| 2026-09-14 | 96 | 6 | 0 | 5h58m |
| 2026-09-15 | 96 | 6 | 0 | 5h25m |
| 2026-09-16 | 0 | 1 | 0 | 25h15m |
| 2026-09-17 | 96 | 6 | 0 | 5h27m |
| 2026-09-18 | 96 | 8 | 0 | 4h35m |
| 2026-09-19 | 96 | 8 | 0 | 4h54m |
| 2026-09-20 | 96 | 8 | 0 | 5h12m |
| 2026-09-21 | 96 | 5 | 0 | 6h54m |
| 2026-09-22 | 96 | 6 | 0 | 5h22m |
| 2026-09-23 | 0 | 1 | 0 |  |

#### score-matchups — P2 one curl, every day (cron `0,15,30,45 * * * *`), 22 runs from 2026-09-23T13:02Z to 2026-09-27T00:54Z
- gap between consecutive run starts: median 3h22m, p90 5h08m, worst 5h43m (from 2026-09-24T06:16Z to 2026-09-24T11:59Z)
- slots declared 335, runs started 22 (6.6%)

| UTC day | slots | scheduled runs | other runs | longest gap starting that day |
|---|---|---|---|---|
| 2026-09-23 | 43 | 3 | 0 | 2h54m |
| 2026-09-24 | 96 | 6 | 0 | 5h43m |
| 2026-09-25 | 96 | 6 | 0 | 5h43m |
| 2026-09-26 | 96 | 7 | 0 | 5h08m |
| 2026-09-27 | 4 | 0 | 0 |  |

#### score-matchups — P3 5h30m loop + concurrency (cron `0,15,30,45 * * * *`), 80 runs from 2026-09-27T00:54Z to 2026-10-13T17:02Z
- gap between consecutive run starts: median 5h09m, p90 7h00m, worst 8h58m (from 2026-10-12T11:22Z to 2026-10-12T20:20Z)
- slots declared 1601, runs started 80 (5.0%)

| UTC day | slots | scheduled runs | other runs | longest gap starting that day |
|---|---|---|---|---|
| 2026-09-27 | 92 | 6 | 1 | 5h43m |
| 2026-09-28 | 96 | 4 | 0 | 8h19m |
| 2026-09-29 | 96 | 5 | 0 | 6h36m |
| 2026-09-30 | 96 | 5 | 0 | 6h33m |
| 2026-10-01 | 96 | 5 | 0 | 7h05m |
| 2026-10-02 | 96 | 5 | 0 | 6h25m |
| 2026-10-03 | 96 | 6 | 0 | 6h02m |
| 2026-10-04 | 96 | 5 | 0 | 6h13m |
| 2026-10-05 | 96 | 4 | 0 | 8h09m |
| 2026-10-06 | 96 | 5 | 0 | 6h45m |
| 2026-10-07 | 96 | 4 | 0 | 6h57m |
| 2026-10-08 | 96 | 5 | 0 | 7h22m |
| 2026-10-09 | 96 | 4 | 0 | 7h15m |
| 2026-10-10 | 96 | 5 | 0 | 6h31m |
| 2026-10-11 | 96 | 6 | 0 | 5h53m |
| 2026-10-12 | 96 | 3 | 0 | 8h58m |
| 2026-10-13 | 69 | 2 | 0 | 7h13m |

#### process-waivers — hourly (cron `0 * * * *`), 1074 runs from 2026-06-29T16:55Z to 2026-10-13T17:02Z
- gap between consecutive run starts: median 1h51m, p90 4h45m, worst 11h37m (from 2026-08-28T09:26Z to 2026-08-28T21:04Z)
- slots declared 2545, runs started 1074 (42.2%)

| UTC day | slots | scheduled runs | other runs | longest gap starting that day |
|---|---|---|---|---|
| 2026-06-29 | 7 | 4 | 0 | 2h20m |
| 2026-06-30 | 24 | 9 | 0 | 4h59m |
| 2026-07-01 | 24 | 8 | 0 | 4h34m |
| 2026-07-02 | 24 | 9 | 0 | 4h08m |
| 2026-07-03 | 24 | 9 | 0 | 3h46m |
| 2026-07-04 | 24 | 11 | 0 | 3h37m |
| 2026-07-05 | 24 | 11 | 0 | 4h45m |
| 2026-07-06 | 24 | 7 | 0 | 4h47m |
| 2026-07-07 | 24 | 9 | 0 | 4h44m |
| 2026-07-08 | 24 | 10 | 0 | 4h08m |
| 2026-07-09 | 24 | 8 | 0 | 3h57m |
| 2026-07-10 | 24 | 10 | 0 | 4h47m |
| 2026-07-11 | 24 | 15 | 0 | 3h12m |
| 2026-07-12 | 24 | 14 | 0 | 3h24m |
| 2026-07-13 | 24 | 10 | 0 | 4h09m |
| 2026-07-14 | 24 | 12 | 0 | 3h15m |
| 2026-07-15 | 24 | 11 | 0 | 3h22m |
| 2026-07-16 | 24 | 11 | 0 | 3h14m |
| 2026-07-17 | 24 | 12 | 0 | 2h54m |
| 2026-07-18 | 24 | 15 | 0 | 3h12m |
| 2026-07-19 | 24 | 15 | 0 | 3h21m |
| 2026-07-20 | 24 | 9 | 0 | 3h42m |
| 2026-07-21 | 24 | 11 | 0 | 4h12m |
| 2026-07-22 | 24 | 10 | 0 | 3h22m |
| 2026-07-23 | 24 | 11 | 0 | 4h04m |
| 2026-07-24 | 24 | 10 | 0 | 3h07m |
| 2026-07-25 | 24 | 14 | 0 | 4h06m |
| 2026-07-26 | 24 | 11 | 0 | 3h00m |
| 2026-07-27 | 24 | 9 | 0 | 4h27m |
| 2026-07-28 | 24 | 11 | 0 | 3h52m |
| 2026-07-29 | 24 | 10 | 0 | 3h08m |
| 2026-07-30 | 24 | 10 | 0 | 3h31m |
| 2026-07-31 | 24 | 10 | 0 | 3h42m |
| 2026-08-01 | 24 | 13 | 0 | 2h45m |
| 2026-08-02 | 24 | 14 | 0 | 3h23m |
| 2026-08-03 | 24 | 8 | 0 | 4h20m |
| 2026-08-04 | 24 | 10 | 0 | 4h04m |
| 2026-08-05 | 24 | 10 | 0 | 3h31m |
| 2026-08-06 | 24 | 7 | 0 | 6h16m |
| 2026-08-07 | 24 | 18 | 0 | 3h09m |
| 2026-08-08 | 24 | 22 | 0 | 2h02m |
| 2026-08-09 | 24 | 21 | 0 | 2h13m |
| 2026-08-10 | 24 | 17 | 0 | 2h24m |
| 2026-08-11 | 24 | 17 | 0 | 2h15m |
| 2026-08-12 | 24 | 16 | 0 | 2h22m |
| 2026-08-13 | 24 | 16 | 0 | 2h24m |
| 2026-08-14 | 24 | 18 | 0 | 2h22m |
| 2026-08-15 | 24 | 23 | 0 | 1h50m |
| 2026-08-16 | 24 | 23 | 0 | 1h49m |
| 2026-08-17 | 24 | 23 | 0 | 1h51m |
| 2026-08-18 | 24 | 23 | 0 | 1h49m |
| 2026-08-19 | 24 | 23 | 0 | 1h50m |
| 2026-08-20 | 24 | 23 | 0 | 1h50m |
| 2026-08-21 | 24 | 23 | 0 | 1h52m |
| 2026-08-22 | 24 | 23 | 0 | 1h52m |
| 2026-08-23 | 24 | 23 | 0 | 1h50m |
| 2026-08-24 | 24 | 22 | 0 | 1h54m |
| 2026-08-25 | 24 | 23 | 0 | 1h50m |
| 2026-08-26 | 24 | 16 | 0 | 5h12m |
| 2026-08-27 | 24 | 3 | 0 | 10h51m |
| 2026-08-28 | 24 | 2 | 0 | 11h37m |
| 2026-08-29 | 24 | 5 | 0 | 7h17m |
| 2026-08-30 | 24 | 6 | 0 | 6h49m |
| 2026-08-31 | 24 | 4 | 0 | 7h21m |
| 2026-09-01 | 24 | 6 | 0 | 5h50m |
| 2026-09-02 | 24 | 7 | 0 | 5h02m |
| 2026-09-03 | 24 | 6 | 0 | 4h53m |
| 2026-09-04 | 24 | 7 | 0 | 5h05m |
| 2026-09-05 | 24 | 8 | 0 | 4h30m |
| 2026-09-06 | 24 | 7 | 0 | 4h44m |
| 2026-09-07 | 24 | 6 | 0 | 5h53m |
| 2026-09-08 | 24 | 6 | 0 | 5h20m |
| 2026-09-09 | 24 | 6 | 0 | 5h35m |
| 2026-09-10 | 24 | 7 | 0 | 5h00m |
| 2026-09-11 | 24 | 6 | 0 | 4h55m |
| 2026-09-12 | 24 | 8 | 0 | 4h40m |
| 2026-09-13 | 24 | 6 | 0 | 5h44m |
| 2026-09-14 | 24 | 5 | 0 | 6h00m |
| 2026-09-15 | 24 | 6 | 0 | 5h32m |
| 2026-09-16 | 24 | 5 | 0 | 6h07m |
| 2026-09-17 | 24 | 6 | 0 | 5h39m |
| 2026-09-18 | 24 | 7 | 0 | 4h47m |
| 2026-09-19 | 24 | 6 | 0 | 5h26m |
| 2026-09-20 | 24 | 7 | 0 | 5h04m |
| 2026-09-21 | 24 | 5 | 0 | 6h06m |
| 2026-09-22 | 24 | 6 | 0 | 5h51m |
| 2026-09-23 | 24 | 5 | 0 | 5h47m |
| 2026-09-24 | 24 | 5 | 0 | 6h07m |
| 2026-09-25 | 24 | 6 | 0 | 5h28m |
| 2026-09-26 | 24 | 5 | 0 | 5h37m |
| 2026-09-27 | 24 | 6 | 0 | 6h32m |
| 2026-09-28 | 24 | 4 | 0 | 7h54m |
| 2026-09-29 | 24 | 4 | 0 | 6h54m |
| 2026-09-30 | 24 | 5 | 0 | 6h54m |
| 2026-10-01 | 24 | 4 | 0 | 7h16m |
| 2026-10-02 | 24 | 4 | 0 | 7h00m |
| 2026-10-03 | 24 | 6 | 0 | 6h12m |
| 2026-10-04 | 24 | 5 | 0 | 6h57m |
| 2026-10-05 | 24 | 4 | 0 | 9h33m |
| 2026-10-06 | 24 | 4 | 0 | 6h58m |
| 2026-10-07 | 24 | 4 | 0 | 7h43m |
| 2026-10-08 | 24 | 4 | 0 | 7h28m |
| 2026-10-09 | 24 | 4 | 0 | 7h16m |
| 2026-10-10 | 24 | 5 | 0 | 7h19m |
| 2026-10-11 | 24 | 4 | 0 | 6h41m |
| 2026-10-12 | 24 | 4 | 0 | 9h36m |
| 2026-10-13 | 18 | 2 | 0 | 8h07m |

