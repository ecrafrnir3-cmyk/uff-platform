# 📒 UFF Project Journal

Dated work log for Ultimate Fantasy Football. Newest entries at the top. Companion to `docs/handoff-brief.md` (status/next-steps doc) — this file is the "what happened and when" history.

---

## 2026-06-12 (evening) — Roster page 3-column layout + player news research

**Where:** work computer, Cowork session.

**Did:**
- Built and deployed the **My Team / roster page** (`/dashboard/league/[id]/roster`):
  - Left column: "Your Powers" — draft power assignments per round with status badges (Active/Fizzled/Negated/Restored/Pending), pulled from `draft_power_assignments` + `team_active_powers`.
  - Center column: Faction Roster Bonus (live `calculate_faction_roster_bonus` call) + full sorted roster (QB/RB/WR/TE/K/DEF order, faction-match highlighting).
  - Right column: "League Activity" (last 8 draft picks across the league) + "NFL News" (ESPN free RSS feed, no auth, 30-min revalidate).
  - Added a "My Team" button on the league page linking here.
  - Deployed via `vercel deploy --prod` — live, confirmed "✓ Ready in 44s".
- Researched real-time per-player news APIs (Nate's ask: "pull individual player news in real time like the major apps"). Findings logged in `handoff-brief.md` Session Update — best free lead is ESPN's undocumented per-player-news endpoint; paid options (SportsDataIO, RotoWire, etc.) have no public pricing. **Not built — awaiting Nate's go-ahead.**

**Why it matters:** This was the last piece blocking the Faction Roster Bonus from being visible to users, and gives the roster page the "Yahoo-app" feel (news + activity panels) Nate asked for after seeing too much empty space on the first version.

**State at end of session:** roster page live and working. Player news feature is researched but not started — next session should open with Nate's decision on that.

---

## 2026-06-12 (daytime) — League creation flow, deep review, doc finalization

**Where:** work computer, Cowork session.

**Did:**
- Finalized the **Hero vs Villain design doc** (`docs/hero-villain-system.md`) — all 16 draft powers, all 18 weekly tokens, Power Restore Chip economy, Faction Control Map scoring, and the full Section 7 scoring pipeline are locked. Doc is build-ready.
- Built the **league creation flow**: faction picker/randomizer UI, even-team enforcement, 16-round draft lock (`/dashboard/league/[id]` page + `actions.ts`).
- Fixed a build error (moved `LEAGUE_SIZE_OPTIONS` out of a `"use server"` file).
- **Fixed Supabase Auth bug**: "Site URL" was set to `localhost`, breaking signup confirmation emails — updated to `https://uff-platform.vercel.app`. Verified with a real signup.
- Pushed the project to **GitHub** for the first time (`github.com/ecrafrnir3-cmyk/uff-platform`, private). `.env.local` gitignored — needs manual recreation on a second computer.
- Did a deep review of the codebase + live Supabase schema + Vercel project; logged a **Pre-Launch Punch List** in `handoff-brief.md` (RLS perf fixes, dead `/demo` code, missing GitHub→Vercel auto-deploy, etc.).
- Added missing FK indexes (`draft_power_assignments`, `league_members`, `power_restore_chips`, `uff_draft_picks`, `uff_leagues`, `uff_roster_players`, `weekly_token_assignments`) flagged by Supabase's performance advisor.
- Logged Nate's **product vision**: launch bar = Yahoo-Fantasy-quality, bug-free, app-store-ready (Google Play first, PWA→TWA path); Yahoo-style **trade comparison tool** added to the feature backlog.
- **Discovered the "big update"**: realized partway through the session that Nate had done a huge amount of direct Supabase work overnight (see entry below) that hadn't been written down anywhere — app code was behind the database. This reframed the session's priorities toward catching the app UI up to the DB.

**Why it matters:** This was the session where the project went from "prototype with a stale plan" to "plan matches a build-ready design doc, and we know exactly what the DB already supports vs. what the app still needs."

---

## 2026-06-11 ~11:48pm – 2026-06-12 ~12:59am — Overnight direct Supabase build-out (Nate, solo)

**Where:** Nate working directly in Supabase, no Cowork session — reconstructed the next day from migration timestamps and schema review.

**Did (all at the database level, via migrations):**
- **Faction system**: `league_members.faction` (hero/villain) + `nfl_teams` table (32 teams, AFC=Hero / NFC=Villain, matches design doc Section 2).
- **Draft powers & weekly tokens**: `draft_powers` (16 rows) and `weekly_tokens` (18 rows), matching the finalized design doc.
- **Power state tracking**: `draft_power_assignments` (which power each team got each round) and `team_active_powers` (status: pending/active/fizzled/negated/restored).
- **Power Restore Chips**: `power_restore_chips` table (economy from the design doc).
- **Players database**: `players` table populated with 4,254 real NFL players (position/team).
- **Draft tool data layer**: `uff_draft_picks`, plus `uff_leagues.draft_order` / `draft_status` / `draft_rounds`.
- **Faction Roster Bonus**: working SQL function `calculate_faction_roster_bonus()` implementing the design doc's "+0.5 pts per rostered player matching your faction" rule.
- Created a test league ("Draft Test 2026") with 2 members, factions assigned, draft in progress, 4 picks made, and all 32 power assignments (2 members × 16 rounds) populated — full schema smoke test.

**Why it matters:** This put the database roughly 4 build-sequencing items ahead of the app code overnight, with zero documentation. It took a chunk of the next session just to *discover* this had happened. **Lesson: log DB changes (even quick ones) in this journal as they happen, not the next day.**

---

## Earlier history (pre-2026-06-11)

Initial build: Next.js app scaffolded and deployed to Vercel; Supabase backend (profiles, uff_leagues, league_members + RLS, plus an early demo schema); Supabase Auth wired in (`@supabase/ssr`); login/signup pages; dashboard with list/create/join leagues. Build verified, signup/create/join flow smoke-tested. Full detail not journaled at the time — see git history (`Initial commit`, `Update docs: hero-villain doc finalized...`) for the record.

## 2026-06-16

**Session focus:** Critical bug fixes + lineup management + shared nav

### Bugs fixed
- `add_player` RPC was inserting NULL `league_id` -- fixed with correct parameter passing.
- UNIQUE constraint on `uff_roster_players` blocked re-adding dropped players -- replaced with partial unique index `WHERE dropped_at IS NULL`.
- FreeAgents.tsx initial load was blank -- `setPosFilter(prev => prev)` is a React no-op (bails on unchanged state). Removed the broken useEffect; the existing `[search, posFilter]` effect fires on mount.
- `allRostered` query used an unreliable PostgREST join filter -- switched to direct `.eq("league_id", leagueId)`.
- Projected pts not displaying in matchups -- added `projected` field throughout (interface, query, component, Realtime handler).
- `uff_roster_players` RLS had a dangerously broad ALL policy -- split into proper SELECT-only policies.

### Features shipped
**Lineup management (full stack):**
- `uff_lineups` table + `lineup_slots` on `uff_leagues` (Supabase migration applied directly)
- `set_lineup` SECURITY DEFINER RPC with position validation + FLEX eligibility (RB/WR/TE)
- `score-matchups` Edge Function v5 -- starters-only scoring when lineup is set
- `lineup-actions.ts` server action + `LineupManager.tsx` client component
- `roster/page.tsx` wired up: slot expansion, current lineup query, S/B badges, flash message

**Shared nav bar:**
- `LeagueNav.tsx` -- sticky tab nav (League / Roster / Matchups / Standings / Free Agents / Settings)
- `layout.tsx` for `/dashboard/league/[id]/` -- membership gate + nav for all league pages

### Technical notes
- NTFS mount still truncates files if Edit/Write tools are used. ALL file writes done via `bash` + Python `open().write()` to avoid this.
- Non-ASCII bytes (em dashes from Python heredoc) caught and replaced with `--` before committing.
- Import path bug: `LineupManager.tsx` is in `roster/`, so `lineup-actions.ts` (one level up) needs `"../lineup-actions"` -- caught in post-commit audit and fixed.

### Commits (need `git push`)
```
72faa99 fix: lineup-actions import path
f2bc5fa feat: shared league layout with sticky nav bar
1f97071 feat: lineup management - set starters vs bench per week
811cd05 fix: critical waiver wire bugs + projected pts display
11f2a42 fix: critical waiver wire bugs + audit fixes
```
