-- Pin five more draft powers to round ranges (2026-09-07)
--
-- The weight+jitter ranking in start_draft clusters powers into the SAME round
-- for nearly every manager, because the weight tiers sit ~1 apart while the
-- jitter is only random()*3. Measured on the live 2026-09-07 draft of
-- "The First War" (14 managers):
--   round 1  : Gunslinger    x11  (weight 2 = lowest of all 16 -> forced QB run)
--   round 13 : Vampire Bite  x9
--   round 14 : Hero's Shield x11  (dead round -- Draft Heist is disabled)
--   round 15 : Iron Defense  x8 / Sniper x6
--   round 16 : Sniper        x8 / Iron Defense x6
--
-- Fix: pin Gunslinger(4-9), Vampire Bite(8-13), Hero's Shield(8-12) and
-- Iron Defense/Sniper(15,16 one each), using the same pattern Shadow Guard(1-5)
-- and Power Negation(3-7) already use. Seven pins + nine ranked = 16 rounds.
-- Ranges are provably always satisfiable: see the migration note in CLAUDE.md.
--
-- Affects FUTURE drafts only -- start_draft runs once, when a draft begins.

CREATE OR REPLACE FUNCTION public.start_draft(p_league_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $startdraft_pins$
DECLARE
  v_commissioner_id uuid;
  v_gs_round int;
  v_vb_round int;
  v_hs_round int;
  v_id_round int;
  v_sn_round int;
  v_draft_status text;
  v_max_teams int;
  v_member_ids uuid[];
  v_shuffled_order uuid[];
  v_member_id uuid;
  v_power_ids smallint[];
  v_unassigned_count int;
  v_sg_round int;
  v_pn_round int;
  i int;
  j int;
  tmp_uuid uuid;
BEGIN
  SELECT commissioner_id, draft_status, max_teams
  INTO v_commissioner_id, v_draft_status, v_max_teams
  FROM uff_leagues WHERE id = p_league_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF auth.uid() IS NOT NULL THEN
    IF auth.uid() != v_commissioner_id THEN
      RAISE EXCEPTION 'Only the commissioner can start the draft';
    END IF;
  ELSIF v_commissioner_id != p_user_id THEN
    RAISE EXCEPTION 'Only the commissioner can start the draft';
  END IF;
  IF v_draft_status != 'not_started' THEN RAISE EXCEPTION 'Draft has already started'; END IF;

  SELECT COUNT(*) INTO v_unassigned_count
  FROM league_members WHERE league_id = p_league_id AND faction IS NULL;
  IF v_unassigned_count > 0 THEN
    RAISE EXCEPTION 'All % manager(s) must choose a faction before the draft can start', v_unassigned_count;
  END IF;

  SELECT ARRAY_AGG(id ORDER BY joined_at)
  INTO v_member_ids
  FROM league_members WHERE league_id = p_league_id;

  -- Shuffle the draft order (Fisher-Yates)
  v_shuffled_order := v_member_ids;
  FOR i IN REVERSE array_length(v_shuffled_order, 1)..2 LOOP
    j := floor(random() * i)::int + 1;
    tmp_uuid := v_shuffled_order[i];
    v_shuffled_order[i] := v_shuffled_order[j];
    v_shuffled_order[j] := tmp_uuid;
  END LOOP;

  UPDATE uff_leagues
  SET draft_order = to_jsonb(v_shuffled_order),
      draft_status = 'in_progress',
      draft_started_at = now()
  WHERE id = p_league_id;

  -- 9 powers rank by weight here. SEVEN are pinned to round ranges below:
  -- Shadow Guard(9), Power Negation(10), Gunslinger(11), Vampire Bite(16),
  -- Hero's Shield(4), Iron Defense(5), Sniper(12). (id 7 = cut Extra Roster Spot.)
  -- 9 + 7 pinned = 16, one per round for rounds 1-16.
  v_power_ids := ARRAY[1,2,3,6,8,13,14,15,17]::smallint[];

  -- Round-aware placement: lower weight => earlier round; jitter keeps it random
  -- per manager. Late-tier weights (14) always sort after everyone else.
  FOREACH v_member_id IN ARRAY v_shuffled_order LOOP
    -- Shadow Guard (9): random EARLY round 1-5 so it can shield a genuinely
    -- draftable player and act as a real Vampire Bite counter.
    v_sg_round := floor(random() * 5)::int + 1;   -- 1..5

    -- Power Negation (10): random round 3-7 (distinct from Shadow Guard) so its
    -- half-scoring cost lands on a startable player — that makes the Power Restore
    -- Chip worth holding. It used to sit in the last throwaway round on a scrub,
    -- where restoring it was pointless.
    SELECT r INTO v_pn_round
    FROM generate_series(3, 7) AS r
    WHERE r <> v_sg_round
    ORDER BY random() LIMIT 1;

    -- Gunslinger (11): QB power. It carried the LOWEST weight (2) of all 16, and
    -- the weight tiers sit ~1 apart against random()*3 jitter, so the ranking
    -- handed it round 1 to nearly everyone -- 11 of 14 managers in the 2026-09-07
    -- draft, turning round 1 into a forced QB run. Pinned to 4-9, where QBs
    -- actually go in full PPR.
    SELECT r INTO v_gs_round
    FROM generate_series(4, 9) AS r
    WHERE r <> v_sg_round AND r <> v_pn_round
    ORDER BY random() LIMIT 1;

    -- Vampire Bite (16): strong and interactive. Must never be round 1 -- Shadow
    -- Guard has to be placeable before any bite (that is why SG is pinned 1-5).
    SELECT r INTO v_vb_round
    FROM generate_series(8, 13) AS r
    WHERE r <> v_gs_round
    ORDER BY random() LIMIT 1;

    -- Hero's Shield (4): its ONLY effect is blocking a Draft Heist, so it must
    -- land in the window Draft Heist can appear in or it is a dead round. On
    -- 2026-09-07, 11 of 14 managers drew it in round 14 -- with Heist disabled,
    -- that was a wasted round for most of the league.
    SELECT r INTO v_hs_round
    FROM generate_series(8, 12) AS r
    WHERE r <> v_gs_round AND r <> v_vb_round
    ORDER BY random() LIMIT 1;

    -- Iron Defense (5, D/ST) and Sniper (12, K) take the last two rounds, one
    -- each in random order. Both previously shared weight 14 and landed here by
    -- accident; pinning makes it a guarantee instead of a coin flip.
    v_id_round := 15 + floor(random() * 2)::int;   -- 15 or 16
    v_sn_round := 31 - v_id_round;                 -- whichever one is left

    INSERT INTO draft_power_assignments (league_id, member_id, round, power_id) VALUES
      (p_league_id, v_member_id, v_sg_round, 9),
      (p_league_id, v_member_id, v_pn_round, 10),
      (p_league_id, v_member_id, v_gs_round, 11),
      (p_league_id, v_member_id, v_vb_round, 16),
      (p_league_id, v_member_id, v_hs_round, 4),
      (p_league_id, v_member_id, v_id_round, 5),
      (p_league_id, v_member_id, v_sn_round, 12);

    -- The other 9 powers rank by weight (+jitter) into the 9 remaining rounds
    -- (every round except the seven pinned above).
    INSERT INTO draft_power_assignments (league_id, member_id, round, power_id)
    SELECT p_league_id, v_member_id, slots.round, ranked.pid
    FROM (
      SELECT pid, row_number() OVER (ORDER BY
        CASE pid
          WHEN 6  THEN 3   -- Berserker Rage (RB)
          WHEN 15 THEN 3   -- Goal Line Hammer (RB)
          WHEN 13 THEN 4   -- Red Zone Menace (WR)
          WHEN 2  THEN 4   -- Reception Specialist (WR/RB/TE)
          WHEN 17 THEN 5   -- Seam Buster (TE)
          WHEN 14 THEN 5   -- Time Stone (any star)
          WHEN 8  THEN 6   -- Telepathy
          WHEN 3  THEN 6   -- Draft Heist
          WHEN 1  THEN 7   -- Foresight Coin
          ELSE 8
        END + random() * 3
      ) AS rnk
      FROM unnest(v_power_ids) AS pid
    ) ranked
    JOIN (
      SELECT r AS round, row_number() OVER (ORDER BY r) AS slot
      FROM generate_series(1, array_length(v_power_ids, 1) + 7) AS r
      WHERE r <> v_sg_round AND r <> v_pn_round AND r <> v_gs_round
        AND r <> v_vb_round AND r <> v_hs_round
        AND r <> v_id_round AND r <> v_sn_round
    ) slots ON slots.slot = ranked.rnk;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_waiver_bid(p_league_id uuid, p_player_id text, p_drop_player_id text, p_bid_amount smallint, p_week smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id   uuid;
  v_balance     smallint;
  v_faab_budget smallint;
  v_season      text;
  v_waiver_type text;
BEGIN
  SELECT lm.id, lm.faab_balance, l.faab_budget, l.season, l.waiver_type
    INTO v_member_id, v_balance, v_faab_budget, v_season, v_waiver_type
    FROM league_members lm
    JOIN uff_leagues    l ON l.id = lm.league_id
   WHERE lm.league_id = p_league_id AND lm.user_id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'Not a member of this league'; END IF;

  IF COALESCE(v_waiver_type, 'faab') = 'priority' THEN
    -- Priority claims carry no dollar amount; no FAAB budget required
    p_bid_amount := 0;
  ELSE
    IF COALESCE(v_faab_budget, 0) = 0 THEN RAISE EXCEPTION 'FAAB bidding is not enabled for this league'; END IF;
    IF p_bid_amount < 0 THEN RAISE EXCEPTION 'Bid amount cannot be negative'; END IF;
    IF COALESCE(v_balance, v_faab_budget) < p_bid_amount THEN
      RAISE EXCEPTION 'Bid of $% exceeds your FAAB balance ($%)', p_bid_amount, COALESCE(v_balance, v_faab_budget);
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM uff_roster_players
     WHERE league_id = p_league_id AND player_id = p_player_id AND dropped_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This player is already on a roster';
  END IF;

  UPDATE uff_waiver_bids
     SET status = 'cancelled'
   WHERE league_id = p_league_id AND member_id = v_member_id
     AND player_id = p_player_id AND week = p_week AND status = 'pending';

  INSERT INTO uff_waiver_bids
    (league_id, member_id, player_id, drop_player_id, bid_amount, week, season)
  VALUES
    (p_league_id, v_member_id, p_player_id, p_drop_player_id, p_bid_amount, p_week, v_season);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.swap_foresight_powers(p_league_id uuid, p_current_round smallint, p_swap_round smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id uuid;
  v_curr record;
  v_swap record;
BEGIN
  SELECT id INTO v_member_id FROM league_members
   WHERE league_id = p_league_id AND user_id = auth.uid();
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'Not a member of this league'; END IF;

  IF p_swap_round <= p_current_round OR p_swap_round > 16 THEN
    RAISE EXCEPTION 'Foresight Coin can only swap with a future round';
  END IF;

  SELECT id, power_id INTO v_curr FROM draft_power_assignments
   WHERE league_id = p_league_id AND member_id = v_member_id AND round = p_current_round FOR UPDATE;
  SELECT id, power_id INTO v_swap FROM draft_power_assignments
   WHERE league_id = p_league_id AND member_id = v_member_id AND round = p_swap_round FOR UPDATE;

  IF v_curr.id IS NULL OR v_swap.id IS NULL THEN
    RAISE EXCEPTION 'Power assignments not found';
  END IF;

  -- Foresight Coin is power_id 1; the caller must hold it in the current round
  IF v_curr.power_id != 1 THEN
    RAISE EXCEPTION 'You do not hold Foresight Coin this round';
  END IF;

  -- Swap via DELETE + re-INSERT. The UNIQUE(member_id, power_id) constraint is
  -- non-deferrable and checked per-row, so an in-place UPDATE swap (even a single
  -- CASE statement) violates it mid-statement. Delete both, then re-insert swapped.
  DELETE FROM draft_power_assignments WHERE id IN (v_curr.id, v_swap.id);
  INSERT INTO draft_power_assignments (league_id, member_id, round, power_id) VALUES
    (p_league_id, v_member_id, p_current_round, v_swap.power_id),
    (p_league_id, v_member_id, p_swap_round,    v_curr.power_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_draft_heist_order(p_league_id uuid, p_new_order jsonb, p_heist_state jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id     uuid;
  v_status        text;
  v_order         jsonb;
  v_heist         jsonb;
  v_max_teams     int;
  v_pick_count    int;
  v_current_round int;
BEGIN
  SELECT id INTO v_member_id FROM league_members
   WHERE league_id = p_league_id AND user_id = auth.uid();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Not a member of this league';
  END IF;

  SELECT draft_status, draft_order, heist_state, max_teams
    INTO v_status, v_order, v_heist, v_max_teams
    FROM uff_leagues WHERE id = p_league_id FOR UPDATE;

  IF v_status != 'in_progress' THEN RAISE EXCEPTION 'Draft is not in progress'; END IF;
  IF v_heist IS NOT NULL THEN RAISE EXCEPTION 'A heist is already active this round'; END IF;

  SELECT COUNT(*) INTO v_pick_count FROM uff_draft_picks WHERE league_id = p_league_id;
  v_current_round := ceil((v_pick_count + 1)::float / v_max_teams)::int;

  -- Caller must actually hold Draft Heist (power_id 3) this round
  IF NOT EXISTS (
    SELECT 1 FROM draft_power_assignments
     WHERE league_id = p_league_id AND member_id = v_member_id
       AND round = v_current_round AND power_id = 3
  ) THEN
    RAISE EXCEPTION 'You do not hold Draft Heist this round';
  END IF;

  -- The new order must be a permutation of the current draft order
  IF (SELECT COUNT(*) FROM jsonb_array_elements_text(v_order))
     != (SELECT COUNT(*) FROM jsonb_array_elements_text(p_new_order))
     OR EXISTS (
       SELECT value FROM jsonb_array_elements_text(v_order)
       EXCEPT
       SELECT value FROM jsonb_array_elements_text(p_new_order)
     ) THEN
    RAISE EXCEPTION 'Invalid draft order';
  END IF;

  UPDATE uff_leagues
     SET draft_order  = p_new_order,
         heist_state  = p_heist_state
   WHERE id = p_league_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_scoring_settings(p_league_id uuid, p_user_id uuid, p_settings jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = p_user_id) THEN
    RAISE EXCEPTION 'Only the commissioner can update scoring settings';
  END IF;
  UPDATE uff_leagues SET scoring_settings = p_settings WHERE id = p_league_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.veto_trade(p_trade_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trade           uff_trades%ROWTYPE;
  v_commissioner_id uuid;
BEGIN
  SELECT * INTO v_trade FROM uff_trades WHERE id = p_trade_id FOR UPDATE;
  IF v_trade.id IS NULL THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_trade.status != 'pending_review' THEN RAISE EXCEPTION 'Trade is not awaiting commissioner review'; END IF;

  SELECT commissioner_id INTO v_commissioner_id FROM uff_leagues WHERE id = v_trade.league_id;
  IF v_commissioner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the commissioner can veto trades';
  END IF;

  UPDATE uff_trades
     SET status = 'vetoed', veto_reason = p_reason, updated_at = now()
   WHERE id = p_trade_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.init_faab_balances(p_league_id uuid, p_amount smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the commissioner can set FAAB balances';
  END IF;
  UPDATE league_members SET faab_balance = p_amount
   WHERE league_id = p_league_id AND faab_balance IS NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_waiver_order(p_league_id uuid, p_member_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE i int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the commissioner can set waiver priority';
  END IF;
  IF p_member_ids IS NULL THEN RETURN; END IF;
  FOR i IN 1..array_length(p_member_ids, 1) LOOP
    UPDATE league_members SET waiver_priority = i
     WHERE id = p_member_ids[i] AND league_id = p_league_id;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.commissioner_draft_pick(p_league_id uuid, p_target_member_id uuid, p_player_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_draft_status    text;
  v_draft_order     jsonb;
  v_max_teams       int;
  v_draft_rounds    smallint;
  v_commissioner_id uuid;
  v_pick_count      int;
  v_total_picks     int;
  v_pick_no         int;
  v_round           int;
  v_pos_in_round    int;
  v_slot            int;
  v_member_id       uuid;
  v_already         int;
  v_pw_name     text;
  v_pw_cat      text;
  v_pw_tied     text;
  v_pw_slug     text;
  v_pos         text;
  v_member_user uuid;
  v_owner       uuid;
BEGIN
  SELECT draft_status, draft_order, max_teams, draft_rounds, commissioner_id
  INTO v_draft_status, v_draft_order, v_max_teams, v_draft_rounds, v_commissioner_id
  FROM uff_leagues WHERE id = p_league_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() != v_commissioner_id THEN
    RAISE EXCEPTION 'Only the commissioner can draft for another manager';
  END IF;

  IF v_draft_status != 'in_progress' THEN RAISE EXCEPTION 'Draft is not in progress'; END IF;

  SELECT COUNT(*) INTO v_pick_count FROM uff_draft_picks WHERE league_id = p_league_id;
  v_total_picks := v_max_teams * v_draft_rounds;
  IF v_pick_count >= v_total_picks THEN RAISE EXCEPTION 'Draft is already complete'; END IF;

  v_pick_no      := v_pick_count + 1;
  v_round        := ceil(v_pick_no::float / v_max_teams)::int;
  v_pos_in_round := v_pick_no - (v_round - 1) * v_max_teams;
  IF v_round % 2 = 1 THEN v_slot := v_pos_in_round;
  ELSE v_slot := v_max_teams - v_pos_in_round + 1; END IF;
  v_member_id := (v_draft_order->>(v_slot - 1))::uuid;
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'No member on the clock'; END IF;

  IF v_member_id != p_target_member_id THEN
    RAISE EXCEPTION 'That manager is not on the clock';
  END IF;

  SELECT COUNT(*) INTO v_already FROM uff_draft_picks WHERE league_id = p_league_id AND player_id = p_player_id;
  IF v_already > 0 THEN RAISE EXCEPTION 'That player has already been drafted'; END IF;

  INSERT INTO uff_draft_picks (league_id, round, pick_no, member_id, player_id)
  VALUES (p_league_id, v_round::smallint, v_pick_no, v_member_id, p_player_id);

  INSERT INTO uff_roster_players (league_id, member_id, player_id, added_at)
  VALUES (p_league_id, v_member_id, p_player_id, now());

  DELETE FROM draft_queue
  WHERE member_id = v_member_id AND league_id = p_league_id AND player_id = p_player_id;

  SELECT dp.name, dp.category, dp.tied_position
    INTO v_pw_name, v_pw_cat, v_pw_tied
  FROM draft_power_assignments dpa
  JOIN draft_powers dp ON dp.id = dpa.power_id
  WHERE dpa.league_id = p_league_id AND dpa.member_id = v_member_id AND dpa.round = v_round;

  IF v_pw_name IS NOT NULL
     AND v_pw_name NOT IN ('Vampire Bite', 'Foresight Coin', 'Draft Heist')
     AND v_pw_cat IS DISTINCT FROM 'draft_mechanic'
  THEN
    SELECT position INTO v_pos FROM players WHERE id = p_player_id;
    IF v_pw_tied IS NULL
       OR v_pw_tied = 'ANY'
       OR (v_pw_tied = 'WR/RB/TE' AND v_pos IN ('WR', 'RB', 'TE'))
       OR (v_pw_tied = 'D/ST'     AND v_pos = 'DEF')
       OR (v_pw_tied = v_pos)
    THEN
      SELECT user_id INTO v_member_user FROM league_members WHERE id = v_member_id;
      SELECT drafted_by_user_id INTO v_owner
        FROM player_draft_powers
        WHERE league_id = p_league_id AND player_id = p_player_id;
      IF v_owner IS NULL OR v_owner = v_member_user THEN
        v_pw_slug := lower(regexp_replace(v_pw_name, '[^a-zA-Z0-9]+', '_', 'g'));
        INSERT INTO player_draft_powers (league_id, player_id, power, round, drafted_by_user_id)
        VALUES (p_league_id, p_player_id, v_pw_slug, v_round, v_member_user)
        ON CONFLICT (league_id, player_id) DO UPDATE
          SET power = EXCLUDED.power, round = EXCLUDED.round, drafted_by_user_id = EXCLUDED.drafted_by_user_id;
      END IF;
    END IF;
  END IF;

  IF v_pick_count + 1 >= v_total_picks THEN
    UPDATE uff_leagues SET draft_status = 'completed', status = 'active' WHERE id = p_league_id;
    BEGIN
      PERFORM generate_schedule(p_league_id, v_commissioner_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN p_player_id;
END;
$startdraft_pins$;
