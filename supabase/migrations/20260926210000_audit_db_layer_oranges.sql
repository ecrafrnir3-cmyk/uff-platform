-- 2026-09-26 — OPEN-LOOPS #77 / code-audit oranges in the database layer, in one migration:
--   A1-06  add_player / add_and_drop_player: p_week is now required, so every add is counted
--          against the weekly and season caps (a NULL week skipped the weekly cap and inserted
--          a row the season cap never counted). The app always passes the week.
--   A1-13  swap_foresight_powers / commissioner_foresight_swap: only during the draft, only on
--          the round the manager just picked, only one of the next two rounds (the rulebook's
--          peek window), bounded by draft_rounds — p_current_round was caller-supplied and
--          never checked, and 16 was hard-coded.
--   A1-14  respond_to_trade / approve_trade: the trade deadline, the roster cap and starter
--          minimum, and the IR-slot limit are checked inside the RPC (check_trade_rules),
--          not only in trade-actions.ts. current_nfl_week() mirrors the app's week math.
--   A1-15  league_members: a BEFORE UPDATE OF faction trigger refuses a faction change once the
--          league's draft_status is not 'not_started' (the column grant let a member switch
--          sides mid-season and change the faction bonus and token awards).
--   A1-08  draft_power_assignments: the member INSERT/UPDATE policies are dropped (a member
--          could rewrite the round of their dealt powers; start_draft deals them as owner).
--   A1-11  uff_trades: the proposer INSERT policy is dropped (propose_trade inserts as owner
--          with all the validation a direct insert skipped).
--   A1-12  uff_draft_picks: the member INSERT policy is dropped (every pick path is a
--          SECURITY DEFINER function; a forged row shifts every later turn).
-- The six changed function bodies are the LIVE pg_get_functiondef with the lines above
-- inserted (generated, asserted one match each, re-diffed after applying). Pre-change bodies
-- are archived at One Mind/Archive/uff-m1-pre-bodies-2026-09-26/.
--
-- Rollback: re-run the archived bodies; DROP TRIGGER league_members_lock_faction_after_draft ON
-- public.league_members; DROP FUNCTION public.check_trade_rules(public.uff_trades);
-- DROP FUNCTION public.current_nfl_week(); and re-create the four policies from the snapshot at
-- the parent commit.
--
-- Applied live 2026-09-26 via the Supabase MCP as audit_db_layer_oranges (20260926143925); the six
-- bodies re-read afterwards and identical. Proven in rolled-back blocks: add with NULL week refused,
-- add with week 3 OK; faction change refused once a draft has started, allowed before; member
-- inserts into draft_power_assignments / uff_trades / uff_draft_picks refused; Foresight after the
-- draft refused; a 2-for-1 that puts the receiver at 17 refused, a clean 1-for-1 executed, an
-- acceptance after the deadline refused; anon permission denied.

-- ── The app's week math, in the database (used by the trade deadline) ────────────────
-- Mirrors src/lib/nfl-utils.ts getCurrentNFLWeek(): weeks since Wednesday 2026-09-09 00:00 UTC,
-- plus one, clamped to 1..18. Change both together or not at all.
CREATE OR REPLACE FUNCTION public.current_nfl_week()
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  SELECT GREATEST(1, LEAST(18, (floor(extract(epoch FROM (now() - '2026-09-09 00:00:00+00'::timestamptz)) / 604800))::int + 1));
$function$;

-- ── A1-14: the trade rules that lived only in trade-actions.ts ─────────────────────────
CREATE OR REPLACE FUNCTION public.check_trade_rules(p_trade public.uff_trades)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deadline   smallint;
  v_cap        int;
  v_slots      jsonb;
  v_ir_spots   int;
  v_min        int;
  v_active_p   int; v_active_r   int;
  v_ir_p       int; v_ir_r       int;
  v_out_p_act  int; v_out_p_ir   int;
  v_out_r_act  int; v_out_r_ir   int;
  v_post_p     int; v_post_r     int;
  v_post_ir_p  int; v_post_ir_r  int;
BEGIN
  SELECT trade_deadline_week, draft_rounds, lineup_slots, ir_spots
    INTO v_deadline, v_cap, v_slots, v_ir_spots
    FROM uff_leagues WHERE id = p_trade.league_id;

  IF v_deadline IS NOT NULL AND current_nfl_week() > v_deadline THEN
    RAISE EXCEPTION 'Trade deadline has passed (Week %). This trade can no longer be accepted.', v_deadline;
  END IF;

  SELECT coalesce(sum(value::int), 9) INTO v_min
    FROM jsonb_each_text(coalesce(v_slots, '{"QB":1,"RB":2,"WR":2,"TE":1,"FLEX":1,"K":1,"DEF":1}'::jsonb));

  -- Players move with their slot, so count what leaves and arrives per slot.
  SELECT count(*) FILTER (WHERE slot = 'active'), count(*) FILTER (WHERE slot = 'ir')
    INTO v_active_p, v_ir_p FROM uff_roster_players WHERE member_id = p_trade.proposer_id AND dropped_at IS NULL;
  SELECT count(*) FILTER (WHERE slot = 'active'), count(*) FILTER (WHERE slot = 'ir')
    INTO v_active_r, v_ir_r FROM uff_roster_players WHERE member_id = p_trade.receiver_id AND dropped_at IS NULL;
  SELECT count(*) FILTER (WHERE slot = 'active'), count(*) FILTER (WHERE slot = 'ir')
    INTO v_out_p_act, v_out_p_ir FROM uff_roster_players
   WHERE member_id = p_trade.proposer_id AND dropped_at IS NULL AND player_id = ANY(p_trade.proposer_player_ids);
  SELECT count(*) FILTER (WHERE slot = 'active'), count(*) FILTER (WHERE slot = 'ir')
    INTO v_out_r_act, v_out_r_ir FROM uff_roster_players
   WHERE member_id = p_trade.receiver_id AND dropped_at IS NULL AND player_id = ANY(p_trade.receiver_player_ids);

  v_post_p    := v_active_p - v_out_p_act + v_out_r_act;
  v_post_r    := v_active_r - v_out_r_act + v_out_p_act;
  v_post_ir_p := v_ir_p     - v_out_p_ir  + v_out_r_ir;
  v_post_ir_r := v_ir_r     - v_out_r_ir  + v_out_p_ir;

  IF v_post_p > v_cap THEN
    RAISE EXCEPTION 'This trade would leave the proposer over the %-player roster limit (%). Adjust the players involved and re-propose.', v_cap, v_post_p;
  ELSIF v_post_r > v_cap THEN
    RAISE EXCEPTION 'This trade would leave the receiver over the %-player roster limit (%). Adjust the players involved and re-propose.', v_cap, v_post_r;
  ELSIF v_post_p < v_min THEN
    RAISE EXCEPTION 'This trade would leave the proposer under the %-starter minimum (%). Adjust the players involved and re-propose.', v_min, v_post_p;
  ELSIF v_post_r < v_min THEN
    RAISE EXCEPTION 'This trade would leave the receiver under the %-starter minimum (%). Adjust the players involved and re-propose.', v_min, v_post_r;
  ELSIF v_post_ir_p > v_ir_spots THEN
    RAISE EXCEPTION 'This trade would leave the proposer over the %-slot IR limit (%).', v_ir_spots, v_post_ir_p;
  ELSIF v_post_ir_r > v_ir_spots THEN
    RAISE EXCEPTION 'This trade would leave the receiver over the %-slot IR limit (%).', v_ir_spots, v_post_ir_r;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_trade_rules(public.uff_trades) FROM PUBLIC, anon, authenticated;

-- ── add_player ──
CREATE OR REPLACE FUNCTION public.add_player(p_league_id uuid, p_user_id uuid, p_player_id text, p_week smallint DEFAULT NULL::smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id        uuid;
  v_active_count     int;
  v_max_active       int;
  v_already_on       int;
  v_max_adds_week    smallint;
  v_max_adds_season  smallint;
  v_week_adds        int;
  v_season_adds      int;
  v_eliminated       timestamptz;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only act for your own team';
  END IF;
  SELECT id INTO v_member_id
    FROM league_members WHERE league_id = p_league_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not a member of this league'; END IF;

  -- Elimination check
  SELECT eliminated_at INTO v_eliminated FROM league_members WHERE id = v_member_id;
  IF v_eliminated IS NOT NULL THEN
    RAISE EXCEPTION 'Your roster is locked — your team was eliminated from the playoffs.';
  END IF;

  -- Player must not already be on an active roster in this league
  SELECT COUNT(*) INTO v_already_on
    FROM uff_roster_players WHERE league_id = p_league_id AND player_id = p_player_id AND dropped_at IS NULL;
  IF v_already_on > 0 THEN RAISE EXCEPTION 'Player is already on a roster in this league'; END IF;

  -- Active roster must have room
  SELECT COUNT(*) INTO v_active_count
    FROM uff_roster_players WHERE member_id = v_member_id AND dropped_at IS NULL AND slot = 'active';
  SELECT draft_rounds, max_adds_per_week, max_adds_per_season
    INTO v_max_active, v_max_adds_week, v_max_adds_season
    FROM uff_leagues WHERE id = p_league_id;
  IF v_active_count >= v_max_active THEN
    RAISE EXCEPTION 'Active roster is full (% players). Drop someone first.', v_max_active;
  END IF;

  -- The week is required so every add is counted against the caps (audit A1-06)
  IF p_week IS NULL THEN
    RAISE EXCEPTION 'Week is required to add a player';
  END IF;

  -- Per-week limit (0 = unlimited)
  IF v_max_adds_week > 0 THEN
    SELECT COUNT(*) INTO v_week_adds
      FROM uff_roster_players WHERE member_id = v_member_id AND week_added = p_week;
    IF v_week_adds >= v_max_adds_week THEN
      RAISE EXCEPTION 'Weekly acquisition limit reached (% of % adds used this week).', v_week_adds, v_max_adds_week;
    END IF;
  END IF;

  -- Per-season limit (0 = unlimited)
  IF v_max_adds_season > 0 THEN
    SELECT COUNT(*) INTO v_season_adds
      FROM uff_roster_players WHERE member_id = v_member_id AND week_added IS NOT NULL AND week_added > 0;
    IF v_season_adds >= v_max_adds_season THEN
      RAISE EXCEPTION 'Season acquisition limit reached (% of % adds used this season).', v_season_adds, v_max_adds_season;
    END IF;
  END IF;

  INSERT INTO uff_roster_players (league_id, member_id, player_id, slot, week_added)
  VALUES (p_league_id, v_member_id, p_player_id, 'active', p_week);
END;
$function$;

-- ── add_and_drop_player ──
CREATE OR REPLACE FUNCTION public.add_and_drop_player(p_league_id uuid, p_user_id uuid, p_add_player_id text, p_drop_player_id text, p_week smallint DEFAULT NULL::smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id        uuid;
  v_on_roster        int;
  v_already_on       int;
  v_max_adds_week    smallint;
  v_max_adds_season  smallint;
  v_week_adds        int;
  v_season_adds      int;
  v_eliminated       timestamptz;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only act for your own team';
  END IF;
  SELECT id INTO v_member_id
    FROM league_members WHERE league_id = p_league_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not a member of this league'; END IF;

  -- Elimination check
  SELECT eliminated_at INTO v_eliminated FROM league_members WHERE id = v_member_id;
  IF v_eliminated IS NOT NULL THEN
    RAISE EXCEPTION 'Your roster is locked — your team was eliminated from the playoffs.';
  END IF;

  -- Can't cut check on the player being dropped
  IF EXISTS (
    SELECT 1 FROM uff_cant_cut_list
    WHERE league_id = p_league_id AND player_id = p_drop_player_id
  ) THEN
    RAISE EXCEPTION 'This player is on the commissioner''s Can''t Cut List and cannot be dropped.';
  END IF;

  -- The player to drop must be on MY active roster
  SELECT COUNT(*) INTO v_on_roster
    FROM uff_roster_players
   WHERE member_id = v_member_id AND player_id = p_drop_player_id AND slot = 'active' AND dropped_at IS NULL;
  IF v_on_roster = 0 THEN
    RAISE EXCEPTION 'The player you are dropping is not on your active roster';
  END IF;

  -- The player to add must not be on any roster in this league
  SELECT COUNT(*) INTO v_already_on
    FROM uff_roster_players WHERE league_id = p_league_id AND player_id = p_add_player_id AND dropped_at IS NULL;
  IF v_already_on > 0 THEN
    RAISE EXCEPTION 'Player is already on a roster in this league';
  END IF;

  -- Fetch limits
  SELECT max_adds_per_week, max_adds_per_season
    INTO v_max_adds_week, v_max_adds_season
    FROM uff_leagues WHERE id = p_league_id;

  -- The week is required so every add is counted against the caps (audit A1-06)
  IF p_week IS NULL THEN
    RAISE EXCEPTION 'Week is required to add a player';
  END IF;

  -- Per-week limit
  IF v_max_adds_week > 0 THEN
    SELECT COUNT(*) INTO v_week_adds
      FROM uff_roster_players WHERE member_id = v_member_id AND week_added = p_week;
    IF v_week_adds >= v_max_adds_week THEN
      RAISE EXCEPTION 'Weekly acquisition limit reached (% of % adds used this week).', v_week_adds, v_max_adds_week;
    END IF;
  END IF;

  -- Per-season limit
  IF v_max_adds_season > 0 THEN
    SELECT COUNT(*) INTO v_season_adds
      FROM uff_roster_players WHERE member_id = v_member_id AND week_added IS NOT NULL AND week_added > 0;
    IF v_season_adds >= v_max_adds_season THEN
      RAISE EXCEPTION 'Season acquisition limit reached (% of % adds used this season).', v_season_adds, v_max_adds_season;
    END IF;
  END IF;

  -- Drop the outgoing player
  UPDATE uff_roster_players
     SET dropped_at = now()
   WHERE member_id = v_member_id AND player_id = p_drop_player_id AND slot = 'active' AND dropped_at IS NULL;

  -- Add the incoming player
  INSERT INTO uff_roster_players (league_id, member_id, player_id, slot, week_added)
  VALUES (p_league_id, v_member_id, p_add_player_id, 'active', p_week);
END;
$function$;

-- ── respond_to_trade ──
CREATE OR REPLACE FUNCTION public.respond_to_trade(p_trade_id uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trade               uff_trades%ROWTYPE;
  v_receiver_member_id  uuid;
  v_proposer_user_id    uuid;
  v_receiver_user_id    uuid;
  v_commissioner_review boolean;
BEGIN
  SELECT * INTO v_trade FROM uff_trades WHERE id = p_trade_id FOR UPDATE;
  IF v_trade.id IS NULL THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_trade.status != 'pending' THEN RAISE EXCEPTION 'Trade is no longer pending'; END IF;

  SELECT id INTO v_receiver_member_id
    FROM league_members WHERE id = v_trade.receiver_id AND user_id = auth.uid();
  IF v_receiver_member_id IS NULL THEN
    RAISE EXCEPTION 'Only the trade recipient can respond to this trade';
  END IF;

  IF NOT p_accept THEN
    UPDATE uff_trades SET status = 'rejected', updated_at = now() WHERE id = p_trade_id;
    RETURN;
  END IF;

  -- Re-validate ownership at acceptance time
  IF EXISTS (
    SELECT 1 FROM unnest(v_trade.proposer_player_ids) AS pid
    WHERE NOT EXISTS (
      SELECT 1 FROM uff_roster_players
      WHERE member_id = v_trade.proposer_id AND player_id = pid AND dropped_at IS NULL
    )
  ) THEN RAISE EXCEPTION 'Proposer no longer has one or more offered players'; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_trade.receiver_player_ids) AS pid
    WHERE NOT EXISTS (
      SELECT 1 FROM uff_roster_players
      WHERE member_id = v_trade.receiver_id AND player_id = pid AND dropped_at IS NULL
    )
  ) THEN RAISE EXCEPTION 'You no longer have one or more of the requested players'; END IF;

  -- Deadline, roster cap/minimum and IR capacity, enforced here, not only in the app (audit A1-14)
  PERFORM check_trade_rules(v_trade);

  -- Check if commissioner review is enabled for this league
  SELECT commissioner_review INTO v_commissioner_review
    FROM uff_leagues WHERE id = v_trade.league_id;

  IF v_commissioner_review THEN
    -- Hold for review instead of executing
    UPDATE uff_trades SET status = 'pending_review', updated_at = now() WHERE id = p_trade_id;
    RETURN;
  END IF;

  -- Execute immediately (no review required)
  SELECT user_id INTO v_proposer_user_id FROM league_members WHERE id = v_trade.proposer_id;
  SELECT user_id INTO v_receiver_user_id FROM league_members WHERE id = v_trade.receiver_id;

  UPDATE uff_roster_players SET member_id = v_trade.receiver_id
   WHERE member_id = v_trade.proposer_id
     AND player_id = ANY(v_trade.proposer_player_ids) AND dropped_at IS NULL;

  UPDATE uff_roster_players SET member_id = v_trade.proposer_id
   WHERE member_id = v_trade.receiver_id
     AND player_id = ANY(v_trade.receiver_player_ids) AND dropped_at IS NULL;

  UPDATE player_draft_powers SET drafted_by_user_id = v_receiver_user_id
   WHERE league_id = v_trade.league_id
     AND player_id = ANY(v_trade.proposer_player_ids)
     AND drafted_by_user_id = v_proposer_user_id;

  UPDATE player_draft_powers SET drafted_by_user_id = v_proposer_user_id
   WHERE league_id = v_trade.league_id
     AND player_id = ANY(v_trade.receiver_player_ids)
     AND drafted_by_user_id = v_receiver_user_id;

  UPDATE uff_trades SET status = 'accepted', updated_at = now() WHERE id = p_trade_id;
END;
$function$;

-- ── approve_trade ──
CREATE OR REPLACE FUNCTION public.approve_trade(p_trade_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trade             uff_trades%ROWTYPE;
  v_commissioner_id   uuid;
  v_proposer_user_id  uuid;
  v_receiver_user_id  uuid;
BEGIN
  SELECT * INTO v_trade FROM uff_trades WHERE id = p_trade_id FOR UPDATE;
  IF v_trade.id IS NULL THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_trade.status != 'pending_review' THEN RAISE EXCEPTION 'Trade is not awaiting commissioner review'; END IF;

  SELECT commissioner_id INTO v_commissioner_id FROM uff_leagues WHERE id = v_trade.league_id;
  IF v_commissioner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the commissioner can approve trades';
  END IF;

  -- Re-validate ownership at approval time (players may have moved since acceptance)
  IF EXISTS (
    SELECT 1 FROM unnest(v_trade.proposer_player_ids) AS pid
    WHERE NOT EXISTS (
      SELECT 1 FROM uff_roster_players
      WHERE member_id = v_trade.proposer_id AND player_id = pid AND dropped_at IS NULL
    )
  ) THEN RAISE EXCEPTION 'Proposer no longer has one or more offered players — trade cannot be completed'; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_trade.receiver_player_ids) AS pid
    WHERE NOT EXISTS (
      SELECT 1 FROM uff_roster_players
      WHERE member_id = v_trade.receiver_id AND player_id = pid AND dropped_at IS NULL
    )
  ) THEN RAISE EXCEPTION 'Receiver no longer has one or more requested players — trade cannot be completed'; END IF;

  -- Deadline, roster cap/minimum and IR capacity, enforced here, not only in the app (audit A1-14)
  PERFORM check_trade_rules(v_trade);

  SELECT user_id INTO v_proposer_user_id FROM league_members WHERE id = v_trade.proposer_id;
  SELECT user_id INTO v_receiver_user_id FROM league_members WHERE id = v_trade.receiver_id;

  UPDATE uff_roster_players SET member_id = v_trade.receiver_id
   WHERE member_id = v_trade.proposer_id
     AND player_id = ANY(v_trade.proposer_player_ids) AND dropped_at IS NULL;

  UPDATE uff_roster_players SET member_id = v_trade.proposer_id
   WHERE member_id = v_trade.receiver_id
     AND player_id = ANY(v_trade.receiver_player_ids) AND dropped_at IS NULL;

  UPDATE player_draft_powers SET drafted_by_user_id = v_receiver_user_id
   WHERE league_id = v_trade.league_id
     AND player_id = ANY(v_trade.proposer_player_ids)
     AND drafted_by_user_id = v_proposer_user_id;

  UPDATE player_draft_powers SET drafted_by_user_id = v_proposer_user_id
   WHERE league_id = v_trade.league_id
     AND player_id = ANY(v_trade.receiver_player_ids)
     AND drafted_by_user_id = v_receiver_user_id;

  UPDATE uff_trades SET status = 'accepted', updated_at = now() WHERE id = p_trade_id;
END;
$function$;

-- ── swap_foresight_powers ──
CREATE OR REPLACE FUNCTION public.swap_foresight_powers(p_league_id uuid, p_current_round smallint, p_swap_round smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_member_id uuid; v_curr record; v_swap record; v_status text; v_rounds smallint; v_last_round smallint;
BEGIN
  SELECT id INTO v_member_id FROM league_members WHERE league_id = p_league_id AND user_id = auth.uid();
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'Not a member of this league'; END IF;
  -- Only during the draft, only on the round this manager just picked, only the next two
  -- rounds (the rulebook's peek window), bounded by the league's rounds (audit A1-13)
  SELECT draft_status, draft_rounds INTO v_status, v_rounds FROM uff_leagues WHERE id = p_league_id;
  IF v_status IS DISTINCT FROM 'in_progress' THEN RAISE EXCEPTION 'Foresight Coin can only be used during the draft'; END IF;
  SELECT max(round) INTO v_last_round FROM uff_draft_picks WHERE league_id = p_league_id AND member_id = v_member_id;
  IF v_last_round IS NULL OR v_last_round <> p_current_round THEN
    RAISE EXCEPTION 'Foresight Coin can only be used on the round you just picked';
  END IF;
  IF p_swap_round <= p_current_round OR p_swap_round > p_current_round + 2 OR p_swap_round > v_rounds THEN
    RAISE EXCEPTION 'Foresight Coin can only swap with one of your next two rounds';
  END IF;
  SELECT id, power_id INTO v_curr FROM draft_power_assignments
   WHERE league_id = p_league_id AND member_id = v_member_id AND round = p_current_round FOR UPDATE;
  SELECT id, power_id INTO v_swap FROM draft_power_assignments
   WHERE league_id = p_league_id AND member_id = v_member_id AND round = p_swap_round FOR UPDATE;
  IF v_curr.id IS NULL OR v_swap.id IS NULL THEN RAISE EXCEPTION 'Power assignments not found'; END IF;
  IF v_curr.power_id != 1 THEN RAISE EXCEPTION 'You do not hold Foresight Coin this round'; END IF;

  DELETE FROM draft_power_assignments WHERE id IN (v_curr.id, v_swap.id);
  INSERT INTO draft_power_assignments (league_id, member_id, round, power_id) VALUES
    (p_league_id, v_member_id, p_current_round, v_swap.power_id),
    (p_league_id, v_member_id, p_swap_round,    v_curr.power_id);
END;
$function$;

-- ── commissioner_foresight_swap ──
CREATE OR REPLACE FUNCTION public.commissioner_foresight_swap(p_league_id uuid, p_acting_member_id uuid, p_current_round smallint, p_swap_round smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_curr record; v_swap record; v_status text; v_rounds smallint; v_last_round smallint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the commissioner can act for another manager';
  END IF;
  -- Same rules as swap_foresight_powers (audit A1-13)
  SELECT draft_status, draft_rounds INTO v_status, v_rounds FROM uff_leagues WHERE id = p_league_id;
  IF v_status IS DISTINCT FROM 'in_progress' THEN RAISE EXCEPTION 'Foresight Coin can only be used during the draft'; END IF;
  SELECT max(round) INTO v_last_round FROM uff_draft_picks WHERE league_id = p_league_id AND member_id = p_acting_member_id;
  IF v_last_round IS NULL OR v_last_round <> p_current_round THEN
    RAISE EXCEPTION 'Foresight Coin can only be used on the round that manager just picked';
  END IF;
  IF p_swap_round <= p_current_round OR p_swap_round > p_current_round + 2 OR p_swap_round > v_rounds THEN
    RAISE EXCEPTION 'Foresight Coin can only swap with one of the next two rounds';
  END IF;
  SELECT id, power_id INTO v_curr FROM draft_power_assignments
   WHERE league_id = p_league_id AND member_id = p_acting_member_id AND round = p_current_round FOR UPDATE;
  SELECT id, power_id INTO v_swap FROM draft_power_assignments
   WHERE league_id = p_league_id AND member_id = p_acting_member_id AND round = p_swap_round FOR UPDATE;
  IF v_curr.id IS NULL OR v_swap.id IS NULL THEN RAISE EXCEPTION 'Power assignments not found'; END IF;
  IF v_curr.power_id != 1 THEN RAISE EXCEPTION 'That manager does not hold Foresight Coin this round'; END IF;

  DELETE FROM draft_power_assignments WHERE id IN (v_curr.id, v_swap.id);
  INSERT INTO draft_power_assignments (league_id, member_id, round, power_id) VALUES
    (p_league_id, p_acting_member_id, p_current_round, v_swap.power_id),
    (p_league_id, p_acting_member_id, p_swap_round,    v_curr.power_id);
END;
$function$;


-- ── A1-15: factions lock once the draft starts, in the database ───────────────────────
CREATE OR REPLACE FUNCTION public.league_members_lock_faction_after_draft()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- The app client arrives as 'authenticated' (or 'anon'); SECURITY DEFINER functions run
  -- as postgres and pass through (randomize_unassigned_factions checks not_started itself).
  IF current_user IN ('authenticated', 'anon')
     AND NEW.faction IS DISTINCT FROM OLD.faction
     AND (SELECT draft_status FROM public.uff_leagues WHERE id = NEW.league_id) <> 'not_started'
  THEN
    RAISE EXCEPTION 'Factions are locked once the draft starts.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS league_members_lock_faction_after_draft ON public.league_members;
CREATE TRIGGER league_members_lock_faction_after_draft
  BEFORE UPDATE OF faction ON public.league_members
  FOR EACH ROW EXECUTE FUNCTION public.league_members_lock_faction_after_draft();

-- ── A1-08, A1-11, A1-12: three INSERT/UPDATE policies that bypassed the RPCs ──────────
-- start_draft deals powers, swap_foresight_powers moves them, propose_trade inserts trades,
-- make_draft_pick/force_autopick/commissioner_draft_pick insert picks — all as the function
-- owner. No app path writes these tables directly (checked in src/ and supabase/functions).
DROP POLICY IF EXISTS "members insert own draft_power_assignments" ON public.draft_power_assignments;
DROP POLICY IF EXISTS "members update own draft_power_assignments" ON public.draft_power_assignments;
DROP POLICY IF EXISTS "proposer can create trade"                  ON public.uff_trades;
DROP POLICY IF EXISTS "members make own draft picks"               ON public.uff_draft_picks;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.draft_power_assignments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.uff_trades              FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.uff_draft_picks         FROM anon;
