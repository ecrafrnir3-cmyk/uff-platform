# 🚀 UFF Handoff Brief

*Last updated: 2026-06-12 (evening session)*

This is the "start here" doc for any new Cowork session on Ultimate Fantasy Football. Pin it alongside the master prompt in the project instructions.

## ✅ Session update — 2026-06-12 (evening, work computer)

**Shipped this session:**
- **My Team / roster page** (`/dashboard/league/[id]/roster`) — built and deployed live. 3-column layout:
  - Left: "Your Powers" — draft power assignments per round with status badges (Active/Fizzled/Negated/Restored/Pending).
  - Center: Faction Roster Bonus calc + full roster list (sorted QB/RB/WR/TE/K/DEF, faction-match highlighting).
  - Right: "League Activity" (recent draft picks feed) + "NFL News" (ESPN free RSS headlines, no-auth).
  - Added "My Team" nav link from the league page.
  - Deployed via `vercel deploy --prod` — confirmed live ("✓ Ready in 44s").
- **Player news research** (Nate's ask: "pull individual player news in real time like the major apps") — researched free vs. paid real-time player/injury news APIs. See findings below. **No code built yet — holding for go-ahead.**

**Player news API research findings:**
- **Best free lead**: ESPN's undocumented per-player news endpoint — `site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=50&playerId={ESPN_ID}` (also `site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}/news`). Same ESPN API family already powering the working NFL News RSS panel — zero cost, fits bootstrap rule. Source: community-documented gist (gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c). **Caveat**: undocumented/unsupported, could change without notice. Couldn't live-test from the sandbox (network allowlist blocks `site.api.espn.com`, unlike `www.espn.com`) — needs testing from a deployed route or local dev.
- **Paid options checked, no public pricing found for any**:
  - SportsDataIO — free trial returns scrambled/demo data only; real pricing requires sales contact.
  - RotoWire — real-time injury/news feed exists (GTD→OUT transitions, ~250 notes/day NFL season), but pricing is sales-negotiated, not public.
  - Also identified but not deep-dived: Tank01 (RapidAPI), BALLDONTLIE, MySportsFeeds, Goalserve, Fantasy Nerds.
- **Recommendation**: try the free ESPN per-player endpoint first (build a small test on a deployed route since sandbox can't reach it). Only explore paid options if it proves unreliable.
- **Next step**: Nate to decide — build/test the free ESPN per-player endpoint, or hold. Not started.

## 📒 Journal

Day-by-day work log now lives in `docs/journal.md` — check there for what happened in past sessions.

## 🎯 Product Vision & Launch Goal

**The bar:** ship a fully functional, bug-free fantasy platform that feels as polished as Yahoo Fantasy — the major-platform UX Nate likes best (clean roster/lineup management, live scoring, and especially Yahoo's **trade comparison tool**, now on the feature backlog — see Pre-Launch Punch List below).

**Target distribution:** Google Play + other app stores, on top of the web app. Plan: PWA-first (manifest already in place), Android via Trusted Web Activity (TWA/Bubblewrap wraps a PWA for the Play Store with minimal extra code) once the app is feature-complete; iOS App Store needs a Capacitor/native shell — bigger lift, deferred.

**What "done" means for launch:** every Section 9 build item working end-to-end with real data, no known bugs, RLS/perf hardening complete (see punch list), and a UX pass so the app *feels* like Yahoo/ESPN-tier, not a prototype.

## 🆕 Big update found 2026-06-12

Nate did a LOT of direct database work overnight (migrations timestamped 2026-06-11 ~11:48pm through 2026-06-12 ~12:59am) that wasn't written down anywhere. The Supabase database is now WAY ahead of this doc and the app code. Section 9 items 1–4 are basically done at the database level:

- **Faction system**: `league_members.faction` (hero/villain), `nfl_teams` table (32 teams, AFC=Hero/NFC=Villain, matches design doc Section 2)
- **Draft powers & weekly tokens pools**: `draft_powers` (16 rows) and `weekly_tokens` (18 rows) tables exist, matching the finalized design doc
- **Power state tracking**: `draft_power_assignments` (which power each team got each round) and `team_active_powers` (status: pending/active/fizzled/negated/restored) tables exist
- **Power Restore Chips**: `power_restore_chips` table exists (economy from design doc)
- **Players database**: `players` table has 4,254 real NFL players with position/team
- **Draft tool data layer**: `uff_draft_picks`, `uff_leagues.draft_order`/`draft_status`/`draft_rounds` all exist
- **Faction Roster Bonus**: a working SQL function `calculate_faction_roster_bonus()` already implements the design doc's "+0.5 pts per rostered player matching your faction" rule exactly

There's also a test league ("Draft Test 2026") with 2 members, factions assigned, draft in progress, 4 picks made, and all 32 power assignments (2 members × 16 rounds) populated — looks like Nate was testing the schema end-to-end.

**What's NOT done yet:** the Next.js app (dashboard, league creation, etc.) doesn't use any of this yet — no faction picker UI, no draft tool UI, no Faction Control Map, no weekly token UI. The database is ready; the app needs to catch up. This is likely the best place to start the next build session.

## Where things stand

**Hero vs Villain design doc** (`docs/hero-villain-system.md`) — fully finalized today:
- All 16 draft superpowers locked, mapped 1:1 to the (now hard-locked) 16-round draft, including the new "tied-to-this-round's-pick" mechanic with position-fizzle risk.
- All 18 weekly superpower tokens locked, with visibility/lock/no-banking rules nailed down and several tightened to evaluate on FINAL results (Last Stand, Underdog, Iron Will) to close manipulation loopholes.
- New sub-systems added: Power Restore Chip economy, Faction Control Map scoring convention (+1/-1/0), and a full **Scoring Pipeline / Order of Operations** (Section 7) that resolves every interaction between draft powers and weekly tokens.
- Doc is build-ready — Section 9 (Build Sequencing) is the punch list for the actual implementation.

**Platform code** (`uff-platform/`):
- Next.js app scaffolded, deployed to Vercel.
- Supabase backend live: schema for `profiles`, `uff_leagues`, `league_members` (with RLS), plus earlier demo schema (leagues, users, rosters, matchups, oracle_recaps).
- Auth wired in (Supabase Auth + `@supabase/ssr`), login/signup pages built, dashboard supports list/create/join leagues.
- Build verified, signup/create/join flow smoke-tested.
- **Fixed 2026-06-12:** Supabase Auth "Site URL" was `localhost`, breaking signup confirmation emails. Updated to `https://uff-platform.vercel.app` (Authentication → URL Configuration); Redirect URLs allow-list also checked.

**GitHub** — as of today, the project is on GitHub for the first time:
- Repo: `https://github.com/ecrafrnir3-cmyk/uff-platform` (private)
- `.env.local` (Supabase keys) is gitignored and was NOT pushed — needs to be recreated manually on any new computer (`.env.example` shows the required vars).
- To work from a second computer: `git clone https://github.com/ecrafrnir3-cmyk/uff-platform.git`, then recreate `.env.local`.

## Next up (per Section 9 Build Sequencing)

1. ~~Schema: power tables, faction assignment, player conference tags~~ — DONE in database (see "Big update" above), app code not yet using it
2. League creation flow: even-team enforcement, faction picker/randomizer, 16-round draft lock — DB supports this, UI doesn't exist yet
3. ~~Faction Roster Bonus weekly scoring calc~~ — DONE as a SQL function (`calculate_faction_roster_bonus`) AND now displayed live on the roster page (2026-06-12)
4. Draft tool (powers hook in here) — DB has draft state/picks tables and test data, no UI yet
   - **Planned data source for ADP**: Fantasy Football Calculator free REST API — `https://fantasyfootballcalculator.com/api/v1/adp/{format}?teams=12&year=2026` (format = standard/ppr/half-ppr/2qb/dynasty). No auth, free for personal/commercial use, just attribute. Sleeper's own API has no clean ADP endpoint — use this instead for suggested pick order / value flags during the draft. (Logged 2026-06-12.)
5. Faction Control Map UI
6. Weekly token award/redemption UI
7. Scoring pipeline engine (Section 7 of the design doc)

**Suggested next session focus (from home computer):**
1. Decide on player news (see Session Update above) — if go, build/test the free ESPN per-player endpoint.
2. Draft tool UI (item 4 above) — biggest remaining gap, DB/test data already exist.
3. Faction Control Map UI (item 5).

## To-do: Vercel GitHub auto-deploy

Discovered 2026-06-12: all Vercel production deploys so far were done manually via `vercel deploy` from Nate's machine — the GitHub repo is NOT connected to Vercel, so `git push` does NOT trigger a deploy. Today's league creation flow had to be pushed (GitHub) AND separately deployed (`vercel deploy --prod`) to go live.

**Fix later**: In Vercel project settings (Settings → Git), connect the `ecrafrnir3-cmyk/uff-platform` GitHub repo so pushes to `main` auto-deploy. This is an account-settings change, so do it with Nate present/approving.

## 🔍 Pre-Launch Punch List (Deep Review 2026-06-12)

A full review of the codebase + live Supabase schema + Vercel project surfaced the items below. None are blocking today's work, but all should be cleared before launch.

**Done today:**
- Added missing indexes on unindexed foreign keys (`draft_power_assignments`, `league_members`, `power_restore_chips`, `uff_draft_picks`, `uff_leagues`, `uff_roster_players`, `weekly_token_assignments`) — flagged by Supabase's performance advisor, cheap/safe to add now before data volume grows.

**Needs a dedicated session (touches RLS — do carefully, not rushed):**
- ~20 RLS policies across `profiles`, `uff_leagues`, `league_members`, `draft_power_assignments`, `weekly_token_assignments`, `uff_roster_players`, `uff_draft_picks`, `team_active_powers` re-evaluate `auth.uid()` per row instead of `(select auth.uid())` — a known Supabase perf gotcha that gets slow under real draft-night load. Fix is mechanical but must be tested per-table to avoid breaking access control.
- Several tables (`draft_power_assignments`, `team_active_powers`, `uff_draft_picks`, `uff_roster_players`, `league_members`) have overlapping/duplicate permissive RLS policies for the same action — consolidate for clarity and a small perf win.

**Cleanup (low priority, no rush):**
- Dead prototype code from the very first proof-of-concept: `/demo` route, `src/lib/{data,oracle,sleeper,db}.ts`, `src/lib/fixtures/*`. Also the old demo DB tables (`leagues`, `matchups`, `rosters`, `sleeper_users`, `oracle_recaps`) — separate from the real `uff_leagues`/`league_members` schema, safe to drop once confirmed unused.
- `/demo` is currently a publicly-reachable route with fake data — not a security issue, but looks unfinished.

**Deploy pipeline (already logged above, reconfirmed):** Vercel project still has no GitHub link — `git push` does not auto-deploy. Confirmed again via Vercel API today.

**Missing piece / current focus:** ~~there's no "My Team / roster" page yet~~ — DONE 2026-06-12 evening, see Session Update above. Faction Roster Bonus now displays live. Draft tool and weekly token UI are still the next big builds.

**New feature backlog (from Nate, 2026-06-12):**
- **Trade comparison tool**, Yahoo-style — compare two rosters/players for trade fairness. Needs a player valuation source; the Fantasy Football Calculator ADP API (already logged under Draft tool) could seed this, or build off nflverse projections later.

**Scaling/app-store notes:**
- Live-game features (Faction Control Map, weekly token reveals, live scoring) will feel much more "pro" with Supabase Realtime subscriptions instead of polling — worth designing in from the start of the scoring pipeline build (Section 9 item 7).
- Custom domain (vs. `*.vercel.app`) would help the "professional platform" feel for app store listings — optional, revisit closer to launch.

## Loose ends to revisit

- Original roadmap items not yet started: real team rosters, scoring engine pulling live nflverse stats, draft tool itself
- ~~This file (`handoff-brief.md`) was never pushed to GitHub~~ — pushed 2026-06-12.
- ~~Supabase "Leaked Password Protection"~~ — checked 2026-06-12, this requires a Pro plan ($25/mo). Skipping per bootstrap-only rule. Not a free win after all.
- ~~No dedicated email-confirmation landing page yet~~ — real signup tested 2026-06-12, confirmation email received successfully.
- No dedicated email-confirmation landing page still doesn't exist — worth building if confirmation links don't land users somewhere sensible (revisit if it becomes an issue).
