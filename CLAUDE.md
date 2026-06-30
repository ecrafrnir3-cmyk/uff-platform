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

- **Framework**: Next.js 15 App Router, TypeScript, Tailwind CSS v4
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

---

## Current Build Status

All features through **Waiver Priority System** are deployed and live.

**Latest Vercel deployment**: READY  
**Commit**: `feat: waiver priority system — priority_waivers RPC, Claim UI, settings toggle + reset`

### Full Feature List (deployed):
- Core league, member management, faction war
- Real-time draft room with 16 named draft powers
- Live NFL scoring via Sleeper + 18 UFF tokens + faction bonus
- FAAB + priority waiver systems (both fully built)
- Matchups with Oracle AI preview/recap + commissioner score override
- Drag-and-drop lineup, IR slots, Can't Cut List, eliminated team lock
- Trade Center: propose/accept/reject/veto + commissioner review + email notifications
- Standings + Faction War + Power Rankings (AI)
- 4-team and 8-team playoff brackets with winner advancement
- Managers page with achievement badges
- Transactions feed, Record Book, Trade Block
- Weekly newsletter cron (AI-generated + emailed via Resend)
- Waiver award emails
- Mobile PWA (installable)
- Recent Activity widget on league hub
- Shared libs: `token-names.ts`, `get-record.ts`

### Pending fix (needs manual git push):
- `standings/page.tsx`: `median_win: boolean | null` (matches nullable DB column) — Edit tool wrote the fix but bash git can't see it through stale mount; run `git add src/app/dashboard/league/\[id\]/standings/page.tsx && git commit -m "fix: median_win boolean | null" && git push` from your terminal.

### Next priorities (not yet built):
- Push notifications (future)
- Achievement/streak badge system expansion
