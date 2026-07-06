# UFF Platform — Claude Project Memory

Read this at the start of every session. It is the authoritative source of truth for this project.

---

## Project Overview

**Ultimate Fantasy Football (UFF)** — a custom fantasy football platform built by Nate. Full-stack Next.js 15 app with deep custom mechanics layered on top of standard fantasy: draft powers, weekly tokens, faction war, Oracle AI recaps, FAAB waivers, priority waivers, commissioner tools.

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
```

---

## Feature Inventory — What's Built

### Core League
- League creation, join, commissioner flow
- Member management, faction assignment (hero/villain)
- League settings page (playoff config, median scoring, trade deadline, Can't Cut List, waiver settings, acquisition limits)

### Draft
- Full real-time draft room (`/draft/`) with Supabase Realtime
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
    score-matchups/index.ts   # ~640 lines — 18 tokens + 11 draft powers + faction bonus
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
16. **Shadow Guard blocks Vampire Bite at two layers** — (1) `assignVampireBite` in `actions.ts` rejects the bite immediately if `player_draft_powers` has `power = 'shadow_guard'` for that player; (2) `score-matchups` edge function also skips the siphon as a safety net. Both checks use the same `powerMap`. Shadow Guard is `power_id = 9` (formerly Cloak) with `category = 'tied_to_pick'`, `tied_position = 'ANY'` — it writes to `player_draft_powers` automatically on pick like other tied_to_pick powers. It also still blocks Telepathy via the existing `power_id = 9` check in `revealNextPower`.

---

## Current Build Status

All features through **#119 (Player Rankings + Waiver Wire)** are built and pushed. Sessions 18–30 completed.

**Latest Vercel deployment**: Live at playuff.com  
**Last pushed commits**: #119 (sync-players v4 synthetic ADP + free-agents limit 300) — pushed 2026-07-06.  
**Pending**: Run sync-players once from Supabase dashboard (Edge Functions → sync-players → Test) to populate v4 data in DB.

### Completed setup (don't redo):
- Sentry account created, DSN set, org=`uff-platform`, project=`javascript-nextjs`
- `.npmrc` with `legacy-peer-deps=true` (committed)
- `turbopack: {}` in `next.config.ts` (committed)
- `pick_clock_seconds` column added to `uff_leagues` via Supabase SQL editor
- Vercel env vars: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` all set

### Full Feature List (deployed + pending push):
- **Marketing landing page** — `/` shows hero + 4 feature cards + faction war section + Season Titles teaser + CTA for visitors; redirects logged-in users to `/dashboard`
- **Mock draft mode** — `/mock-draft` (accessible from league hub + nav). Client-side-only simulation, zero DB writes. CPU picks every 800ms using positional need algorithm. All 16 powers simulated: tied_to_pick (auto), Draft Heist (CPU steals earlier slot if back-half), Vampire Bite (CPU targets user's best player; user gets modal to bite CPU player), Hero's Shield (blocks Heist), Telepathy (reveals next picker's power), Foresight Coin (user chooses between current/future round powers), Shadow Guard (permanently marks player as bite-immune), Power Negation (removes power from highest-ADP powered pick). UI: player list with position filter + search, draft board grid (collapsible), My Roster tab with composition, Power Log tab. Reset button reruns from scratch.
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
- Pending push: `feat: marketing landing page — hero, feature cards, faction war section, season titles teaser, CTA (#115)`

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

### Session 30 — Player Rankings + Waiver Wire (2026-07-06)
- **sync-players v4**: Two-tier ADP ranking. FFC PPR ADP for ~179 name-matched players; Sleeper `search_rank` used as synthetic ADP (offset above max FFC pick) for up to 250 additional unmatched players → 400+ total ranked players. Response returns `adpMatched`, `adpSynthetic`, `adpTotalRanked`, updated `adpSource`.
- **FreeAgents.tsx**: Query limit raised 150 → 300 to surface all ranked players.
- **Waiver wire in-season**: Already working — `free-agents/page.tsx` fetches Sleeper weekly projections and re-sorts by projected points when season is active. No code changes needed.
- **Sept 1 reminder**: Scheduled task created (fires once 2026-09-01 09:00 EDT) reminding to re-run sync-players for fresh pre-season data.
- **Pending action**: Nate needs to trigger sync-players once from Supabase dashboard (Edge Functions → sync-players → Test → Send Request) to populate v4 synthetic ADP in DB.

### Next priorities (not yet built):
- **Player sync** — `sync-players` v4 deployed. Two-tier ranking: (1) FFC PPR ADP for ~179 matched players, (2) Sleeper `search_rank` synthetic ADP for up to 250 additional unmatched players → 400+ total ranked. Response now returns `adpMatched`, `adpSynthetic`, `adpTotalRanked`. Free-agents limit raised from 150 → 300. Sept 1 reminder scheduled. Run again ~Sept 1 before the Sept 9 draft season. **Needs one manual trigger from Supabase dashboard to populate v4 data.**
- **In-season waiver wire priority** — already built! `free-agents/page.tsx` fetches Sleeper weekly projections (`/v1/projections/nfl/{year}/{week}`) and sorts free agents by projected points when in-season. Shows "Ranked by projected points · Week N" during the season, falls back to ADP off-season.
- **Push notifications** — mobile PWA (requires service worker + VAPID keys)
- **Admin dashboard** — cross-league health view for Nate
- **App Store listing** — iOS/Android PWA/TWA submission
- **Cron migration** — GitHub Actions → Vercel Cron Jobs
- **Push notifications** — mobile PWA (requires service worker + VAPID keys)
- **App Store listing** — iOS/Android PWA/TWA submission
- **Admin dashboard** — cross-league health view for Nate
- Consider migrating crons from GitHub Actions → Vercel Cron Jobs (more reliable, less drift)
- Update `nfl-utils.ts` season start date every off-season (currently `2026-09-09`)
