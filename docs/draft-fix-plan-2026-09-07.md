# Official Re-Draft Fix Plan — 2026-09-07 (assessment by Fable, fixes for Opus)

**Context.** The 2026-09-02 inaugural draft of The First War was killed mid-run and reset to `not_started`. Group feedback surfaced 5 complaints. This session verified each against the current code (`C:\Users\ecraf\Claude\Projects\UFF`), the live DB (`synfuvgdamhjboobjmls`, ACTIVE), and the graphify mind. **The killed draft's raw data is gone** (0 rows in `uff_draft_picks` / `draft_power_assignments` / `uff_roster_players` — the reset preceded any export; the only record is the in-session audit: 1 anomaly in 9 rounds, Reveille doubled R9 / Blessed Defender skipped R9, 0 dup players).

**Mandate:** fix the draft experience, don't rebuild the engine. The backend is 224-pick sim-verified green. Every issue below is client-side or UX except where noted. **Heist stays OFF for the official draft** (standing decision) — its section is optional/deferred.

---

## Complaint → root cause map (all verified in code/DB this session)

| # | Complaint | Root cause | Status |
|---|-----------|-----------|--------|
| 1 | "Didn't see powers first round" | Powers are a server-prop fetched at page load, never refetched; everyone loaded pre-start (empty) and transitioned lobby→draft via poll without reload | **OPEN — P0** |
| 2 | "Foresight didn't work" | (a) same empty-powers state → modal never opened; (b) server swap bug — already fixed, verified live; (c) local-state swap uses wrong round variable | **(a) P0, (c) small fix** |
| 3 | "Elizabeth had no players one round" | Default list = top 60 by ADP, drafted filtered client-side → list runs dry ~round 4-5; self-heal never fires (raw list isn't empty); no empty-state message | **OPEN — P0** |
| 4 | Heist targets confused by snake direction | Modal shows no this-round pick order; sidebar shows base order while even rounds reverse | **Deferred (Heist OFF)** |
| 5 | "Kept refreshing to see the current pick" | Draft night had no Realtime + throttled 5s poll; 4-layer fix deployed post-draft; publication verified live today | **Fixed, UNVERIFIED on devices — P1** |

---

## P0-1 · Powers never load for clients that were open at draft start (complaints 1 + 2)

**Files:** `src/app/dashboard/league/[id]/draft/page.tsx` (lines 67-85), `DraftRoom.tsx` (props line ~804, state `myPowersState` line ~824).

**Mechanism.** `myPowers` is fetched once server-side in `page.tsx`. `start_draft` creates the `draft_power_assignments` rows *at start*. All 14 managers sat in the PreDraftLobby (rendered by `DraftRoom`'s early return); when Nate clicked Start, their clients flipped to the live room via `fetchPicks`' league-row sync — **no page reload, so `myPowersState` stayed the pre-draft fetch: `[]`**. Nothing in the client ever refetches powers (`setMyPowersState` is only called by the Foresight swap).

**Blast radius (why this was the bug of the night).** Not cosmetic:
- "My Powers" panel + "Your power this round" (buffer + turn banners): blank.
- `handlePick` (line ~1505) reads `myPowerThisRound` to call `assignPowerToPick` → **round-1 powers silently never attached** (round 1 = star powers, possibly Shadow Guard, which was deliberately moved to R1-5 to counter Vampire Bite).
- Foresight (line ~1492), Telepathy buffer reveal (line ~1031), Heist auto-open: all gate on `myPowerThisRound` → none fired. This alone explains "Foresight didn't work."
- Managers who hard-refreshed mid-draft recovered from round 2+ — matching "first round" in the feedback.

**Fix spec.**
1. Add a client-side `fetchMyPowers` in `DraftRoom.tsx` — direct query, RLS allows it (verified: `authenticated read draft_power_assignments` policy is `USING (true)`); no new server action needed:
   ```ts
   const fetchMyPowers = useCallback(async () => {
     const { data } = await supabase
       .from("draft_power_assignments")
       .select("round, draft_powers(id, name, category, description, tied_position)")
       .eq("league_id", leagueId)
       .eq("member_id", myMemberId)
       .order("round", { ascending: true });
     if (data && data.length) setMyPowersState(data as unknown as PowerRow[]);
   }, [leagueId, myMemberId]);
   ```
   (Keep the never-clobber-with-empty guard, mirroring the players fix.)
2. Call it: (a) inside `fetchPicks`' league sync whenever status lands on `in_progress` **and** `myPowersState.length === 0` (self-healing, covers the lobby→live transition, dropped requests, and reconnects); (b) on mount when the draft is already in progress and the prop came back empty. The 2.5s poll + realtime piggyback makes (a) land well inside the 30s round-1 buffer.
3. After a successful Foresight swap, call `fetchMyPowers()` instead of (or after) the hand-rolled local swap — that also erases P0-2's display bug.

**Acceptance:** two browsers in a throwaway league, both sitting in the lobby → Start Draft → both show My Powers + "Your power this round" during the round-1 buffer **without any reload**, and a round-1 pick attaches its power (row lands in `player_draft_powers`).

## P0-2 · Foresight local swap uses the wrong round variable (complaint 2 residue)

**File:** `DraftRoom.tsx`, `handleForesightCoin` (~line 1580-1588).

The server call correctly uses `foresightPickedRound`, but the local sidebar swap looks up `p.round === currentRound`. The modal opens *after* the pick, so if the Foresight holder was the **last pick of the round**, `currentRound` has already advanced → the local display swaps the wrong rows (server state is right; UI drifts until refresh). Fix: use `foresightPickedRound` — or moot it entirely by refetching per P0-1 step 3. Note: the server RPC `swap_foresight_powers` is confirmed atomic and live (delete+insert, ownership + future-round checks, row locks) — do **not** touch it.

## P0-3 · Default player list runs dry mid-draft (complaint 3)

**File:** `DraftRoom.tsx`, players effect (~line 1070-1101), self-heal (~1106-1119), empty-state (~2111).

**Mechanism.** The default view fetches the **top 60 by ADP regardless of drafted status** (`limit(60)`), and drafted players are filtered client-side (`availablePlayers`). Drafting roughly follows ADP, so by ~pick 56-70 all 60 rows are drafted → `availablePlayers = []`. Three compounding gaps: the self-heal keys on `players.length === 0` (raw list has 60 rows, so it never fires); the "no players match" message only renders when a search/filter is active — the default view shows **silent blankness**; and the 486-player ranked pool means position filters can also thin out late. The 09-02 fix (retry/no-clobber, `a79fb98`) addressed a *different*, real failure (dropped request under load) — this depth bug survived it.

**Fix spec.**
1. Scale the fetch with draft progress: `.limit(60 + picks.length)` and add `picks.length` to the effect deps (a refetch per pick is ~5KB × 14 clients — negligible; alternatively throttle on `Math.floor(picks.length / league.max_teams)`). The pool is only 486 ADP-ranked rows (verified `count(*)` today), so even `limit(300)` flat is acceptable — pick one, don't over-engineer.
2. Show an empty-state on the **default** view too (drop the `search/posFilter` condition guard), with copy like "All listed players are drafted — loading deeper ranks…" while the bigger fetch lands.
3. Point the self-heal at the real symptom: fire when `availablePlayers.length === 0` (compute from `players` minus `pickedIds` inside the effect), not raw `players.length`.

**Acceptance:** in a sim league, autopick through 6+ rounds, then load the room fresh AND leave it open — default view still lists undrafted players both ways; position filters (e.g. K, DEF) still populate in round 14+.

## P1-1 · Verify the live-refresh fix on real devices (complaint 5)

Nothing to build. Draft night ran with zero Realtime and a throttled 5s poll; the 4-layer fix shipped after (`ca4ca37`, `5484cf3`): Realtime push on `uff_draft_picks` + `uff_leagues` (**publication re-verified live today, post-un-pause**), focus/visibilitychange refetch, tap/scroll throttled refetch, 2.5s poll. What's missing is the **2-device check**: pick on device A, watch device B's board/turn banner advance untouched, phone screen-off/screen-on included. Fold it into the rehearsal (P1-3). If B lags >3s while awake, debug the Realtime socket (RLS on the subscriber's SELECT is in place; check `realtime.subscription` errors in the browser console) before draft night.

## P1-2 · Small UX: make snake direction legible (complaint 4's cheap half, useful even with Heist OFF)

The sidebar "Draft Order" renders base order 1→14 every round; on even rounds picking runs 14→1 and the only hints are a tiny `<` glyph on the board and the "PICKING" chip. That's what scrambled the group's mental model. Cheap fixes, pick both:
1. Sidebar: label it "Picking order — Round N" and **render it in this-round order** (reverse the array on even rounds), numbering by this-round pick position; keep the PICKING highlight.
2. Turn banner: append the pick context everyone was refreshing for — "Pick #87 · Round 7 (←) · Waiting on {team}". The header already shows Round/Pick; the banner is where eyes are.

## P1-3 · The dry-run rehearsal (process lesson from 09-02 — mandatory before the official draft)

Every 09-02 failure was invisible to single-user/RPC testing and only surfaced under 14 live clients. Before the official draft: throwaway league, 3-4 real humans on phones + a desktop, exercising: lobby→start transition (powers appear, no reload), round-1 buffer, a Foresight swap, a Telepathy reveal, a Vampire Bite, deep-round player list, the 2-device refresh check, one deliberate AFK timeout (self-autopick then the 15s force_autopick safety net + power auto-attach). Tear the league down after. Keep The First War untouched throughout.

## P2 (deferred — ONLY if Nate decides to run Heist ON) · Draft Heist rebuild

Standing decision: official draft runs Heist OFF (`HEIST_ENABLED = false` client + both RPCs raise server-side; original bodies preserved beneath the guards — verified live today). If it ever comes back, both halves are required:
1. **Atomicity (the round-9 skip/double race):** design already on record — a `_uff_restore_expired_heist(league)` SECURITY DEFINER helper that restores `draft_order` from `heist_state.originalOrder` and clears it whenever `(heist_state->>'round')::int < current_round`, called at the top of `make_draft_pick` / `force_autopick` / `commissioner_draft_pick` AND before accepting a new heist; then **delete the client restore effect** (`DraftRoom.tsx` ~line 981-991) and the per-client `heistOriginalOrder`/`heistUsedRound` bookkeeping it drives.
2. **Direction UX (this feedback):** in `HeistModal`, compute each target's **this-round pick number** and the holder's own; badge each row "Picks #N this round — before/after you", sort by it, and confirm-warn when the chosen slot picks *later* than the holder ("this moves your pick back"). Consider only offering earlier-than-you targets.
3. Test in the isolated sim (`33333333…` pattern): heist at a round boundary, two heists same round, heist across the snake turn, Hero's-Shield block, stale-state auto-clear.

---

## Test + ship checklist (Opus)

1. `npx tsc --noEmit` clean; `npm run build` passes.
2. Re-run the isolated 224-pick sim (reuse the 14 real users — synthetic profiles are blocked by the `profiles.id → auth.users` FK): invariants 224/224 picks, 0 dup players, 16 per team, 0 round anomalies, snake order clean, schedule 196 rows. Tear down after; then `SELECT count(*)` checks that The First War is pristine (`not_started`, 14 members, 0 picks, 35 scoring keys).
3. Manual 2-browser pass per the P0 acceptance criteria above.
4. **Deploy = `git push` to main** (Vercel auto-deploy). Never `vercel --prod`.
5. Any SQL via Supabase MCP: unique dollar-quote tags (`$fixtag$`), `count(*)` not estimates, migrations mirrored into `supabase/migrations/` + the schema snapshot.
6. **Before any future draft reset: export picks/powers/rosters first** (the 09-02 regret — raw data was destroyed unexported).

## Notes / non-goals

- **Do not** touch `start_draft`, `make_draft_pick`, `force_autopick`, the scoring path, or `swap_foresight_powers` — all verified good; every P0 here is client-side React.
- RLS observation (log only, don't fix now): `draft_power_assignments` is readable by ANY authenticated user (`USING (true)`), so a savvy manager could read everyone's powers via the API, sidestepping Telepathy/Shadow Guard. Tightening it naively would break Telepathy's legitimate cross-member read (`revealNextPower` runs on the caller's session) and the P0-1 client fetch. Family league; acceptable for Season 1 — revisit post-season with a SECURITY DEFINER reveal RPC + own-rows-only policy.
- Commissioner "Draft for {team}" buttons render for Nate on every other manager's turn (confirm-guarded). Optional polish: only surface them once the pick clock expires, to prevent a mis-tap during a live room.
- Unrelated pre-Week-1 items still open elsewhere: DEF data sync verification; Supabase Pro ($25/mo) recommended before Week 1.
