# UFF code audit, second pass — 2026-10-08 (report only, nothing fixed)

| | |
|---|---|
| **Commit audited** | `c07ea77bff1aa532853496243125996521fc5258` (`origin/main` on 2026-10-13, the day this was written). Every `file:line` below is as of that commit. |
| **Scope command** | `git log --stat c39c6c6..c07ea77` — 10 commits, 2026-09-27 to 2026-10-10 (nine the brief expected plus the merge commit `dcc707c`; the clone is not shallow). Plus three surfaces the first audit never opened: `src/app/dashboard/league/[id]/war/page.tsx`, `src/app/universe/page.tsx`, and error reporting (`sentry.{client,server,edge}.config.ts`, `src/instrumentation.ts`, `withSentryConfig` in `next.config.ts`). |
| **Method** | Code reading only. No database, no deployed environment, no scripts run. Two outbound checks were attempted and blocked by the sandbox (the Sleeper API, for NV-1 below), so that item is filed as not verified. |
| **Previous report** | `docs/code-audit-2026-09-25.md` (ids `A1-xx`..`A5-xx`). Nothing from it is repeated; where a new finding touches an old one, the old id is cited. |
| **Skeptic pass** | Every cited line was re-opened cold before this was finalised. **6 candidate findings were dropped**: (1) "Settings force-finalize skips `mark_week_tokens_used`" — `finalize_week` marks the tokens itself (`functions.sql:1565-1566`), so the Matchups button's extra call is redundant, not a guard; (2) "`mark_week_tokens_used` is anon-reachable" — revoked on 2026-09-15 (`20260915130000:38`); (3) "the story pages never check league membership" — the league layout does (`layout.tsx:34`) before any page under it renders; (4) "the committed portraits carry the generation prompt in PNG text chunks" — neither sampled file has a `tEXt`/`iTXt` chunk; (5) "the start-sit bye check breaks if the schedule stores one row per game" — the seeder stores one row per team (`scripts/seed-schedule.mjs:80-82`); (6) "`/universe` reads characters with the service role" — it uses the cookie client and a deliberate `anon` SELECT policy (`policies.sql:166`). |

## Summary

**13 findings: 0 critical · 1 high · 4 medium · 8 low.** Plus 7 items that need the database or the deployed environment to settle.

The three that matter most:

1. **B-01 (high, detail withheld).** A file under `lore/` in this public repository carries information about the real managers that the app never shows and that nobody agreed to publish, plus one value a stranger could act on. Full detail is in the chat message that accompanies this PR, not here.
2. **B-03 / B-02 (medium).** On the code alone, production is very likely unmonitored: the Sentry 8 SDK's browser half depends on a webpack build step that a Turbopack build (`turbopack: {}`, Next 16) never runs, and even with a DSN there is no `global-error.tsx` and no `onRequestError`, so App Router render and route errors are never captured. With the DSN unset nothing is logged at all, on either side.
3. **B-04 (medium).** The Settings page's "Force Finalize Week" shares every missing guard of the Matchups button (no games-over check, no undo, no story engine) and its week box defaults to the **current, unfinished** NFL week, so the red button is one click from finalizing a week still being played.

---

## The seven questions, answered

**1. Who can reach it?**

| surface | who | the line that decides |
|---|---|---|
| `/dashboard/league/[id]/story` and `/story/[slug]` | league members only | the page checks sign-in (`story/page.tsx:14`, `story/[slug]/page.tsx:19`); membership is enforced one level up by the league layout, `layout.tsx:20-34` (`if (!member) redirect(...)`) |
| `/dashboard/league/[id]/war` | league members only | its own check, `war/page.tsx:26-40` |
| `/universe` | signed out, anyone | no auth call at all (`universe/page.tsx:61-67`); the read works because `uff_characters` has `"characters are publicly readable" ... TO anon, authenticated` (`policies.sql:166`). Only fiction and `art_url` are selected |
| `POST /api/cron/generate-newsletter` (all query modes) | only a caller holding `CRON_SECRET` | `generate-newsletter/route.ts:272-278` fails closed when the secret is unset and compares the bearer exactly. `?emailOnly=1`, `?force=1`, `?noEmail=1`, `?week=N` are parsed **after** that check (`:300-311`), so no signed-in user, member or commissioner can make the app mail the league. The only other trigger is the GitHub `workflow_dispatch`, which needs write access to this repository |
| `POST /api/start-sit` | league members only, 5/min | `start-sit/route.ts:22-35` (sign-in, membership, `checkRateLimit`) |

**2. What can it spend?** Three paid paths are in scope, none new to a signed-out visitor:

- `generate-newsletter` → Anthropic (haiku, `max_tokens` 1200, `route.ts:231`). Bounded by `CRON_SECRET`, one call per league per run, and the "row exists → skip" guard (`:337-357`); `?force=1` bypasses that guard but still needs the secret.
- `start-sit` → Anthropic (haiku, `max_tokens` 300, `:189`). Bounded by membership and `checkRateLimit(..., 5)` per user per minute (`:34`), which is the in-memory, per-instance limiter of A3-06: a manager in a loop gets 5 calls per minute **per warm lambda**, not 5 total. No cache; identical requests are billed again.
- `scripts/generate-portraits.mjs` → Google Gemini image API. Offline script, never reachable from the app; refuses to call without `--yes` (`:244`), refuses above `--max-cost` (default $2, `:237`), stops on the first error (`:290-297`). See B-12 for the one gap.

No page in scope (story, war, universe, lock banner) calls a paid API.

**3. What does it expose?** The public repository, not the app, is the problem. `lore/issues/*.md` and `/universe` print character fiction only — no e-mail address or user id appears anywhere under `lore/`, `src/app/universe` or `src/lib/lore.ts` (grep for `@` and UUID shapes: none). But one file under `lore/` and one session hand-off file in the repo root carry real people's names and family relations, and one league credential. That is **B-01**; the file and line numbers are in the withheld detail. The commissioner's first name also appears in `lore/issues/001-the-first-war.md:26` and `lore/canon-threads.md:21`, where the app does render it to members (`listIssues` publishes every file in that folder, see B-10).

**4. What uses the service-role client, and is it guarded?** In scope, exactly one file: `generate-newsletter/route.ts:316` (`createClient(supabaseUrl, serviceKey)`) and `:386` (`getAllUserEmails`, which reads every auth user's e-mail with the admin client). Both sit below the `CRON_SECRET` check at `:272-278`. Story, war, universe and start-sit all use the cookie-scoped client; the portrait script touches no database.

**5. What fails silently?** Every swallowed error in the scoped work:

| where | what is swallowed | what a manager sees | told? |
|---|---|---|---|
| `src/lib/lore.ts:64-68` | `readdir` of `lore/issues` fails → `[]` | "No issues have been published yet." (`story/page.tsx:40`) | nobody; no log (B-09) |
| `src/lib/lore.ts:84-89` | `readFile` of an issue fails → `null` → 404 | a 404 for an issue that exists in git | nobody (B-09) |
| `start-sit/route.ts:108` | Sleeper projections fetch | every player "(no projection available)" | nobody; see NV-1 |
| `start-sit/route.ts:205-208` | anything else | "Internal error" | `console.error` only, and with B-02/B-03 that reaches no one |
| `generate-newsletter/route.ts:411-414` | e-mail send | no newsletter in the inbox; the run stays green | `console.error` (pre-existing; A3-04 covers the send layer) |
| `generate-newsletter/route.ts:442-444` | notification fan-out | no bell | `console.error` |
| `war/page.tsx:46-52,75-81`, `universe/page.tsx:63-67` | query `error` never read | an empty meter / an empty roster | nobody (B-11) |
| `scripts/generate-portraits.mjs:87, 271, 320` | missing `.env.local`, missing variant file, missing manifest | each is handled on the next line; not silent | n/a |

Finalize's swallowed story block (`finalize-week/route.ts:64-90`) is A5-02/A5-05 and is not repeated. **What is new since then:** nothing shipped in this range writes to the story tables, so a swallowed week loses nothing *new*. But the comic pages (`1bb0648`) now give the war meter and battle list a front door in the nav, and `story/page.tsx:26-28` tells members the front "only moves when a Vanguard team beats a Dominion team on the field" — so a week whose story recompute was swallowed is now *visible* as a meter that did not move, next to a comic that says it should have. The portraits (`edc26db`) are static files and are unaffected.

**6. Error reporting.** From the code alone, if `NEXT_PUBLIC_SENTRY_DSN` is unset in production: `Sentry.init({ dsn: undefined, enabled: true })` runs on all three configs (`sentry.client.config.ts:4,21`, `sentry.server.config.ts:4,9`, `sentry.edge.config.ts:4,8`). The v8 SDK treats a missing DSN as "no transport": it neither throws nor logs unless `debug: true` is set (it is not), every `captureException` is a no-op, and the app is silently unmonitored on the server, the edge and in the browser. The build side is equally quiet: `withSentryConfig` gets `org: ""` and an undefined `authToken` (`next.config.ts:31-33`) with `silent: true` (`:36`), so source-map upload is skipped without a word. `automaticVercelMonitors: true` (`:45`) monitors Vercel crons, and `vercel.json` is `{}` — the five crons live in GitHub Actions — so it monitors nothing. There is also no `console` fallback anywhere: `grep Sentry\. src/` finds only `instrumentation.ts`. Whether the DSN *is* set in Vercel is NV-5. Beyond the DSN question, two structural gaps mean even a correct DSN would miss most errors: B-02 and B-03.

**7. The portrait pipeline.** Images live in `public/art/characters/<slug>.png`, 20 files committed by `edc26db` (`~0.5-0.85 MB` each) and served statically by Vercel; the database only holds the path in `uff_characters.art_url`, set by hand after picking a keeper (`generate-portraits.mjs:34-36`; whether it was set is NV-2). The script writes variants named `<slug>-v<n>.png` (`:268`), which are git-ignored along with the manifest and error dumps (`.gitignore:52-59`), so a re-run **cannot overwrite a committed keeper**: it never writes that filename. It *can* bill for portraits that already exist: its skip test is the variant file (`:270-271`), not the keeper, and the variants are not in git, so on any fresh clone the full `--yes --max-cost 6` run regenerates 60 images for 20 characters that already have faces. That is B-12. `--force` additionally regenerates existing variants. The rails that hold: dry run by default (`:244`), `--max-cost` refusal (`:237-242`), key read from env or `.env.local` and never printed (`:80-89`), raw responses dumped outside `public/` (`:292, :301`), stop on first failure.

**`c07ea77` — the Start/Sit advisor sees bye weeks.** Reachable by members only, 5/min (answer 1). One paid call per request (answer 2). It exposes nothing new; the prompt carries the caller's own roster and team name only. The bye derivation is sound: `uff_game_schedule` holds one row per team per week (`tables.sql:376-384`, seeded by `scripts/seed-schedule.mjs:80-82`), so "team absent from the week's rows" is a bye, and the `playingTeams.size >= 20` guard (`:81`) correctly disables the check when the week is unseeded. One comment is wrong but harmless: `:76-77` says an unloaded week is "not yet loaded by sync-projections"; the schedule is loaded by `seed-schedule.mjs`, not by that cron. The real question about this route is older than the commit and is NV-1: the projections it feeds the model come from the Sleeper endpoint that `sync-projections/route.ts:11-15` documents as answering with empty stat objects.

---

## Findings

### B-01
- **Severity:** high
- **Where:** `lore/the-real-league.md` (whole file; one line in particular); `UFF_Session_Handoff_2026-09-06.md:47`; `lore/issues/001-the-first-war.md:26`; `lore/canon-threads.md:21`; `lore/announcements/2026-09-24-war-front-reset.md:5,7,33`
- **Detail withheld.** The repository is public; the full description, who is affected, how to prove it and the smallest fix are in the chat message that accompanies this PR.

### B-02
- **Severity:** medium
- **Where:** `src/instrumentation.ts:1-8`; absent `src/app/global-error.tsx`; `sentry.client.config.ts:21`, `sentry.server.config.ts:9`
- **What goes wrong:** `instrumentation.ts` only imports the two server configs. It does not export `onRequestError` (`Sentry.captureRequestError`, available since `@sentry/nextjs` 8.28; the lock file has 8.55.2), which is how Next 15+ hands server-component, route-handler and middleware errors to a monitor. There is no `global-error.tsx`, which the App Router needs for a React render error to be reported at all. Nothing in `src/` calls `Sentry.captureException`. So with a valid DSN the only errors Sentry could see are the ones its own (webpack-only, see B-03) wrapping would catch; without a DSN, nothing is logged anywhere (answer 6).
- **Who is affected:** the operator: a 500 in a route, a render crash on the roster page, or a failed newsletter leaves no trace except Vercel's function log.
- **How a human proves it:** throw inside any server component on a preview deployment and look for the event in Sentry; `ls src/app/global-error.tsx` fails.
- **Smallest fix:** export `onRequestError = Sentry.captureRequestError` from `instrumentation.ts`, add a `global-error.tsx` that calls `Sentry.captureException`, and set `debug: true` or a one-line `console.warn` when the DSN is empty so a missing DSN is visible in the build log.

### B-03
- **Severity:** medium (likely; needs the deployed site to confirm)
- **Where:** `next.config.ts:6` (`turbopack: {}`), `:29` (`withSentryConfig`); `sentry.client.config.ts` (never imported by anything in `src/`)
- **What goes wrong:** `@sentry/nextjs` 8.x injects `sentry.client.config.ts` into the browser bundle, uploads source maps and auto-wraps route handlers through its **webpack** plugin. Next 16 builds with Turbopack, and the config opts in explicitly ("to silence Sentry's webpack conflict warning", `:5`). Sentry's Turbopack production-build support arrived in a later major (with `instrumentation-client.ts` as the client entry); on 8.x a Turbopack build runs none of the plugin's steps. The server half still initialises via `instrumentation.ts`, but the browser SDK is most likely never loaded in production: no replay, no client errors, and `hideSourceMaps`/`widenClientFileUpload` (`:39-42`) do nothing.
- **Who is affected:** the operator; every manager-facing crash in the browser is invisible.
- **How a human proves it:** in the production site's browser console, `window.__SENTRY__` is undefined, or `curl -s https://playuff.com | grep -c sentry` is 0; and the Sentry project shows no browser events since the Next 16 upgrade.
- **Smallest fix:** upgrade `@sentry/nextjs` to the major that documents Turbopack production builds and move the client init into `src/instrumentation-client.ts` (or build with webpack, which `turbopack: {}` was added to avoid).

### B-04
- **Severity:** medium
- **Where:** `src/app/dashboard/league/[id]/settings/actions.ts:63-88` (`forceFinalize`); form at `settings/page.tsx:682-709`, default week at `:698`; the RPC at `supabase/schema-snapshot/functions.sql:1500-1507`
- **What goes wrong:** "Force Finalize Week" in Settings is the second manual finalize control (the Matchups button is known and not reported here). It calls the same `finalize_week` RPC and shares all three missing guards: (1) **no games-over check** — the RPC's only test is "caller is the commissioner" (`:1500-1502`), then it marks every matchup of the week complete (`:1504-1507`) whatever the kickoff times say; (2) **no undo** — nothing in the app or the schema un-finalizes a week; (3) **it skips the story engine** — feats and legends are computed only inside the cron route (`finalize-week/route.ts:64-90`), so a week finalized here never gets its story rows, and A5-02 means the next Wednesday will not add them. It is worse than the Matchups button in one way: the week box is pre-filled with `currentNFLWeek` (`page.tsx:698`), the week *in progress*, and the surrounding text (`:686-687`) calls it "the current NFL week" without saying it is unfinished. The Matchups button at least hides itself once a week is finalized and sits on the week being viewed.
- **Who is affected:** every manager in the league: a mid-week finalize freezes partial scores as final, awards next week's tokens and the high-score chip on them, and cannot be reversed from the app.
- **How a human proves it:** code alone (the RPC body has no `kickoff_utc` reference and no `is_complete` precondition); on a preview deployment, open Settings on a Thursday and read the default in the week box.
- **Smallest fix:** default the box to `currentNFLWeek - 1`, and have `finalize_week` raise when any `uff_game_schedule.kickoff_utc` for that week is still in the future (the same check the cron relies on by timing). Removing the control is the smaller change still: the cron's catch-up loop already repairs a missed Wednesday.

### B-05
- **Severity:** medium
- **Where:** `src/app/api/cron/generate-newsletter/route.ts:376-378` (`noEmail` guard), `:421-444` (notification block gated on `emailOnly` only), `:354` (`force`)
- **What goes wrong:** The repair path added on 2026-09-30, `?week=3&force=1&noEmail=1`, was built so a regenerated newsletter would *not* reach the inbox twice. It suppresses the e-mail (`:376-378`) but the in-app + push notification block runs for every path except `emailOnly` (`:421-424`), so a `force` regeneration pings every member a second time ("📰 Week N Newsletter") for a week they were already told about. The comment at `:416-418` says the block "sits inside the idempotency guard"; with `force=1` that guard is bypassed at `:354`.
- **Who is affected:** all members of the league on every forced regeneration (the week-3 repair, if it was run as the commit message describes).
- **How a human proves it:** `SELECT league_id, title, count(*) FROM uff_notifications WHERE type = 'newsletter' GROUP BY 1, 2 HAVING count(*) > (SELECT count(*) FROM league_members lm WHERE lm.league_id = uff_notifications.league_id);` (NV-3), or read `:354` and `:421-424` side by side.
- **Smallest fix:** fire the notification block only when the row did not exist before this run (`!existing`), which is the "first publish" the comment describes.

### B-06
- **Severity:** low
- **Where:** `supabase/schema-snapshot/functions.sql:1473-1507` (`finalize_week` signature and guard); callers `matchups/actions.ts:16-20`, `settings/actions.ts:75-79`
- **What goes wrong:** The third way in, beyond the two buttons: the commissioner's own browser session can call `supabase.rpc('finalize_week', { p_league_id, p_user_id, p_week })` directly through PostgREST, because the RPC is EXECUTE-able by `authenticated` and the guard is `auth.uid() = commissioner_id`. That path skips the only validation either button adds — the 1-18 bound in `settings/actions.ts:71-73` — since the RPC itself checks no range, no "already complete", no kickoff. No new privilege (it is the commissioner either way), but it means the real guard has to live in the RPC, not in the forms.
- **Who is affected:** the league, if the commissioner (or anyone holding their session) runs it by hand.
- **How a human proves it:** code alone; `SELECT has_function_privilege('authenticated', 'public.finalize_week(uuid,uuid,integer)', 'EXECUTE');` confirms reachability.
- **Smallest fix:** the same RPC-side kickoff/range check as B-04.

### B-07
- **Severity:** low
- **Where:** `src/app/api/cron/generate-newsletter/route.ts:259-263`
- **What goes wrong:** The terminal-punctuation guard `/[.!?"'’”]\s*$/` rejects any newsletter that ends in a closing parenthesis, an ellipsis (`…`), a dash, or a closing `*` — endings a "dramatic columnist" prompt will produce sooner or later. A false positive throws, the league is recorded `ok: false`, the run answers 500 (`:458-462`), and because the next scheduled run targets the *next* week (`:311`), that week's newsletter is never generated without a manual dispatch (B-08). The `stop_reason === "max_tokens"` check above it is the right guard; this one trades a half sentence for a missing week.
- **Who is affected:** the whole league for that week.
- **How a human proves it:** `node -e 'console.log(/[.!?"’”]\s*$/.test("...the throne.)"))'` prints `false`.
- **Smallest fix:** widen the class to `[.!?…)"'’”*]` or drop the regex and keep only `stop_reason`.

### B-08
- **Severity:** low
- **Where:** `src/app/api/cron/generate-newsletter/route.ts:311` (`week = getRawNFLWeek() - 1`), `:337-357` (guard looks only at the target week); contrast `finalize-week/route.ts:40-61`
- **What goes wrong:** The newsletter has no catch-up. Any week it misses, for any reason (a 500 from B-07, an Anthropic outage, the run starting before finalize has completed, which the cron census in `docs/cron-census-2026-10-08.md` §3 shows is a weekly coin-flip with 13-minute margins), stays missing until someone dispatches the workflow with `week=N`. Finalize learned this lesson (`:40-46`, "a single dropped or delayed Wednesday run otherwise permanently skips that week"); the newsletter did not.
- **Who is affected:** the league, for that week, with no signal beyond a red Actions run nobody is subscribed to.
- **How a human proves it:** NV-4, `SELECT week FROM league_newsletters ORDER BY week;` against the weeks finalized.
- **Smallest fix:** loop `w = 1..target` as finalize does, generating only where no row exists and the week's matchups are complete.

### B-09
- **Severity:** low
- **Where:** `src/lib/lore.ts:64-68`, `:84-89`; the warning about why at `:9-13`
- **What goes wrong:** Both reads swallow every error. The failure the file itself warns about, `lore/issues` not traced into the serverless bundle, would present as "No issues have been published yet." and a 404 per issue, byte-identical to "no issues written yet" and "bad slug". Nothing is logged, so the next time `outputFileTracingIncludes` (`next.config.ts:10-13`) silently stops matching (a route rename, a Next upgrade), the Comics section goes blank and nobody is told.
- **Who is affected:** members, who lose the comics; the operator, who cannot tell a blank folder from a broken deploy.
- **How a human proves it:** code alone.
- **Smallest fix:** `console.error` the caught error in both places, and in `listIssues` distinguish `ENOENT` on the directory from an empty directory.

### B-10
- **Severity:** low
- **Where:** `src/lib/lore.ts:70-71`; the editorial rule at `lore/issues/README.md:29-31`
- **What goes wrong:** `listIssues` publishes every `.md` in `lore/issues/` except `README.md` to all members on the next deploy. The README records that the first drafts of #002/#003 "produced 31 errors across three drafts" before fact-checking; a `004-*.md` committed for review, or a draft pushed to `main` by mistake, is live canon the moment Vercel builds it. There is no draft flag, no `published:` field and no folder split.
- **Who is affected:** members, who read an unchecked issue as the record of their own games.
- **How a human proves it:** code alone.
- **Smallest fix:** keep drafts under `lore/issues/drafts/` (the reader lists only the top level) or skip files whose first lines contain `draft: true`.

### B-11
- **Severity:** low
- **Where:** `src/app/dashboard/league/[id]/war/page.tsx:46-52`, `:54-58`, `:75-81`; `src/app/universe/page.tsx:63-67`, `:139`
- **What goes wrong:** Neither page reads `error` from any query. A failed `alliance_war` read renders the meter at `front 0`, week `null` (`war/page.tsx:105-110`), indistinguishable from "the war has not started"; a failed `uff_characters` read renders `/universe` with both factions empty. The universe footer still says "Portraits coming soon." (`:139`) although `edc26db` shipped the twenty portraits and the card already renders `art_url` (`:31-38`).
- **Who is affected:** members (war) and visitors (universe) see a wrong page with no hint; the operator sees nothing.
- **How a human proves it:** code alone; the footer text is visible on the live page.
- **Smallest fix:** destructure `error` and render a one-line notice when it is set; delete or condition the footer sentence.

### B-12
- **Severity:** low
- **Where:** `scripts/generate-portraits.mjs:266-272` (skip test on `<slug>-v<n>.png`), `:34-36` (the keeper is `<slug>.png`, chosen by hand); `.gitignore:56-57`
- **What goes wrong:** The "skips files that already exist" rail (`:19`) tests the variant filename, and the variants are git-ignored. On any checkout other than the one that generated them, every character looks ungenerated, and `node scripts/generate-portraits.mjs --yes --max-cost 6` spends about $4 at the listed rate (`:48`, 60 × $0.067) to regenerate variants for twenty characters whose keepers are already committed. The committed keeper is never overwritten (the script never writes `<slug>.png`), so this is money, not art.
- **Who is affected:** whoever pays the Gemini balance.
- **How a human proves it:** `git clone`, then `node scripts/generate-portraits.mjs --dry-run` lists all 20 as pending.
- **Smallest fix:** skip a character whose `<slug>.png` exists in the output directory unless `--force`.

### B-13
- **Severity:** low
- **Where:** `.github/workflows/generate-newsletter.yml:37-40`
- **What goes wrong:** The four `workflow_dispatch` inputs are interpolated unquoted into the shell (`Q="${Q}&week=${{ github.event.inputs.week }}"`), the classic injection shape: an input of `1&force=1` or `1" ; curl ... ; "` becomes shell or query text. Dispatching needs write access to this repository, which already lets a person edit the workflow, so there is no escalation; it is recorded because the same pattern copied into a workflow with an `issue_comment` or `pull_request_target` trigger would be exploitable.
- **Who is affected:** nobody today.
- **How a human proves it:** code alone.
- **Smallest fix:** pass the inputs through `env:` and quote them (`"${WEEK}"`).

---

## Not verified without the database (or the deployed environment)

- **NV-1 — the Start/Sit advisor's projections are probably all zero.** `start-sit/route.ts:91-92` fetches `/v1/projections/nfl/{season}/{week}`; `sync-projections/route.ts:11-15` records that this exact endpoint "answers 200 with ~7,600 players whose stat objects are all EMPTY", which is why that route moved to `/projections/nfl/...?season_type=regular&position[]=...` on 2026-09-07. If that is still true, `projMap` is all zero, every player is printed "(no projection available)" (`:154-156`), and the model is asked to rank starters with no numbers at all. The sandbox could not reach `api.sleeper.app` (proxy 403). **One check:** `curl -s 'https://api.sleeper.app/v1/projections/nfl/2026/6?season_type=regular' | jq '[.[] | select(length > 0)] | length'` — `0` confirms. Fix shape if confirmed: read `player_projections` (already loaded weekly) instead of calling Sleeper from the route.
- **NV-2 — whether the portraits are wired up.** `SELECT name, art_url FROM uff_characters WHERE art_url IS NULL OR art_url NOT LIKE '/art/characters/%';` — any row still shows a silhouette on `/universe` and the character page despite `edc26db`.
- **NV-3 — whether the week-3 repair double-notified** (B-05): the query in B-05, or `SELECT user_id, count(*) FROM uff_notifications WHERE type = 'newsletter' AND title LIKE '%Week 3%' GROUP BY 1 HAVING count(*) > 1;`.
- **NV-4 — which newsletter weeks exist** (B-07/B-08): `SELECT league_id, week, length(content), generated_at FROM league_newsletters ORDER BY week;` beside the finalized weeks.
- **NV-5 — whether `NEXT_PUBLIC_SENTRY_DSN` is set in Vercel's Production environment, and whether the Sentry project has received any event since the Next 16 / Turbopack build** (B-02/B-03). The Vercel dashboard and the Sentry project's event stream settle both; the repo cannot.
- **NV-6 — whether the league credential that appears in the repository (B-01) is still the live value**: `SELECT join_code = '<value in the withheld detail>' FROM uff_leagues;` — true means rotate it.
- **NV-7 — whether `CRON_SECRET` is set in every Vercel environment that receives the newsletter workflow's URL** (`secrets.NEXT_PUBLIC_APP_URL`). The route fails closed without it (`:272-274`), so an unset Preview environment is a 500, not an open door; this only confirms that the Wednesday runs hit Production.

## Looked at and found sound

- **Story pages:** membership gating through the league layout (`layout.tsx:20-34`); the slug is validated against `^[a-z0-9][a-z0-9-]*$` before it reaches the filesystem (`lore.ts:83`), so no traversal; `ComicBody.tsx` builds React nodes and never uses `dangerouslySetInnerHTML` (`:12-13`), so a stray `<script>` in an issue is text; `outputFileTracingIncludes` (`next.config.ts:10-13`) matches both story routes; the nav additions (`LeagueNav.tsx:30-31`) are links only.
- **Newsletter changes (`c3222a3`, `4b64a7a`):** auth unchanged and fail-closed (`:272-278`); all four query flags are secret-gated; `emailOnly` refuses when no row exists (`:346-353`) and never rewrites the row (`:366`); the `max_tokens` raise to 1200 with the `stop_reason` check (`:254-258`) is the right fix for the week-3 truncation; `?week=` is bounded to 1-18 (`:312`); status codes 200/207/500 (`:458-462`) make a total failure red.
- **War page:** its own membership check (`:26-40`); reads only story tables and character names; writes nothing.
- **Universe page:** no auth and none needed; selects fiction columns only; the `anon` read is a deliberate policy (`policies.sql:166`); `<img src={c.art_url}>` is a same-origin path.
- **Start/Sit (`c07ea77`):** auth, membership and rate limit in the right order (`:22-35`); the bye logic and its "unseeded week" guard (`:76-83`) are correct for the schedule's one-row-per-team shape; the prompt contains only the caller's own roster.
- **Lock banner (`df8efbc`):** copy and props only; `lockReason` is derived server-side (`roster/page.tsx:913`) from the same `viewWeek < currentWeek` the lock itself uses.
- **Portrait script rails:** dry run by default, `--max-cost`, key never printed, error dumps outside `public/`, stop on first failure; the diagnostics and variants are git-ignored (`.gitignore:52-59`); the two sampled PNGs carry no text chunks (no embedded prompt).
- **Sentry configs as written:** `enabled` is gated on `NODE_ENV === "production"`, replay masks all text and blocks media (`sentry.client.config.ts:14-17`), sample rates are modest. The gaps are structural (B-02, B-03), not in these three files.
- **Issue #001 move (`47ae57b`):** a rename plus README text; the README's "#65 fixed" note matches the 2026-09-24 announcement file.
- **Lore figures:** all 28 scores printed across #002 and #003 recompute exactly to every derived number in the lore: each stated margin, the 29-feat count (#002:171), both weekly records, the 3-3 ledger, and the four season totals in `lore/season-1-spine.md:38` (1,710.53 / 1,656.70 / 763.77 / 635.42). **No figure contradicts another figure inside the lore.** The only loose ends, noted in the CSV: #003's header prints no week number (the README assigns it Week 2), and "An 88-point week" (#003:160) fits two different week-1 scores. The database half of the reconciliation is `docs/lore-figures-2026-10-08.csv`: 114 rows, one per figure, with file and line.

## Not looked at

- **The 19 commits of `e99ee3d..c39c6c6`** (the 2026-09-26 fix series: twelve migrations `20260926120000`..`20260927012000` and edits to nineteen API routes). The first report says under "Status since 2026-09-25" that nobody audited them, and that is still true. Auditing them would take one session the size of the first audit's Areas 1 and 3: diff each migration's function body against `supabase/schema-snapshot/functions.sql` and the A1 finding it claims to close, then re-walk the auth block of each of the nineteen routes against the A3 pattern.
- `src/app/dashboard/league/[id]/character/page.tsx` (renders `art_url` too; outside the range), `src/components/story/{WarMeter,BattleReport,FreeLegendsBoard,PowerSheet}.tsx` beyond their props, `src/lib/story-engine/` (Area 5 of the first report), `src/app/api/chat/route.ts` and the other AI routes (unchanged in this range).
- `art/higgsfield-brief.md` beyond a grep for real names (it holds the 20 prompts; one line attributes a character to the commissioner by first name), and the 18 portrait PNGs not sampled for text chunks.
- The two session hand-off files in the repo root beyond the one grep that found B-01's second location; `docs/` other than the two audit reports.
- Anything the database holds: whether the fixes claimed for A1-xx..A5-xx are live, the grant state of every RPC named above, and every NV item.
