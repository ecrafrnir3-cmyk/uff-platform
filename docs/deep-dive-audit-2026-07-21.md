# UFF Deep-Dive Audit — 2026-07-21

> **FIX STATUS (2026-07-22): the fix sweep shipped.** Everything in Phases 0–2 below is FIXED except where noted — DB migrations applied to live Supabase (and recorded in `supabase/migrations/20260721230000_audit_fixes_2026_07_21.sql`), both edge functions redeployed (score-matchups v15, sync-players v5), app code committed. Additional bugs found during fixing: (a) the `uff_trades` status CHECK didn't allow `pending_review` — accepting a trade in a commissioner-review league crashed at the DB; (b) `make_draft_pick`/`start_draft` also trusted caller-supplied user IDs (forgeable picks) — both fixed; (c) a redundant pg_cron scoring job with a WRONG season anchor (Sep 3 vs Sep 9) ran every 5 min — deleted; (d) `reset_waiver_priority` compared text season to integer (runtime error) — fixed.
>
> **POST-DEPLOY DISCOVERY (2026-07-22):** while verifying the deploy, we found `finalize-week.yml` had been **invalid YAML since June** — a literal quoted newline in its curl command terminated the block scalar, so GitHub could never parse it: all 79 historical "runs" were push-time parse failures and **the Wednesday finalize schedule never fired once**. In-season, nothing would have finalized automatically. Fixed in commit `c13aa67` (single-line curl + `--fail-with-body`); GitHub now resolves the workflow by name and state=active. This supersedes the audit's assumption that the finalize cron was merely fragile — it was nonexistent.
>
> **Still open (deliberately):** the draft pick clock still only runs on the on-the-clock user's client (offline picker still stalls the draft — the queue-empty stall is fixed via best-available-ADP autopick, but a server-side timer wasn't built); matchup-preview still reveals both teams' tokens (game-design call for Nate — it competes with Recon); Second Wind→Position Power no-op, Momentum streak gaps, Time Stone mid-game partial semantics, season-titles weak guard, trade roster-size validation, transactions phantom-add display, newsletter tie wording, record-book playoff filter, prompt-injection via team names, and next-season items (hardcoded 2026 anchor, generate_schedule one-season block). **Dashboard-only follow-ups Nate must do:** set `CRON_SECRET` and `SYNC_SECRET` as edge-function secrets in the Supabase dashboard (both edge functions are currently publicly invokable — harmless-idempotent but open), and note both were left `verify_jwt: false` so the no-auth pg_cron nightly sync keeps working.

**Requested by:** Nate ("see if we missed anything and flag anything that doesn't make sense or won't work right")
**Scope:** entire platform — crons/scheduling, scoring engine, draft room, waivers/roster, trades/standings/playoffs, AI routes/security.
**Method:** six independent subsystem audits reading actual code, the live Supabase database (RPC bodies via `pg_get_functiondef`, constraints, live rows), and the live Sleeper API — followed by an adversarial verification pass where 18 headline findings each got an independent skeptic instructed to refute them.
**Verification status:** 10 skeptics completed — 9 findings CONFIRMED, 1 REFUTED and replaced with a worse defect. The remaining 8 skeptics could not run (monthly Claude spend limit hit mid-pass); those findings rest on the primary audit's evidence, which for most includes direct quotes of live DB function bodies.

**Nothing was changed. This is a flag-only report. All file paths are relative to the repo root; DB = live Supabase project `synfuvgdamhjboobjmls`.**

---

## The big picture (read this first)

1. **The platform's autopilot is broken.** The parts that run unattended — auto-waivers, waiver result emails, week-18 finalization, the newsletter loop, scoring-failure detection — all have confirmed defects. Season 1 would limp through a week fine and then quietly fall apart at the weekly boundaries.
2. **The trust model is client-side in too many places.** Several live database functions authenticate with a caller-supplied user ID instead of the session (`auth.uid()`), the draft power actions trust whatever the browser sends, and a public share page + an unscoped commissioner override combine into a working cross-league score-tampering chain.
3. **Three cross-league time bombs are latent, not live.** Playoff seeding, the faction bonus, and the share page all work *today* only because exactly one league exists. Each silently breaks the moment a second league generates a schedule.
4. **The source of truth for game logic is not in git.** The RPCs that implement drafting, waivers, trades, finalization, seeding, and titles exist only in the live database — `supabase/migrations/` holds a single migration. If the DB is ever lost or forked, the game rules go with it.
5. **The docs overstate what works.** `CLAUDE.md` says rate limiting was "confirmed on all 10 AI routes" — the verifier proved `checkRateLimit` has **zero call sites**. Same lesson as Bell Cow U: check the artifact, not the status stamp.

**One genuinely good result:** every previously-fixed invariant was re-verified and held — Vampire Bite league-scoping, Shadow Guard's two-layer block, Power Negation semantics, `faabEnabled` logic, the FreeAgents `hasBid` gating, and the priority Cancel path. No regressions on past fixes.

---

## CONFIRMED — verified by independent adversarial pass

### C1. Auto-waivers process the wrong week → all claims stranded forever (HIGH)
`src/app/api/cron/process-waivers/route.ts:51`, `src/lib/nfl-utils.ts`, RPCs `process_waiver_bids` / `process_priority_waivers`.
The week number rolls Wednesday 00:00 UTC. Default `waiver_day=3, waiver_hour=3` (Wed 3 AM ET) means the cron runs *after* the roll and asks the RPC for week N+1 bids, while every bid placed Thu–Tue carries week N. The RPC filters `WHERE week = p_week AND status='pending'` → finds nothing → returns "0 claims" successfully. Every claim in a default-configured league is silently left pending forever. Manual commissioner processing only works if he hand-enters the *previous* week number.

### C2. Priority-waiver leagues can't submit claims at all (HIGH)
RPC `submit_waiver_bid` + `FreeAgents.tsx:240-244` + `faab-actions.ts:22`.
The RPC raises "FAAB bidding is not enabled for this league" whenever `faab_budget = 0` and never reads `waiver_type`. Priority leagues normally have budget 0 (the column default; switching waiver type in settings never sets a budget). The priority Claim button calls that same RPC → every claim errors out.

### C3. Priority waiver *processing* always crashes and rolls back (HIGH — replaces a lesser finding)
RPC `process_priority_waivers` inserts awarded players with `slot = <player position>` ('QB', 'RB'…), but the table CHECK constraint only allows `'active'`/`'ir'`. The function has no exception handler → the first award raises a constraint violation and **the entire processing transaction rolls back**: no claims awarded, priorities untouched, cron just logs an error. (The original "orphaned roster row" theory was refuted by the verifier — the constraint makes it impossible; the reality is a total abort.)

### C4. FAAB waiver result emails/notifications never fire (MED)
RPC `process_waiver_bids` writes statuses `'won'`/`'lost'`; the cron's email block (`process-waivers/route.ts:105`) queries `.in("status", ["awarded","rejected"])` — the *priority* processor's vocabulary. FAAB leagues (the default) get zero result emails and zero in-app notifications, silently.

### C5. Week 18 is never finalized; the week-17 newsletter re-emails everyone weekly, forever (HIGH)
`nfl-utils.ts:6` clamps the week at 18; both weekly crons compute `week - 1`. So the automated pipeline stops at week 17: week 18 (the championship week!) is never finalized except by hand, its newsletter never exists, and every Wednesday after the season the week-17 newsletter is regenerated (fresh Anthropic spend) and re-emailed to all members indefinitely — no idempotency guard, no season end date in the workflows. (Verifier correction: week 17 finalization itself no-ops on re-runs — the `is_complete=false` filter prevents damage there. The newsletter loop and missing week 18 stand.)

### C6. Scoring can be dead for weeks while every cron run shows green (HIGH)
`score-matchups/route.ts:39` returns HTTP 200 even when the edge function fails (`{ ok: res.ok }` in the body); the GitHub workflow only fails on non-200 and discards the body (`curl -o /dev/null`). Sentry sees nothing because nothing throws. **Verifier bonus discovery:** there is *also* a live pg_cron job (`score-matchups-every-5min`) calling the same edge function fire-and-forget via `net.http_post`, responses unread — so scoring runs on two redundant schedules, both blind to failure. (This double-schedule is itself worth resolving — it doubles Sleeper/DB load and confuses debugging.)

### C7. Team defenses are never synced — DEF data is frozen at a June backfill (HIGH)
`sync-players/index.ts:110` skips any Sleeper entry without `full_name`; verified against the live Sleeper API that all 32 DEF entries have no `full_name` field. Live DB confirms: DEF rows exist only from a one-time manual backfill (updated_at frozen 2026-06-16, `adp` NULL, `status` NULL) while every other position was refreshed by the July sync. DEF ADP/injury/team data will never update; DEF draft ranking and DEF-dependent features degrade silently.

### C8. Public share page leaks and mixes matchups across leagues (HIGH, latent)
`src/app/share/matchup/[matchupId]/page.tsx:102-106` — no auth, service-role client (bypasses RLS), queries by `matchup_id` alone. Verified in the DB that `matchup_id` numbering restarts at 1 per league (only unique indexes are `(id)` and `(league_id, week, member_id)`). With 2+ leagues the query returns 4+ rows and the page renders two arbitrary ones as if they played each other — publicly. Enumerable by URL. Nothing in the app even links to this page; it's orphaned but live. (Verifier caveat: the fetched UUIDs aren't rendered in the HTML, so the leak is game data, not raw IDs — but see U2, which doesn't need the page to get row IDs.)

### C9. Faction bonus collides across leagues (MED today, HIGH at 2+ leagues)
`supabase/functions/score-matchups/index.ts:245-257` — `playerMemberMap` is keyed by `player_id` across ALL leagues being scored; a player rostered in two leagues credits only the last-written member with the 0.5 faction bonus. The adjacent Vampire Bite pass league-scopes correctly (that was the old fix), underscoring the omission here. Latent: fires the moment a second league is live.

### C10. Rate limiting is dead code on every AI route (HIGH)
`src/lib/rate-limit.ts` defines `checkRateLimit`; all 10 AI routes import it at line 1; **zero call sites exist anywhere in `src/`** — verified by grep and by reading a full route. No middleware, proxy, or DB-side compensating throttle exists. Any authenticated member can script unlimited Anthropic-backed requests (chat also doesn't bound message sizes). `CLAUDE.md`'s Session 22 claim that rate limiting was "confirmed on all 10 routes" is false — the routes import it and never call it.

---

## UNVERIFIED-BY-SECOND-PASS — strong primary evidence, skeptics didn't run (spend limit)

These eight came out of the subsystem audits with specific file/line or live-DB-function evidence; treat as near-certain but re-confirm the DB-side ones before acting.

### U1. Several DB RPCs authenticate with a caller-supplied user ID (HIGH — security)
Live function bodies (read via `pg_get_functiondef` by the primary audit): `finalize_week`, `seed_playoffs`, `generate_schedule`, `extend_schedule` check `commissioner_id != p_user_id` where `p_user_id` is an argument the client sends; `authenticated` role has EXECUTE. `commissioner_id` is readable by any logged-in user under the current RLS. So any member can, from the browser console, finalize any league's week mid-games, seed playoffs early, or extend schedules. Additionally `mark_week_tokens_used`, `advance_playoff_bracket`, and `finalize_all_active_leagues` have **no auth check at all** (the token one enables a griefing play: pre-mark opponents' tokens used, destroying their Insurance before finalize). The trade RPCs, by contrast, correctly use `auth.uid()` — the fix pattern already exists in the same database.

### U2. Commissioner score override: cross-league write + silently erased by the cron (HIGH)
`matchups/actions.ts:63-96`. (a) It verifies the caller commissions the *form-supplied* league, then updates the matchup row by ID with the **service-role client and no league filter** — any commissioner of any throwaway league can rewrite scores in any other league (row IDs are readable by all authenticated users). Found independently by two subsystem audits. (b) The override writes `points = old + delta` directly, and the scoring edge function blindly overwrites `points` on every 15-minute run for non-finalized weeks — any pre-finalize adjustment evaporates within 15 minutes. Post-finalize adjustments survive but desync `median_win`, Insurance voids, bracket winners, and the high-scorer chip, which are never recomputed.

### U3. The cron finalization path skips median scoring and playoff advancement, and the repair path is bricked (HIGH)
`finalize_all_active_leagues` (live body read by primary audit) never sets `median_win` and never calls `advance_playoff_bracket` — unlike the commissioner's `finalize_week`. Consequences: median leagues accrue phantom median losses (`standings/page.tsx:124-131` counts NULL as a loss); playoff weeks never advance the bracket; and the UI's `forceFinalize` repair fails and rolls back because `finalize_week`'s high-scorer chip INSERT hits `UNIQUE(member_id, earned_week)` already satisfied by the cron's award.

### U4. Playoff seeding breaks at 2+ leagues (HIGH, latent)
`seed_playoffs` joins opponents on `matchup_id` alone with no league/season scoping, while `generate_schedule` numbers `matchup_id` from 1 per league (the per-league numbering was independently confirmed by the C8 verifier). One league: fine. Two leagues: every league's seeding math ingests the other league's rows. Same under-constrained join pattern exists in `reset_waiver_priority`.

### U5. Draft power server actions are client-trust-only (HIGH — game integrity)
`draft/actions.ts`: `assignPowerToPick` has no membership check and its upsert on `(league_id, player_id)` lets **any member overwrite the power on any player** (e.g. strip an opponent's Shadow Guard, then Vampire Bite them); `revealNextPower`, `executeHeist`, `restoreHeistOrder` lack membership/holds-the-power checks (`executeHeist` trusts a client-supplied draft order — a crafted call rewrites `draft_order` arbitrarily); `swapForesightCoin` and `assignVampireBite` never verify the caller holds that power for that round. For a hand-picked friendly beta this is survivable; it is not shippable to strangers (the app-store plan).

### U6. Draft can freeze permanently: pick clock is client-only and autopick is queue-only (HIGH)
`DraftRoom.tsx` (~line 982): the clock only ticks on the on-the-clock user's own browser — if they're offline, no timer exists anywhere and the draft freezes for everyone, indefinitely. Even online, expiry calls `executeAutodraft` (`queue-actions.ts:94-156`) which picks **only from the user's queue** — empty queue → error → stuck on "Time's up — autopicking…". The documented "auto-selects best queued/available player" fallback does not exist. Related: the draft room is *not* Supabase Realtime — it's a 5-second poll; the make-pick RPC's concurrency guarantees are unverifiable from the repo.

### U7. Scoring engine trusts every DB read: a transient query failure writes zeros over live scores (HIGH)
`score-matchups/index.ts:148-183` destructures `{ data }` from ~8 parallel queries with no error checks; a failed roster/lineup/token query yields empty maps → every member computes 0 → the unchecked final `.update()`s (624-646) overwrite the stored week with zeros. Self-heals next run — unless it's the last run before Wednesday finalization, in which case the week finalizes on garbage.

### U8. Underdog/Clutch Gene bonuses can flip matchup winners (HIGH — game rules)
`score-matchups/index.ts:599-620`: Underdog's +3 and Clutch Gene's +1 are added into the stored `points` that standings and the finalize RPC compare raw — a margin smaller than the bonus flips the result, which the code comment and spec both promise can't happen. Also order-dependent (side A's bonus mutates the total side B's condition reads). Time Stone likewise freezes players who are merely Questionable (`index.ts:331` treats any non-null injury status as injured), substituting stale scores for players who actually played.

---

## MEDIUM findings (primary audits; not re-verified)

**Scheduling/crons**
- `CRON_SECRET` unset → auth fails open: all four cron routes compare against `` `Bearer ${undefined}` ``, so the literal header "Bearer undefined" would pass (three routes never check the var exists).
- finalize → newsletter ordering is two independent GitHub cron schedules 30 min apart; GH Actions delays routinely exceed that → "No complete matchups" → that week's newsletter silently never sends (workflow treats 207 as success, even when *every* league fails).
- Waiver processing requires an exact ET day+hour match — a skipped hourly run (common on GH Actions) means that league's waivers just don't run that week; no catch-up sweep.
- The week rolls Tuesday evening ET (Wed 00:00 UTC), so Tuesday-evening waiver configs straddle two week numbers; DST approximation (`month >= 2 && month <= 9`) is wrong for up to a week around transitions in some years.
- Nothing is season-gated: all crons run year-round against week 1 (pre-season) / week 17 (post-season).
- Season anchor internally contradictory: comment says "Thursday Sep 9, 2026" but Sep 9 is a Wednesday; if real kickoff is Thu Sep 10, all weekly lock times are 24h early — but the Wednesday-UTC boundary is also what makes the finalize/newsletter `week-1` math work, so the anchor and the crons must be changed together.

**Waivers/roster**
- Priority mode enforces no roster cap and no per-week/per-season acquisition limits (FAAB does); neither mode checks the Can't Cut List on the drop side (client-only guard).
- FAAB: if the named drop player is gone at process time, the add still happens → roster cap exceeded.
- Priority: the processing loop materializes its order once — the #1 manager wins *all* their claims in one run instead of moving to the back after the first.
- Whole-week lineup lock is client-only when `uff_game_schedule` has no rows for the week (server fallback missing in `setLineup`).
- "→ IR" button shows for Out/Doubtful players but the `move_to_ir` RPC requires status exactly 'Injured Reserve' → guaranteed error clicks.
- Eliminated members' pre-elimination bids still process.

**Trades**
- `cancel_trade` has no row lock and an unconditional final UPDATE → a cancel racing an accept can mark an *executed* trade "cancelled" (rosters swapped, history wrong, hidden from Transactions).
- No roster-size validation anywhere in the trade path (3-for-1 leaves both rosters wrong-sized).
- `propose_trade` never checks the receiver is in the same league → crafted cross-league trades corrupt `uff_roster_players` (member from league B owning a row still tagged league A).
- Trade deadline enforced only in the Next.js layer — the RPCs are directly callable post-deadline.
- `veto_trade` writes status `'rejected'`, never `'vetoed'` → the veto UI branch and veto-reason display in Trade Center are dead code; vetoes look like partner rejections.
- RLS lets a proposer UPDATE arbitrary columns on a pending trade (bait-and-switch player arrays pre-accept, or set `status='accepted'` directly to fake a completed trade in history).
- `matchup-breakdown`, `trade-eval`, `trade-veto-analysis` routes don't constrain secondary IDs (member/trade IDs) to the league they authorize against — actual exposure depends on RLS policies that aren't in the repo.

**Standings/pages**
- Standings, managers, and record-book queries have no `is_playoff` filter → playoff games pollute regular-season records; PF/PA also accumulates from live/incomplete rows.
- `MatchupView` keeps previous week's state on `?week=` navigation (no key/prop-sync) — matchups, recaps, and previews from week N render under week N+1's header until hard refresh.
- Transactions page double-reports every trade (trade event + phantom waiver "add" by the acquiring team).
- `get-record.ts` counts ties as losses (feeds every AI prompt); newsletter's own tie logic disagrees; newsletter declares team B winner on exact ties.
- Season titles RPC only requires *some* completed playoff match — run early, it crowns a semifinalist champion; championship is inferred from "highest combined points in the last completed playoff week," ignoring the bracket's actual `winner_id`.

**Scoring engine (game rules)**
- Iron Defense never doubles — code floors negatives at 0 only; the design doc and player guide both promise "doubled, season-long." Either the engine is missing the power's main effect or two player-facing surfaces oversell it.
- Mirror Match mirrors bonuses from *benched* opponent players (no starter check in the bonus accumulation pass).
- Second Wind → Position Power silently does nothing (the replay consumes the choice slot, so the position choice is empty → no-op); the UI happily offers it.
- Time Stone's "last healthy score" is overwritten with mid-game partials on every 15-min run — the freeze hierarchy evaluates garbage.
- Momentum streaks mis-compute when a past opponent isn't in the current scoring run, and ignore Insurance-voided weeks.
- Projections fetch failure silently zeroes all projections (mis-aiming Iron Will's "double your highest-projected starter") and overwrites stored projections with 0.
- A member with no lineup rows for the week scores their **entire roster** (`isStarter` defaults true when the lineup set is missing).
- sync-players assigns FFC ADP by normalized name with no team/status disambiguation — retired namesakes (e.g. the two Mike Williamses) inherit real players' ADP.

**Security/email (below the HIGHs)**
- Open redirect in `auth/callback` via unvalidated `?next=` (phishing primitive on a legitimate Supabase confirmation link).
- HTML injection into notification emails via unescaped team names / veto reasons / announcement bodies — attacker-controlled markup sent from the verified playuff.com domain.
- `syncPlayers` server action has no commissioner check (any member can hammer the service-role-authorized edge function); `processWaivers` action likewise relies entirely on RPC-side checks that don't exist for priority mode.
- `matchup-preview` reveals both teams' secret weekly tokens to any member pre-lock — the rulebook says that's the Recon token's exclusive power.
- Prompt injection via team/league names into the newsletter/Oracle prompts (integrity, not leakage — no hidden data in context).

---

## LOW findings (abridged)

Curly-vs-straight apostrophe makes one of the two "Hero's Shield" UI checks dead; Vampire Bite modal lets you bite your own player; draft board misattributes columns during a heisted round; Telepathy reveal goes stale after an intra-buffer heist (and the "cloaked" banner names Shadow Guard, disclosing the power it hides); queue-add position race on rapid clicks; hardcoded power IDs (9, 4) with no repo-side seed as source of truth; `/api/trending` unauthenticated via admin client (public data, needless RLS bypass); chat SSE passes through raw Anthropic events (model ID/usage visible; benign); score-matchups proxy has no timeout; `generate_schedule` blocks a second season forever (`COUNT(*)` not season-scoped); `getCurrentNFLWeek` hardcodes the 2026 season (breaks next year); mid-cancel partial email map on admin pagination error; ties advance slot A in playoffs with no tiebreaker; `saveDraftOrder` doesn't validate the submitted IDs are exactly the league's members (malformed order bricks the draft); Sniper dead if a commissioner zeroes `fgm_50p`; unused `memberLeagueMap` leftover; stale docs — CLAUDE.md/handoff-brief still describe the removed Mock Draft Mode as live, and CLAUDE.md's architecture section says "Supabase Realtime" for a draft room that actually polls every 5 s.

---

## Recommended fix order (when UFF resumes)

**Phase 0 — before the Sept 9 draft (function):**
1. Waiver week mismatch (C1) + priority claim block (C2) + priority slot crash (C3) + FAAB email statuses (C4) — the waiver system end-to-end.
2. Draft freeze (U6): server-side or any-client pick timer + best-available autopick fallback.
3. Week-18 clamp + newsletter loop (C5); add a season gate to all four workflows.
4. Scoring observability (C6): propagate edge-function failure to a non-200 + kill or fix the redundant pg_cron job; add error checks in the edge function (U7).
5. DEF sync (C7): build the name from `first_name + last_name` for DEF.

**Phase 1 — before any stranger joins (trust):**
6. Move all RPC auth to `auth.uid()` (U1) and add auth to the unauthenticated RPCs; the trade RPCs already show the correct pattern.
7. Scope `adjustScore` to the league + persist overrides as a delta column the cron re-applies (U2).
8. Delete or league-scope the share page (C8); fix the open redirect; escape email HTML.
9. Server-side validation on draft power actions (U5).
10. Actually call `checkRateLimit` (C10) — one line per route.

**Phase 2 — before a second league exists:**
11. League-scope `seed_playoffs`, `reset_waiver_priority`, faction bonus (C9/U4).
12. Fix `finalize_all_active_leagues` (median + bracket + idempotent chip insert) (U3).

**Phase 3 — hygiene:**
13. Dump every RPC + RLS policy into `supabase/migrations/` so the game rules live in git.
14. Reconcile spec vs engine on Iron Defense, Underdog/Clutch flips, Time Stone; fix the tie-handling inconsistencies; update CLAUDE.md's false claims (rate limiting "confirmed", "Supabase Realtime" draft room, Mock Draft remnants).

---

*Report generated 2026-07-21 by a six-agent subsystem audit + 18-finding adversarial verification pass (10 completed, 8 blocked by the monthly spend limit). Verification transcripts live in the session workspace; live-DB claims were read via the Supabase MCP against project `synfuvgdamhjboobjmls`.*
