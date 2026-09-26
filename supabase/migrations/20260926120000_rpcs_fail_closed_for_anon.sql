-- 2026-09-26 — seven commissioner RPCs let a caller who is NOT the commissioner run them
-- (OPEN-LOOPS #72). Found 2026-09-24 by a verification sweep of the live database; one
-- of them was executed as `anon` with no JWT and it wrote a row.
--
-- Two shapes of the same bug, all SECURITY DEFINER (so RLS does not apply inside):
--
--   1. No auth.uid() at all — add_to_cant_cut, remove_from_cant_cut,
--      update_scoring_settings. Each compares a caller-SUPPLIED p_user_id to
--      uff_leagues.commissioner_id. Anyone who knows the commissioner's id can pass it.
--      The first two are also EXECUTE-able by anon, so no account is needed.
--
--   2. The null-permissive guard — generate_schedule, extend_schedule, seed_playoffs:
--          IF auth.uid() IS NOT NULL THEN
--            IF auth.uid() != v_commissioner_id THEN RAISE ... END IF;
--          ...
--      The real check only runs for a signed-in caller. anon's auth.uid() IS NULL, so
--      the wrapper skips it and the body runs: rewrite the season's matchups, add weeks
--      to a live season, seed the bracket — with the public anon key.
--
-- Fix, in order so the first part can be applied on its own:
--   a. REVOKE EXECUTE from PUBLIC/anon on the five anon-reachable functions and make the
--      intended `authenticated` grant explicit (same shape as 20260915130000).
--   b. Redefine all six so the guard FAILS CLOSED: auth.uid() must be non-null AND equal
--      the commissioner_id read from the league row. p_user_id stays in every signature
--      (the app and three internal callers pass it) but no longer decides anything.
--
-- Callers, checked before choosing fail-closed (details in the PR):
--   * settings/actions.ts calls all six through the cookie-based user client
--     (createClient from @/lib/supabase/server) — auth.uid() is the signed-in
--     commissioner, so the new guard passes for exactly the intended user.
--   * No caller in supabase/functions, scripts/, or .github/ — no service-role path.
--   * generate_schedule is ALSO called internally, on the final pick, by make_draft_pick,
--     force_autopick and commissioner_draft_pick, inside BEGIN ... EXCEPTION WHEN OTHERS
--     THEN NULL. They run with the picker's auth.uid(); the old guard already refused a
--     non-commissioner final picker there (auth.uid() was non-null and not the
--     commissioner), so this migration does not change that path. It is left as is —
--     not this finding's to fix — and the commissioner "Generate schedule" action
--     remains the working route.
--
-- seed_playoffs had no SET search_path; it gets the same `public` pin as its siblings.
--
-- Rollback: GRANT EXECUTE ... TO anon on the five, and the previous bodies are in
-- supabase/schema-snapshot/functions.sql at the parent commit of this change.

-- ── a. Privileges ─────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE keeps an existing function's ACL, so these revokes survive part b.

REVOKE EXECUTE ON FUNCTION public.add_to_cant_cut(uuid, uuid, text)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_from_cant_cut(uuid, uuid, text)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_schedule(uuid, uuid, smallint)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.extend_schedule(uuid, uuid, smallint)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.seed_playoffs(uuid, uuid)                 FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.add_to_cant_cut(uuid, uuid, text),
  public.remove_from_cant_cut(uuid, uuid, text),
  public.generate_schedule(uuid, uuid, smallint),
  public.extend_schedule(uuid, uuid, smallint),
  public.seed_playoffs(uuid, uuid)
TO authenticated;

-- ── b. Guards fail closed ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.add_to_cant_cut(p_league_id uuid, p_user_id uuid, p_player_id text)
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
    RAISE EXCEPTION 'Only the commissioner can manage the Can''t Cut List';
  END IF;

  INSERT INTO uff_cant_cut_list (league_id, player_id)
  VALUES (p_league_id, p_player_id)
  ON CONFLICT (league_id, player_id) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_from_cant_cut(p_league_id uuid, p_user_id uuid, p_player_id text)
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
    RAISE EXCEPTION 'Only the commissioner can manage the Can''t Cut List';
  END IF;

  DELETE FROM uff_cant_cut_list
  WHERE league_id = p_league_id AND player_id = p_player_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_scoring_settings(p_league_id uuid, p_user_id uuid, p_settings jsonb)
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
    RAISE EXCEPTION 'Only the commissioner can update scoring settings';
  END IF;

  UPDATE uff_leagues SET scoring_settings = p_settings WHERE id = p_league_id;
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
  v_season          text;
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
  SELECT commissioner_id, season INTO v_commissioner_id, v_season
  FROM uff_leagues WHERE id = p_league_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_commissioner_id THEN
    RAISE EXCEPTION 'Only the commissioner can generate the schedule';
  END IF;

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

CREATE OR REPLACE FUNCTION public.extend_schedule(p_league_id uuid, p_user_id uuid, p_new_weeks smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id uuid;
  v_season          text;
  v_member_ids      uuid[];
  v_n               int;
  v_teams           uuid[];
  v_dummy           uuid := gen_random_uuid();
  v_current_max     smallint;
  v_matchup_id      int;
  v_home            uuid;
  v_away            uuid;
  v_week            int;
  i                 int;
  j                 int;
  tmp               uuid;
BEGIN
  SELECT commissioner_id, season
    INTO v_commissioner_id, v_season
    FROM uff_leagues WHERE id = p_league_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_commissioner_id THEN
    RAISE EXCEPTION 'Only the commissioner can extend the schedule';
  END IF;
  IF p_new_weeks < 1 OR p_new_weeks > 18 THEN RAISE EXCEPTION 'season_weeks must be 1–18'; END IF;

  SELECT COALESCE(MAX(week), 0) INTO v_current_max
    FROM uff_matchups WHERE league_id = p_league_id AND is_playoff = false;

  IF p_new_weeks <= v_current_max THEN
    RAISE EXCEPTION 'New week count (%) must be greater than current max week (%)', p_new_weeks, v_current_max;
  END IF;

  SELECT ARRAY_AGG(id ORDER BY joined_at) INTO v_member_ids
    FROM league_members WHERE league_id = p_league_id;

  v_n := array_length(v_member_ids, 1);
  IF v_n < 2 THEN RAISE EXCEPTION 'Need at least 2 teams'; END IF;

  IF v_n % 2 = 1 THEN
    v_teams := v_member_ids || ARRAY[v_dummy];
  ELSE
    v_teams := v_member_ids;
  END IF;

  SELECT COALESCE(MAX(matchup_id), 0) + 1 INTO v_matchup_id
    FROM uff_matchups WHERE league_id = p_league_id;

  FOR v_week IN 1..v_current_max LOOP
    tmp := v_teams[array_length(v_teams, 1)];
    FOR j IN REVERSE array_length(v_teams, 1)..3 LOOP
      v_teams[j] := v_teams[j - 1];
    END LOOP;
    v_teams[2] := tmp;
  END LOOP;

  FOR v_week IN (v_current_max + 1)..p_new_weeks LOOP
    FOR i IN 1..(array_length(v_teams, 1) / 2) LOOP
      v_home := v_teams[i];
      v_away := v_teams[array_length(v_teams, 1) - i + 1];

      IF v_home != v_dummy AND v_away != v_dummy THEN
        INSERT INTO uff_matchups (matchup_id, league_id, week, season, member_id, points, is_playoff)
        VALUES
          (v_matchup_id, p_league_id, v_week::smallint, v_season, v_home, 0, false),
          (v_matchup_id, p_league_id, v_week::smallint, v_season, v_away, 0, false);
        v_matchup_id := v_matchup_id + 1;
      END IF;
    END LOOP;

    tmp := v_teams[array_length(v_teams, 1)];
    FOR j IN REVERSE array_length(v_teams, 1)..3 LOOP
      v_teams[j] := v_teams[j - 1];
    END LOOP;
    v_teams[2] := tmp;
  END LOOP;

  UPDATE uff_leagues SET season_weeks = p_new_weeks WHERE id = p_league_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seed_playoffs(p_league_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id   uuid;
  v_season            text;
  v_playoff_teams     smallint;
  v_playoff_start     smallint;
  v_championship_week smallint;
  v_seeds             uuid[];
  v_matchup_id        int;
BEGIN
  SELECT commissioner_id, season, playoff_teams, playoff_start_week, championship_week
    INTO v_commissioner_id, v_season, v_playoff_teams, v_playoff_start, v_championship_week
    FROM uff_leagues WHERE id = p_league_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_commissioner_id THEN
    RAISE EXCEPTION 'Only the commissioner can seed playoffs';
  END IF;

  IF EXISTS (SELECT 1 FROM uff_playoff_bracket WHERE league_id = p_league_id AND season = v_season) THEN
    RAISE EXCEPTION 'Playoff bracket already seeded for this season';
  END IF;

  IF v_playoff_teams NOT IN (4, 6, 8) THEN
    RAISE EXCEPTION 'Playoff teams must be 4, 6, or 8 (got %)', v_playoff_teams;
  END IF;

  -- Opponent join is league/season-scoped: matchup_id restarts at 1 per league
  SELECT ARRAY_AGG(member_id ORDER BY wins DESC, pf DESC)
    INTO v_seeds
    FROM (
      SELECT
        m.member_id,
        COUNT(*) FILTER (WHERE m.points > opp.points AND NOT m.void_result) AS wins,
        SUM(m.points) AS pf
      FROM uff_matchups m
      JOIN uff_matchups opp
        ON opp.league_id   = m.league_id
       AND opp.season      = m.season
       AND opp.matchup_id  = m.matchup_id
       AND opp.member_id  != m.member_id
      WHERE m.league_id   = p_league_id
        AND m.season      = v_season
        AND m.is_complete = true
        AND m.is_playoff  = false
      GROUP BY m.member_id
    ) standings
    LIMIT v_playoff_teams;

  IF array_length(v_seeds, 1) < v_playoff_teams THEN
    RAISE EXCEPTION 'Not enough teams with completed games to seed % playoff spots', v_playoff_teams;
  END IF;

  SELECT COALESCE(MAX(matchup_id), 0) + 1 INTO v_matchup_id FROM uff_matchups WHERE league_id = p_league_id;

  UPDATE league_members
     SET eliminated_at = now()
   WHERE league_id = p_league_id
     AND id NOT IN (SELECT unnest(v_seeds[1:v_playoff_teams]));

  IF v_playoff_teams = 4 THEN
    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b, member_id_a, member_id_b)
    VALUES
      (p_league_id, v_season, 1, v_playoff_start, 1, 1, 4, v_seeds[1], v_seeds[4]),
      (p_league_id, v_season, 1, v_playoff_start, 2, 2, 3, v_seeds[2], v_seeds[3]);

    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b)
    VALUES
      (p_league_id, v_season, 2, v_championship_week, 1, NULL, NULL);

    INSERT INTO uff_matchups (matchup_id, league_id, week, season, member_id, points, is_playoff, playoff_round)
    VALUES
      (v_matchup_id,     p_league_id, v_playoff_start, v_season, v_seeds[1], 0, true, 1),
      (v_matchup_id,     p_league_id, v_playoff_start, v_season, v_seeds[4], 0, true, 1),
      (v_matchup_id + 1, p_league_id, v_playoff_start, v_season, v_seeds[2], 0, true, 1),
      (v_matchup_id + 1, p_league_id, v_playoff_start, v_season, v_seeds[3], 0, true, 1);

  ELSIF v_playoff_teams = 6 THEN
    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b, member_id_a, member_id_b)
    VALUES
      (p_league_id, v_season, 1, v_playoff_start,     1, 3, 6, v_seeds[3], v_seeds[6]),
      (p_league_id, v_season, 1, v_playoff_start,     2, 4, 5, v_seeds[4], v_seeds[5]);

    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b, member_id_a, member_id_b)
    VALUES
      (p_league_id, v_season, 2, v_playoff_start + 1, 1, 1, NULL, v_seeds[1], NULL),
      (p_league_id, v_season, 2, v_playoff_start + 1, 2, 2, NULL, v_seeds[2], NULL);

    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b)
    VALUES
      (p_league_id, v_season, 3, v_championship_week, 1, NULL, NULL);

    INSERT INTO uff_matchups (matchup_id, league_id, week, season, member_id, points, is_playoff, playoff_round)
    VALUES
      (v_matchup_id,     p_league_id, v_playoff_start, v_season, v_seeds[3], 0, true, 1),
      (v_matchup_id,     p_league_id, v_playoff_start, v_season, v_seeds[6], 0, true, 1),
      (v_matchup_id + 1, p_league_id, v_playoff_start, v_season, v_seeds[4], 0, true, 1),
      (v_matchup_id + 1, p_league_id, v_playoff_start, v_season, v_seeds[5], 0, true, 1);

  ELSIF v_playoff_teams = 8 THEN
    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b, member_id_a, member_id_b)
    VALUES
      (p_league_id, v_season, 1, v_playoff_start, 1, 1, 8, v_seeds[1], v_seeds[8]),
      (p_league_id, v_season, 1, v_playoff_start, 2, 4, 5, v_seeds[4], v_seeds[5]),
      (p_league_id, v_season, 1, v_playoff_start, 3, 2, 7, v_seeds[2], v_seeds[7]),
      (p_league_id, v_season, 1, v_playoff_start, 4, 3, 6, v_seeds[3], v_seeds[6]);

    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b)
    VALUES
      (p_league_id, v_season, 2, v_playoff_start + 1, 1, NULL, NULL),
      (p_league_id, v_season, 2, v_playoff_start + 1, 2, NULL, NULL);

    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b)
    VALUES
      (p_league_id, v_season, 3, v_championship_week, 1, NULL, NULL);

    INSERT INTO uff_matchups (matchup_id, league_id, week, season, member_id, points, is_playoff, playoff_round)
    VALUES
      (v_matchup_id,     p_league_id, v_playoff_start, v_season, v_seeds[1], 0, true, 1),
      (v_matchup_id,     p_league_id, v_playoff_start, v_season, v_seeds[8], 0, true, 1),
      (v_matchup_id + 1, p_league_id, v_playoff_start, v_season, v_seeds[4], 0, true, 1),
      (v_matchup_id + 1, p_league_id, v_playoff_start, v_season, v_seeds[5], 0, true, 1),
      (v_matchup_id + 2, p_league_id, v_playoff_start, v_season, v_seeds[2], 0, true, 1),
      (v_matchup_id + 2, p_league_id, v_playoff_start, v_season, v_seeds[7], 0, true, 1),
      (v_matchup_id + 3, p_league_id, v_playoff_start, v_season, v_seeds[3], 0, true, 1),
      (v_matchup_id + 3, p_league_id, v_playoff_start, v_season, v_seeds[6], 0, true, 1);
  END IF;
END;
$function$;
