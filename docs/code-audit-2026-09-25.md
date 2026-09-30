# UFF code audit — 2026-09-25 (report only, no code changed)

| | |
|---|---|
| **Date** | 2026-09-25 (written 2026-09-26 UTC) |
| **Commit audited** | Areas 1–3: `e99ee3d9da89b000add7f796fd08b202a5cce65b`. Areas 4–5 (second session, 2026-09-30): `4b64a7a` (`origin/main` that day; the Area 4–5 files are byte-identical between the two). |
| **Areas covered** | Area 1 — database layer (all 29 files in `supabase/migrations/`, both files in `supabase/schema-snapshot/`). Area 2 — server actions (every `*actions.ts` under `src/app/dashboard/` except the three draft files, plus `src/lib/supabase/{admin,server,client,middleware}.ts` and `src/proxy.ts`). Area 3 — every route under `src/app/api/` plus `src/lib/{push,push-validate,rate-limit,notifications,email}.ts`. Area 4 — `supabase/functions/score-matchups/index.ts`, `supabase/functions/sync-players/index.ts`. Area 5 — `src/lib/scoring.ts`, `src/lib/story-engine/{engine,rules,battles,feats}.ts`. |
| **Method** | Code reading only. No database access, nothing applied, nothing deployed. |
| **Skeptic pass** | Every `path:line` below was re-opened cold before finalising. **5 candidate findings were dropped in session one and 3 in session two** (session two: a faction-bonus "starters vs roster" mismatch — the guide agrees with the engine, only the chat rulebook differs, already A3-03; a Mulligan slot-legality concern — the rulebook wording permits it; a sync-players "retired players linger" claim that the code does not prove). Session one's five because the code did not support them (an unpaired dollar-quote that was my grep's error, not the file's; `uff_notifications` UPDATE "missing WITH CHECK" — Postgres applies USING to new rows; the roster-exit trigger "not firing on trades" — trades UPDATE `member_id`, so it fires; a cross-league trade read in `trade-veto-analysis` that RLS already blocks; and `advance_playoff_bracket` "anon-reachable" — it was revoked on 2026-09-15). |

## Not read (absence from this report is not a clean bill)

- **Areas 4 and 5 were read in full in the second session (below).** Still not read from that neighbourhood: `scripts/lineup-core-test.ts`, `scripts/story-*-test.ts`, `scripts/sync-projections.mjs`, and the War Room components (`WarMeter`, `BattleReport`, `FreeLegendsBoard`) beyond the two `grep` lines cited in A5-03.
- **Draft room (audited 2026-09-07, not re-audited):** `src/app/dashboard/league/[id]/draft/{DraftRoom.tsx,actions.ts,queue-actions.ts,watchlist-actions.ts}`, `src/lib/draft-notify.ts`, and the bodies of `make_draft_pick`, `force_autopick`, `update_draft_heist_order`, `clear_heist_state` beyond their auth guards. Where an RLS policy on a draft table is reported below, it is because the policy is database-layer, not draft-room code.
- **Read only partially:** the AI routes `oracle`, `token-advisor`, `trade-eval`, `start-sit`, `waiver-intel`, `power-rankings`, `draft-advisor`, `matchup-breakdown` were checked for the auth / membership / rate-limit pattern and their inputs, not line-by-line for logic. `matchup-preview` and `trade-veto-analysis` were read through their auth and Recon gating only.
- **Not opened at all:** `src/lib/characters.ts`, `src/lib/get-record.ts`, `src/lib/nfl-utils.ts` (three `grep` lines only), every page/component under `src/app/dashboard/**`, `scripts/`, `.github/workflows/`, `next.config.ts` (one `grep` for redirects), `public/sw.js`, `sentry.*.config.ts`, and `supabase/migrations/20260907210000_pin_draft_power_rounds.sql` beyond its structure (it is already flagged DO NOT APPLY).
- **Not re-reported (already known, per the brief):** the seven `p_user_id`-trusting RPCs in PR #1, the unsafe pin migration, the permissive `ALL` policy on `uff_push_subscriptions` (not present in the git snapshot at all — see A1-19), finalize-from-Matchups guards, projected-total faction bonus, now-keyed scoring state, untradeable Power Restore Chips, half-completing `sync-players`.

## Status since 2026-09-25 (not re-verified)

PR #3 merged the same day. Between `e99ee3d` and `4b64a7a` main carries commits whose subjects claim fixes for A1-01/A2-01 (`join_league` RPC), A1-02, A1-03 (`commissioner_draft_pick`, `reset_waiver_priority` + six more RPCs), A1-05/A1-09/A2-06 (lineup lock in the database), A1-06..A1-15, A1-16..A1-22, A2-02..A2-09, A3-01, A3-05 and a schema-snapshot generator, plus #79 (`veto_trade` fails closed). None of those diffs were audited in this session; the entries below stand as written on 2026-09-25 and a reader should check each against `git log --grep '#77'` before acting.

Severity key: 🔴 reachable by an anonymous or wrong user, or destroys/corrupts data · 🟠 wrong result for a legitimate user, or silent data drift · 🟡 quality, no user-visible effect today.

Line numbers in `supabase/schema-snapshot/functions.sql` refer to the file as committed; where a later migration supersedes a body, the migration is cited instead.

---

## Area 1 — Database layer

### A1-01
- **Severity:** 🔴
- **Where:** `supabase/schema-snapshot/policies.sql:31`; app-side check at `src/app/dashboard/actions.ts:135-153`
- **Code:**
  ```sql
  CREATE POLICY "users can join a league as themselves" ON public.league_members FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
  ```
  ```ts
  const { data: league, error: leagueError } = await supabase
    .from("uff_leagues")
    .select("id, max_teams")
    .eq("join_code", joinCode)
    .maybeSingle();
  ...
  if (memberCount >= league.max_teams) {
  ```
- **Why it is wrong:** The only database rule for inserting a membership is "user_id is me". Join code, league capacity, and league status (forming / drafting / active) are checked in the server action only. Any signed-in account can POST a `league_members` row for any league id straight to PostgREST, with any `team_name`, `is_commissioner`, `faction`, `wins`, `faab_balance` (the column grant that restricts UPDATE does not apply to INSERT). League ids are readable by every signed-in user (`leagues are viewable by authenticated users`, `policies.sql:109`), and so is `join_code` (it is a column of `uff_leagues`; `settings/actions.ts:480` selects it with the user client).
- **How a human proves it:** `SELECT policyname, cmd, with_check FROM pg_policies WHERE tablename = 'league_members';` and `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.league_members'::regclass AND NOT tgisinternal;` — expect no INSERT trigger that checks join_code/status/capacity.
- **Confidence:** likely (policy proven from code; a live-only trigger could exist, git holds none).
- **Fix shape:** Move joining into a SECURITY DEFINER `join_league(p_join_code, p_team_name, p_faction)` RPC that locks the league row and checks code, status and capacity, then drop the INSERT policy.

### A1-02
- **Severity:** 🔴
- **Where:** `supabase/schema-snapshot/policies.sql:41-48`; engine read at `supabase/functions/score-matchups/index.ts:344`
- **Code:**
  ```sql
  CREATE POLICY "league members can insert player powers" ON public.player_draft_powers FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
     FROM league_members
    WHERE ((league_members.league_id = player_draft_powers.league_id) AND (league_members.user_id = auth.uid())))));
  CREATE POLICY "league members can update player powers" ON public.player_draft_powers FOR UPDATE TO public USING ((EXISTS ( SELECT 1
     FROM league_members
    WHERE ((league_members.league_id = player_draft_powers.league_id) AND (league_members.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
  ```
- **Why it is wrong:** Both policies test league membership, not row ownership (`drafted_by_user_id`). Any member can UPDATE an opponent's row to `power = 'power_negation'` (the engine halves that player's score), set `'shadow_guard'` on their own players, or reassign `drafted_by_user_id`, and can INSERT a power row for any undrafted-power player in the league. The scoring engine reads this table every 15 minutes.
- **How a human proves it:** `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'player_draft_powers';`
- **Confidence:** proven from code.
- **Fix shape:** Scope USING/WITH CHECK to `drafted_by_user_id = auth.uid()` (or drop both and let only the SECURITY DEFINER draft RPCs write the table).

### A1-03
- **Severity:** 🔴
- **Where:** `supabase/schema-snapshot/functions.sql:1054-1058` (`finalize_week`), `:2555-2559` (`start_draft`), `:1573` (`make_draft_pick`), `:2918` (`commissioner_draft_pick`), `:2201` (`reset_waiver_priority`)
- **Code:**
  ```sql
    IF auth.uid() IS NOT NULL THEN
      IF auth.uid() != v_commissioner_id THEN
        RAISE EXCEPTION 'Only the commissioner can finalize a week';
      END IF;
    ELSIF v_commissioner_id != p_user_id THEN
  ```
  ```sql
    IF auth.uid() IS NOT NULL AND auth.uid() != v_commissioner_id THEN
      RAISE EXCEPTION 'Only the commissioner can draft for another manager';
    END IF;
  ```
- **Why it is wrong:** Same class as the 2026-09-15 lock-down (`20260915130000_lock_down_anon_admin_functions.sql:4-9` proved `anon`'s `auth.uid()` is NULL and walks past this guard) and PR #1, but these five functions are in neither list and in git carry no REVOKE. Supabase grants EXECUTE to PUBLIC by default. With the anon key: `commissioner_draft_pick` needs no id at all (the guard is skipped entirely) — anyone can make the on-the-clock pick in any in-progress draft; `finalize_week` / `start_draft` need only the commissioner's uuid, which any signed-in account can read from `uff_leagues`; `make_draft_pick` accepts any `p_user_id`; `reset_waiver_priority` reorders a league's waiver order.
- **How a human proves it:** `SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname IN ('finalize_week','start_draft','make_draft_pick','commissioner_draft_pick','reset_waiver_priority');`
- **Confidence:** needs the database (guard logic proven; grant state unknown — the 09-24 migration noted defaults were PUBLIC for three other functions).
- **Fix shape:** `REVOKE EXECUTE ... FROM PUBLIC, anon` on all five and re-grant to `authenticated` + `service_role`; in `commissioner_draft_pick` require `auth.uid() IS NOT NULL`.

### A1-04
- **Severity:** 🔴
- **Where:** `supabase/schema-snapshot/functions.sql:2129-2131`
- **Code:**
  ```sql
    IF v_commissioner_id != p_user_id THEN
      RAISE EXCEPTION 'Only the commissioner can randomize factions';
    END IF;
  ```
- **Why it is wrong:** `randomize_unassigned_factions` is SECURITY DEFINER and never references `auth.uid()`; the "commissioner" is whoever the caller says. Any signed-in user can pass the commissioner's uuid and randomize factions in any league whose draft has not started. It is the eighth instance of the class PR #1 fixes and is not in that PR.
- **How a human proves it:** code alone proves the guard; `SELECT has_function_privilege('authenticated','public.randomize_unassigned_factions(uuid,uuid)','EXECUTE');` proves reachability.
- **Confidence:** proven from code.
- **Fix shape:** Compare against `auth.uid()` (and revoke from anon), the same shape as PR #1.

### A1-05
- **Severity:** 🔴
- **Where:** `supabase/schema-snapshot/functions.sql:2455-2525` (`set_lineup`); app-only lock at `src/app/dashboard/league/[id]/lineup-actions.ts:29-55`
- **Code:**
  ```sql
    -- Atomic replace
    DELETE FROM public.uff_lineups
    WHERE member_id = v_member_id AND week = p_week::smallint;

    INSERT INTO public.uff_lineups (league_id, member_id, player_id, week, slot)
    SELECT p_league_id, v_member_id, (r->>'player_id'), p_week::smallint, (r->>'slot')
    FROM jsonb_array_elements(p_slots) AS r;
  ```
  ```ts
  // Per-player game-time lock
  const playerIds = Object.values(newAssignments);
  const now = new Date();
  ```
- **Why it is wrong:** The RPC validates roster membership and position only. It has no kickoff lock and no `is_complete` guard, so a member calling it directly (it is EXECUTE-able by `authenticated`; the 2026-09-24 migration confirms `anon` cannot) can bench a starter after his game went badly and start a bench player whose game has not kicked off, or rewrite a finalized week's lineup (which `matchup-breakdown` and Story Engine feats read). The lock exists only in the server action.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Inside `set_lineup`, reject any slot whose occupant changes when that player's team has a `uff_game_schedule.kickoff_utc <= now()` for that week (honouring Quick Feet once), and reject any week whose `uff_matchups.is_complete` is true.

### A1-06
- **Severity:** 🟠
- **Where:** `supabase/schema-snapshot/functions.sql:89` (signature), `:132`, `:143` (`add_player`); `:5`, `:60`, `:71` (`add_and_drop_player`)
- **Code:**
  ```sql
  CREATE OR REPLACE FUNCTION public.add_player(p_league_id uuid, p_user_id uuid, p_player_id text, p_week smallint DEFAULT NULL::smallint)
  ```
  ```sql
    IF p_week IS NOT NULL AND v_max_adds_week > 0 THEN
  ```
  ```sql
      FROM uff_roster_players WHERE member_id = v_member_id AND week_added IS NOT NULL AND week_added > 0;
  ```
- **Why it is wrong:** The weekly acquisition limit is only enforced when the caller supplies `p_week`, and the season limit counts only rows with `week_added > 0`. Calling the RPC without `p_week` (it defaults to NULL) skips the weekly cap and inserts a row that the season cap will never count. The server action always passes the week, but the RPC is the enforcement layer.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Compute the week inside the function (or `RAISE` when `p_week IS NULL`) and count season adds by `added_at` within the season instead of `week_added`.

### A1-07
- **Severity:** 🟠
- **Where:** `supabase/schema-snapshot/policies.sql:156-158`; engine read at `supabase/functions/score-matchups/index.ts:347`
- **Code:**
  ```sql
  CREATE POLICY "league members can insert vampire bites" ON public.vampire_bites FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
     FROM league_members
    WHERE ((league_members.league_id = vampire_bites.league_id) AND (league_members.user_id = auth.uid())))));
  ```
- **Why it is wrong:** The policy checks only that the inserter is in the league. `biting_member_id`, `target_player_id` and `round` are free: a member can record a bite without holding Vampire Bite, on behalf of any member, on a Shadow-Guarded or own player, or a second bite. All the real checks live in the draft server action (`draft/actions.ts:257`, `:404` insert with the user client), which this policy makes bypassable. The engine siphons 10% per bite row.
- **How a human proves it:** `SELECT policyname, cmd, with_check FROM pg_policies WHERE tablename='vampire_bites';` plus `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.vampire_bites'::regclass;` (to see what uniqueness exists).
- **Confidence:** proven from code.
- **Fix shape:** Drop the INSERT policy and route both bite paths through one SECURITY DEFINER RPC (`commissioner_vampire_bite` already has the checks; add a self-service twin).

### A1-08
- **Severity:** 🟠
- **Where:** `supabase/schema-snapshot/policies.sql:11-18`
- **Code:**
  ```sql
  CREATE POLICY "members insert own draft_power_assignments" ON public.draft_power_assignments FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
     FROM league_members lm
    WHERE ((lm.id = draft_power_assignments.member_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))));
  CREATE POLICY "members update own draft_power_assignments" ON public.draft_power_assignments FOR UPDATE TO public USING ((EXISTS ( SELECT 1
  ```
- **Why it is wrong:** A member may rewrite the `round` (and `power_id`) of their own dealt powers at any time, which is exactly what `swap_foresight_powers` exists to control. `start_draft` deals powers as the function owner, so no client path needs these policies.
- **How a human proves it:** `SELECT policyname, cmd FROM pg_policies WHERE tablename='draft_power_assignments';`
- **Confidence:** proven from code.
- **Fix shape:** Drop both member write policies.

### A1-09
- **Severity:** 🟠
- **Where:** `supabase/schema-snapshot/policies.sql:168-172`; app writes at `src/app/dashboard/league/[id]/actions.ts:192-198` and `lineup-actions.ts:160-165`
- **Code:**
  ```sql
  CREATE POLICY "members update own weekly_token_assignments" ON public.weekly_token_assignments FOR UPDATE TO public USING ((EXISTS ( SELECT 1
     FROM league_members lm
    WHERE ((lm.id = weekly_token_assignments.member_id) AND (lm.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
  ```
  ```ts
    .from("weekly_token_assignments")
    .update({ choice })
  ```
- **Why it is wrong:** The app legitimately writes `choice` and (for Quick Feet) `status`; but nothing in git restricts the columns, so a member can also set `token_id` (pick Insurance every week), move `week`, or flip `status` back to `pending` after use. The 2026-08-25 hardening did exactly this column-grant fix for `league_members` and did not touch this table.
- **How a human proves it:** `SELECT privilege_type, column_name FROM information_schema.column_privileges WHERE table_name='weekly_token_assignments' AND grantee='authenticated';` — if UPDATE is table-wide (or `information_schema.role_table_grants` shows UPDATE), the finding holds.
- **Confidence:** needs the database.
- **Fix shape:** `REVOKE UPDATE ON weekly_token_assignments FROM authenticated; GRANT UPDATE (choice) ...;` and move the Quick Feet status flip into `set_lineup`.

### A1-10
- **Severity:** 🟠
- **Where:** `supabase/schema-snapshot/policies.sql:55-57`; app path `src/app/dashboard/league/[id]/player-actions.ts:141-172`
- **Code:**
  ```sql
  CREATE POLICY "chip owner can use their chip" ON public.power_restore_chips FOR UPDATE TO public USING ((EXISTS ( SELECT 1
     FROM league_members lm
    WHERE ((lm.id = power_restore_chips.member_id) AND (lm.user_id = auth.uid())))));
  ```
  ```ts
    // Mark chip as used
    await supabase
      .from("power_restore_chips")
      .update({ used: true, used_at: new Date().toISOString(), used_on_player_id: playerId })
      .eq("id", chipId);
  ```
- **Why it is wrong:** The owner may UPDATE any column, so `used` can be set back to `false` and the chip spent again. The action itself is read-then-write with no `used = false` predicate on the final update, so two concurrent submits restore two players with one chip; and the `player_draft_powers` update is not scoped to the caller's own player, so a chip is consumed (`used: true`) even when zero rows matched.
- **How a human proves it:** `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename='power_restore_chips';`
- **Confidence:** proven from code.
- **Fix shape:** One SECURITY DEFINER `use_restore_chip(p_chip_id, p_player_id)` that does `UPDATE ... SET used=true WHERE id=$1 AND used=false AND member owns it RETURNING`, then the restore, in one transaction; drop the UPDATE policy.

### A1-11
- **Severity:** 🟠
- **Where:** `supabase/schema-snapshot/policies.sql:141-143`
- **Code:**
  ```sql
  CREATE POLICY "proposer can create trade" ON public.uff_trades FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
     FROM league_members lm
    WHERE ((lm.id = uff_trades.proposer_id) AND (lm.user_id = auth.uid())))));
  ```
- **Why it is wrong:** `propose_trade` (`functions.sql:2041-2099`) is SECURITY DEFINER and validates same-league receiver, non-empty sides and ownership — none of which a direct INSERT under this policy enforces. `league_id`, `receiver_id`, `status` and both player arrays are free, so a bogus offer can be planted in another league's inbox; if that receiver accepts, `respond_to_trade` re-validates ownership but not league, and moves `uff_roster_players.member_id` across leagues.
- **How a human proves it:** `SELECT policyname, cmd, with_check FROM pg_policies WHERE tablename='uff_trades';`
- **Confidence:** proven from code (policy); cross-league execution is likely (needs a cooperating receiver).
- **Fix shape:** Drop the INSERT policy; `propose_trade` inserts as the function owner.

### A1-12
- **Severity:** 🟠
- **Where:** `supabase/schema-snapshot/policies.sql:104-106`
- **Code:**
  ```sql
  CREATE POLICY "members make own draft picks" ON public.uff_draft_picks FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
     FROM league_members lm
    WHERE ((lm.id = uff_draft_picks.member_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))));
  ```
- **Why it is wrong:** Every pick path (`make_draft_pick`, `force_autopick`, `commissioner_draft_pick`) is SECURITY DEFINER, so no client needs to insert here. With the policy, a member can insert a pick row with any `pick_no`/`player_id` mid-draft; the RPCs derive the on-the-clock member from `COUNT(*)` of this table (`20260902180000:83-92`), so one forged row shifts every subsequent turn. Affects future drafts, not the completed one.
- **How a human proves it:** `SELECT policyname, cmd FROM pg_policies WHERE tablename='uff_draft_picks';`
- **Confidence:** proven from code.
- **Fix shape:** Drop the policy.

### A1-13
- **Severity:** 🟠
- **Where:** `supabase/schema-snapshot/functions.sql:2719-2721`, `:2733-2735`; same in `commissioner_foresight_swap` (`20260902240000_commissioner_interactive_powers.sql:105-113`)
- **Code:**
  ```sql
    IF p_swap_round <= p_current_round OR p_swap_round > 16 THEN
      RAISE EXCEPTION 'Foresight Coin can only swap with a future round';
    END IF;
  ```
  ```sql
    IF v_curr.power_id != 1 THEN
      RAISE EXCEPTION 'You do not hold Foresight Coin this round';
    END IF;
  ```
- **Why it is wrong:** `p_current_round` is caller-supplied and never compared to the draft's real round, and there is no `draft_status = 'in_progress'` check. A member holding Foresight in round 7 can call `(7, 9)` during round 2, then `(9, 12)`, then `(12, 16)` — Foresight travels forward and every future power is re-ordered at will, before the draft reaches any of them. The 16 is also hard-coded rather than `draft_rounds`.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Derive the current round from the pick count, require `in_progress`, require the caller's pick for that round to be the one just made, and bound by `draft_rounds`.

### A1-14
- **Severity:** 🟠
- **Where:** `supabase/schema-snapshot/functions.sql:2247-2260` (`respond_to_trade`), `:339-346` (`approve_trade`); checks that exist only app-side at `src/app/dashboard/league/[id]/trade-actions.ts:207-257`
- **Code:**
  ```sql
    SELECT * INTO v_trade FROM uff_trades WHERE id = p_trade_id FOR UPDATE;
    IF v_trade.id IS NULL THEN RAISE EXCEPTION 'Trade not found'; END IF;
    IF v_trade.status != 'pending' THEN RAISE EXCEPTION 'Trade is no longer pending'; END IF;
  ```
  ```ts
    // Uneven trades (2-for-1 etc.) must leave BOTH rosters legal: no more than
    // the roster cap (draft_rounds) and no fewer than the starter count.
  ```
- **Why it is wrong:** Trade deadline, post-trade roster cap/minimum, and IR-slot handling are enforced in the server action only. The receiver can call `respond_to_trade(id, true)` directly after the deadline or into an over-cap roster. The RPCs also move rows regardless of `slot`, so an IR player arrives in the receiver's IR slot with no `ir_spots` check.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Move the deadline and roster-size checks from `trade-actions.ts` into `respond_to_trade`/`approve_trade`.

### A1-15
- **Severity:** 🟠
- **Where:** `supabase/migrations/20260825150000_harden_league_members_rls.sql:61-62`; app-only rule at `src/app/dashboard/league/[id]/actions.ts:69-71`
- **Code:**
  ```sql
  REVOKE UPDATE ON public.league_members FROM anon, authenticated;
  GRANT UPDATE (faction) ON public.league_members TO authenticated;
  ```
  ```ts
    if (league.draft_status !== "not_started") {
      redirect(`/dashboard/league/${leagueId}?error=` + encodeURIComponent("Factions are locked once the draft starts."));
    }
  ```
- **Why it is wrong:** "Factions are locked once the draft starts" is a server-action rule; the column grant lets a member PATCH `faction` on their own row at any time. The faction feeds the per-run roster bonus (`calculate_faction_roster_bonus`, `functions.sql:526-541`) and the faction-war token award in both finalize paths, so a mid-season switch to the winning side changes scoring and token awards. `check_faction_balance` only enforces capacity.
- **How a human proves it:** `SELECT column_name FROM information_schema.column_privileges WHERE table_name='league_members' AND grantee='authenticated' AND privilege_type='UPDATE';` plus the trigger list on `league_members`.
- **Confidence:** proven from code (grant); the trigger list confirms no other DB-side lock.
- **Fix shape:** A BEFORE UPDATE trigger on `league_members` that raises when `NEW.faction IS DISTINCT FROM OLD.faction` and the league's `draft_status <> 'not_started'` (or move the write into an RPC).

### A1-16
- **Severity:** 🟡
- **Where:** `supabase/schema-snapshot/functions.sql:175-179` (`advance_playoff_bracket`), `:2189-2193` (`reset_waiver_priority`), `:2316-2320` (`seed_playoffs`)
- **Code:**
  ```sql
  CREATE OR REPLACE FUNCTION public.advance_playoff_bracket(p_league_id uuid, p_week smallint)
   RETURNS void
   LANGUAGE plpgsql
   SECURITY DEFINER
  AS $function$
  ```
- **Why it is wrong:** Three SECURITY DEFINER functions have no `SET search_path`; every other function in the file has `SET search_path TO 'public'`. Search-path hijack needs CREATE on a schema earlier in the path, which Supabase restricts, so it is quality today.
- **How a human proves it:** `SELECT proname, proconfig FROM pg_proc WHERE proname IN ('advance_playoff_bracket','reset_waiver_priority','seed_playoffs');` — `proconfig` NULL confirms.
- **Confidence:** proven from code (snapshot); needs the database only if the live body differs.
- **Fix shape:** `ALTER FUNCTION ... SET search_path = public;` for each.

### A1-17
- **Severity:** 🟡
- **Where:** `supabase/schema-snapshot/functions.sql:170`, `:898`, `:1149`, `:1403`, `:2977`; `src/app/api/cron/generate-newsletter/route.ts:313`; `src/app/api/cron/sync-projections/route.ts:97`
- **Code:**
  ```sql
    ON CONFLICT (league_id, player_id) DO NOTHING;
  ```
  ```sql
            ON CONFLICT (member_id, earned_week) DO NOTHING;
  ```
  ```ts
        .upsert(upserts.slice(i, i + 500), { onConflict: "player_id,season,week" });
  ```
- **Why it is wrong:** None of these conflict targets (`uff_cant_cut_list(league_id,player_id)`, `power_restore_chips(member_id,earned_week)`, `player_draft_powers(league_id,player_id)`, `league_newsletters(league_id,week)`, `player_projections(player_id,season,week)`) has a unique index anywhere in git. The 2026-09-15 finalize outage (`20260915100000`) was precisely a missing `ON CONFLICT` target. More broadly, **no table, index, constraint or trigger definition for the core schema exists in the repo** — only functions and policies — so git cannot answer this question.
- **How a human proves it:** `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('uff_cant_cut_list','power_restore_chips','player_draft_powers','league_newsletters','player_projections');`
- **Confidence:** needs the database (live runs suggest the chip and power indexes exist; the others are unverified).
- **Fix shape:** Commit a `supabase db dump --schema public` output (tables, indexes, constraints, triggers) next to the two snapshots and refresh it with each migration.

### A1-18
- **Severity:** 🟡
- **Where:** `supabase/schema-snapshot/policies.sql:3`; `supabase/schema-snapshot/functions.sql:1723-1775`, `:2470-2472`
- **Code:**
  ```sql
  -- 67 policies (65 @ 2026-08-17 + 2 push-subscription policies @ 2026-08-24).
  ```
  ```sql
  CREATE OR REPLACE FUNCTION public.set_lineup(p_league_id uuid, p_user_id uuid, p_week integer, p_slots jsonb)
  ...
    SELECT id INTO v_member_id
    FROM public.league_members
    WHERE league_id = p_league_id AND user_id = p_user_id;
  ```
- **Why it is wrong:** The snapshots are billed as the disaster-recovery source of truth but lag the migrations: `policies.sql` lacks the seven policies created by `20260825140000` (uff_characters) and `20260826120000/140000` (six story tables), and does not show the live `ALL` policy on `uff_push_subscriptions` the brief mentions; `functions.sql` still holds the pre-2026-09-24 `move_to_ir` (no lineup delete) and the six RPCs without the `You can only act for your own team` guard, and omits `clear_lineup_on_roster_exit`. Restoring from these files would silently re-open the 09-24 hijack.
- **How a human proves it:** `SELECT count(*) FROM pg_policies WHERE schemaname='public';` (expect > 67) and `SELECT pg_get_functiondef('public.set_lineup'::regproc) ILIKE '%auth.uid()%';` (expect true).
- **Confidence:** proven from code.
- **Fix shape:** Regenerate both snapshots from the live DB after every migration (a script that runs `pg_get_functiondef` / `pg_policies` and diffs).

### A1-19
- **Severity:** 🟡
- **Where:** `supabase/schema-snapshot/policies.sql:37-40`, `:66-67`
- **Code:**
  ```sql
  CREATE POLICY "public read leagues" ON public.leagues FOR SELECT TO public USING (true);
  CREATE POLICY "public read matchups" ON public.matchups FOR SELECT TO public USING (true);
  ...
  CREATE POLICY "public read rosters" ON public.rosters FOR SELECT TO public USING (true);
  CREATE POLICY "public read sleeper_users" ON public.sleeper_users FOR SELECT TO public USING (true);
  ```
- **Why it is wrong:** Five legacy tables (`leagues`, `matchups`, `rosters`, `oracle_recaps`, `sleeper_users`) are readable with the anon key and are referenced by no code under `src/` or `supabase/functions/`. If they hold anything, it leaks anonymously; if empty, they are attack surface for nothing.
- **How a human proves it:** `SELECT 'leagues', count(*) FROM public.leagues UNION ALL SELECT 'matchups', count(*) FROM public.matchups UNION ALL SELECT 'rosters', count(*) FROM public.rosters UNION ALL SELECT 'oracle_recaps', count(*) FROM public.oracle_recaps UNION ALL SELECT 'sleeper_users', count(*) FROM public.sleeper_users;`
- **Confidence:** needs the database.
- **Fix shape:** Drop the tables if unused (same shape as `20260922210000_drop_leftover_test_tables.sql`).

### A1-20
- **Severity:** 🟡
- **Where:** `supabase/schema-snapshot/functions.sql:607`, `:2137`; DB range at `supabase/migrations/20260825140000_character_lore_layer.sql:45-46`; app rule at `src/app/dashboard/actions.ts:40`
- **Code:**
  ```sql
    v_capacity := v_max_teams / 2;
  ```
  ```sql
  ALTER TABLE public.uff_leagues ADD CONSTRAINT uff_leagues_max_teams_range
    CHECK (max_teams BETWEEN 2 AND 16);
  ```
- **Why it is wrong:** Integer division makes a 15-team league hold 7 + 7 factions; the fifteenth member can never choose a side and `start_draft` refuses until all have one. The app rejects odd sizes at creation, but the DB CHECK accepts them and the commissioner UPDATE policy can set any value.
- **How a human proves it:** `SELECT id, max_teams FROM uff_leagues WHERE max_teams % 2 = 1;`
- **Confidence:** proven from code (no user affected unless an odd league exists).
- **Fix shape:** Tighten the CHECK to even values, or use `ceil(max_teams / 2.0)`.

### A1-21
- **Severity:** 🟡
- **Where:** `supabase/migrations/20260924150000_move_to_ir_clears_lineup.sql:86-90`; `20260924190000_lineup_follows_the_roster.sql:57-61`
- **Code:**
  ```sql
         AND EXISTS (SELECT 1 FROM uff_matchups m
                      WHERE m.league_id = p_league_id
                        AND m.member_id = v_member_id
                        AND m.week = ln.week
                        AND m.is_complete = false)
  ```
- **Why it is wrong:** The lineup-clearing delete requires a matchup row for that member and week. A week where the member has no row (bye in an odd-team schedule, a playoff week before the bracket is seeded, or a future week beyond `season_weeks`) keeps the stale `uff_lineups` row the migration set out to remove.
- **How a human proves it:** `SELECT l.member_id, l.week, l.player_id FROM uff_lineups l LEFT JOIN uff_matchups m ON m.member_id=l.member_id AND m.week=l.week WHERE m.id IS NULL;` — any rows are unreachable by the guard.
- **Confidence:** proven from code.
- **Fix shape:** Use `NOT EXISTS (... is_complete = true)` instead of `EXISTS (... is_complete = false)`.

### A1-22
- **Severity:** 🟡
- **Where:** `supabase/schema-snapshot/policies.sql:114-116` (`uff_matchups`), `:98-102` (`uff_draft_picks`), `:126-130` (`uff_roster_players`), `:120-122` (`uff_playoff_bracket`), `:6-10` (`draft_power_assignments`), `:69-75` (`team_active_powers`)
- **Code:**
  ```sql
  CREATE POLICY "commissioner manage matchups" ON public.uff_matchups FOR ALL TO public USING ((EXISTS ( SELECT 1
     FROM uff_leagues ul
    WHERE ((ul.id = uff_matchups.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))));
  ```
- **Why it is wrong:** Six commissioner `FOR ALL` policies give direct row-level write on game state that the app only ever writes through RPCs or the admin client. On `uff_matchups` in particular, a direct `points` write bypasses the `score_adjustment` persistence that `adjustScore` maintains (`matchups/actions.ts:94-104`), so the next scoring run erases it. Not exploitable beyond the commissioner's own league; listed because the brief asks for `FOR ALL` where less would do.
- **How a human proves it:** `SELECT tablename, policyname FROM pg_policies WHERE cmd='ALL' AND schemaname='public';`
- **Confidence:** proven from code.
- **Fix shape:** Replace with SELECT/DELETE (or nothing) where the app has an RPC path; keep only what a page actually writes with the user client.

---

## Area 2 — Server actions

### A2-01
- **Severity:** 🟠
- **Where:** `src/app/dashboard/actions.ts:145-153`, `:167-177`
- **Code:**
  ```ts
    const { data: members } = await supabase
      .from("league_members")
      .select("id, faction")
      .eq("league_id", league.id);

    const memberCount = members?.length ?? 0;
    if (memberCount >= league.max_teams) {
  ```
- **Why it is wrong:** `joinLeague` counts, then inserts, with no lock and no DB uniqueness on capacity, so two concurrent joins to the last seat both succeed; and it never checks `draft_status`/`status`, so a join code shared after the draft adds a rosterless fifteenth team to an active league (the schedule, finalize and faction math all assume the drafted set). The DB does not back any of these rules (A1-01).
- **How a human proves it:** `SELECT l.id, l.max_teams, count(m.*) FROM uff_leagues l JOIN league_members m ON m.league_id=l.id GROUP BY 1,2 HAVING count(m.*) > l.max_teams;` and `SELECT * FROM league_members m JOIN uff_leagues l ON l.id=m.league_id WHERE l.draft_status<>'not_started' AND m.joined_at > l.draft_started_at;`
- **Confidence:** proven from code.
- **Fix shape:** The `join_league` RPC from A1-01 with `SELECT ... FOR UPDATE` on the league and a `draft_status = 'not_started'` check.

### A2-02
- **Severity:** 🟠
- **Where:** `src/app/dashboard/league/[id]/player-actions.ts:195-200`; policies at `supabase/schema-snapshot/policies.sql:126-137`
- **Code:**
  ```ts
    await supabase
      .from("uff_roster_players")
      .update({ on_trade_block: block })
      .eq("member_id", member.id)
      .eq("player_id", playerId)
      .is("dropped_at", null);
  ```
- **Why it is wrong:** `toggleTradeBlock` writes with the user-scoped client, but the only write policy on `uff_roster_players` in git is the commissioner `FOR ALL`. Under RLS an UPDATE that matches no permitted rows succeeds with zero rows, the result is not checked, and the action redirects to `?block=added`. For every non-commissioner the Trade Block toggle would be a silent no-op.
- **How a human proves it:** `SELECT policyname, cmd FROM pg_policies WHERE tablename='uff_roster_players' AND cmd IN ('UPDATE','ALL');` — if only the commissioner policy exists, the finding holds. (A live-only member UPDATE policy would clear it, and would itself be A1-22 material.)
- **Confidence:** needs the database.
- **Fix shape:** A tiny SECURITY DEFINER `set_trade_block(p_league_id, p_player_id, p_block)` scoped to the caller's own roster row, and check `count` on the result.

### A2-03
- **Severity:** 🟠
- **Where:** `src/lib/email.ts:313`; no route at `src/app/join` (absent), no redirect in `next.config.ts`
- **Code:**
  ```ts
      <a href="https://uff-platform.vercel.app/join?code=${encodeURIComponent(joinCode)}"
  ```
- **Why it is wrong:** The primary button of every league invite email points at `/join`, which does not exist in the app router and has no rewrite; invitees get a 404. The code is also printed in the email body, so it is recoverable, but the call to action is dead.
- **How a human proves it:** code alone proves it (`ls src/app/join` fails; `next.config.ts` has no `redirects`).
- **Fix shape:** Link to `/login?mode=signup&code=…` (or add a `/join` page) and read the code on the dashboard join form.

### A2-04
- **Severity:** 🟠
- **Where:** `src/app/dashboard/league/[id]/player-actions.ts:141-172` (see A1-10 for the policy half)
- **Code:**
  ```ts
    const { data: chip } = await supabase
      .from("power_restore_chips")
      .select("id, used")
      .eq("id", chipId)
      .eq("member_id", member.id)
      .maybeSingle();
    ...
    if (chip.used) {
  ```
- **Why it is wrong:** Read-then-write with no conditional predicate on the final `used: true` update (the draft-room pathology in a different room: state read before the write, then written back). Two submits in flight both pass `chip.used === false`. The `player_draft_powers` restore is filtered by league/player/power only, not by the caller's ownership, and the chip is marked used even when that update matched zero rows.
- **How a human proves it:** `SELECT member_id, count(*) FROM power_restore_chips WHERE used GROUP BY 1 HAVING count(*) > (SELECT count(*) FROM power_restore_chips c2 WHERE c2.member_id = power_restore_chips.member_id);` is not expressible simply — instead compare `used_on_player_id` against `player_draft_powers.restored_at IS NOT NULL` rows: a chip with `used=true` whose player has no `restored_at` was burned for nothing.
- **Confidence:** proven from code.
- **Fix shape:** Same RPC as A1-10.

### A2-05
- **Severity:** 🟡
- **Where:** `src/app/dashboard/league/[id]/lineup-actions.ts:37`; also `src/app/api/cron/score-matchups/route.ts:4`, `src/app/api/cron/sync-projections/route.ts:22`, `src/lib/nfl-utils.ts:7`
- **Code:**
  ```ts
        .eq("season", 2026)
  ```
  ```ts
  const SEASON = 2026;
  ```
- **Why it is wrong:** The season is hard-coded in four places. When one is updated next off-season and another is not, `setLineup` finds no schedule rows and the per-player lock silently disables (`isLocked` returns false for every player), while scoring still runs.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Export a single `SEASON` from `nfl-utils.ts` and import it everywhere.

### A2-06
- **Severity:** 🟡
- **Where:** `src/app/dashboard/league/[id]/lineup-actions.ts:159-165`
- **Code:**
  ```ts
    // Quick Feet is spent only now that the lineup actually saved.
    if (quickFeetConsumed && quickFeetRowId) {
      await supabase
        .from("weekly_token_assignments")
        .update({ status: "used", used_at: new Date().toISOString() })
        .eq("id", quickFeetRowId);
    }
  ```
- **Why it is wrong:** The locked swap and the token spend are two statements with no transaction; if the second fails (or the response is dropped), the swap stands and the token remains `pending` for another use. It also depends on the loose UPDATE policy in A1-09.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Pass a `p_quick_feet` flag into `set_lineup` and spend the token inside the same transaction.

### A2-07
- **Severity:** 🟡
- **Where:** `src/app/dashboard/league/[id]/settings/actions.ts:372-390`
- **Code:**
  ```ts
    const { error } = await supabase
      .from("uff_leagues")
      .update({ draft_order: order })
      .eq("id", leagueId);
  ```
- **Why it is wrong:** `saveDraftOrder` accepts any array of strings; nothing checks that it is a permutation of the league's member ids. `force_autopick` and `commissioner_draft_pick` index into this array and raise `No member on the clock` on a bad entry. It also never calls `revalidatePath`, so the settings page shows the old order until a hard reload.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Validate the array against `league_members` ids (same permutation check `update_draft_heist_order` does) and revalidate.

### A2-08
- **Severity:** 🟡
- **Where:** `src/app/dashboard/league/[id]/trade-actions.ts:193-194`, `:315`
- **Code:**
  ```ts
    revalidatePath(`/dashboard/league/${leagueId}/roster`);
    redirect(`/dashboard/league/${leagueId}/roster?trade=proposed`);
  ```
- **Why it is wrong:** `proposeTrade`, `respondToTrade` and `cancelTrade` revalidate only `/roster`. The trade inbox, sent history and the nav badge (pending-count computed in `layout.tsx`) live under `/trade` and the league layout; they stay stale until another navigation revalidates them.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Also `revalidatePath` `/trade` and the league root (layout) in each trade action.

### A2-09
- **Severity:** 🟡
- **Where:** `src/app/dashboard/league/[id]/settings/actions.ts:122-124`, `:143-162`
- **Code:**
  ```ts
    const playoffTeams       = parseInt(formData.get("playoff_teams") as string, 10);
    const playoffStartWeek   = parseInt(formData.get("playoff_start_week") as string, 10);
    const championshipWeek   = parseInt(formData.get("championship_week") as string, 10);
  ```
- **Why it is wrong:** `saveLeagueSettings` writes these unvalidated. `advance_playoff_bracket` handles only 4/6/8 teams (`functions.sql:244-258`); a 5 or NaN reaches the DB, and `championship_week < playoff_start_week` is accepted. `saveDraftOrder` and this action rely on the commissioner UPDATE policy rather than a check in the action.
- **How a human proves it:** `SELECT id, playoff_teams, playoff_start_week, championship_week FROM uff_leagues WHERE playoff_teams NOT IN (4,6,8) OR championship_week < playoff_start_week;`
- **Confidence:** proven from code.
- **Fix shape:** Validate `playoff_teams ∈ {4,6,8}` and week ordering before the update.

---

## Area 3 — API routes and the push layer

### A3-01
- **Severity:** 🟠
- **Where:** `src/app/api/cron/story-engine/route.ts:20-23`; contrast `src/app/api/cron/finalize-week/route.ts:13-19`
- **Code:**
  ```ts
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  ```
  ```ts
    if (!process.env.CRON_SECRET) {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }
  ```
- **Why it is wrong:** The story-engine route fails **open** when `CRON_SECRET` is unset (a preview deployment without the secret, or a rotation gap), while every other cron fails closed — the exact bug the "audit M1" fix removed elsewhere. Open, it lets anyone recompute Legend state for any league with the service role.
- **How a human proves it:** code alone proves it; `CRON_SECRET` presence per Vercel environment (Preview included) decides exposure today.
- **Fix shape:** Copy the fail-closed check from `finalize-week/route.ts:13-19`.

### A3-02
- **Severity:** 🟠
- **Where:** `src/app/api/chat/route.ts:45-67`, `:75`, `:82`, `:87`
- **Code:**
  ```ts
        .from("uff_leagues")
        .select("name, current_week, waiver_type, median_scoring, commissioner_id")
  ...
        .select("id, team_name, faction, wins, losses, points_for, waiver_priority")
  ...
        .from("uff_matchups")
        .select("member_id, opponent_id, week, member_score, opponent_score, is_complete, median_win")
  ...
        .from("uff_transactions")
  ```
- **Why it is wrong:** `opponent_id`, `member_score`, `opponent_score`, `current_week`, `points_for` and the table `uff_transactions` appear nowhere else in `src/` or `supabase/` — every other route derives records from `matchup_id, member_id, points` via `getRecord`. If those columns do not exist, PostgREST returns an error, `data` is `null`, and the assistant answers from "No standings data yet." / "No completed matchups yet." while sounding authoritative.
- **How a human proves it:** `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='uff_matchups' AND column_name IN ('opponent_id','member_score','opponent_score')) OR (table_name='uff_leagues' AND column_name='current_week') OR (table_name='league_members' AND column_name='points_for')) UNION ALL SELECT 'uff_transactions', table_name FROM information_schema.tables WHERE table_name='uff_transactions';` — empty result confirms.
- **Confidence:** needs the database.
- **Fix shape:** Build the context from `uff_matchups(matchup_id, member_id, points, is_complete)` with `getRecord`, and from `uff_roster_players` for recent adds/drops, like `transactions/page.tsx` does.

### A3-03
- **Severity:** 🟡
- **Where:** `src/app/api/chat/route.ts:152-156`
- **Code:**
  ```ts
  • Draft Heist — During the draft, steal a player off another team's roster. The target team must pick a replacement.
  • Telepathy — During the draft, see your opponents' draft boards and queued picks in real time.
  • Cloak — During the draft, hide your own draft board and queue from all opponents.
  • Foresight Coin — During the draft, flip the coin to peek at upcoming available players before they appear in the draft pool.
  ```
- **Why it is wrong:** The rulebook the assistant is told is "exactly what it does" contradicts the engine and the guide: Heist swaps draft slots (and is disabled), Telepathy reveals the next picker's power, "Cloak" is now Shadow Guard (blocks Vampire Bite), Foresight swaps two of your own round powers. The assistant will state wrong rules with confidence.
- **How a human proves it:** code alone proves it (compare `src/app/guide/page.tsx:206-219` and `20260902240000`).
- **Fix shape:** Generate the rulebook block from `draft_powers.description` and `token-names.ts` at request time, or fix the text.

### A3-04
- **Severity:** 🟠
- **Where:** `src/lib/email.ts:18-49`; fan-out sites `src/app/api/cron/generate-newsletter/route.ts:333-346`, `src/app/api/cron/process-waivers/route.ts:150-192`, `src/app/dashboard/league/[id]/announcements/actions.ts:55-78`, `src/app/dashboard/league/[id]/settings/actions.ts:500-515`
- **Code:**
  ```ts
      if (!res.ok) {
        const text = await res.text();
        console.error("[email] Resend API error:", res.status, text);
      }
    } catch (err) {
      // Email failures must never crash the calling action
      console.error("[email] send failed:", err);
    }
  ```
  ```ts
        await sendEmail({ ... });
        sentCount++;
  ```
- **Why it is wrong:** `sendEmail` returns nothing, so no caller can tell a 429/4xx from success — invites report `invited=N` after Resend refused them. There is no daily budget anywhere: the newsletter alone sends one mail per member of every league in a single `Promise.all`, waiver results add one per bidder, announcements one per member, trades two per event, and the draft sent 197 in one night (deep-dive figure) against a 100/day free tier that also carries Supabase auth mail. Once the cap is hit, sign-up confirmations and password resets fail silently for the rest of the day.
- **How a human proves it:** Resend dashboard → Logs, filter by `429`/`4xx` on a newsletter Wednesday; code alone proves the silent path.
- **Fix shape:** Return `{ok, status}` from `sendEmail`, keep a per-day counter row (or use Resend's batch endpoint and a queue), and stop non-critical fan-out when the budget is nearly spent so auth mail keeps headroom.

### A3-05
- **Severity:** 🟠
- **Where:** `src/app/api/cron/finalize-week/route.ts:90-99`; RPC at `supabase/migrations/20260902200000_finalize_playoff_token_filter.sql:239-241`
- **Code:**
  ```ts
    const totalSkipped = perWeek.reduce((s, p) => s + p.skipped, 0);
    ...
    return NextResponse.json({
      ok: true,
      ...
      ...(totalSkipped > 0 ? { warning: `${totalSkipped} league-week(s) were skipped during finalize (errored) — investigate` } : {}),
  ```
  ```sql
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped + 1;
      END;
  ```
- **Why it is wrong:** A league whose finalize throws is counted and forgotten: the RPC discards `SQLERRM`, and the route answers HTTP 200 `ok: true` with a warning string, so the GitHub Actions run stays green. That league's week is never marked complete, tokens are never awarded, and (because the route re-runs weeks 1..N) the same silent failure repeats every Wednesday. The newsletter route already does this right (`207`/`500`, `generate-newsletter/route.ts:392-397`).
- **How a human proves it:** `SELECT league_id, week, count(*) FROM uff_matchups WHERE is_complete=false AND week < (SELECT max(week) FROM uff_matchups WHERE is_complete) GROUP BY 1,2;` — any row is a league-week the cron has been skipping.
- **Confidence:** proven from code.
- **Fix shape:** Have the RPC return `skipped_leagues: [{id, error: SQLERRM}]` and have the route return 207 when `totalSkipped > 0`.

### A3-06
- **Severity:** 🟡
- **Where:** `src/lib/rate-limit.ts:7`, `:23-42`
- **Code:**
  ```ts
  const store = new Map<string, { count: number; resetAt: number }>();
  ```
- **Why it is wrong:** The counter lives in module memory. On Vercel every concurrent lambda instance has its own map and every cold start resets it, so the per-minute ceilings on the ten AI routes and the push-save path are advisory: N warm instances allow N× the limit. The file says so; the brief asks that it be recorded.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Back the counter with a shared store (Upstash/Redis, or a small Postgres table with `INSERT ... ON CONFLICT ... RETURNING count`).

### A3-07
- **Severity:** 🟡
- **Where:** `src/app/api/matchup-breakdown/route.ts:31-47`
- **Code:**
  ```ts
      const { league_id, week, member_a_id, member_b_id } = await req.json();
  ...
      if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });
  ```
- **Why it is wrong:** It is the one authenticated route with no `checkRateLimit`, and each call fetches a full-week Sleeper stat feed and recomputes two rosters. Not an AI route, so "all 10 AI routes are limited" remains true; it is still the most expensive unlimited endpoint.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Add `checkRateLimit(\`${user.id}:matchup-breakdown\`, 10)` after the membership check.

### A3-08
- **Severity:** 🟡
- **Where:** `src/app/api/trending/route.ts:19-23`, `:37`
- **Code:**
  ```ts
    const hours = Math.min(parseInt(searchParams.get("hours") ?? "24", 10), 168);
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 50);
  ...
      const supabase = createAdminClient();
  ```
- **Why it is wrong:** Unauthenticated, no rate limit, and `parseInt("abc")` is `NaN`, which `Math.min` passes through into the Sleeper URL (`lookback_hours=NaN`) for a guaranteed upstream error and a 500. The service-role client is used for a table that is public-read (`players are publicly readable`, `policies.sql:53`).
- **How a human proves it:** code alone proves it.
- **Fix shape:** `Number.isFinite` fallbacks, the anon client, and a small IP-keyed limit.

### A3-09
- **Severity:** 🟡
- **Where:** `src/app/api/push/resubscribe/route.ts:48-57`; compare `src/app/dashboard/push-actions.ts:32`, `:59-61`
- **Code:**
  ```ts
    const { error } = await admin.from("uff_push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint: v.value.endpoint,
  ```
- **Why it is wrong:** The resubscribe route validates the endpoint (good) but has neither the 10/min rate limit nor the 10-devices-per-user prune that `savePushSubscription` enforces. A user can accumulate rows without bound through this path; `push.ts` then sends to the newest 25 of them per notification.
- **How a human proves it:** `SELECT user_id, count(*) FROM uff_push_subscriptions GROUP BY 1 ORDER BY 2 DESC LIMIT 5;`
- **Confidence:** proven from code.
- **Fix shape:** Extract the rate-limit + cap into `push-validate.ts` (or a shared `persistSubscription`) and call it from both.

### A3-10
- **Severity:** 🟡
- **Where:** `src/lib/push-validate.ts:18-23`, `:37`
- **Code:**
  ```ts
  const ALLOWED_HOST_SUFFIXES = [
    ".googleapis.com", // FCM (Chrome/Android): fcm.googleapis.com, android.googleapis.com
    ".mozilla.com", // Firefox: updates.push.services.mozilla.com
    ".windows.com", // Edge/WNS: *.notify.windows.com
    ".apple.com", // Safari/iOS 16.4+: web.push.apple.com
  ];
  ...
    return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  ```
- **Why it is wrong:** The allowlist is a suffix match, so a subscription row may hold any https URL on `*.googleapis.com`, `*.windows.com`, `*.apple.com`, `*.mozilla.com` (e.g. `storage.googleapis.com/<bucket>`), and `sendPushToUser` will POST an encrypted payload there on every notification. Internal/private targets are correctly closed (https, port 443, vendor-owned), so this is amplification against vendor hosts, bounded by the 10/25-row caps.
- **How a human proves it:** `SELECT endpoint FROM uff_push_subscriptions WHERE endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com)/';`
- **Confidence:** proven from code.
- **Fix shape:** Match exact hosts (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`) plus the documented path prefixes.

### A3-11
- **Severity:** 🟡
- **Where:** `src/lib/email.ts:111`, `:143`, `:167`, `:191`, `:222`, `:248`, `:286`, `:313`, `:319`
- **Code:**
  ```ts
    const url = `https://uff-platform.vercel.app/dashboard/league/${leagueId}/trade`;
  ```
- **Why it is wrong:** Every email deep link uses the Vercel hostname rather than `playuff.com`; it works because the alias exists, but the brand in the mail is the wrong domain and a future alias change breaks nine links at once.
- **How a human proves it:** code alone proves it.
- **Fix shape:** One `APP_URL` constant (env-driven) used by every template.

---

## Area 4 — Edge functions (second session, 2026-09-30)

Audited at `4b64a7a` (origin/main); neither file changed between `e99ee3d` and `4b64a7a`. Every use of the current clock was enumerated: `score-matchups/index.ts:567` (`nowMs`, the kickoff lock), `:603` (`now`, Time Stone timestamps), `sync-players/index.ts:60` (FFC year), `:90` (`updated_at`). The first two are the already-known "scoring state keyed to the current moment" item and are not re-reported; the last two are correct uses.

### A4-01
- **Severity:** 🟠
- **Where:** `supabase/functions/score-matchups/index.ts:285-289`; contrast `:296-306`; writes at `:947-957`
- **Code:**
  ```ts
    if (!statsRes.ok) {
      return new Response(JSON.stringify({ error: `Sleeper stats error: ${statsRes.status}` }), { status: 502 });
    }

    const allStats: Record<string, Record<string, number>> = await statsRes.json();
  ```
  ```ts
    const projOk = Object.keys(allProj).length > 0;
  ```
- **Why it is wrong:** The projections fetch learned the lesson (`projOk requires ACTUAL DATA, not merely a 200`); the stats fetch did not. A 200 with `{}`, or with the rank-only shape this same API served until 2026-09-08, passes straight through: every rostered player scores 0, and the function writes `points = 0 + score_adjustment` to every open matchup row. Sunday's real points are overwritten with zeros until a later run gets data; if that run is the last one before Wednesday's finalize, the week is finalized 0-0 and tokens are awarded on it. The only guard against this class is the route's "has any game kicked off" check, which cannot see an empty body.
- **How a human proves it:** code alone proves it. (To see how close it is: `SELECT count(*) FROM uff_matchups WHERE is_complete=false AND points=0 AND week=<current>` right after a run.)
- **Fix shape:** After parsing, require a sanity floor (e.g. at least 50 players carrying one of `pass_yd`/`rush_yd`/`rec`/`pts_allow_*`), else return 502 without writing, exactly as `projOk` does.

### A4-02
- **Severity:** 🟠
- **Where:** `supabase/functions/score-matchups/index.ts:978-989`
- **Code:**
  ```ts
    if (tsUpdates.length > 0) {
      await Promise.all(
        tsUpdates.map(({ leagueId, playerId, ...fields }) =>
          supabase
            .from('player_draft_powers')
            .update(fields)
  ```
- **Why it is wrong:** The Time Stone state writes (`frozen_score`, `last_healthy_score`, `freeze_broken_at`) are fired and their results discarded. A failed update is never logged or returned, so a freeze that should have been set or cleared silently is not, and the next run recomputes from the stale row. Score writes and lineup persists in the same function both check their errors.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Collect the `Promise.all` results and report failures the way `writeErrors` does.

### A4-03
- **Severity:** 🟠
- **Where:** `supabase/functions/score-matchups/index.ts:249-254`
- **Code:**
  ```ts
    if (CRON_SECRET) {
      const auth = req.headers.get('x-cron-secret');
      if (auth !== CRON_SECRET) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }
    }
  ```
- **Why it is wrong:** The secret check is skipped when the edge secret is unset — the same fail-open shape A3-01 had in the story-engine route (fixed on main 2026-09-26). The function is deployed with `verify_jwt=false` (project memory, Session 40), so an unset or mistyped `CRON_SECRET` edge secret makes "score any week 1–18 and write it" reachable by anyone with the project URL.
- **How a human proves it:** Supabase dashboard → Edge Functions → score-matchups → Secrets: confirm `CRON_SECRET` is set; then `curl -X POST <project>/functions/v1/score-matchups -d '{"week":1}'` with no headers must return 401.
- **Confidence:** needs the environment (set today per Session 34; the code offers no protection if it ever is not).
- **Fix shape:** Return 500 when `CRON_SECRET` is empty, as every cron route now does.

### A4-04
- **Severity:** 🟠
- **Where:** `supabase/functions/sync-players/index.ts:26-32`
- **Code:**
  ```ts
    const authHeader = req.headers.get("Authorization") ?? "";
    const syncSecret = Deno.env.get("SYNC_SECRET");
    if (syncSecret && authHeader !== `Bearer ${syncSecret}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }
  ```
- **Why it is wrong:** `SYNC_SECRET` is deliberately unset (project memory: setting it breaks the 4 AM pg_cron call, which sends no auth header). That means the guard is permanently off, and because pg_cron reaches the function with no JWT, `verify_jwt` must be off too — so the function is callable by anyone, unauthenticated. Each call pulls Sleeper's full ~5 MB player file, calls FFC, and upserts ~2,500 rows in 500-row chunks (`:174-185`). Rated 🟠 rather than 🔴 because the data written is Sleeper's own; the exposure is cost, load, and a mid-draft/mid-scoring `players` rewrite on demand.
- **How a human proves it:** `curl -X POST <project>/functions/v1/sync-players` with no headers — a 200 with `{"ok":true,...}` confirms. Also `SELECT jobname, command FROM cron.job WHERE command ILIKE '%sync-players%'` to see how pg_cron authenticates.
- **Confidence:** likely (follows from the documented pg_cron setup; the dashboard setting is the proof).
- **Fix shape:** Have pg_cron send the service-role key (it can read it from vault or a literal in the job) and fail closed on a missing secret; or turn `verify_jwt` on and let pg_cron pass the service JWT.

### A4-05
- **Severity:** 🟡
- **Where:** `supabase/functions/score-matchups/index.ts:259`; caller `src/app/api/cron/score-matchups/route.ts:105`; constant `src/lib/nfl-utils.ts:9`
- **Code:**
  ```ts
    const season = body.season ?? url.searchParams.get('season') ?? '2026';
  ```
  ```ts
        body: JSON.stringify({ week }),
  ```
- **Why it is wrong:** The route now imports `SEASON` from `nfl-utils` (A2-05 was consolidated on main) but still sends only `week`; the edge function falls back to a hard-coded `'2026'`. Next season the route will believe it is scoring 2027 while the function queries `uff_matchups.season = '2026'`, finds nothing, and answers `200 {updated: 0, message: 'No active matchups'}` — a green run that scores no one.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Send `{ week, season: SEASON }` from the route and make the function reject a missing season.

### A4-06
- **Severity:** 🟡
- **Where:** `supabase/functions/score-matchups/index.ts:764-783`
- **Code:**
  ```ts
        for (const memberId of leagueMemberIds) {
          const playerScores = fullScoreCache[memberId];
          if (playerScores && playerScores[targetId] != null) {
            vampireSiphon[biterId] = (vampireSiphon[biterId] ?? 0) + playerScores[targetId].pts * 0.1;
  ```
- **Why it is wrong:** `fullScoreCache` holds every rostered player, bench included, and the loop finds whichever member currently owns the target. Two consequences the rules do not describe: a bitten player parked on the victim's bench still bleeds 10% to the biter (Mirror Match, by contrast, was made starters-only in audit M2); and if the bitten player is later traded to the biter, the biter siphons 10% of their own starter on top of his full score. The siphon also reads `.pts` after the victim's per-player token (Fortress, Triple Threat) has multiplied it.
- **How a human proves it:** `SELECT vb.target_player_id, rp.member_id, vb.biting_member_id, rp.slot FROM vampire_bites vb JOIN uff_roster_players rp ON rp.player_id=vb.target_player_id AND rp.league_id=vb.league_id AND rp.dropped_at IS NULL;` — any row with `rp.member_id = vb.biting_member_id`, or a target not in the owner's `uff_lineups` for the week, is a case the code pays out on.
- **Confidence:** proven from code; whether it is *wrong* is a rules decision.
- **Fix shape:** Require `isStarter` on the target and skip when the owner is the biter (or decide the rule and write it into the guide).

### A4-07
- **Severity:** 🟡
- **Where:** `supabase/functions/score-matchups/index.ts:46`; mirrored at `src/lib/scoring.ts:69`
- **Code:**
  ```ts
      case 'sniper':               return (stats['fgm_50p'] ?? 0) * (settings['fgm_50p'] ?? 0);
  ```
- **Why it is wrong:** Sniper's bonus is "the league's own 50+ FG multiplier again", so it is exactly 0 in any league whose `scoring_settings` has no `fgm_50p` key (Sleeper's per-range keys are `fgm_50_59` / `fgm_60p`). The power would attach, show a badge, and pay nothing.
- **How a human proves it:** `SELECT id, name, scoring_settings ? 'fgm_50p' AS has_key, scoring_settings->'fgm_50p' FROM uff_leagues;`
- **Confidence:** needs the database.
- **Fix shape:** Give Sniper a fixed bonus per 50+ make (as the other powers do), or fall back to a constant when the key is absent.

### A4-08
- **Severity:** 🟡
- **Where:** `supabase/functions/score-matchups/index.ts:715-717`; write path `src/app/dashboard/league/[id]/actions.ts:192-198`
- **Code:**
  ```ts
        const chosenPos = (token.choice ?? '').toUpperCase();
        if (chosenPos) {
          const atPos = starters.filter(([, ps]) => ps.position === chosenPos);
  ```
- **Why it is wrong:** Position Power is documented for QB/RB/WR/TE/K. The picker offers only those, but `setTokenChoice` accepts any string and the engine matches it against the roster verbatim, so a hand-crafted `choice = "DEF"` (or `"7:DEF"` through Second Wind) multiplies the D/ST by 1.5×.
- **How a human proves it:** `SELECT choice FROM weekly_token_assignments WHERE token_id IN (7,18) AND choice IS NOT NULL AND upper(choice) NOT SIMILAR TO '(7:)?(QB|RB|WR|TE|K)';`
- **Confidence:** proven from code.
- **Fix shape:** Validate `choice` against the allowed set in the server action and again in `resolveToken`.

### A4-09
- **Severity:** 🟡
- **Where:** `supabase/functions/score-matchups/index.ts:12-28`, `src/lib/scoring.ts:11-28`, `src/lib/story-engine/feats.ts:16-35`, plus `src/app/api/matchup-breakdown/route.ts`
- **Code:**
  ```ts
  /** Fantasy score for one stat line under a league's scoring settings (mirrors score-matchups). */
  export function calcScore(stats: Record<string, number>, settings: Record<string, number>): number {
  ```
- **Why it is wrong:** `scoring.ts` calls itself "the ONE place a Sleeper stat line becomes UFF points", yet `feats.ts` (same Node runtime, same repo) carries its own copy of the function and of `FLAG_KEYS`. The Deno engine must duplicate; the Node code need not. A flag-key change made in `scoring.ts` will not reach feat detection.
- **How a human proves it:** code alone proves it.
- **Fix shape:** `import { computeScore } from "@/lib/scoring"` in `feats.ts` and delete the copy.

### A4-10
- **Severity:** 🟡
- **Where:** `supabase/functions/score-matchups/index.ts:258-263`; the only guard `src/app/api/cron/score-matchups/route.ts:79-89`
- **Code:**
  ```ts
    const week   = parseInt(body.week   ?? url.searchParams.get('week')   ?? '0');
    ...
    if (!week || week < 1 || week > 18) {
  ```
- **Why it is wrong:** The function scores whatever week it is handed. The "has any game in this week kicked off" gate that stopped the 2026-09-23 phantom-points incident lives only in the Vercel route; a call from pg_cron, a manual invoke, or a future scheduler that skips the route can write zeros onto an unplayed week again.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Move the `uff_game_schedule` kickoff check into the function (with the same `force` escape hatch).

---

## Area 5 — `src/lib/scoring.ts` and `src/lib/story-engine/` (second session, 2026-09-30)

`scoring.ts` (108 lines) was read in full: **no finding**. Its `computeScore`/`applyDraftPower` match the engine line for line, and its one documented divergence (Time Stone handled by the caller) is correct.

### A5-01
- **Severity:** 🟠
- **Where:** `src/lib/story-engine/feats.ts:100-102`, `:133-137`
- **Code:**
  ```ts
    const res = await fetch(`${SLEEPER_BASE}/stats/nfl/regular/${season}/${week}`);
    if (!res.ok) throw new Error(`Sleeper stats ${res.status}`);
    const allStats = (await res.json()) as Record<string, Record<string, number>>;
  ```
  ```ts
    await admin.from("character_feats").delete().eq("league_id", leagueId).eq("week", week);
    if (rows.length) {
  ```
- **Why it is wrong:** Same gap as A4-01, with a worse write pattern: the week's existing feats are deleted *before* the new ones are computed, and a 200 with an empty body yields zero detected feats, so a previously correct week is wiped and the LP replay loses every feat point for it on the next recompute.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Sanity-check `allStats` (as A4-01) before touching the table, and delete only inside the same statement as the insert (or skip the delete when nothing was detected and the fetch looked empty).

### A5-02
- **Severity:** 🟠
- **Where:** `src/app/api/cron/finalize-week/route.ts:78-84`; `src/lib/story-engine/feats.ts:101`
- **Code:**
  ```ts
            for (const w of weeksFinalized) {
              await computeWeekFeats(supabase, lg.id, w);
            }
            await recomputeLeagueLegends(supabase, lg.id, target);
            storyLeagues++;
          } catch (e) {
            console.error(`story engine failed for league ${lg.id}:`, (e as Error).message);
  ```
- **Why it is wrong:** Feats are computed only for weeks finalized *in this run*. If Sleeper hiccups on a Wednesday, `computeWeekFeats` throws, the catch logs it, and that week is never in `weeksFinalized` again — its feats are permanently missing, and because the throw also skips `recomputeLeagueLegends` for that league, the Legend ladder stays a week stale until the next Wednesday. The engine is otherwise built to be replayable; the feats layer is the one part that is not.
- **How a human proves it:** `SELECT m.week FROM uff_matchups m JOIN uff_leagues l ON l.id=m.league_id WHERE l.story_engine_enabled AND m.is_complete GROUP BY m.week EXCEPT SELECT DISTINCT week FROM character_feats;` — a finalized week with no feat rows at all is a candidate (some weeks legitimately have zero feats, so confirm against the stat line).
- **Confidence:** proven from code.
- **Fix shape:** Recompute feats for every completed week missing from `character_feats` (or the last N), not only `weeksFinalized`, and compute feats in their own try/catch so a feats failure does not skip the legend recompute.

### A5-03
- **Severity:** 🟠
- **Where:** `src/lib/story-engine/engine.ts:457-464`, `:489-490`, `:511-512`, `:521`, `:558`; reader `src/app/dashboard/league/[id]/war/page.tsx:47-48`, `:106`
- **Code:**
  ```ts
      front += heroWins - villainWins;
      allianceRows.push({
        league_id: leagueId,
        week: wk,
        hero_battle_wins: heroWins,
        villain_battle_wins: villainWins,
        front_position: front,
      });
  ```
  ```ts
          bopts = {
            heroBonus: highGroundBonus(front > 0 ? front : 0),
            villainBonus: highGroundBonus(front < 0 ? -front : 0),
  ```
  ```ts
      front += campaignSwing;
  ```
- **Why it is wrong:** The `alliance_war` rows — the only thing the War Room reads for the meter — are written inside the weekly loop, before the Great Battle swings (`GREAT_BATTLE_WAR_SWING = ±2`) are added at `:558`. So First Clash and Siege never move the stored front, and The Last Front's High-Ground bonus (`:511-512`) is computed from a `front` that also excludes them. Only the function's return value carries the swung number. Separately, the Great Battles are still decided by the seeded simulation (`resolveBattle`, `:519`) while the weekly front now "follows the field" (`:349-360`), so the two halves of the meter obey different rules.
- **How a human proves it:** `SELECT week, front_position FROM alliance_war WHERE league_id=<id> ORDER BY week;` beside `SELECT event, week, result->>'winner' FROM campaign_events WHERE league_id=<id>;` — a resolved First Clash with no ±2 step in `front_position` around its week confirms.
- **Confidence:** proven from code.
- **Fix shape:** Apply each set-piece's swing into `front` at its week inside the loop (or post-adjust the affected `alliance_war` rows), and decide whether Great Battles should also be field-bound.

### A5-04
- **Severity:** 🟡
- **Where:** `src/lib/story-engine/engine.ts:143-149`, `:211-214`
- **Code:**
  ```ts
      .from("uff_matchups")
      .select("member_id, matchup_id, week, points")
      .eq("league_id", leagueId)
      .eq("season", season)
      .eq("is_complete", true)
      .lte("week", throughWeek);
  ```
  ```ts
          const won = me.points > opp.points;
          const lost = me.points < opp.points;
  ```
- **Why it is wrong:** The replay treats every completed matchup alike: playoff rows count as War Battles and LP (no `is_playoff` filter), and an Insurance-voided loss (`void_result`) still costs −1 LP and extends the loss streak although the fantasy record ignores it. The spec ("Loss −1", "bound to the real games") does not say which is intended; the code has chosen silently.
- **How a human proves it:** `SELECT count(*) FROM uff_matchups WHERE is_complete AND (is_playoff OR void_result);` — any rows are being replayed under this rule.
- **Confidence:** proven from code (rule decision needed).
- **Fix shape:** Select `is_playoff, void_result` and decide explicitly in `lpForResult`'s caller.

### A5-05
- **Severity:** 🟡
- **Where:** `src/lib/story-engine/engine.ts:582-603`
- **Code:**
  ```ts
      const delB = await admin.from("story_battles").delete().eq("league_id", leagueId);
      if (delB.error) throw new Error(`story_battles delete: ${delB.error.message}`);
      if (battleRows.length) {
        const insB = await admin.from("story_battles").insert(battleRows);
  ```
- **Why it is wrong:** Persist is four separate delete/insert pairs with no transaction. A failure after the delete (network, a CHECK on `kind`) leaves the War Room with no battles and an empty meter until the next Wednesday run — the cron route logs and moves on.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Wrap the persist in one RPC (`replace_story_state(league_id, battles jsonb, war jsonb, events jsonb)`), or insert first and delete rows older than the run's timestamp.

### A5-06
- **Severity:** 🟡
- **Where:** `src/lib/story-engine/engine.ts:241`
- **Code:**
  ```ts
      if (wk === throughWeek) for (const [cid, st] of state) st.lastWeekLp = wkDelta.get(cid) ?? 0;
  ```
- **Why it is wrong:** `week_surge` is filled only when `throughWeek` is itself a completed week. The finalize hook passes the just-finalized week, so it works there; the manual `/api/cron/story-engine` route accepts any week 1–25, and a recompute "through" a week with no completed matchups (or past the last one) writes `week_surge = 0` for every legend, which then feeds `battleRating` (`rules.ts:90`) as zero surge.
- **How a human proves it:** code alone proves it.
- **Fix shape:** Take the surge from the latest completed week ≤ `throughWeek` (the `stateAt` helper at `:478-482` already does this for set-pieces).

### A5-07
- **Severity:** 🟡
- **Where:** `src/lib/story-engine/feats.ts:10-11`, `:60-73`
- **Code:**
  ```ts
   * NOTE: Sleeper stat keys should be sanity-checked against a real Week-1 line;
   * detection is defensive (checks alternate key names) but untested vs live data.
  ```
  ```ts
        const fumRec = g(s, "fum_rec", "def_fum_rec", "def_st_fum_rec");
        const dInt = g(s, "int", "def_int");
  ```
- **Why it is wrong:** The file says it has never been checked against a live stat line, and three weeks of real lines now exist. In Sleeper's feed `fum_rec` also appears on offensive players who recover their own fumble, so a running back falling on his own ball would earn the roster a "Twist of Fate" (OMEN) feat.
- **How a human proves it:** `SELECT player_id, stats FROM player_projections` is the wrong table; instead fetch one live line: `curl https://api.sleeper.app/v1/stats/nfl/regular/2026/1 | jq 'to_entries | map(select(.value.fum_rec)) | .[0:5]'` and check positions.
- **Confidence:** likely.
- **Fix shape:** Restrict the defensive keys to `DEF` lines (position is available from `players`) and record the verified key list in the file.

---

## Summary

| Area | 🔴 | 🟠 | 🟡 | Total |
|---|---|---|---|---|
| A1 — database layer | 5 | 10 | 7 | 22 |
| A2 — server actions | 0 | 4 | 5 | 9 |
| A3 — API routes + push | 0 | 4 | 7 | 11 |
| A4 — edge functions | 0 | 4 | 6 | 10 |
| A5 — scoring + story engine | 0 | 3 | 4 | 7 |
| **All** | **5** | **25** | **29** | **59** |

Dropped in the skeptic pass: 5 in session one, 3 in session two (listed in the header).

### Top five to fix first

1. **A1-03 — five more anon-reachable RPCs, `commissioner_draft_pick` with no id needed.** One `REVOKE` migration in the exact shape of 2026-09-15 closes a hole the team has already agreed is unacceptable; `finalize_week` is irreversible.
2. **A1-02 — any member can rewrite an opponent's `player_draft_powers` row.** It is a two-line policy change and the engine reads that table every 15 minutes during games; this is the cheapest way for a manager to cut a rival's star in half.
3. **A1-01 / A2-01 — any signed-in account can insert itself into any league.** The league is mid-season; a stray membership row breaks standings, finalize and faction math for everyone, and the fix (an RPC + drop one policy) also closes the capacity race.
4. **A1-05 — `set_lineup` has no kickoff lock.** The most obvious fantasy cheat, reachable with one `rpc()` call by anyone who reads the network tab; the lock logic already exists in `lineup-actions.ts` and only needs to move down a layer.
5. **A3-05 + A3-04 — finalize skips and email failures are silent.** Both are "green run, broken league" defects: a league that stops finalizing or a Wednesday that stops emailing will not be noticed until a manager complains, and the fixes are a status code and a return value.

**From areas 4–5, fix first:** A4-01 (a 200 with no stats writes zeros over real points, the single fetch the whole engine trusts), A5-02 (a feats failure is never retried and stalls the legend replay), A5-03 (Great Battles never reach the War Meter). Then A4-04 (`sync-players` is callable by anyone) and A4-02 (Time Stone writes unchecked).

Close behind: A1-15 (mid-season faction switch via column grant), A1-07/A1-08/A1-09/A1-10 (the remaining self-service write policies — one migration can drop them all), A3-02 (the chat assistant may be answering from an empty context), A2-03 (dead invite button).
