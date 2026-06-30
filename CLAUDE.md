# UFF Platform — Claude Project Memory

Read this at the start of every session. It is the authoritative source of truth for this project.

---

## Project Overview

**Ultimate Fantasy Football (UFF)** — a custom fantasy football platform built by Nate. Full-stack Next.js 15 app with deep custom mechanics layered on top of standard fantasy: draft powers, weekly tokens, faction war, Oracle AI recaps, FAAB waivers, priority waivers, commissioner tools.

**Live URL**: https://uff-platform.vercel.app  
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
EMAIL_FROM          # e.g. "UFF <noreply@yourdomain.com>"
```

---

## Feature Inventory — What's Built

### Core League
- League creation, join, commissioner flow
- Member management, faction assignment (hero/villain)
- League settings page (playoff config, median scoring, trade deadline, Can't Cut List, waiver settings, acquisition limits)

### Draft
- Full real-time draft room (`/draft/`) with Supabase Realtime
- 16 named draft powers (Gunslinger, Vampire Bite, Draft Heist, Telepathy, Cloak, Foresight Coin, Hero's Shield, etc.)
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
    score-matchups/index.ts   # ~640 lines — 18 tokens + 11 draft powers + faction bonus
    sync-players/index.ts     # Pulls from Sleeper players API
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

1. **Bash mount is stale** — `/sessions/.../mnt/uff-platform/` shows cached old file versions. Always use Read tool for current Windows filesystem state. Git in bash also can't see Edit tool changes — user must `git add/commit/push` from their terminal for any Edit-tool-only changes.
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

---

## Current Build Status

All features through **#108 (Lineup Total, Injury Alerts, % Owned)** are built. Sessions 18–20 added bug fixes and features.

**Latest Vercel deployment**: READY  
**Last deployed commit**: `feat: Sentry, pick clock, email invites, on-the-clock notifications, pre-draft checklist (#101–#105)` — deployed and live  
**Pending commit**: `fix: Vampire Bite scope, DST offset, Oracle cache, email pagination`

### Nate must do now:
1. `git add -A`
2. `git commit -m "fix: Vampire Bite cross-league scope, DST offset in waivers, Oracle cache order, getAllUserEmails pagination"`
3. `git push`

### Completed setup (don't redo):
- Sentry account created, DSN set, org=`uff-platform`, project=`javascript-nextjs`
- `.npmrc` with `legacy-peer-deps=true` (committed)
- `turbopack: {}` in `next.config.ts` (committed)
- `pick_clock_seconds` column added to `uff_leagues` via Supabase SQL editor
- Vercel env vars: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` all set

### Full Feature List (deployed + pending push):
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
- League Assistant Chat (/chat) — AI with full league context (standings, matchups, transactions, full rulebook)
- Player news/trending feed (Sleeper trending API)
- Weekly newsletter cron (AI-generated + emailed via Resend)
- Waiver award emails + in-app notifications
- Mobile PWA (installable)
- Recent Activity widget on league hub
- Shared libs: `token-names.ts`, `get-record.ts`, `notifications.ts`

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
```

### Known gotcha added:
10. **Windows CMD no `&&`** — CMD does not support `&&` chaining. If a git commit fails with "index.lock" or "HEAD.lock" errors, run `del .git\index.lock` and/or `del .git\HEAD.lock`, then retry the three commands separately: `git add -A`, `git commit -m "..."`, `git push`.
11. **Dotall `/s` regex flag** — TypeScript target below ES2018 rejects `/pattern/s`. Use `.split(/PATTERN/)[0]` instead or `[\s\S]*` in place of `.*` with `s` flag.

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

### Next priorities (not yet built):
- **Rate limiting on AI routes** — per user, per minute — critical before any public launch
- **Mock draft mode** — simulate draft without locking real rosters
- **Push notifications** — mobile PWA (requires service worker + VAPID keys)
- **Onboarding / invite flow polish**
- **Admin dashboard** — cross-league health view for Nate
- **App Store listing** — iOS/Android PWA submission
- Consider migrating crons from GitHub Actions → Vercel Cron Jobs (more reliable, less drift)
- Update `nfl-utils.ts` season start date every off-season (currently `2026-09-09`)
