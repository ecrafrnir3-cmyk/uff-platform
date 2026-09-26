-- 2026-09-26 — OPEN-LOOPS #77 / code-audit A1-05 (+ A1-09, A2-06): the per-player game-time
-- lock lived only in lineup-actions.ts. set_lineup validated roster and position and nothing
-- else, so a manager calling it directly could bench a starter after his game went badly,
-- start a bench player whose game had already been played (a known score), or rewrite a
-- finalized week. Quick Feet (token 13) was spent by a second statement after the save, so a
-- dropped response left the swap standing and the token still pending; and the token table's
-- UPDATE grant was table-wide, so a member could rewrite token_id, week or status.
--
-- Nate's rules call (2026-09-26, option 1 = the rulebook): Quick Feet is a late injury swap.
-- It lets ONE locked starter out per week; the player coming in must not have kicked off.
-- A locked starter may still change slots (he is starting either way). A finalized week is
-- untouchable. The token is spent inside the same transaction as the save.
--
-- What changes:
--   a. set_lineup — same signature, same #55 guard, same roster/position validation, then:
--        * refuse if any of this member's matchups for the week is_complete;
--        * refuse any player entering the lineup whose team has kicked off this week, unless
--          he was already starting (slot move);
--        * a locked starter leaving the lineup needs a pending Quick Feet token for the week,
--          consumed here (status = 'used', used_at = now()); two or more locked departures
--          are refused outright.
--      The app keeps its own copy of the rule for the UI; this is the backstop and the spend.
--   b. weekly_token_assignments — authenticated may UPDATE only `choice` (the token choice);
--      anon loses every write. The row-ownership UPDATE policy is unchanged.
--   c. uff_lineups — anon and authenticated lose INSERT/UPDATE/DELETE/TRUNCATE. No write
--      policy existed and no app path writes the table directly: set_lineup and
--      persist_effective_lineup are SECURITY DEFINER, the #70 trigger runs as owner.
--
-- App: lineup-actions.ts no longer spends the token after the save (the function does), and
-- no longer lets Quick Feet bring a kicked-off player IN; a locked starter changing slots is
-- allowed. No other caller of set_lineup exists (src/, supabase/functions, scripts, pg_proc).
--
-- Rollback: the pre-change set_lineup body is archived at
--   One Mind/Archive/uff-a105-pre-bodies-2026-09-26/set_lineup.sql, then
--   GRANT UPDATE ON public.weekly_token_assignments TO authenticated;
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.weekly_token_assignments TO anon;
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.uff_lineups TO anon, authenticated;
--   and revert lineup-actions.ts (git has it).
--
-- Applied live 2026-09-26 via the Supabase MCP as lineup_lock_in_the_database (20260926142613) and
-- proven as a real manager in rolled-back blocks: identical save OK; benching a locked K without
-- Quick Feet REFUSED; starting a locked bench WR REFUSED; a locked starter changing slots OK;
-- rewriting finalized week 1 REFUSED; with a pending Quick Feet token: two locked out REFUSED,
-- one locked out OK and the token flipped to 'used' in the same call, a second locked swap that
-- week REFUSED; the member can update the token's choice (1 row) but not its status or token_id
-- (permission denied); anon permission denied on both tables.

-- ── a. set_lineup ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_lineup(p_league_id uuid, p_user_id uuid, p_week integer, p_slots jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id  uuid;
  v_rec        jsonb;
  v_slot       text;
  v_player_id  text;
  v_player_pos text;
  v_slot_base  text;
  v_eligible   text[];
  v_season     int;
  v_old        jsonb;
  v_new        jsonb;
  v_out_count  int := 0;
  v_out_player text;
  v_qf_id      uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only act for your own team';
  END IF;
  SELECT id INTO v_member_id
  FROM public.league_members
  WHERE league_id = p_league_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this league';
  END IF;

  -- Validate each entry
  FOR v_rec IN SELECT value FROM jsonb_array_elements(p_slots) AS value LOOP
    v_slot      := v_rec->>'slot';
    v_player_id := v_rec->>'player_id';

    IF v_slot IS NULL OR v_player_id IS NULL THEN
      RAISE EXCEPTION 'Each slot entry must have slot and player_id';
    END IF;

    -- Player must be on active roster
    IF NOT EXISTS (
      SELECT 1 FROM public.uff_roster_players
      WHERE member_id = v_member_id
        AND player_id = v_player_id
        AND slot = 'active'
        AND dropped_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Player % is not on your active roster', v_player_id;
    END IF;

    -- Position eligibility
    SELECT position INTO v_player_pos FROM public.players WHERE id = v_player_id;
    v_slot_base := regexp_replace(v_slot, '_[0-9]+$', '');

    CASE v_slot_base
      WHEN 'QB'   THEN v_eligible := ARRAY['QB'];
      WHEN 'RB'   THEN v_eligible := ARRAY['RB'];
      WHEN 'WR'   THEN v_eligible := ARRAY['WR'];
      WHEN 'TE'   THEN v_eligible := ARRAY['TE'];
      WHEN 'FLEX' THEN v_eligible := ARRAY['RB','WR','TE'];
      WHEN 'K'    THEN v_eligible := ARRAY['K'];
      WHEN 'DEF'  THEN v_eligible := ARRAY['DEF','DST'];
      WHEN 'DST'  THEN v_eligible := ARRAY['DEF','DST'];
      ELSE RAISE EXCEPTION 'Unknown slot type: %', v_slot_base;
    END CASE;

    IF v_player_pos IS NULL OR NOT (v_player_pos = ANY(v_eligible)) THEN
      RAISE EXCEPTION 'Position % cannot be placed in % slot', v_player_pos, v_slot;
    END IF;
  END LOOP;

  -- A finalized week is untouchable (matchup-breakdown and Story Engine feats read it)
  IF EXISTS (
    SELECT 1 FROM public.uff_matchups m
    WHERE m.league_id = p_league_id AND m.member_id = v_member_id
      AND m.week = p_week::smallint AND m.is_complete
  ) THEN
    RAISE EXCEPTION 'Week % is final and its lineup can no longer be changed', p_week;
  END IF;

  -- Per-player game-time lock: a player is locked once his team's game this week has
  -- kicked off. The app applies the same rule for the UI; this is the backstop for a
  -- direct call, and the place Quick Feet is spent.
  SELECT season::int INTO v_season FROM public.uff_leagues WHERE id = p_league_id;

  SELECT coalesce(jsonb_object_agg(slot, player_id), '{}'::jsonb) INTO v_old
    FROM public.uff_lineups WHERE member_id = v_member_id AND week = p_week::smallint;
  SELECT coalesce(jsonb_object_agg(r->>'slot', r->>'player_id'), '{}'::jsonb) INTO v_new
    FROM jsonb_array_elements(p_slots) AS r;

  -- 1. A locked player who was not already starting cannot come in — Quick Feet or not:
  --    the late injury swap's replacement must not have played yet.
  FOR v_player_id IN SELECT DISTINCT n.value FROM jsonb_each_text(v_new) AS n LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_each_text(v_old) AS o WHERE o.value = v_player_id)
       AND EXISTS (
         SELECT 1 FROM public.uff_game_schedule g
         JOIN public.players p ON p.id = v_player_id
         WHERE g.season = v_season AND g.week = p_week AND g.team = p.team
           AND g.kickoff_utc <= now()
       )
    THEN
      RAISE EXCEPTION 'Player % has already kicked off this week and cannot be started', v_player_id;
    END IF;
  END LOOP;

  -- 2. A locked starter can be taken out only with Quick Feet, once per week.
  FOR v_player_id IN SELECT DISTINCT o.value FROM jsonb_each_text(v_old) AS o LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_each_text(v_new) AS n WHERE n.value = v_player_id)
       AND EXISTS (
         SELECT 1 FROM public.uff_game_schedule g
         JOIN public.players p ON p.id = v_player_id
         WHERE g.season = v_season AND g.week = p_week AND g.team = p.team
           AND g.kickoff_utc <= now()
       )
    THEN
      v_out_count  := v_out_count + 1;
      v_out_player := v_player_id;
    END IF;
  END LOOP;

  IF v_out_count > 1 THEN
    RAISE EXCEPTION 'Quick Feet lets one locked player out per week; this save takes out %', v_out_count;
  ELSIF v_out_count = 1 THEN
    SELECT id INTO v_qf_id
      FROM public.weekly_token_assignments
     WHERE league_id = p_league_id AND member_id = v_member_id
       AND week = p_week::smallint AND token_id = 13 AND status = 'pending'
     FOR UPDATE;
    IF v_qf_id IS NULL THEN
      RAISE EXCEPTION 'Player % has already kicked off this week and is locked in your lineup', v_out_player;
    END IF;
    -- Spent here, in the same transaction as the save (audit A2-06)
    UPDATE public.weekly_token_assignments
       SET status = 'used', used_at = now()
     WHERE id = v_qf_id;
  END IF;

  -- Atomic replace
  DELETE FROM public.uff_lineups
  WHERE member_id = v_member_id AND week = p_week::smallint;

  INSERT INTO public.uff_lineups (league_id, member_id, player_id, week, slot)
  SELECT p_league_id, v_member_id, (r->>'player_id'), p_week::smallint, (r->>'slot')
  FROM jsonb_array_elements(p_slots) AS r;
END;
$function$;

-- ── b. weekly_token_assignments: a member may change their token choice, nothing else ──
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.weekly_token_assignments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.weekly_token_assignments FROM authenticated;
GRANT UPDATE (choice) ON public.weekly_token_assignments TO authenticated;

-- ── c. uff_lineups: written only through the functions and the engine ────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.uff_lineups FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.uff_lineups FROM authenticated;
