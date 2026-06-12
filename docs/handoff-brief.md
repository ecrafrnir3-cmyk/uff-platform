# 🚀 UFF Handoff Brief

*Last updated: 2026-06-12*

This is the "start here" doc for any new Cowork session on Ultimate Fantasy Football. Pin it alongside the master prompt in the project instructions.

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
3. ~~Faction Roster Bonus weekly scoring calc~~ — DONE as a SQL function (`calculate_faction_roster_bonus`), not yet called from the app
4. Draft tool (powers hook in here) — DB has draft state/picks tables and test data, no UI yet
   - **Planned data source for ADP**: Fantasy Football Calculator free REST API — `https://fantasyfootballcalculator.com/api/v1/adp/{format}?teams=12&year=2026` (format = standard/ppr/half-ppr/2qb/dynasty). No auth, free for personal/commercial use, just attribute. Sleeper's own API has no clean ADP endpoint — use this instead for suggested pick order / value flags during the draft. (Logged 2026-06-12.)
5. Faction Control Map UI
6. Weekly token award/redemption UI
7. Scoring pipeline engine (Section 7 of the design doc)

**Suggested next session focus:** pick one of the app-side gaps above (league creation flow with faction picker is a natural starting point since it's the first thing a user touches) and build the UI to match what the database already supports.

## To-do: Vercel GitHub auto-deploy

Discovered 2026-06-12: all Vercel production deploys so far were done manually via `vercel deploy` from Nate's machine — the GitHub repo is NOT connected to Vercel, so `git push` does NOT trigger a deploy. Today's league creation flow had to be pushed (GitHub) AND separately deployed (`vercel deploy --prod`) to go live.

**Fix later**: In Vercel project settings (Settings → Git), connect the `ecrafrnir3-cmyk/uff-platform` GitHub repo so pushes to `main` auto-deploy. This is an account-settings change, so do it with Nate present/approving.

## Loose ends to revisit

- Original roadmap items not yet started: real team rosters, scoring engine pulling live nflverse stats, draft tool itself
- ~~This file (`handoff-brief.md`) was never pushed to GitHub~~ — pushed 2026-06-12.
- ~~Supabase "Leaked Password Protection"~~ — checked 2026-06-12, this requires a Pro plan ($25/mo). Skipping per bootstrap-only rule. Not a free win after all.
- ~~No dedicated email-confirmation landing page yet~~ — real signup tested 2026-06-12, confirmation email received successfully.
- No dedicated email-confirmation landing page still doesn't exist — worth building if confirmation links don't land users somewhere sensible (revisit if it becomes an issue).
