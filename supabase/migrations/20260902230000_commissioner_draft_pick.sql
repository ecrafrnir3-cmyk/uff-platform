-- APPLIED LIVE 2026-09-02 via Supabase MCP (commissioner_draft_pick).
-- New RPC: lets the COMMISSIONER draft a specific player FOR the manager currently
-- on the clock — for a no-show who can't attend the draft. Mirrors make_draft_pick's
-- insert core + force_autopick's power-attach (position-tied powers auto-attach,
-- interactive/mechanic powers are skipped), crediting the on-the-clock member. Guards:
-- caller must be the commissioner; the target must actually be on the clock (so a
-- proxy pick can never jump the draft order); no already-drafted player. Verified in
-- an isolated 14-team live draft: happy-path pick + RB power attach credited to the
-- target member; non-commissioner blocked; not-on-clock blocked; duplicate blocked.
-- Backs the "Draft for {team}" button in the draft room (commissioner-only).

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
$function$;
