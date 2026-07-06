# 🚀 UFF War Room — Current State

*Last updated: 2026-07-06 (Session 26 — mock draft mode)*

---

## 🔢 Build Status

**All features through #116 (Mock Draft Mode) are built. #115 and #116 are pending push.**

- **Live URL**: https://uff-platform.vercel.app
- **GitHub**: github.com/ecrafrnir3-cmyk/uff-platform (`main`)
- **Supabase**: `synfuvgdamhjboobjmls`
- **Vercel project**: `prj_HbhjhScNXEPvZTIFePCvfiEBnzSu`

---

## ✅ What's Working (Don't Touch)

### Core Flow
- **Marketing landing page** (`/`) — hero + 4 feature cards (Draft Powers, Faction War, 18 Tokens, Oracle AI) + features strip + Season Titles teaser + CTA. Server component: logged-in users redirect to `/dashboard`, visitors see the landing page. Links to `/login`, `/about`, `/guide`. ✅
- **Mock draft mode** (`/mock-draft`) — fully client-side simulation, zero DB writes. CPU picks every 800ms with positional need logic. All 16 draft powers simulated including Vampire Bite modal, Draft Heist modal, Foresight Coin modal. Draft board grid, My Roster tab, Power Log. Accessible from league hub header + nav bar. ✅
- Auth: signup, login, password reset ✅
- League creation, join, commissioner flow ✅
- Faction assignment (hero/villain) ✅
- Draft room: real-time, snake order, 16 named powers, pick clock, round buffer, autodraft queue ✅
- Scoring engine: Sleeper → Edge Function → `uff_matchups` (18 tokens + 11 draft powers + faction bonus) ✅
- Lineup: drag-and-drop, IR slots, Start Best auto-fill, optimal lineup calculator, week navigator ✅
- Free agents: FAAB + priority waivers, acquisition limits, Waiver Intel AI ✅
- Trades: propose/accept/reject/veto/commissioner review, Trade Inbox, AI evaluator, email notifications ✅
- Standings: W/L/PF/PA, Faction War section, Power Rankings AI ✅
- Playoffs: 4 or 8 team bracket, commissioner seeds, winner advancement ✅
- Matchups: live scores, Oracle AI preview/recap, commissioner score override, score breakdown ✅

### League Tools
- Commissioner Broadcast (email + in-app notification to all members) ✅
- Season Schedule page + head-to-head history ✅
- Record Book, Transactions feed, Trade Block, Trade History ✅
- Managers page with achievement badges ✅
- **Season Titles** — faction-aware end-of-season awards via Settings → `award_season_titles` RPC ✅
  - Champion Hero → Super Hero, Champion Villain → Super Villain, 2nd → Nemesis
  - 3rd/4th: Hero → Side Kick, Villain → Henchman; everyone else → Cast
- Global Player Search (`/players`) with ownership + injury status ✅
- Notification Center (`/notifications`) with bell icon + unread badge ✅
- League Assistant Chat (`/chat`) — AI with full rulebook context ✅
- Player news/trending feed (Sleeper trending API) ✅
- Weekly newsletter cron (AI-generated + emailed via Resend) ✅

### Draft Powers (all 16)
- **Shadow Guard** (formerly Cloak, power_id=9): blocks Vampire Bite *permanently* on picked player + blocks Telepathy reveal. Two-layer protection: `assignVampireBite` (immediate error) + `score-matchups` safety net. Category: `tied_to_pick/ANY` → writes to `player_draft_powers` automatically like other pick powers ✅
- All other powers: Gunslinger, Berserker Rage, Reception Specialist, Iron Defense, Red Zone Menace, Goal Line Hammer, Seam Buster, Sniper, Power Negation, Time Stone, Vampire Bite, Foresight Coin, Draft Heist, Hero's Shield, Telepathy ✅

### Infrastructure
- Crons: score-matchups every 15min (Thu–Tue), finalize-week Wed 07:00 UTC, newsletter Wed 07:30 UTC, process-waivers hourly ✅
- Sentry error monitoring (production-only, session replay) ✅
- Rate limiting on all 10 AI routes ✅
- Mobile PWA (installable, manifest with icons) ✅
- Security headers in next.config.ts ✅

---

## 🔴 Bugs / Known Gaps

**None confirmed as of Session 24 deep dive.** The following are open design gaps (not crashes):

| Item | Detail | Priority |
|---|---|---|
| Root page marketing content | ✅ Built in session 25. `/` now shows full landing page for visitors; logged-in users redirect to `/dashboard`. | ✅ Done |
| Email sending domain | `EMAIL_FROM` fallback is `onboarding@resend.dev` (Resend test domain). If `EMAIL_FROM` env var isn't set to a verified custom domain in Vercel, production emails may fail. | 🔴 Launch-critical |
| Player data freshness | `players` table populated with 4,254 players. Needs `sync-players` run before 2026 season opens Sep 9 to get current rosters. | 🟡 Pre-season |
| PWA icons | manifest.ts uses `/icon` (Next.js route). Need to verify actual `icon.png` file exists in `/app` at adequate resolution. | 🟡 App Store |
| Shadow Guard toast is generic | When applied during draft, toast says "Shadow Guard applied to this pick!" — doesn't mention Telepathy block benefit. Minor polish. | 🟢 Low |

---

## 🟡 Next Features (Not Yet Built)

In priority order per CLAUDE.md + session notes:

1. **Custom domain** — `uff-platform.vercel.app` is not a launch URL; need a real domain + DNS + Supabase Auth Site URL update
4. **Push notifications** — mobile PWA (requires service worker + VAPID keys)
5. **App Store listing** — iOS/Android PWA/TWA submission
6. **Admin dashboard** — cross-league health view for Nate
7. **Cron migration** — GitHub Actions → Vercel Cron Jobs (more reliable, less drift)

---

## 🔑 Key Env Vars (Vercel)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY           ← NEVER log or return in responses
CRON_SECRET
RESEND_API_KEY
EMAIL_FROM                  ← Must be verified domain for production
NEXT_PUBLIC_SENTRY_DSN
SENTRY_ORG                  ← uff-platform
SENTRY_PROJECT              ← javascript-nextjs
SENTRY_AUTH_TOKEN
```

---

## 📁 Key File Map

```
src/app/
  page.tsx                          # Root: landing page (visitors) → redirects /dashboard (logged-in)
  dashboard/league/[id]/
    mock-draft/
      page.tsx                      # Server component: loads league + all power assignments + players
      MockDraftRoom.tsx             # Client component: full simulation (~650 lines)
  about/page.tsx                    # Deep-dive "About" page (linked from landing nav + footer)
  guide/page.tsx                    # Full powers + tokens guide (public)
  dashboard/league/[id]/
    layout.tsx                      # Auth gate + trade badge + notif count
    LeagueNav.tsx                   # Full nav (16 pages + bell)
    settings/
      actions.ts                    # All commissioner actions incl. awardSeasonTitles
      page.tsx                      # Commissioner tools UI
    managers/page.tsx               # Achievement badges + season title badges
    draft/
      DraftRoom.tsx                 # Real-time draft room (Shadow Guard UI)
      actions.ts                    # Draft actions (assignVampireBite → Shadow Guard check)
    matchups/MatchupView.tsx        # Realtime scoring client
    free-agents/FreeAgents.tsx      # FAAB + priority waivers
src/lib/
  nfl-utils.ts                      # Season start 2026-09-09 (update each off-season)
  email.ts                          # Resend templates (FROM fallback = onboarding@resend.dev)
  rate-limit.ts                     # In-memory per-user rate limiter
supabase/functions/
  score-matchups/index.ts           # Scoring engine (~640 lines, shadow_guard at line 469)
.github/workflows/                  # 4 cron workflows
```

---

## 🚫 Permanent Security Rules

- `ANTHROPIC_API_KEY` — NEVER log, return in responses, or put in client-side code
- `SUPABASE_SERVICE_ROLE_KEY` — server-only (`createAdminClient()`)
- All AI routes use `process.env.ANTHROPIC_API_KEY` server-side only

---

*Companion doc: `CLAUDE.md` is the authoritative session-to-session memory. This war room is the launch-readiness snapshot.*
