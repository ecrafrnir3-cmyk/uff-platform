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

**The bar:** ship a fully functional, bug-free fantasy platform that feels as polished as Yahoo Fantasy — the major-plat