# UFF Platform — Claude Project Memory

Read this at the start of every session. It is the authoritative source of truth for this project.

---

## Project Overview

**Ultimate Fantasy Football (UFF)** — a custom fantasy football platform built by Nate. Full-stack Next.js 16 app with deep custom mechanics layered on top of standard fantasy: draft powers, weekly tokens, faction war, Oracle AI recaps, FAAB waivers, priority waivers, commissioner tools, plus a parallel read-only story layer (character lore + Story Engine, see Session 37 catch-up).

**Live URL**: https://playuff.com (primary) — https://uff-platform.vercel.app also works  
**Custom domain**: `playuff.com` — purchased via Vercel ($11.25/yr), DNS managed by Vercel, Resend verified ✅  
**GitHub**: github.com/ecrafrnir3-cmyk/uff-platform (branch: `main`)  
**Vercel project ID**: `prj_HbhjhScNXEPvZTIFePCvfiEBnzSu`  
**Vercel team ID**: `team_7mJJqrw9cxuUtAYXgG2EWLBP`  
**Supabase project**: `synfuvgdamhjboobjmls`  

---

## Tech Stack

- **Framework**: Next.js 16 App Router, TypeScript, Tailwind CSS v4
- **Database**: Supabase PostgreSQL + RLS; service role key for admin ops
- **Auth**: Supabase Auth (email/password)
- **Bundler**: Turbopack (Vercel build) — stops at first TS error; errors cascade, fix one and the next surfaces
- **Scoring**: Sleeper API → Supabase Edge Function (`score-matchups`) → `uff_matchups` table
- **AI**: Anthropic API (claude-haiku-4-5-20251001) for Oracle, newsletter, power rankings, trade eval, draft advisor, waiver intel, matchup preview
- **Email**: Resend (`RESEND_API_KEY` env var, `EMAIL_FROM` env var)
- **Crons**: GitHub Actions workflows (score-matchups every 15min game days, generate-newsletter Wed 07:30 UTC, process-waivers every hour, finalize-week Wed 07:00 UTC)

---

## Security Constraints — PERMANENT

- `ANTHROPIC_API_KEY` must **NEVER** be logged, returned in API responses, or exposed in any way. This was leaked in a prior session and rotated.
- All AI routes use `process.env.ANTHROPIC_API_KEY` only server-side.

---

## Environment Variables (Vercel)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
CRON_SECRET
RESEND_API_KEY
EMAIL_FROM          # Set to: "UFF <noreply@playuff.com>" — Resend domain verified ✅
NEXT_PUBLIC_SENTRY_DSN
SENTRY_ORG
SENTRY_PROJECT
SENTRY_AUTH_TOKEN
NEXT_PUBLIC_VAPID_PUBLIC_KEY   # build-inlined — changing it requires a redeploy
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

`SYNC_SECRET` is referenced by `sync-players` but **deliberately unset** — setting it would break the 4 AM pg_cron player sync, which calls the function with no auth header (Session 34).

---

## Feature Inventory — What's Built

### Core League
- League creation, join, commissioner flow
- Member management, faction assignment (hero/villain)
- League settings page (playoff config, median scoring, trade deadline, Can't Cut List, waiver settings, acquisition limits)

### Draft
- Full multi-user draft room (`/draft/`) — live via a 5-second POLL (NOT Supabase Realtime; Session 34 correction) with a server-anchored pick clock (Session 35)
- 16 named draft powers (Gunslinger, Vampire Bite, Draft Heist, Telepathy, Shadow Guard, Foresight Coin, Hero's Shield, etc.)
- Autodraft queue with drag-to-reorder
- Commissioner starts draft via `startDraft` RPC
- AI Draft Advisor (claude-haiku, streams pick suggestions)

### Scoring & Matchups
- **Live NFL scores**: Sleeper API → `score-matchups` Edge Function every 15 min on game days
- Matchups page with real-time Supabase subscriptions (`MatchupView.tsx`)
- Per-player game-time locks via `uff_game_schedule`
- Median scoring mode (each team also plays vs. league median)
- Oracle AI pre-game preview + post-game recap per matchup
- **Commissioner score override**: inline ±delta form on matchups page (commissioner only)
- Week finalization RPC (`finalize_week`)
- **Score engine**: 18 UFF tokens + 11 draft powers, all custom (no Yahoo mechanics)

### Roster
- Drag-and-drop lineup (`DragDropLineup.tsx`)
- IR slot moves
- Trade block flagging per player
- Can't Cut List enforcement (commissioner sets, blocks drops)
- Eliminated team roster lock (`eliminated_at` column)

### Free Agents / Waivers
- **FAAB waivers**: blind bid system, `submit_waiver_bid` / `cancel_waiver_bid` RPCs
- **Priority waivers**: inverse standings claim order, `process_priority_waivers` RPC
- `waiver_type` column on `uff_leagues` — `"faab"` | `"priority"` (default `"faab"`)
- `waiver_priority` column on `league_members` — integer ranking (1 = highest)
- `reset_waiver_priority` RPC — reranks members by inverse standings
- Priority Claim UI on free-agents page (blue "Waiver Priority #N" banner, "Claim" button)
- Waiver Intel AI (claude-haiku, analyzes pickups)
- Auto-waiver processing cron (configurable day/hour per league, branches on waiver_type)
- Acquisition limits (per-week and per-season add caps)

### Trades
- Full propose/accept/reject/veto cycle
- Commissioner review mode (pending_review status)
- Trade deadline enforcement
- Trade evaluator AI (claude-haiku, fairness analysis)
- **Trade Inbox** (P10): incoming offers with Accept/Reject, sent history with status badges + Cancel
- Nav badge showing pending incoming trade count
- **Email notifications**: trade proposed → receiver email, trade responded → proposer email, trade vetoed → both parties

### Standings
- Live standings with W/L, PF, PA, win%
- Faction War standings section
- Power Rankings (AI on-demand, claude-haiku)

### Playoffs
- Configurable bracket size (4 or 8 team)
- Commissioner seeds playoff bracket
- Winner advancement across rounds
- Live bracket scores

### Other Pages
- Managers page (W/L, PF, faction, roster preview) — **achievement badges** (win streaks, blowouts, top scorer, undefeated)
- Transactions feed (adds, drops, trades, draft picks)
- Record Book (highest/lowest scores, streaks, blowouts, etc.)
- Trade Block (flag players league-wide)
- League hub **Recent Activity widget**: last 6 adds/drops/trades
- /about and /guide pages

### AI / Newsletter
- Weekly newsletter cron: AI writes, stores in `league_newsletters`, **emails all members** (Resend)
- Oracle recap (post-game), Oracle preview (pre-game)
- Token Advisor, Waiver Intel, Trade Evaluator, Draft Advisor, Power Rankings — all claude-haiku

### Mobile PWA
- `manifest.ts` + Apple meta tags in `layout.tsx`
- `viewport-fit=cover`, standalone mode
- Installable on iOS/Android

---

## Key File Locations

```
src/
  app/
    api/
      cron/
        finalize-week/route.ts          # Wed 07:00 UTC
        generate-newsletter/route.ts    # Wed 07:30 UTC — generates + emails newsletter
        process-waivers/route.ts        # Hourly — branches on waiver_type (FAAB vs priority)
        score-matchups/route.ts         # Proxies to Supabase Edge Function
      draft-advisor/route.ts
      matchup-preview/route.ts
      oracle/route.ts
      power-rankings/route.ts
      token-advisor/route.ts
      trade-eval/route.ts
      waiver-intel/route.ts
    dashboard/
      league/[id]/
        layout.tsx                      # Auth gate + pending trade count for nav badge
        LeagueNav.tsx                   # Nav bar with Trade badge
        trade-actions.ts                # propose/respond/approve/veto/cancel + email notifications
        trade/page.tsx                  # Trade Center: inbox, sent history, propose form
        matchups/
          page.tsx                      # Matchups + commissioner score override UI
          actions.ts                    # finalizeWeek + adjustScore
          MatchupView.tsx               # Realtime client component
        standings/
          page.tsx
          PowerRankingsCard.tsx
        roster/page.tsx                 # DragDropLineup
        free-agents/
          page.tsx                      # FAAB + priority waiver UI
          FreeAgents.tsx                # Client component — waiverType + myPriority props
          faab-actions.ts               # submitWaiverBid / cancelWaiverBid server actions
        draft/
          page.tsx
          DraftRoom.tsx
          actions.ts
          queue-actions.ts
        playoffs/page.tsx
        settings/
          page.tsx                      # Commissioner tools incl. waiver type + reset priority
          actions.ts                    # saveLeagueSettings, processWaivers, resetWaiverPriority
        record-book/page.tsx
        trade-block/page.tsx
        transactions/page.tsx
        managers/page.tsx               # Achievement badges
  lib/
    supabase/
      client.ts     # Browser client
      server.ts     # Server component client (cookie-based auth)
      admin.ts      # Service role admin client (no auth, bypasses RLS)
    email.ts        # Resend email utility + templates (trade, waiver, newsletter)
    nfl-utils.ts    # getCurrentNFLWeek() — season start 2026-09-09, returns 1 pre-season
    token-names.ts  # TOKEN_NAMES map (18 tokens) — single source of truth
    get-record.ts   # getRecord() + CompletedMatchupRow — shared across AI routes
supabase/
  functions/
    score-matchups/index.ts   # ~800 lines (v17) — 18 tokens + 11 draft powers + faction bonus
    sync-players/index.ts     # Pulls from Sleeper + FFC ADP + Sleeper search_rank fallback (v4)
.github/workflows/            # All cron triggers
```

---

## Architecture Patterns

### Server Actions
- All form submissions use `"use server"` actions
- Auth: always `supabase.auth.getUser()` first, redirect to `/login` if null
- Commissioner check: query `uff_leagues.commissioner_id === user.id`
- After mutations: `revalidatePath()` then `redirect()`
- Errors: `redirect(...?error=encodeURIComponent(msg))` pattern

### Supabase Clients
- `createClient()` from `@/lib/supabase/server` — for user-scoped auth (server components + actions)
- `createAdminClient()` from `@/lib/supabase/admin` — for service role ops (email lookup, score override)
- `.returns<T[]>()` on queries that need typed results from complex selects
- RLS is active; admin client bypasses it

### Waiver System Architecture
- Priority claims reuse `uff_waiver_bids` table with `bid_amount: 0`
- `process_priority_waivers` RPC: orders by `waiver_priority ASC NULLS LAST`, awards first eligible claim per player, moves winner to bottom via re-normalization
- `faabEnabled` = `faab_budget > 0 && waiver_type === "faab"` — prevents FAAB UI in priority leagues
- Priority Cancel button calls `handleCancelBid(id)` directly (NOT the bid edit form)

### TypeScript
- Turbopack stops at first error — fix one, next surfaces
- Bash `tsc --noEmit` is unreliable (stale Linux mount); use Read tool to check files
- Interface fields must be structurally compatible across files (e.g. `MatchupRow` in page.tsx vs MatchupView.tsx must match)
- `boolean | null` vs `boolean` — DB nullable fields must match both sides
- Key nullable columns: `median_win` (boolean, nullable), `projected` (numeric, nullable), `token_bonus` (numeric, nullable)

### Color Palette
```
Background: #0d0d1a
Border:     #2a2a40
Gold:       #FFD700
Blue:       #0057FF
Red:        #CC0000
Green:      #3DDC84
Text:       #f4f4f8
Muted text: #d4d4e8
```

---

## Common Gotchas

1. **Bash mount is stale** *(Cowork desktop sessions on Nate's machine only — remote/cloud sessions have a normal filesystem and working git)* — `/sessions/.../mnt/uff-platform/` shows cached old file versions. Always use Read tool for current Windows filesystem state. Git in bash also can't see Edit tool changes — user must `git add/commit/push` from their terminal for any Edit-tool-only changes.
2. **Turbopack cascade** — each build error masks the next. After fixing a TS error, the next build may reveal a new one.
3. **`boolean | null` mismatches** — Supabase nullable columns come back as `T | null`. Both sides of structural type comparisons must agree.
4. **Git staging** — always `git add` before `git commit`. Nate has forgotten this before.
5. **Service role key** — never in client-side code. `createAdminClient()` is server-only.
6. **ANTHROPIC_API_KEY** — never log or return in responses.
7. **`.returns<T[]>()`** — required on Supabase queries with complex joins that TypeScript can't infer.
8. **Priority waiver Cancel** — in priority mode, Cancel directly calls `handleCancelBid()`, NOT `setBidForm()`. Don't regress this.
9. **`faabEnabled` logic** — must be `faab_budget > 0 && waiver_type === "faab"`. Don't simplify to just `faab_budget > 0` or priority leagues will show FAAB UI.
10. **Windows CMD no `&&`** — CMD does not support `&&` chaining. If a git commit fails with "index.lock" or "HEAD.lock" errors, run `del .git\index.lock` and/or `del .git\HEAD.lock`, then retry the three commands separately.
11. **Dotall `/s` regex flag** — TypeScript target below ES2018 rejects `/pattern/s`. Use `.split(/PATTERN/)[0]` or `[\s\S]*` instead.
12. **VB siphon must be league-scoped** — the `fullScoreCache` holds members from ALL leagues being scored simultaneously. The Vampire Bite inner loop must filter to `leagueMemberIds` only, not `Object.values(fullScoreCache)`.
13. **DST in process-waivers** — use `isEDT = month >= 2 && month <= 9` (March–October = UTC-4), else UTC-5. NFL season spans the EDT→EST transition.
14. **Oracle cache row order** — `uff_matchups` query for a matchup returns 2 rows in non-guaranteed order. Always check `rows[0].oracle_recap ?? rows[1]?.oracle_recap`.
15. **`getAllUserEmails` pagination** — always paginate with `page++` until `data.users.length < 1000`. Single-page fetch silently truncates at 1000 users.
16. **Shadow Guard blocks Vampire Bite at two layers** — (1) `assignVampireBite` in `actions.ts` rejects the bite immediately if `player_draft_powers` has `power = 'shadow_guard'` for that player; (2) `score-matchups` edge function also skips the siphon as a safety net. Both checks use the same `powerMap`. Shadow Guard is `power_id = 9` (formerly Cloak) with `category = 'tied_to_pick'`, `tied_position = 'ANY'` — it writes to `player_draft_powers` automatically on pick like other tied_to_pick powers. It also still blocks Telepathy via the existing `power_id = 9` check in `revealNextPower`.

---

## Current Build Status

All work through the **Story Engine ("The Legend & the War", Phases 1–3b)** is built and pushed. Sessions 18–37 completed (36 documented below; the 2026-08-24→26 work between Sessions 36 and 37 is reconstructed in the Session 37 catch-up).

**Latest Vercel deployment**: Live at playuff.com  
**Last pushed commit**: `1a71a96` (Story Engine: War Room link from Character tab) — pushed 2026-08-26.  
**sync-players**: runs NIGHTLY via pg_cron — no manual trigger needed (the old "run it once from the dashboard" note was retired in Session 34).

### Completed setup (don't redo):
- Sentry account created, DSN set, org=`uff-platform`, project=`javascript-nextjs`
- `.npmrc` with `legacy-peer-deps=true` (committed)
- `turbopack: {}` in `next.config.ts` (committed)
- `pick_clock_seconds` column added to `uff_leagues` via Supabase SQL editor
- Vercel env vars: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` all set

### Full Feature List (deployed + pending push):
- **Marketing landing page** — `/` shows hero + 4 feature cards + faction war section + Season Titles teaser + CTA for visitors; redirects logged-in users to `/dashboard`
- ~~Mock draft mode~~ — **REMOVED in Session 32** (solo-vs-bots wasn't useful; don't rebuild unless Nate explicitly asks — and then as an open multiplayer lobby)
- Core league, member management, faction war
- Real-time draft room with 16 named draft powers + AI Draft Advisor
- **Draft pick clock with autopick** — configurable timer (30s–5min), countdown ring, auto-selects best queued/available player on expiry
- **Commissioner pre-draft checklist** — blocks "Start Draft" until: ≥2 members joined, league full, all factions set, draft order configured, rounds set
- **Email league invites** — commissioner pastes emails in Settings → sends branded invite with join code + join link
- **"You're on the clock" notifications** — after each pick, next manager gets in-app notification + email with round/pick info
- **Sentry error monitoring** — production-only, session replay enabled, wraps next.config.ts
- Injury status badges on all player cards (roster, draft room, free agents)
- Draft order manager (randomize, drag-to-reorder, lock after draft starts)
- Pre-draft watchlist (save target players before draft)
- Live NFL scoring via Sleeper + 18 UFF tokens + faction bonus
- FAAB + priority waiver systems (both fully built)
- Matchups with Oracle AI preview/recap + commissioner score override + score breakdown
- Drag-and-drop lineup, IR slots, Can't Cut List, eliminated team lock
- Start/Sit AI Advisor on roster page
- Trade Center: propose/accept/reject/veto + commissioner review + email notifications + AI analysis on proposal
- Commissioner Veto Analyzer (AI fairness verdict)
- Trade History page (completed/vetoed/rejected/cancelled trades)
- Trade Inbox with nav badge
- Standings + Faction War + Power Rankings (AI)
- Full season schedule page + head-to-head history page
- 4-team and 8-team playoff brackets with winner advancement
- Managers page with achievement badges (streaks, blowouts, undefeated, top scorer)
- Transactions feed, Record Book, Trade Block
- Global Player Search (/players) with ownership + injury status
- In-App Notification Center (/notifications) — bell icon in nav with unread badge
- Commissioner Broadcast — announcements → email + in-app notification to all members
- **Season Titles** — commissioner awards end-of-season titles post-playoffs via Settings button → `award_season_titles` RPC → badges on Managers page. Titles are faction-aware: Champion Hero → "Super Hero", Champion Villain → "Super Villain"; 2nd always → "Nemesis"; 3rd/4th Hero → "Side Kick", 3rd/4th Villain → "Henchman"; everyone else → "Cast"
- League Assistant Chat (/chat) — AI with full league context (standings, matchups, transactions, full rulebook)
- Player news/trending feed (Sleeper trending API)
- Weekly newsletter cron (AI-generated + emailed via Resend)
- Waiver award emails + in-app notifications
- Mobile PWA (installable)
- Recent Activity widget on league hub
- Shared libs: `token-names.ts`, `get-record.ts`, `notifications.ts`
- **PWA Web Push notifications** (Session 36) — all 8 in-app notification types fan out to push; VAPID vars live in Vercel Production since 2026-08-25
- **Character lore layer** — managers cast as unique canon Hero/Villain characters on faction lock (`src/lib/characters.ts`, `/character` tab, public `/universe` page)
- **Story Engine — "The Legend & the War"** — parallel READ-ONLY story layer (Legend Points, ranks, feats, War Battles vs Internal Duels, War Meter); zero impact on real fantasy results by design. Spec: `docs/legend-and-the-war.md` (LOCKED v2). Auto-runs from the finalize-week cron (failure-isolated) for leagues with `story_engine_enabled = true`
- **Self-serve team rename** (`RenameTeam.tsx` on league hub)

### New key file locations (added #77–#100):
```
src/
  app/
    api/
      chat/route.ts                   # League Assistant Chat — SSE stream, full rulebook context
      player-search/route.ts          # Global player search with ownership
      start-sit/route.ts              # Start/Sit AI Advisor
      matchup-breakdown/route.ts      # Per-player score breakdown
      trade-veto-analysis/route.ts    # Commissioner veto AI
      trending/route.ts               # Sleeper trending players (add/drop)
    dashboard/league/[id]/
      announcements/                  # Commissioner bulletin board + broadcast
      chat/                           # League Assistant Chat UI
      h2h/page.tsx                    # Head-to-head history
      notifications/                  # Notification center + MarkReadButton + actions
      players/                        # Global player search UI
      schedule/page.tsx               # Full season schedule
      trades/page.tsx                 # Trade history page
      settings/
        DraftOrderManager.tsx         # Draft order drag-to-reorder
        VetoAnalyzer.tsx              # AI veto analysis (commissioner only)
        WaiverPriorityManager.tsx     # Manual priority drag-to-reorder
      roster/StartSitAdvisor.tsx      # Start/Sit AI UI
      draft/watchlist-actions.ts      # Pre-draft watchlist server actions
  components/
    TrendingPlayers.tsx               # Trending adds/drops widget
  lib/
    notifications.ts                  # createNotification() — non-blocking, admin client
    rate-limit.ts                     # checkRateLimit(key, maxPerMin) — in-memory per-instance
```

### New key files added (#101–#105):
```
sentry.client.config.ts           # Sentry client-side init (project root)
sentry.server.config.ts           # Sentry server-side init (project root)
sentry.edge.config.ts             # Sentry edge runtime init (project root)
src/instrumentation.ts            # Next.js instrumentation hook for Sentry
next.config.ts                    # Wrapped with withSentryConfig
```
`pick_clock_seconds` column added to `uff_leagues` table.
`join_code` added to settings page league select.
`sendLeagueInvites` server action in `settings/actions.ts`.
`leagueInviteHtml` + `onTheClockHtml` templates in `lib/email.ts`.
`ChecklistItem` component + `checks` object in `DraftRoom.tsx` `PreDraftLobby`.

### Features #107–#108 (Session 19–20)
- **#107**: `⚡ Start Best` button — projection-aware auto-fill that resets entire lineup, skips bye/injured when alternatives exist; projected pts display (green) vs actual pts (gold) on every player card in DragDropLineup
- **#108**: **Lineup score total** chip in lineup header (gold for actual, green for projected); **Injury alert banners** below hint bar (red for Out/Doubtful starters, yellow for Questionable); **% Owned** on free agents player cards — computed from UFF's own `uff_roster_players` table, shown as "X% owned" in muted text
- Sentry DSN fix — `NEXT_PUBLIC_SENTRY_DSN` was truncated in Vercel; correct DSN restored

### New feature: Round Buffer Timer (#106)
- 30-second buffer fires at the start of every draft round (including round 1 when draft transitions from not_started → in_progress)
- During buffer: pick buttons disabled, pick clock paused, buffer countdown ring shown
- **Draft Heist**: HeistModal now auto-triggers during the buffer (not on the user's turn) — swap pick slots BEFORE the round begins
- **Telepathy**: auto-reveals the first picker's power at buffer start (inline in buffer banner, no button needed)
- State: `roundBufferActive`, `roundBufferTimeLeft`, `bufferTelepathyReveal`, `prevRoundRef` in DraftRoom.tsx
- Reconnect safety: `prevRoundRef` initializes to currentRound on reconnect (no spurious buffer); initializes to 0 when not_started so round 1 triggers correctly
- Buffer is client-side only — if a user reloads mid-buffer, they miss it; that's acceptable

### Features #109–#112 (Session 21–22) — deployed
- **#109**: **Rate limiting** — in-memory per-user per-minute limits on all 10 AI routes (chat: 10/min, draft-advisor: 8/min, power-rankings: 3/min, others: 5/min). `src/lib/rate-limit.ts` — returns 429 when exceeded. All routes: chat, draft-advisor, matchup-preview, oracle, power-rankings, start-sit, token-advisor, trade-eval, trade-veto-analysis, waiver-intel.
- **#110**: **Stat line breakdown** on player cards — `formatStatLine()` helper shows "247 pass yds · 2 TD" etc. per position. Applied to DragDropLineup starters + bench cards, and matchup breakdown (route + MatchupView). Only shows when actual game stats exist (seasonPts > 0 for that player).
- **#111**: **Week navigator** on roster page — `?week=N` URL param; prev/next arrows in header; past weeks show read-only locked lineup with historical stats; current week badge. Weekly token card + Start/Sit advisor gated to current week only.
- **#112**: **Optimal lineup calculator** — post-week section below the lineup (visible when locked + seasonPts available). Greedy algorithm sorts by actual pts, assigns best eligible player per slot. Shows "Optimal: X.X pts vs Y.Y pts actual, Z.Z pts left on bench" or "✓ Perfect lineup" when diff ≤ 0.5 pts.

### Deep Dive Review — Session 23 findings (no bugs, clean build)
- Season Titles feature fully reviewed: DB column, RPC (faction-aware, commissioner guard via `auth.uid()`), server action, settings UI, managers badge display — all clean
- RPC uses `SECURITY DEFINER` + internal `auth.uid()` commissioner check (defense in depth)
- `award_season_titles` correctly handles 4-team and 8-team brackets; 3rd/4th ranked by total playoff PF, faction determines Side Kick vs Henchman
- `MemberRow` interface updated with `season_title: string | null`; IIFE badge render null-safe with graceful fallback
- Settings preview grid shows all 6 faction-aware titles clearly
- No TypeScript issues; no regressions in managers page badge/standings logic

### Deep Dive Review — Session 22 findings (no bugs, clean build)
- Latest deployment `dpl_4hKmTyid3sCHWpgSuXe4d16kSSLG` is READY, zero runtime errors
- Sentry DSN errors from older deployment (dpl_HPcWHy6xrryELmGo8tBiFbU6ug6D = #107) — not in latest
- `AuthApiError: Invalid Refresh Token` (2 occurrences, middleware) — benign, expected when sessions expire
- Rate limiting: confirmed all 10 AI routes import and call `checkRateLimit`
- Stat lines: operator precedence on `!(seasonPts?.[pid] ?? 0 > 0)` looks odd but evaluates correctly
- Week navigator: past weeks use `readOnly=true` (hides save bar) + `locked=true` (hides edit controls) + `projectedPts=undefined`
- % Owned: global cross-league ownership, `(ownershipMap[p.id] ?? 0) > 0` guard prevents showing "0% owned"
- Optimal lineup: uses CURRENT roster (not historical) — minor inaccuracy if trades happened mid-week, acceptable

### Deep Dive Review — Session 24 findings (no bugs, clean build)
- All Shadow Guard code verified: `assignVampireBite` guard in `actions.ts`, safety net at line 469 in `score-matchups/index.ts`, UI text in `DraftRoom.tsx`, `guide/page.tsx` updated with Shadow Guard PowerCard
- All Season Titles verified: `awardSeasonTitles` in `settings/actions.ts`, `TITLE_STYLES` + `season_title: string | null` in `managers/page.tsx`, RPC exists in Supabase
- Cron schedules correct: score-matchups Thu–Tue every 15min, finalize-week Wed 07:00 UTC, newsletter Wed 07:30 UTC
- `nfl-utils.ts` season start confirmed `2026-09-09` ✅
- `email.ts` fallback is `onboarding@resend.dev` — `EMAIL_FROM` env var must be set to a verified custom domain in Vercel before production email (invites, trades, newsletter) will deliver reliably
- **Root page gap identified**: `src/app/page.tsx` redirected non-logged-in visitors straight to `/login` — fixed in session 25.
- War room (`docs/handoff-brief.md`) fully rewritten with current state

### Session 26 — #116 Mock Draft Mode
- **`src/app/dashboard/league/[id]/mock-draft/page.tsx`** — Server Component: loads league + all members' power assignments + top N players by ADP. No auth changes needed — standard `createClient()` auth check.
- **`src/app/dashboard/league/[id]/mock-draft/MockDraftRoom.tsx`** — Full client-side simulation (~650 lines).
  - All state in React, zero DB writes
  - CPU picks via 800ms useEffect: `getBestAvailableByNeed()` with positional targets (QB:2, RB:5, WR:5, TE:2, K:1, DEF:1) + `POS_PRIORITY_TIERS` by round progress
  - Power categories: `tied_to_pick` → auto-apply (Gunslinger, Berserker Rage, Power Negation, etc.); `draft_mechanic` (Heist, Foresight, Hero's Shield, Telepathy, Vampire Bite) → decision logic
  - CPU power decisions: Heist steals if back-half of round + target not shielded; Vampire Bite targets user's best unguarded player; Shadow Guard marks player immune permanently
  - Power Negation: `tied_to_pick` debuff — `applyPick()` auto-applies it (halves the drafted player's own weekly score per `case 'power_negation': return -(baseScore / 2)` in score-matchups). NOT an ability to remove other teams' powers. No CPU post-pick logic needed.
  - User modals: VampireBiteModal (search+select drafted opponent player), HeistModal (pick a target who picks before you), ForesightModal (keep current round power or swap to future round)
  - Telepathy: reveals next picker's power name (if not Shadow Guard protected) as an event log entry
  - Draft board: collapsible snake grid with pick numbers, player names, position colors, power/guard/bite indicators
  - Three tabs: Players (filter by position + search), My Roster (picks with composition bar), Power Log (all power events in color-coded feed)
  - Reset button resets all state to run another mock
- **`src/app/dashboard/league/[id]/LeagueNav.tsx`** — Added `{ label: "Mock Draft", href: "/mock-draft" }` to `BASE_NAV`
- **`src/app/dashboard/league/[id]/page.tsx`** — Added "🎮 Mock Draft" button to quick-links header (always visible regardless of draft status)
- Note: if `draft_power_assignments` is empty (powers not yet assigned), mock draft runs without any power effects — a "No powers assigned yet" banner appears

### Session 25 — #115 Marketing Landing Page
- **`src/app/page.tsx`** rewritten as full marketing landing page (Server Component)
- Auth check preserved: logged-in users still redirect to `/dashboard`
- Sections: sticky nav (UFF wordmark, About, Powers & Guide, Sign In, Start Your League), hero with gradient headline + season badge, 4 feature cards (Draft Powers, Faction War, 18 Tokens, Oracle AI), platform feature strip (6 icons), Season Titles teaser (6 faction-aware title badges), final CTA, footer
- Links: `/login?mode=signup` for all signup CTAs, `/guide` for Powers Guide, `/about` for About, `/login` for Sign In
- Design: same palette + component patterns as `about/page.tsx`
- `export const metadata` added with SEO title + description
- Pushed in Session 28 as part of 3-commit batch

### Session 27 — Mock Draft Power Logic Deep Dive + Bug Fixes

Deep dive cross-referenced `MockDraftRoom.tsx` against `draft/actions.ts` and `score-matchups/index.ts`. Found and fixed 7 bugs:

**Bug fixes applied to `MockDraftRoom.tsx`:**
1. **Vampire Bite CPU condition unreachable** — `appliedPower === null` was mutually exclusive with `power.name === "Vampire Bite"` (both can never be true at once). Fixed: removed `appliedPower === null` check, simplified to `if (hasPowers && power && power.name === "Vampire Bite")`.
2. **Power Negation wrong mechanic** — CPU had post-pick logic "removing power labels from other teams' picks" which is completely wrong. Real behavior from score-matchups: `case 'power_negation': return -(baseScore / 2)` — it's a `tied_to_pick` debuff halving the drafted player's own weekly score. `applyPick()` already handles it. Removed the entire wrong CPU block.
3. **Foresight Coin no actual swap** — `handleForesightConfirm` only logged; `allPowersMap` is immutable (from props). Fixed: added `userPowerOverrides: Record<number, PowerInfo | null>` state + refactored `applyPick` to accept optional `powerOverride?: PowerInfo | null` parameter + `commitUserPick` accepts optional `powerOverride` param. Stale closure issue resolved by passing `futurePower` directly at call time rather than relying on React state update timing.
4. **Telepathy missing same-round check** — real DraftRoom checks `Math.ceil(nextPickNo / maxTeams) === currentRound` before revealing. Fixed: added the same guard.
5. **Unused `displayName` function** — defined but never called (TS lint warning). Removed.
6. **Status banner used stale allPowersMap** — power badge in banner showed original assignment even after Foresight Coin swap. Fixed: uses `userPowerOverrides`-aware lookup.
7. **ForesightModal received stale powers map** — showed original assignment in options. Fixed: passes merged `{ ...allPowersMap[myMemberId], ...userPowerOverrides }`. Updated `ForesightModal.powersMap` type to `Record<number, PowerInfo | null>`.

**Architectural notes for future sessions:**
- `applyPick(player, memberId, pickNo, round, powerOverride?)` — 5th param is optional; CPU calls omit it (uses allPowersMap lookup); user calls pass result of override-aware lookup
- `commitUserPick(player, powerOverride?)` — 2nd param lets `handleForesightConfirm` bypass stale closure
- `userPowerOverrides` cleared in Reset handler
- `handleUserPickPlayer` uses override-aware lookup for modal decisions (Heist/Foresight checks)

### Session 28 — Push verification (2026-07-06)
All 3 pending commits pushed to `main` from Nate's terminal. Code verified clean via Read tool:
- `MockDraftRoom.tsx` — all 7 Session 27 bug fixes confirmed in place
- `src/app/page.tsx` — marketing landing page (#115) confirmed clean; auth redirect preserved
- `mock-draft/page.tsx` — server component confirmed clean; auth gate, power + player loads correct
No new bugs found. Vercel deployment triggered by push.

### Session 29 — Domain Launch (2026-07-06)
All launch-blocker domain tasks completed:
- **playuff.com** purchased via Vercel ($11.25/yr), DNS managed by Vercel nameservers
- **Vercel project**: `playuff.com` → Production, `www.playuff.com` → 308 redirect → `playuff.com`
- **Supabase Auth Site URL**: updated to `https://playuff.com`; redirect URLs include `playuff.com/**` and `www.playuff.com/**`
- **EMAIL_FROM**: updated to `UFF <noreply@playuff.com>` in Vercel env vars
- **Resend**: `playuff.com` domain verified — DKIM, SPF MX, SPF TXT all verified; DNS records added manually via Vercel DNS

### Session 30 — Mock Draft DEF/K fix (#121)
- **Bug**: `mock-draft/page.tsx` loaded players ordered by ADP with `nullsFirst: false` + `limit(N)`. DEF teams (and sometimes K) have null ADP since FFC doesn't rank team defenses — they got cut off by the limit, making the DEF position tab empty in the player list.
- **Fix**: Added a second query for `position IN ('DEF', 'K') AND team IS NOT NULL` and merged any not already in the ADP-ranked list. Deduplicated by ID before passing to `MockDraftRoom`. This is a permanent safeguard even after v4 ADP is populated.

### Deep Dive Review — Session 30 findings (1 bug fixed)
- **Bug fixed in `FreeAgents.tsx`**: `hasBid` and `existingBid` were gated on `faabEnabled && ...` — in priority waiver mode (`faabEnabled = false`), this meant player cards never showed "Claimed" state inline, inline Cancel never appeared, and the "Claim" button would show even on already-claimed players. Fixed: `(faabEnabled || isPriorityMode) && ...` for both variables.
- `sync-players/index.ts` v4 — logic verified clean. `needSyntheticAdp` index math correct (`rows.length` before `rows.push` = future index). 250-cap on synthetic assignments correct.
- `faab-actions.ts` — clean. `submitWaiverBid` / `cancelWaiverBid` both auth-guard properly via `supabase.auth.getUser()`.
- `nfl-utils.ts` — returns week 1 pre-season (correct), won't exceed 18. `isLineupLocked` works correctly off-season.
- `free-agents/page.tsx` — Sleeper projections fetch fails silently off-season; `hasProjections = false` correct fallback.
- CLAUDE.md — removed stale "Pending push" note from Session 25, removed duplicate entries in Next priorities.
- **New gotcha**: `hasBid` / `existingBid` in FreeAgents.tsx must check `(faabEnabled || isPriorityMode)`, not `faabEnabled` alone.

### Session 30 — Player Rankings + Waiver Wire (2026-07-06)
- **sync-players v4**: Two-tier ADP ranking. FFC PPR ADP for ~179 name-matched players; Sleeper `search_rank` used as synthetic ADP (offset above max FFC pick) for up to 250 additional unmatched players → 400+ total ranked players. Response returns `adpMatched`, `adpSynthetic`, `adpTotalRanked`, updated `adpSource`.
- **FreeAgents.tsx**: Query limit raised 150 → 300 to surface all ranked players.
- **Waiver wire in-season**: Already working — `free-agents/page.tsx` fetches Sleeper weekly projections and re-sorts by projected points when season is active. No code changes needed.
- **Sept 1 reminder**: Scheduled task created (fires once 2026-09-01 09:00 EDT) reminding to re-run sync-players for fresh pre-season data.
- **Pending action**: Nate needs to trigger sync-players once from Supabase dashboard (Edge Functions → sync-players → Test → Send Request) to populate v4 synthetic ADP in DB.

### Session 31 — Mock Draft Phase 1: Round Buffer + Power Descriptions (#122)
Enhancements to `MockDraftRoom.tsx`:
- **Round buffer timer**: `bufferActive` + `bufferTimeLeft` state + `prevRoundRef` (initialized to 0 so round 1 fires on mount). Two new useEffects: (1) fires when `currentRound !== prevRoundRef.current` → starts 30s buffer; (2) countdown tick, sets `bufferActive = false` at 0.
- **Buffer UI**: Gold-bordered overlay replaces status banner during buffer. Shows "Round N of M Starting…" header + SVG countdown ring (stroke-dasharray animated) + user's power card for that round with full description and "auto-applies" vs "active power" hint text.
- **Player list disabled during buffer**: `disabled`, `opacity`, `cursor`, and "Draft" button visibility all gated on `!bufferActive`.
- **CPU blocked during buffer**: `bufferActive` added to early-return guard in CPU auto-pick effect + dependency array.
- **Power descriptions inline**: `powerDescByName` lookup map (name → description from allPowerRows). Used in My Roster tab power badge as truncated italic suffix (40-char limit, tooltip shows full text). Status banner power badge retains concise format.
- **Reset button**: `prevRoundRef.current = 0` added so round 1 buffer fires again on the next mock.
- **Architectural note**: Buffer fires at round start including round 1 (by design). If user presses Reset mid-buffer, prevRoundRef resets to 0 → buffer effect re-fires naturally for round 1.
- **Power randomization**: `shufflePowerAssignments()` helper shuffles `draft_powers` values across existing member/round slots (Fisher-Yates) so each mock run has a different power configuration. Driven by `activeRows` state (replaces direct `allPowerRows` use in `allPowersMap` derivation). Reset calls `setActiveRows(shufflePowerAssignments(allPowerRows))` for a fresh shuffle. Real power assignments are never mutated — the DB rows are just rearranged client-side.
- ~~Pending push~~ *(resolved: pushed in `7288e47`; the mock-draft files were then deleted entirely in Session 32)*

### Session 32 — Mock Draft Mode REMOVED (2026-07-07)
Nate tried the solo-vs-bots Mock Draft Mode and didn't find it useful. Decision: kill it entirely rather than build Phase 2 (multi-user lobby). Reasoning: Season 1 is a small beta with hand-picked people Nate already knows — there's no pool of strangers to matchmake with, and the real draft room (already live, real-time, multi-user) can be reused with a disposable test league for any group rehearsal needed. Removed:
- `src/app/dashboard/league/[id]/mock-draft/` (both `page.tsx` and `MockDraftRoom.tsx`) — deleted
- `LeagueNav.tsx` — removed the "Mock Draft" nav item
- `page.tsx` (league hub) — removed the "🎮 Mock Draft" button
Also added `.gitattributes` (`* text=auto eol=lf`) after discovering this machine's Git checked out the whole repo with CRLF line endings, making every file show as modified. Fixed via `git config core.autocrlf true` + `git add -A` (renormalized cleanly, only the 4 real file changes stayed staged).
**Do not rebuild Mock Draft Mode unless Nate explicitly asks — if he does, revisit as a true open multiplayer lobby (any UFF user, not scoped to one league), not the old solo-vs-bots version.**
Push required setting git identity on this new laptop first (`git config --global user.email` / `user.name` — first commit attempt failed silently with "Please tell me who you are", which made `git push` a no-op ("Everything up-to-date") until fixed). Confirmed live: Vercel deployment `dpl_7mpNTZLqY4FfF3GS6p5vXXRAv284` (commit `18c9b9b`) built successfully off this removal.

### Session 33 — New laptop confirmed fully operational + Graphify installed (2026-07-07)
- **New laptop dev environment: fully verified working end-to-end.** Git (with identity configured), Node/npm, local clone, `.env.local` (all 3 Supabase vars), `npm run dev`, GitHub push access, and Vercel auto-deploy on push all confirmed functioning via the Mock Draft removal work above — that whole round-trip (edit → commit → push → Vercel build) is the proof.
- **Graphify installed** — a free, local, MIT-licensed knowledge-graph CLI (`graphifyy` on PyPI, tree-sitter based, no API key needed for code-only extraction). Ran `graphify update .` against the full codebase: **678 nodes, 1142 edges, 52 communities**, 100% extracted (no LLM cost). Output lives in `graphify-out/` (`graph.json`, `graph.html` — open directly in a browser for a visual map, `GRAPH_REPORT.md` — readable summary with god-node list and community breakdown). Ran `graphify claude install`, which wrote the `## graphify` section below + a `.claude/settings.json` PreToolUse hook.
- **Caveat resolved (2026-07-22)**: the graphify CLI is now installed locally on this laptop (`graphify.exe` via Python 3.14 user scripts) — `graphify query`/`update` work directly. The graph was refreshed 2026-07-22 after the audit fix sweep: **705 nodes, 1186 edges, 69 communities** (old version auto-backed up in `graphify-out/2026-07-22/`). Re-run `graphify update .` after future code changes.
- **Next-steps assessment** (small hand-picked beta, season starts 2026-09-09 — about 9 weeks out): the honest read is most of the "not yet built" list below is over-engineering for a small private beta and should stay parked. The two things that actually matter before season start: (1) trigger `sync-players` once from the Supabase dashboard (Edge Functions → sync-players → Test) — still pending, populates v4 ADP data real players will draft from; (2) run one full live rehearsal of the **real** draft room (not mock) with actual invited members, well before Sept 9, to catch any real-multiplayer issues while there's still time to fix them. Cron migration (GitHub Actions → Vercel Cron) is worth doing before the season actually starts since crons will run unattended on real game data — moderate priority, not urgent today.

### Session 34 — Deep-dive audit + fix sweep (2026-07-21/22)
Six-agent audit + adversarial verification found ~60 defects; the critical ones were FIXED same-session. Full findings + fix status: `docs/deep-dive-audit-2026-07-21.md`. Highlights:
- **Waiver system was broken end-to-end** (cron queried the wrong week → all claims stranded; priority claims blocked by FAAB guard; priority processing crashed on a slot CHECK; FAAB result emails never sent — status-word mismatch). All fixed: RPCs rewritten (sweep `week <= p_week`, slot='active', roster caps/add limits/Can't-Cut/eliminated checks, per-award priority re-eval), cron email block fixed.
- **Week-18 clamp**: finalize + newsletter crons now use unclamped `getRawNFLWeek()` with in-season guards — week 18 finalizes, off-season no-ops, newsletter has an idempotency guard (was re-emailing week 17 forever).
- **Security**: DB RPCs now enforce `auth.uid()` (finalize/seed/schedule/start_draft/make_draft_pick trusted caller-supplied user IDs); heist RPCs require actually holding Draft Heist + permutation check; adjustScore league-scoped + persisted in new `uff_matchups.score_adjustment` (scoring cron re-applies it instead of erasing it); public `/share/matchup` page DELETED (cross-league leak); open redirect in auth callback fixed; email HTML now escaped; **rate limiting actually wired up** (CLAUDE.md previously claimed "confirmed on all 10 routes" — it had ZERO call sites; the Session 22 note below was wrong).
- **Trades**: status CHECK was missing `pending_review` (review-league accepts crashed!); veto now writes 'vetoed'; cancel/accept race closed; receiver must be same-league; loose RLS update policy dropped.
- **Scoring engine v15**: query errors abort instead of writing zeros; faction bonus per-member (cross-league collision); Time Stone ignores Questionable; Underdog/Clutch capped at the margin (can't flip results); Iron Defense doubles per spec; Mirror Match starters-only; projections-fetch failure no longer zeroes projections.
- **sync-players v5**: DEF entries (no `full_name` in Sleeper) now synced via first+last name — all 32 defenses were frozen at a June backfill. Note: sync-players runs NIGHTLY via pg_cron (the "run sync-players manually" note below is stale). A redundant pg_cron scoring job with a wrong season anchor was deleted; GH Actions is the scoring scheduler and now fails red on errors (route propagates non-200, workflow prints the body).
- **Corrections to earlier notes**: the draft room is a 5-second POLL, not Supabase Realtime; `getWeekLockTime` anchor fixed to Thu Sep 10 kickoff (was locking lineups 24h early — the week-ROLL anchor stays Wed Sep 9, the crons depend on it).
- **Post-deploy discovery (2026-07-22): `finalize-week.yml` was invalid YAML since June** — the Wednesday finalize schedule NEVER fired (all 79 historical runs were push-time parse failures, easy to miss because unparseable workflows show by file path, not name). Fixed in `c13aa67`. Lesson: a workflow that shows in the Actions sidebar by its FILE PATH instead of its display name is unparseable and its schedule is dead.
- ✅ **Secrets done (2026-07-22)**: Nate rotated `CRON_SECRET` across GitHub Actions + Vercel + Supabase edge secrets (old value was unrecoverable — Vercel "Sensitive") and verified the full chain green via a manual Score Matchups run. `SYNC_SECRET` deliberately NOT set — it would break the 4 AM pg_cron player sync, which calls the function with no auth header.
- Still-open items are listed in the audit report's FIX STATUS block (notably: pick clock is still client-side-only for the on-the-clock user — an offline picker still stalls the draft; run the pre-season draft rehearsal with that in mind).

### Session 35 — Real-league readiness sweep (2026-08-17)
UFF reactivated as the MAIN EFFORT (USTP paused; War Room updated). A group wants to play — this session built everything app-side for a real season. Commit `f49d2f7`.
- **🔴 DISCOVERY: the Supabase project had been AUTO-PAUSED for inactivity — the live site was fully down.** Restore is blocked: free tier allows 2 active projects and the slots are held by `ustp-platform` + `arch-materials` (created 08-14, unknown purpose). Nate approved pausing ustp-platform, but the Supabase API refuses with "Cannot pause project while it is currently hibernating" (stuck >30 min, retried many times). **UNBLOCK OPTIONS: Nate pauses ustp-platform from the Supabase dashboard, or upgrades to Pro ($25/mo — also removes the mid-season auto-pause risk, recommended for a real season).**
- **Stale-milestone finding: tokens 9/11/13 + double-finalize were ALREADY BUILT** (commits `d70ca6b`, `d5e0531`, `322a34b`) — the war-room "next milestone" predated the audit sweep.
- **Server-anchored draft clock (U6 closed app-side)**: deadline = last pick's `picked_at` (or new `draft_started_at` for pick 1) + 30s round buffer for round-first picks + clock; ALL clients tick it; on-the-clock client self-autodrafts at 0; every other client force-autopicks after +15s grace (+jitter) via new `force_autopick` RPC. Spectators see the countdown + "ran out of time" state. Next-picker notifications now fire on ALL pick paths (shared `src/lib/draft-notify.ts`).
- **Scoring engine (local, NOT YET DEPLOYED)**: no-lineup members no longer score their whole roster — fallback chain: saved lineup → carry-forward of most recent prior week (players still rostered) → auto-filled best legal lineup from the league's `lineup_slots` template by projections. Second Wind can replay Position Power with its position (`choice` format "7:POS" — picker UI asks for the position). Momentum skips Insurance-voided losses.
- **Recon exclusivity**: matchup-preview no longer reveals opponents' tokens (own token always, opponent's only to a pending Recon holder in that matchup).
- **Guards**: trade acceptance validates both post-trade roster sizes (cap `draft_rounds`, floor = starter count); record book excludes playoffs; transactions no longer double-report trades as adds; waiver cron catches up missed same-day hours (`waiver_hour <= now`, safe — result emails window on `processed_at`); chat bounds message sizes (2k/msg, 8k total).
- **✅ DB RESTORED + ALL DB WORK SHIPPED same session** (Nate paused ustp-platform via dashboard — the API kept refusing with a stuck "hibernating" error). Applied live: `draft_started_at` column + stamped in `start_draft`; `force_autopick` RPC (mirrors `make_draft_pick`'s insert core, FOR UPDATE serialized); `move_to_ir` accepts official IR OR injury_status IR/Out/Doubtful/PUP; `award_season_titles` is bracket-driven with a completion guard (was crowning semifinalists by points heuristic); **token-award week bug found & fixed in BOTH finalize paths** — awards were written to the just-finalized week where the roster page never reads them; now week N+1, and the commissioner's manual `finalize_week` gained full parity (marks tokens used + awards) with ON CONFLICT idempotency. score-matchups **v17 deployed**. `uff_game_schedule` verified seeded (544 rows, full 2026). **All 39 RPCs + 65 RLS policies snapshotted into `supabase/schema-snapshot/`** (audit item 13 — game rules now live in git). Verified C1 waiver fix (`week <= p_week`) and Insurance/double-finalize wiring in the live bodies. Pushed `ad1c2c2`; **live verify green**: playuff.com renders, `/api/trending` returns real DB data (DEF included). pg_cron nightly sync survived the pause/restore; redundant scoring job still gone.
- Known-open by design: prompt-injection via team names (friendly-league risk accepted); draft-power actions server validation done in sweep; `SYNC_SECRET` still deliberately unset.

### Session 36 — PWA push notification layer (2026-08-24)
Web Push built end-to-end. Everything below is verified locally (build green, eslint clean on new files, SW registered at scope /, VAPID send exercised live against FCM with a 410-prune, DB migration APPLIED to the live project). **Goes live when Nate adds the 3 VAPID env vars to Vercel (values in `.env.local`: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) and the commit is pushed** — NEXT_PUBLIC_ vars are build-inlined, so the deploy AFTER setting them is the one that activates the client side. Server side degrades to a silent no-op without the keys, so deploying first is safe.
- **`public/sw.js`** — push-only service worker: `push` → showNotification, `notificationclick` → focus-or-open the payload URL. **Deliberately NO fetch handler / offline cache** — caching a Next deploy's assets in a SW is how PWAs serve stale builds forever. Don't add one casually.
- **`src/lib/push.ts`** — `sendPushToUser(userId, {title, body, url, tag})`: reads `uff_push_subscriptions` via admin client, web-push to every device, **prunes 404/410 subscriptions**, never throws, no-ops without VAPID env vars.
- **`src/lib/notifications.ts`** — THE HOOK: `createNotification` now fans out push after the insert, so ALL 8 notification types get push automatically (plus future ones). Type→URL map mirrors the email deep links (`on_the_clock`→/draft, trade_*→/trade, `waiver_results`→/free-agents, `announcement`→/announcements, `newsletter`→league home). `on_the_clock` uses tag `on_the_clock:{leagueId}` so a newer clock alert replaces a stale one.
- **`src/app/dashboard/push-actions.ts`** — server actions: `savePushSubscription` (validates endpoint/base64url keys, upserts on endpoint — globally unique per Push API, so account-switch on a shared device reassigns it), `deletePushSubscription` (scoped to own user), `sendTestPush` (rate-limited 5/min).
- **`src/app/dashboard/PushNotificationsCard.tsx`** — client card, rendered on /dashboard (card variant) and league notifications page (banner variant). States: unsupported / **ios-install** (iOS needs Add-to-Home-Screen first — 16.4+ only exposes push to installed PWAs) / denied / off / on. Enable → register SW → requestPermission → subscribe → save → auto test-push. Async detection effect (react-hooks/set-state-in-effect clean).
- **DB**: `uff_push_subscriptions` (user_id FK cascade, endpoint UNIQUE, p256dh, auth, user_agent) — migration `20260824120000_push_subscriptions.sql` applied live via Supabase MCP; RLS own-SELECT/own-DELETE (writes via service role); snapshot `policies.sql` updated (65→67).
- **Gap fixes riding along**: (1) `startDraft` now calls `notifyNextPicker` — the FIRST overall pick previously got no notification of any kind; (2) newsletter cron now creates in-app notifications per member (inside its idempotency guard → no double-sends), which also gives newsletter push for free; (3) TYPE_ICON gained `on_the_clock` ⏰ + `newsletter` 📰; (4) manifest icons were lying — `/icon` (512) was declared as 192; now real `/icon-192.png` + safe-zone-padded `/icon-maskable.png` ImageResponse routes; (5) removed `metadata.icons.apple` from layout.tsx (conflicted with the `apple-icon.tsx` file convention, which wins); (6) `src/proxy.ts` matcher now excludes `/sw.js` (was paying a Supabase getUser round-trip per SW fetch).
- **Adversarial review + hardening (same session)**: a multi-agent review of the diff (3 of 4 dimensions completed; verify wave cut short by a spend limit, findings triaged by hand against the code). One SSRF/amplification finding CONFIRMED + a cluster of real correctness bugs — ALL FIXED before ship:
  - **`src/lib/push-validate.ts` (new)** — shared validation. **Host allowlist**: endpoints must be https, default port, and under a real push-vendor suffix (`.googleapis.com`/`.mozilla.com`/`.windows.com`/`.apple.com`). Without it, any user could store an arbitrary URL and turn `sendPushToUser` into a blind-SSRF / outbound-flood amplifier. Unit-verified 9/9 (accepts FCM/APNs/Mozilla/WNS, rejects 169.254/private/arbitrary host/custom port/http).
  - **`savePushSubscription`** — now rate-limited (`{uid}:push-save`, 10/min) AND caps devices at 10/user (deletes oldest beyond). Live-verified: 12 rows → pruned to the newest 10.
  - **`push.ts`** — `webpush.sendNotification` now passes `timeout: 10000` (a stalled hostile endpoint no longer hangs the awaited draft-pick path); prunes on **403** too (VAPID rotation), not just 404/410; per-payload TTL (on_the_clock → 300s so a reconnecting phone doesn't buzz about a pick already autopicked away); title/body/serialized-payload size guards (< ~3.5 KB, under the Web Push ceiling); returns `{configured, attempted, delivered}`.
  - **`sendTestPush`** — surfaces real outcomes: "not configured" / "no subscribed devices" / "push service rejected" instead of a false "Sent ✓".
  - **`public/sw.js`** — `renotify: true` on tagged notifications (a repeat on-the-clock alert was silently replacing the old one — no sound/banner); added a **`pushsubscriptionchange`** handler that re-subscribes and POSTs to **`/api/push/resubscribe` (new route)** so FCM rotation doesn't silently kill a device.
  - **`PushNotificationsCard`** — permission prompt now fires FIRST (preserves iOS transient activation); reconciles the server row with the browser subscription on load (heals prunes + re-claims on a shared device); `disable()` checks the delete result before unsubscribing; a transient SW-registration failure shows "off" (retryable) not "unsupported".
- **Verification method note**: created a throwaway auth user, logged in via the dev server, confirmed the card renders (denied-state path, since the embedded browser blocks notification prompts), verified the send path in Node against FCM, then deleted the test user. Real-device push test happens post-deploy on Nate's phone.

### Session 37 — Project memory review (2026-08-28)
Full review of this file against the repo. **Main finding: 14 commits (2026-08-24 → 26) were never documented here** — reconstructed below from git history + code reading (same precedent as the journal's overnight-build entry). Corrections applied to the sections above are listed at the end.

**Catch-up — undocumented work 2026-08-24 → 26 (all pushed to `main`, head `1a71a96`):**
- **Push activation saga** (`371596a`…`3ed4330`): the 3 VAPID env vars were added to Vercel and scoped to Production; several forced recompiles were needed because `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is build-inlined; `PushNotificationsCard` now trims pasted whitespace and validates the decoded key is a real 65-byte P-256 point before subscribing. App-side push activation is DONE; real-device test status unrecorded.
- **DB fixes** (`e581f2a`, `ce8750d`): dropped the ambiguous `generate_schedule(uuid,uuid)` overload; `start_draft` power dealing is now round-aware. Both mirrored into `supabase/schema-snapshot/functions.sql`.
- **Character lore layer** (`5a513fe` + hardening `9f0d3d0`, `2b59bbd`): managers are cast as unique canon Hero/Villain characters when they lock a faction — `src/lib/characters.ts` (`syncCharacterForFaction`, never throws: casting must not break join/faction flows), `uff_characters` table (migration `20260825140000`), `/character` league tab (in `LeagueNav`), public `/universe` page, `CharacterSilhouette`, seed script `scripts/seed-characters.mjs`. `secret_story` column hidden via revoke-table-SELECT + grant-public-columns. Hardening: per-league uniqueness, size caps, stale-cast fixes.
- **RLS hardening** (`03e3839`): `league_members` writes locked down; FAAB/waiver commissioner ops moved to commissioner RPCs (migration `20260825150000`, snapshot updated).
- **Duplicate-league guard** (`0b2d46e`, `0ad5be2`): double-submit protection (`SubmitButton` component) + a DB unique index on forming leagues as the real guarantee (migration `20260825160000`).
- **Self-serve team rename** (`bb3f14e`): `RenameTeam.tsx` on the league hub + server action + migration `20260825170000`.
- **Story Engine — "The Legend & the War"** (`deddbbd`, `45cd21a`, `b03ff87`, `1a71a96`): spec `docs/legend-and-the-war.md` (**LOCKED v2**, approved by Nate) + lore corpus in `lore/` + art brief `art/higgsfield-brief.md`. Two sealed layers: fantasy league untouched; the engine is READ-ONLY on fantasy data and writes only to isolated tables (`character_legend`, battles, feats — migrations `20260826120000/130000/140000`). Code: `src/lib/story-engine/` (`engine.ts` ~590 lines, `rules.ts`, `battles.ts` War Battles vs Internal Duels, `feats.ts` stat-line feats). Cron route `api/cron/story-engine` (POST leagueId/week/dryRun, x-cron-secret) + **auto-hook inside finalize-week** — wrapped so story failures can NEVER affect real finalization, gated on `uff_leagues.story_engine_enabled`. Surfaces: `/war` (War Room: `WarMeter`, `BattleReport`, `FreeLegendsBoard`) + Power Sheet on `/character`, linked from the Character tab. Test scripts: `scripts/story-battles-test.ts`, `story-feats-test.ts`, `story-engine-dryrun.mjs`.

**Corrections applied to this file in this review:**
- Overview said "Next.js 15" while Tech Stack said 16 — `package.json` has `next 16.2.9`; fixed to 16.
- Feature Inventory still claimed the draft room uses "Supabase Realtime" — it's a 5-second poll (Session 34 correction never propagated up); fixed.
- Feature Inventory still listed Mock Draft Mode (removed Session 32); struck through with a do-not-rebuild pointer.
- Current Build Status was frozen at #119 / 2026-07-06 with a stale "run sync-players manually" pending item (sync is nightly pg_cron since Session 34); rewritten.
- Duplicate "Known gotcha added" block (gotchas 10–11 verbatim twice) removed; Session 31 "Pending push" note resolved; `score-matchups` line count updated (~800, v17); Gotcha #1 (stale Bash mount) scoped to Cowork-desktop sessions only.
- Verified still true: rate limiting really is wired on all 10 AI routes (20 `checkRateLimit` call sites — Session 34's fix holds); mock-draft directory gone; season anchors in `nfl-utils.ts` correct (week ROLLS Wed 2026-09-09, lock anchor Thu Sep 10); all 4 GitHub Actions cron schedules match the Tech Stack line; `finalize-week.yml` parses (has a display name in the workflow list).
- Also noted: `docs/journal.md` stops at 2026-06-12 — it never picked up the CLAUDE.md session-log era; treat this file, not the journal, as the history of record.

**Addendum (same day) — code + graph verification pass.** Installed graphify in the remote container and rebuilt the graph: **1125 nodes, 1833 edges, 86 communities** (session-local only — `graphify-out/` is gitignored by design, so this doesn't refresh the laptop's copy). Verified against code, all TRUE: 18 tokens in `token-names.ts`; VB siphon league-scoped (`leagueMemberIds` filter, score-matchups ~L589); Shadow Guard both layers (`actions.ts:249` + score-matchups `:592` — the Session 24 "line 469" reference has drifted with the file, use the `shadow_guard` grep not the line number); `isEDT` DST in process-waivers; Oracle `rows[0] ?? rows[1]` cache read; `getAllUserEmails` `page++` pagination; `faabEnabled` formula + `(faabEnabled || isPriorityMode)` gating; per-route rate limits (chat 10 / draft-advisor 8 / power-rankings 3); `claude-haiku-4-5-20251001` at 11 call sites; schema snapshot holds 40 functions (was 39 at Session 35) + 67 policies; there is no `src/middleware.ts` — the auth middleware lives in `src/proxy.ts`. Graph agrees with the documented architecture: god nodes are `createClient` (159 edges), `createAdminClient`, `checkRateLimit` (25), `getCurrentNFLWeek`, `createNotification`, `sendEmail`; zero import cycles; story-engine subgraph wires finalize-week POST → `recomputeLeagueLegends` + `computeWeekFeats` exactly as documented. **One fix applied**: the Environment Variables section was missing the 4 Sentry + 3 VAPID vars the code uses (added, with the SYNC_SECRET deliberately-unset note). Known parser quirk: tree-sitter reports a false-positive "syntax error" in `DragDropLineup.tsx` L411 — the JSX is valid and production builds green; it only slightly thins that file's graph extraction. **Laptop graph refreshed same day** (graphifyy reinstalled at `%APPDATA%\Python\Python314\Scripts\graphify.exe` — that Scripts dir is not on PATH, use the full path or add it): identical counts 1125/1833/86, old graph backed up in `graphify-out/2026-08-28/`. The laptop repo also pulled to `c1d3998` same day.

### Next priorities (not yet built):
- **Confirm push on a real phone** — VAPID vars are in Vercel Production and the client card recompiled (2026-08-24→25 commits); the remaining step is Nate enabling + test-pushing on his own device (status unconfirmed in this memory)
- **Draft rehearsal** — run one full live rehearsal of the real draft room with actual invited members before Sept 9 (pick clock now server-anchored, but rehearse anyway — Session 35)
- **Story Engine next phases** — comic/art generation (`art/higgsfield-brief.md` brief exists), Great Battles / campaign arc per `docs/legend-and-the-war.md`
- **Admin dashboard** — cross-league health view for Nate
- **App Store listing** — iOS/Android PWA/TWA submission
- **Cron migration** — GitHub Actions → Vercel Cron Jobs (more reliable, less drift)
- Update `nfl-utils.ts` season start date every off-season (currently `2026-09-09`)

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
