# UFF Platform — Claude Project Memory

Read this at the start of every session. It is the authoritative source of truth for this project.

---

## Project Overview

**Ultimate Fantasy Football (UFF)** — a custom fantasy football platform built by Nate. Full-stack Next.js 15 app with deep custom mechanics layered on top of standard fantasy: draft powers, weekly tokens, faction war, Oracle AI recaps, FAAB waivers, commissioner tools.

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

### Roster
- Drag-and-drop lineup (`DragDropLineup.tsx`)
- IR slot moves
- Trade block flagging per player
- Can't Cut List enforcement (commissioner sets, blocks drops)
- Eliminated team roster lock (`eliminated_at` column)

### Free Agents / Waivers
- Free agents page with FAAB bid UI
- Waiver Intel AI (claude-haiku, analyzes pickups)
- FAAB bidding: `submit_waiver_bid`, `cancel_waiver_bid` RPCs
- Auto-waiver processing cron (configurable day/hour per league)
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
- Managers page (W/L, PF, faction, roster preview)
- Transactions feed (adds, drops, trades, draft picks)
- Record Book (highest/lowest scores, streaks, blowouts, etc.)
- Trade Block (flag players league-wide)
- /about and /guide pages

### AI / Newsletter
- Weekly newsletter cron: AI writes, stores in `league_newsletters`, **emails all members** (Resend)
- Oracle recap (post-game), Oracle preview (pre-game)
- Token Advisor, Waiver Intel, Trade Evaluator, Draft Advisor, Power Rankings — all claude-haiku

---

## Key File Locations

```
src/
  app/
    api/
      cron/
        finalize-week/route.ts          # Wed 07:00 UTC
        generate-newsletter/route.ts    # Wed 07:30 UTC — generates + emails newsletter
        process-waivers/route.ts        # Hourly — FAAB auto-processing
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
        free-agents/page.tsx            # FAAB bidding + WaiverIntel
        draft/
          page.tsx
          DraftRoom.tsx
          actions.ts
          queue-actions.ts
        playoffs/page.tsx
        settings/page.tsx               # Commissioner tools
        record-book/page.tsx
        trade-block/page.tsx
        transactions/page.tsx
        managers/page.tsx
  lib/
    supabase/
      client.ts     # Browser client
      server.ts     # Server component client (cookie-based auth)
      admin.ts      # Service role admin client (no auth, bypasses RLS)
    email.ts        # Resend email utility + getMemberEmails helper
    nfl-utils.ts    # getCurrentNFLWeek()
supabase/
  functions/
    score-matchups/index.ts   # 590 lines — full scoring engine with all token/power mechanics
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

### TypeScript
- Turbopack stops at first error — fix one, next surfaces
- Bash `tsc --noEmit` is unreliable (stale Linux mount); use Read tool to check files
- Interface fields must be structurally compatible across files (e.g. `MatchupRow` in page.tsx vs MatchupView.tsx must match)
- `boolean | null` vs `boolean` — DB nullable fields must match both sides

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

1. **Bash mount is stale** — `/sessions/.../mnt/uff-platform/` shows cached old file versions. Always use Read tool for current Windows filesystem state.
2. **Turbopack cascade** — each build error masks the next. After fixing a TS error, the next build may reveal a new one.
3. **`boolean | null` mismatches** — Supabase nullable columns come back as `T | null`. Both sides of structural type comparisons must agree.
4. **Git staging** — always `git add` before `git commit`. Nate has forgotten this before.
5. **Service role key** — never in client-side code. `createAdminClient()` is server-only.
6. **ANTHROPIC_API_KEY** — never log or return in responses.
7. **`.returns<T[]>()`** — required on Supabase queries with complex joins that TypeScript can't infer.

---

## Current Build Status

All features through **P10 (Trade Inbox)** are deployed and live. Last successful Vercel deployment:
- Commit: `fix: median_win boolean | null in MatchupView to match page.tsx`
- State: READY

### Recently added (post-P10):
- **Email notifications** (Resend): trade events + newsletter delivery
- **Commissioner score override**: ±delta form on matchups page

### Next priorities (not yet built):
- Waiver priority order (non-FAAB claim ordering by inverse standings)
- Email notifications for waiver award results
- Push notifications (future)
