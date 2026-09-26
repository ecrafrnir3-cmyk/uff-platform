-- 2026-09-26 — OPEN-LOOPS #76: the auto-generated schedule on the final draft pick only
-- fired when the caller happened to be the commissioner. make_draft_pick, force_autopick and
-- commissioner_draft_pick all did PERFORM generate_schedule(p_league_id, v_commissioner_id)
-- inside BEGIN … EXCEPTION WHEN OTHERS THEN NULL, and generate_schedule (rightly, since #72)
-- refuses anyone but the commissioner — so an ordinary manager making the last pick left the
-- league 'active' with no matchups and no error. The First War only got its schedule because
-- pick 224 came through a commissioner-credentialed call.
--
-- Fix: split the generator from the guard.
--   * generate_schedule_internal(p_league_id, p_weeks DEFAULT NULL) — the live body of
--     generate_schedule minus the caller check; p_weeks NULL means the league's own
--     season_weeks. EXECUTE is revoked from PUBLIC, anon and authenticated: only postgres
--     (i.e. the SECURITY DEFINER functions below) and service_role can call it.
--   * generate_schedule keeps its signature and its fail-closed commissioner guard and now
--     delegates to the internal function. The settings button behaves exactly as before.
--   * The three draft-pick functions call generate_schedule_internal(p_league_id) on the last
--     pick and log a WARNING with the reason if it fails, instead of swallowing it silently.
--
-- Every body is the LIVE pg_get_functiondef with exactly the lines above changed (generated,
-- asserted one match each, re-diffed after applying). Rollback: the pre-change bodies are
-- archived at One Mind/Archive/uff-76-pre-bodies-2026-09-26/, then
--   DROP FUNCTION public.generate_schedule_internal(uuid, smallint);
--
-- Applied live 2026-09-26 via the Supabase MCP as final_pick_schedule_does_not_depend_on_the_picker
-- (20260926140512). Re-diffed after apply: all five bodies identical. Proven in rolled-back blocks:
-- commissioner via generate_schedule reaches 'Schedule already exists'; a manager calling the
-- internal function gets permission denied; a 4-team league with season_weeks 4 produced 16
-- matchup rows and a 3-team league with 2 weeks produced 4 (one bye per week).

CREATE OR REPLACE FUNCTION public.generate_schedule_internal(p_league_id uuid, p_weeks smallint DEFAULT NULL::smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id uuid;
  v_season          text;
  v_weeks_cfg       smallint;
  v_member_ids      uuid[];
  v_n               int;
  v_teams           uuid[];
  v_dummy           uuid := gen_random_uuid();
  v_week            int;
  v_matchup_id      int;
  v_home            uuid;
  v_away            uuid;
  v_existing        int;
  i                 int;
  j                 int;
  tmp               uuid;
BEGIN
  SELECT commissioner_id, season, season_weeks INTO v_commissioner_id, v_season, v_weeks_cfg
  FROM uff_leagues WHERE id = p_league_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  -- No caller check here on purpose: this function is not executable by app roles.
  -- generate_schedule (commissioner only) and the three draft-pick functions call it.
  p_weeks := COALESCE(p_weeks, v_weeks_cfg, 14);

  IF p_weeks < 1 OR p_weeks > 18 THEN
    RAISE EXCEPTION 'season_weeks must be between 1 and 18';
  END IF;

  SELECT COUNT(*) INTO v_existing FROM uff_matchups WHERE league_id = p_league_id;
  IF v_existing > 0 THEN RAISE EXCEPTION 'Schedule already exists for this league'; END IF;

  SELECT ARRAY_AGG(id ORDER BY joined_at) INTO v_member_ids
  FROM league_members WHERE league_id = p_league_id;

  v_n := array_length(v_member_ids, 1);
  IF v_n < 2 THEN RAISE EXCEPTION 'Need at least 2 teams to generate a schedule'; END IF;

  IF v_n % 2 = 1 THEN
    v_teams := v_member_ids || ARRAY[v_dummy];
  ELSE
    v_teams := v_member_ids;
  END IF;

  UPDATE uff_leagues SET season_weeks = p_weeks WHERE id = p_league_id;

  v_matchup_id := 1;
  FOR v_week IN 1..p_weeks LOOP
    FOR i IN 1..(array_length(v_teams, 1) / 2) LOOP
      v_home := v_teams[i];
      v_away := v_teams[array_length(v_teams, 1) - i + 1];

      IF v_home != v_dummy AND v_away != v_dummy THEN
        INSERT INTO uff_matchups (matchup_id, league_id, week, season, member_id, points)
        VALUES
          (v_matchup_id, p_league_id, v_week::smallint, v_season, v_home, 0),
          (v_matchup_id, p_league_id, v_week::smallint, v_season, v_away, 0);
        v_matchup_id := v_matchup_id + 1;
      END IF;
    END LOOP;

    tmp := v_teams[array_length(v_teams, 1)];
    FOR j IN REVERSE array_length(v_teams, 1)..3 LOOP
      v_teams[j] := v_teams[j - 1];
    END LOOP;
    v_teams[2] := tmp;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_schedule(p_league_id uuid, p_user_id uuid, p_weeks smallint DEFAULT 14)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id uuid;
BEGIN
  SELECT commissioner_id INTO v_commissioner_id FROM uff_leagues WHERE id = p_league_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_commissioner_id THEN
    RAISE EXCEPTION 'Only the commissioner can generate the schedule';
  END IF;

  PERFORM generate_schedule_internal(p_league_id, p_weeks);
END;
$function$;

CREATE OR REPLACE FUNCTION public.make_draft_pick(p_league_id uuid, p_user_id uuid, p_player_id text)
 RETURNS jsonb
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
  v_current_pick_no int;
  v_current_round   int;
  v_round_pick_pos  int;
  v_draft_slot      int;
  v_member_id       uuid;
  v_current_member_id uuid;
  v_already_picked  int;
BEGIN
  -- Session-verified identity, fail closed: a direct RPC call cannot pick as
  -- someone else, and a caller with no session is refused (OPEN-LOOPS #77).
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only make picks as yourself';
  END IF;

  -- FOR UPDATE locks the league row so concurrent pick attempts serialize
  SELECT draft_status, draft_order, max_teams, draft_rounds, commissioner_id
  INTO v_draft_status, v_draft_order, v_max_teams, v_draft_rounds, v_commissioner_id
  FROM uff_leagues WHERE id = p_league_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF v_draft_status != 'in_progress' THEN RAISE EXCEPTION 'Draft is not in progress'; END IF;

  SELECT COUNT(*) INTO v_pick_count FROM uff_draft_picks WHERE league_id = p_league_id;

  v_total_picks := v_max_teams * v_draft_rounds;
  IF v_pick_count >= v_total_picks THEN RAISE EXCEPTION 'Draft is already complete'; END IF;

  v_current_pick_no  := v_pick_count + 1;
  v_current_round    := ceil(v_current_pick_no::float / v_max_teams)::int;
  v_round_pick_pos   := v_current_pick_no - (v_current_round - 1) * v_max_teams;

  IF v_current_round % 2 = 1 THEN
    v_draft_slot := v_round_pick_pos;
  ELSE
    v_draft_slot := v_max_teams - v_round_pick_pos + 1;
  END IF;

  v_current_member_id := (v_draft_order->>(v_draft_slot - 1))::uuid;

  SELECT id INTO v_member_id FROM league_members
  WHERE league_id = p_league_id AND user_id = p_user_id;

  IF v_member_id IS NULL THEN RAISE EXCEPTION 'You are not in this league'; END IF;
  IF v_member_id != v_current_member_id THEN RAISE EXCEPTION 'It is not your turn to pick'; END IF;

  SELECT COUNT(*) INTO v_already_picked
  FROM uff_draft_picks WHERE league_id = p_league_id AND player_id = p_player_id;
  IF v_already_picked > 0 THEN RAISE EXCEPTION 'That player has already been drafted'; END IF;

  INSERT INTO uff_draft_picks (league_id, round, pick_no, member_id, player_id)
  VALUES (p_league_id, v_current_round::smallint, v_current_pick_no, v_member_id, p_player_id);

  INSERT INTO uff_roster_players (league_id, member_id, player_id, added_at)
  VALUES (p_league_id, v_member_id, p_player_id, now());

  -- On last pick: flip status, then auto-generate schedule
  IF v_pick_count + 1 >= v_total_picks THEN
    UPDATE uff_leagues
    SET draft_status = 'completed', status = 'active'
    WHERE id = p_league_id;

    BEGIN
      PERFORM generate_schedule_internal(p_league_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Draft complete for league % but the schedule was not generated: % (the commissioner can press Generate schedule)', p_league_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'pick_no', v_current_pick_no,
    'round', v_current_round,
    'member_id', v_member_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.force_autopick(p_league_id uuid)
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
  v_clock_secs      int;
  v_started_at      timestamptz;
  v_pick_count      int;
  v_total_picks     int;
  v_pick_no         int;
  v_round           int;
  v_pos_in_round    int;
  v_slot            int;
  v_member_id       uuid;
  v_anchor          timestamptz;
  v_buffer_secs     int := 0;
  v_deadline        timestamptz;
  v_player_id       text;
  -- power-attach locals
  v_pw_name     text;
  v_pw_cat      text;
  v_pw_tied     text;
  v_pw_slug     text;
  v_pos         text;
  v_member_user uuid;
  v_owner       uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM league_members WHERE league_id = p_league_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'You are not in this league';
  END IF;

  SELECT draft_status, draft_order, max_teams, draft_rounds, commissioner_id,
         pick_clock_seconds, draft_started_at
  INTO v_draft_status, v_draft_order, v_max_teams, v_draft_rounds, v_commissioner_id,
       v_clock_secs, v_started_at
  FROM uff_leagues WHERE id = p_league_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF v_draft_status != 'in_progress' THEN RAISE EXCEPTION 'Draft is not in progress'; END IF;
  IF v_clock_secs IS NULL THEN RAISE EXCEPTION 'No pick clock configured for this league'; END IF;

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

  SELECT max(picked_at) INTO v_anchor FROM uff_draft_picks WHERE league_id = p_league_id;
  IF v_anchor IS NULL THEN v_anchor := v_started_at; END IF;
  IF v_anchor IS NULL THEN RAISE EXCEPTION 'No clock anchor for this pick'; END IF;

  IF (v_pick_no - 1) % v_max_teams = 0 THEN v_buffer_secs := 30; END IF;
  v_deadline := v_anchor + make_interval(secs => v_buffer_secs + v_clock_secs + 15);
  IF now() < v_deadline THEN
    RAISE EXCEPTION 'Pick clock has not expired yet';
  END IF;

  -- Queue-top of the on-the-clock member, else best available ADP
  SELECT q.player_id INTO v_player_id
  FROM draft_queue q
  WHERE q.member_id = v_member_id AND q.league_id = p_league_id
    AND NOT EXISTS (SELECT 1 FROM uff_draft_picks dp
                    WHERE dp.league_id = p_league_id AND dp.player_id = q.player_id)
  ORDER BY q.position ASC
  LIMIT 1;

  IF v_player_id IS NULL THEN
    SELECT p.id INTO v_player_id
    FROM players p
    WHERE p.adp IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM uff_draft_picks dp
                      WHERE dp.league_id = p_league_id AND dp.player_id = p.id)
    ORDER BY p.adp ASC
    LIMIT 1;
  END IF;

  IF v_player_id IS NULL THEN RAISE EXCEPTION 'No available player to autopick'; END IF;

  -- Pick-insert core — mirrors make_draft_pick
  INSERT INTO uff_draft_picks (league_id, round, pick_no, member_id, player_id)
  VALUES (p_league_id, v_round::smallint, v_pick_no, v_member_id, v_player_id);

  INSERT INTO uff_roster_players (league_id, member_id, player_id, added_at)
  VALUES (p_league_id, v_member_id, v_player_id, now());

  DELETE FROM draft_queue
  WHERE member_id = v_member_id AND league_id = p_league_id AND player_id = v_player_id;

  -- ── Attach the round's draft power to the auto-picked player ────────────────
  -- Mirrors the client assignPowerToPick + self-autodraft rules so a manager who
  -- is force-autopicked while offline keeps the power they were dealt for this
  -- round instead of silently losing it. Never attaches the interactive powers
  -- (Vampire Bite / Foresight Coin / Draft Heist) or the draft-mechanic powers;
  -- a position-tied power attaches only when the picked player's position matches
  -- (otherwise it fizzles, exactly like a mismatched manual/self-autodraft pick).
  -- The power is credited to the ON-THE-CLOCK member (the offline manager), never
  -- to auth.uid() (the peer client that fired the safety-net force).
  SELECT dp.name, dp.category, dp.tied_position
    INTO v_pw_name, v_pw_cat, v_pw_tied
  FROM draft_power_assignments dpa
  JOIN draft_powers dp ON dp.id = dpa.power_id
  WHERE dpa.league_id = p_league_id AND dpa.member_id = v_member_id AND dpa.round = v_round;

  IF v_pw_name IS NOT NULL
     AND v_pw_name NOT IN ('Vampire Bite', 'Foresight Coin', 'Draft Heist')
     AND v_pw_cat IS DISTINCT FROM 'draft_mechanic'
  THEN
    SELECT position INTO v_pos FROM players WHERE id = v_player_id;
    IF v_pw_tied IS NULL
       OR v_pw_tied = 'ANY'
       OR (v_pw_tied = 'WR/RB/TE' AND v_pos IN ('WR', 'RB', 'TE'))
       OR (v_pw_tied = 'D/ST'     AND v_pos = 'DEF')
       OR (v_pw_tied = v_pos)
    THEN
      SELECT user_id INTO v_member_user FROM league_members WHERE id = v_member_id;
      SELECT drafted_by_user_id INTO v_owner
        FROM player_draft_powers
        WHERE league_id = p_league_id AND player_id = v_player_id;
      IF v_owner IS NULL OR v_owner = v_member_user THEN
        v_pw_slug := lower(regexp_replace(v_pw_name, '[^a-zA-Z0-9]+', '_', 'g'));
        INSERT INTO player_draft_powers (league_id, player_id, power, round, drafted_by_user_id)
        VALUES (p_league_id, v_player_id, v_pw_slug, v_round, v_member_user)
        ON CONFLICT (league_id, player_id) DO UPDATE
          SET power = EXCLUDED.power,
              round = EXCLUDED.round,
              drafted_by_user_id = EXCLUDED.drafted_by_user_id;
      END IF;
    END IF;
  END IF;

  IF v_pick_count + 1 >= v_total_picks THEN
    UPDATE uff_leagues
    SET draft_status = 'completed', status = 'active'
    WHERE id = p_league_id;

    BEGIN
      PERFORM generate_schedule_internal(p_league_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Draft complete for league % but the schedule was not generated: % (the commissioner can press Generate schedule)', p_league_id, SQLERRM;
    END;
  END IF;

  RETURN v_player_id;
END;
$function$;

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
  -- power-attach locals (same rules as force_autopick)
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

  -- Commissioner-only, fail closed: a caller with no session (anon, or the SQL
  -- console as postgres) is refused, never waved through (OPEN-LOOPS #77).
  IF auth.uid() IS NULL OR auth.uid() <> v_commissioner_id THEN
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

  -- The commissioner can only pick for the manager who is actually on the clock,
  -- so a proxy pick can never jump the draft order.
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

  -- Attach the round's draft power to the picked player, crediting the ON-THE-CLOCK
  -- member (the one being proxy-drafted for) — identical rules to force_autopick:
  -- skip interactive powers (Vampire Bite / Foresight Coin / Draft Heist) and
  -- draft_mechanic powers; a position-tied power attaches only on a matching
  -- position (else it fizzles); never overwrite another manager's power.
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
      PERFORM generate_schedule_internal(p_league_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Draft complete for league % but the schedule was not generated: % (the commissioner can press Generate schedule)', p_league_id, SQLERRM;
    END;
  END IF;

  RETURN p_player_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.generate_schedule_internal(uuid, smallint) FROM PUBLIC, anon, authenticated;
