# 🚀 UFF Handoff Brief

## Session update -- 2026-06-16 (evening: NTFS corruption cleanup)

**Shipped this session:**

All NTFS-truncated files reconstructed and deployed. Build is green.

**Root cause:** The Write/Edit file tools and bash heredocs truncate files on the Windows NTFS mount. Every file written since the lineup management session was silently corrupted in git. Fix: always use Python `open(path, 'w').write(content)` via bash for file writes on this project.

**Files reconstructed:**
- `matchups/page.tsx` -- missing `)}` closing the `!hasSchedule` block; appended missing week selector + MatchupView + Finalize button JSX.
- `free-agents/page.tsx` -- 36 null bytes stripped.
- `actions.ts` -- 722 null bytes stripped.
- `DraftRoom.tsx` -- 10 closing JSX lines deleted by a prior commit; reconstructed from `d41f371` base with valid changes from `84c605c` applied cleanly (supabase singleton, DEF position label).
- `[id]/page.tsx` -- every version since `7f3e18b` was truncated at 11044b; fully rewritten from scratch tracing 4 commits of diffs.
- `settings/page.tsx` -- truncated mid-input element; missing input attributes + all closing structure appended.

**Bug fixes on top:**
- `DraftRoom.tsx:90` -- `data as Pick[]` -> `data as unknown as Pick[]` (TS strict cast).
- `matchups/page.tsx:128` -- missing `)}` after `!hasSchedule` div.

**NTFS write rule (CRITICAL for all future sessions):**
Never use the Edit/Write tools or bash `cat >` heredocs to write files in this project. Always use:
```bash
python3 -c "open('path', 'w').write('''...content...''')"
```
or a Python script via bash.

*Last updated: 2026-06-16 (evening)*


## ✅ Session update — 2026-06-16 (lineup management + nav bar)

**Shipped this session:**

**Critical bug fixes (6 from prior audit):**
- `add_player` RPC: was inserting NULL league_id -- fixed to pass `p_league_id` explicitly.
- UNIQUE constraint blocked re-adding dropped players -- replaced with partial index `WHERE dropped_at IS NULL`.
- FreeAgents.tsx blank on load -- removed broken `setPosFilter(prev => prev)` no-op useEffect.
- `allRostered` query in free-agents/page.tsx -- PostgREST join filter was unreliable, switched to direct `.eq("league_id", leagueId)` on the `uff_roster_players` table.
- Projected pts not showing in matchups -- added `projected` field to interface, query, MatchupView.tsx, and Realtime handler.
- RLS: `uff_roster_players` had an ALL policy; split into proper SELECT-only policies.

**Lineup management system (full stack):**
- DB migration: `uff_lineups` table (member_id, week, slot, player_id) + `lineup_slots` JSONB on `uff_leagues` (default: QB×1, RB×2, WR×2, TE×1, FLEX×1, K×1, DEF×1 = 9 starters).
- `set_lineup` SECURITY DEFINER RPC: validates player on active roster, validates position eligibility (FLEX accepts RB/WR/TE), atomically replaces the week's lineup.
- `score-matchups` Edge Function v5: scores only starters when lineup is set; falls back to all active players if no lineup submitted yet.
- `lineup-actions.ts` server action: calls the RPC and redirects with success/error flash.
- `LineupManager.tsx` client component: slot dropdowns with position filtering (auto-updates assignment state), bench display, Save Lineup button.
- `roster/page.tsx` updated: queries `lineup_slots` + `uff_lineups` for current week, expands slots, renders LineupManager above roster, shows S/B (starter/bench) badge per player row.

**Shared league nav bar:**
- `LeagueNav.tsx`: sticky nav with UFF wordmark + tabs (League, Roster, Matchups, Standings, Free Agents, Settings), active tab highlighted gold with bottom border, uses `usePathname`.
- `layout.tsx` for `/dashboard/league/[id]/`: verifies membership once for all child routes, renders nav above every page.

**Git log (local, awaiting `git push` from Nate):**
```
72faa99 fix: lineup-actions import path
f2bc5fa feat: shared league layout with sticky nav bar
1f97071 feat: lineup management - set starters vs bench per week
811cd05 fix: critical waiver wire bugs + projected pts display
11f2a42 fix: critical waiver wire bugs + audit fixes
```

**IMPORTANT -- Nate needs to `git push` from CMD to send these to GitHub.**

*Last updated: 2026-06-16*

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