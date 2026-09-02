-- APPLIED LIVE 2026-09-02 via Supabase MCP.
-- Commissioner proxy — INTERACTIVE draft powers. When the commissioner drafts for
-- a no-show (commissioner_draft_pick), that team's position-tied powers auto-attach,
-- but its INTERACTIVE powers (Vampire Bite / Foresight Coin / Draft Heist) need a
-- choice. These let the commissioner make that choice AS the on-clock team. Every
-- RPC re-checks commissioner identity + that the acting member actually holds the
-- power that round, server-side, so none of this can be driven by a non-commish.
--
-- Also fixes a LATENT bug in the member-facing swap_foresight_powers: the
-- UNIQUE(member_id, power_id) constraint on draft_power_assignments is
-- non-deferrable and checked per-row, so the old two-UPDATE swap (and even a
-- single-statement CASE swap) violates it mid-statement. The swap must be done as
-- DELETE + re-INSERT. This never surfaced because no real draft had run yet.
-- Verified in an isolated 14-team live draft: VB happy + non-commish + own-player;
-- Foresight happy + non-commish; Heist happy + non-commish + Hero's-Shield block.

-- ── Vampire Bite (post-pick): bite an opponent's drafted player for the team ────
CREATE OR REPLACE FUNCTION public.commissioner_vampire_bite(p_league_id uuid, p_acting_member_id uuid, p_target_player_id text, p_round integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the commissioner can act for another manager';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM draft_power_assignments
                 WHERE league_id = p_league_id AND member_id = p_acting_member_id AND round = p_round AND power_id = 16) THEN
    RAISE EXCEPTION 'That manager does not hold Vampire Bite this round';
  END IF;
  IF EXISTS (SELECT 1 FROM uff_roster_players
             WHERE league_id = p_league_id AND player_id = p_target_player_id AND member_id = p_acting_member_id AND dropped_at IS NULL) THEN
    RAISE EXCEPTION 'Cannot bite your own player — choose an opponent''s player';
  END IF;
  IF EXISTS (SELECT 1 FROM player_draft_powers
             WHERE league_id = p_league_id AND player_id = p_target_player_id AND power = 'shadow_guard') THEN
    RAISE EXCEPTION 'That player is protected by Shadow Guard — the bite fizzles. Choose a different target.';
  END IF;
  INSERT INTO vampire_bites (league_id, biting_member_id, target_player_id, round)
  VALUES (p_league_id, p_acting_member_id, p_target_player_id, p_round);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That player has already been bitten. Choose someone else.';
END;
$function$;

-- ── Draft Heist (pre-pick): swap the team's draft slot with a target's ─────────
CREATE OR REPLACE FUNCTION public.commissioner_heist(p_league_id uuid, p_acting_member_id uuid, p_target_member_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_status text; v_order jsonb; v_heist jsonb; v_max_teams int; v_pick_count int; v_current_round int;
  v_a int; v_b int; v_new_order jsonb; v_target_team text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the commissioner can act for another manager';
  END IF;

  SELECT draft_status, draft_order, heist_state, max_teams
    INTO v_status, v_order, v_heist, v_max_teams
    FROM uff_leagues WHERE id = p_league_id FOR UPDATE;

  IF v_status != 'in_progress' THEN RAISE EXCEPTION 'Draft is not in progress'; END IF;
  IF v_heist IS NOT NULL THEN RAISE EXCEPTION 'A heist is already active this round'; END IF;

  SELECT COUNT(*) INTO v_pick_count FROM uff_draft_picks WHERE league_id = p_league_id;
  v_current_round := ceil((v_pick_count + 1)::float / v_max_teams)::int;

  IF NOT EXISTS (SELECT 1 FROM draft_power_assignments
                 WHERE league_id = p_league_id AND member_id = p_acting_member_id AND round = v_current_round AND power_id = 3) THEN
    RAISE EXCEPTION 'That manager does not hold Draft Heist this round';
  END IF;

  -- Blocked if the target holds Hero's Shield this round
  IF EXISTS (SELECT 1 FROM draft_power_assignments
             WHERE league_id = p_league_id AND member_id = p_target_member_id AND round = v_current_round AND power_id = 4) THEN
    SELECT team_name INTO v_target_team FROM league_members WHERE id = p_target_member_id;
    RETURN jsonb_build_object('blocked', true, 'blockerTeam', COALESCE(v_target_team, 'that team'));
  END IF;

  -- Positions in draft_order (0-based jsonb index)
  SELECT ord - 1 INTO v_a FROM (SELECT value, row_number() OVER () AS ord FROM jsonb_array_elements_text(v_order)) t WHERE value = p_acting_member_id::text;
  SELECT ord - 1 INTO v_b FROM (SELECT value, row_number() OVER () AS ord FROM jsonb_array_elements_text(v_order)) t WHERE value = p_target_member_id::text;
  IF v_a IS NULL OR v_b IS NULL THEN RAISE EXCEPTION 'Could not find draft positions'; END IF;

  v_new_order := jsonb_set(jsonb_set(v_order, ARRAY[v_a::text], v_order->v_b), ARRAY[v_b::text], v_order->v_a);

  UPDATE uff_leagues
     SET draft_order = v_new_order,
         heist_state = jsonb_build_object('round', v_current_round, 'memberA', p_acting_member_id, 'memberB', p_target_member_id, 'originalOrder', v_order)
   WHERE id = p_league_id;

  RETURN jsonb_build_object('blocked', false);
END;
$function$;

-- ── Foresight Coin (post-pick): swap this round's power with a future round ─────
-- Swap via DELETE + re-INSERT (a plain UPDATE swap violates the immediate
-- UNIQUE(member_id, power_id) mid-statement).
CREATE OR REPLACE FUNCTION public.commissioner_foresight_swap(p_league_id uuid, p_acting_member_id uuid, p_current_round smallint, p_swap_round smallint)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_curr record; v_swap record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the commissioner can act for another manager';
  END IF;
  IF p_swap_round <= p_current_round OR p_swap_round > 16 THEN
    RAISE EXCEPTION 'Foresight Coin can only swap with a future round';
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

-- ── Member-facing Foresight fix (same delete+insert swap) ──────────────────────
CREATE OR REPLACE FUNCTION public.swap_foresight_powers(p_league_id uuid, p_current_round smallint, p_swap_round smallint)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_member_id uuid; v_curr record; v_swap record;
BEGIN
  SELECT id INTO v_member_id FROM league_members WHERE league_id = p_league_id AND user_id = auth.uid();
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'Not a member of this league'; END IF;
  IF p_swap_round <= p_current_round OR p_swap_round > 16 THEN
    RAISE EXCEPTION 'Foresight Coin can only swap with a future round';
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
