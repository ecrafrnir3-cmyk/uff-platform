-- 2026-09-26 — OPEN-LOOPS #77, part b: the six remaining members of the #72 bug class
-- (code audit 2026-09-25, findings A1-03 and A1-04) now FAIL CLOSED.
--
--   * finalize_week, start_draft: the IF auth.uid() IS NOT NULL THEN … ELSIF … p_user_id
--     shape — the caller-supplied id decided the outcome whenever there was no session.
--   * reset_waiver_priority, commissioner_draft_pick: IF auth.uid() IS NOT NULL AND … —
--     no session meant no check at all. Both were also EXECUTE-able by anon until part a
--     (20260926150000) revoked it.
--   * make_draft_pick: same AND-shape against p_user_id.
--   * randomize_unassigned_factions: zero auth.uid(); trusted p_user_id (the #55 shape).
--
-- Every body below is the LIVE pg_get_functiondef with exactly one guard block replaced
-- (generated, not retyped; verified by diff before and after applying). reset_waiver_priority
-- also gains SET search_path TO 'public' like every other SECURITY DEFINER function here.
-- p_user_id stays in every signature (the app passes it) but no longer decides anything.
--
-- Callers, all through the cookie-based user client (createClient from @/lib/supabase/server):
--   league/[id]/actions.ts (start_draft, randomize_unassigned_factions),
--   draft/actions.ts + draft/queue-actions.ts (make_draft_pick, commissioner_draft_pick),
--   matchups/actions.ts + settings/actions.ts (finalize_week), settings/actions.ts
--   (reset_waiver_priority). The weekly cron calls finalize_all_active_leagues, which does
--   NOT call finalize_week. No edge function, pg_cron job, trigger or DB function calls any
--   of the six, so no service-role path exists to break.
--
-- Consequence to remember: none of the six can be run from the SQL editor or the MCP as
-- postgres any more without first setting request.jwt.claims to the commissioner.
-- Rollback: the pre-change bodies are archived at
--   One Mind/Archive/uff-77-pre-bodies-2026-09-26/<function>.sql
-- and GRANTs are untouched by this file (CREATE OR REPLACE keeps the ACL).
--
-- Applied live 2026-09-26 via the Supabase MCP as six_more_rpcs_fail_closed (version 20260926132441);
-- all six bodies re-read with pg_get_functiondef afterwards and found identical to this file.

CREATE OR REPLACE FUNCTION public.reset_waiver_priority(p_league_id uuid, p_season integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id uuid;
  v_member RECORD;
  v_rank   INT := 1;
BEGIN
  SELECT commissioner_id INTO v_commissioner_id FROM uff_leagues WHERE id = p_league_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_commissioner_id THEN
    RAISE EXCEPTION 'Only the commissioner can reset waiver priority';
  END IF;

  -- Opponent join league/season-scoped; season cast fixes text=integer comparison
  FOR v_member IN
    SELECT
      lm.id,
      COALESCE(SUM(CASE
        WHEN um.points > opp.points AND NOT um.void_result THEN 1
        ELSE 0
      END), 0) AS wins,
      COALESCE(SUM(um.points), 0) AS pf
    FROM league_members lm
    LEFT JOIN uff_matchups um ON um.member_id = lm.id
      AND um.league_id = p_league_id
      AND um.season    = p_season::text
      AND um.is_complete = TRUE
    LEFT JOIN uff_matchups opp ON opp.league_id = p_league_id
      AND opp.season     = p_season::text
      AND opp.matchup_id = um.matchup_id
      AND opp.member_id != lm.id
    WHERE lm.league_id = p_league_id
    GROUP BY lm.id
    ORDER BY wins ASC, pf ASC
  LOOP
    UPDATE league_members SET waiver_priority = v_rank WHERE id = v_member.id;
    v_rank := v_rank + 1;
  END LOOP;
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
      PERFORM generate_schedule(p_league_id, v_commissioner_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN p_player_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_week(p_league_id uuid, p_user_id uuid, p_week integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id uuid;
  v_max_teams       int;
  v_top_member_id   uuid;
  v_chip_count      int;
  v_median_scoring  boolean;
  v_median_score    numeric;
  v_hero_wins       int;
  v_villain_wins    int;
  v_hero_pts        numeric;
  v_villain_pts     numeric;
  v_winning_faction text;
  v_member          record;
  v_available_token int;
BEGIN
  SELECT commissioner_id, max_teams, median_scoring
    INTO v_commissioner_id, v_max_teams, v_median_scoring
    FROM uff_leagues
   WHERE id = p_league_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF auth.uid() IS NULL OR auth.uid() <> v_commissioner_id THEN
    RAISE EXCEPTION 'Only the commissioner can finalize a week';
  END IF;

  UPDATE uff_matchups
     SET is_complete = true
   WHERE league_id = p_league_id
     AND week = p_week::smallint;

  UPDATE uff_matchups m
     SET void_result = true
    FROM (
      SELECT loser_id
      FROM (
        SELECT
          CASE WHEN a.points < b.points THEN a.member_id
               WHEN b.points < a.points THEN b.member_id
               ELSE NULL
          END AS loser_id
        FROM uff_matchups a
        JOIN uff_matchups b
          ON  b.league_id  = a.league_id
          AND b.week       = a.week
          AND b.matchup_id = a.matchup_id
          AND b.member_id  > a.member_id
        WHERE a.league_id = p_league_id
          AND a.week = p_week::smallint
          AND a.points <> b.points
      ) losers
      WHERE loser_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM weekly_token_assignments wta
          WHERE wta.league_id = p_league_id
            AND wta.member_id = losers.loser_id
            AND wta.week      = p_week::smallint
            AND wta.token_id  = 11
            AND wta.status    = 'pending'
        )
    ) insurance_losers
   WHERE m.league_id  = p_league_id
     AND m.week       = p_week::smallint
     AND m.member_id  = insurance_losers.loser_id;

  IF v_median_scoring THEN
    SELECT AVG(pts) INTO v_median_score
      FROM (
        SELECT points AS pts,
               ROW_NUMBER() OVER (ORDER BY points) AS rn,
               COUNT(*) OVER () AS cnt
          FROM uff_matchups
         WHERE league_id   = p_league_id
           AND week        = p_week::smallint
           AND is_playoff  = false
      ) ranked
     WHERE rn IN (FLOOR((cnt + 1) / 2.0), CEIL((cnt + 1) / 2.0));

    UPDATE uff_matchups
       SET median_win = (points > v_median_score)
     WHERE league_id  = p_league_id
       AND week       = p_week::smallint
       AND is_playoff = false;
  END IF;

  -- Parity with the cron path: consume this week's tokens
  UPDATE weekly_token_assignments
     SET status = 'used',
         used_at = now()
   WHERE league_id = p_league_id
     AND week = p_week::smallint
     AND status = 'pending';

  PERFORM advance_playoff_bracket(p_league_id, p_week::smallint);

  SELECT member_id
    INTO v_top_member_id
    FROM uff_matchups
   WHERE league_id  = p_league_id
     AND week       = p_week::smallint
     AND is_playoff = false
   ORDER BY points DESC NULLS LAST
   LIMIT 1;

  IF v_top_member_id IS NOT NULL THEN
    SELECT count(*) INTO v_chip_count
      FROM power_restore_chips
     WHERE league_id = p_league_id
       AND used = false;

    IF v_chip_count < v_max_teams THEN
      INSERT INTO power_restore_chips (league_id, member_id, earned_week)
      VALUES (p_league_id, v_top_member_id, p_week::smallint)
      ON CONFLICT (member_id, earned_week) DO NOTHING;
    END IF;
  END IF;

  -- Parity with the cron path: faction-war token award for NEXT week
  WITH matchup_pairs AS (
    SELECT
      a.matchup_id,
      a.member_id  AS member_a,
      b.member_id  AS member_b,
      a.points     AS pts_a,
      b.points     AS pts_b,
      CASE
        WHEN a.points > b.points THEN a.member_id
        WHEN b.points > a.points THEN b.member_id
        ELSE NULL
      END          AS winner_id,
      CASE
        WHEN a.points > b.points THEN a.points
        WHEN b.points > a.points THEN b.points
        ELSE NULL
      END          AS winner_pts
    FROM uff_matchups a
    JOIN uff_matchups b
      ON  b.league_id  = a.league_id
      AND b.week       = a.week
      AND b.matchup_id = a.matchup_id
      AND b.member_id  > a.member_id
    WHERE a.league_id = p_league_id
      AND a.week      = p_week::smallint
      AND a.is_playoff = false
  ),
  winner_factions AS (
    SELECT mp.winner_id AS member_id,
           lm.faction::text AS faction,
           mp.winner_pts
    FROM matchup_pairs mp
    JOIN league_members lm ON lm.id = mp.winner_id
    WHERE mp.winner_id IS NOT NULL
  ),
  faction_stats AS (
    SELECT faction,
           COUNT(*)::int    AS wins,
           SUM(winner_pts)  AS total_pts
    FROM winner_factions
    GROUP BY faction
  )
  SELECT
    COALESCE(MAX(CASE WHEN faction = 'hero'    THEN wins      END), 0),
    COALESCE(MAX(CASE WHEN faction = 'villain' THEN wins      END), 0),
    COALESCE(MAX(CASE WHEN faction = 'hero'    THEN total_pts END), 0),
    COALESCE(MAX(CASE WHEN faction = 'villain' THEN total_pts END), 0)
  INTO v_hero_wins, v_villain_wins, v_hero_pts, v_villain_pts
  FROM faction_stats;

  IF    v_hero_wins > v_villain_wins    THEN v_winning_faction := 'hero';
  ELSIF v_villain_wins > v_hero_wins    THEN v_winning_faction := 'villain';
  ELSIF v_hero_pts  > v_villain_pts     THEN v_winning_faction := 'hero';
  ELSIF v_villain_pts > v_hero_pts      THEN v_winning_faction := 'villain';
  ELSE                                       v_winning_faction := 'all';
  END IF;

  IF p_week < 18 THEN
    FOR v_member IN
      WITH pairs AS (
        SELECT
          a.member_id AS member_a, b.member_id AS member_b,
          a.points    AS pts_a,    b.points    AS pts_b
        FROM uff_matchups a
        JOIN uff_matchups b
          ON  b.league_id  = a.league_id
          AND b.week       = a.week
          AND b.matchup_id = a.matchup_id
          AND b.member_id  > a.member_id
        WHERE a.league_id = p_league_id
          AND a.week      = p_week::smallint
          AND a.is_playoff = false
      ),
      winners AS (
        SELECT member_a AS member_id FROM pairs WHERE pts_a > pts_b
        UNION ALL
        SELECT member_b              FROM pairs WHERE pts_b > pts_a
      )
      SELECT w.member_id, lm.faction::text AS faction
      FROM winners w
      JOIN league_members lm ON lm.id = w.member_id
      WHERE v_winning_faction = 'all'
         OR lm.faction::text = v_winning_faction
    LOOP
      SELECT t.n INTO v_available_token
      FROM generate_series(1, 18) AS t(n)
      WHERE t.n NOT IN (
        SELECT token_id
        FROM weekly_token_assignments
        WHERE league_id = p_league_id
          AND member_id = v_member.member_id
      )
      ORDER BY random()
      LIMIT 1;

      IF v_available_token IS NULL THEN
        v_available_token := floor(random() * 18 + 1)::int;
      END IF;

      INSERT INTO weekly_token_assignments (league_id, member_id, week, token_id)
      VALUES (p_league_id, v_member.member_id, p_week + 1, v_available_token)
      ON CONFLICT (league_id, member_id, week) DO NOTHING;
    END LOOP;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_draft(p_league_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id uuid;
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
  IF auth.uid() IS NULL OR auth.uid() <> v_commissioner_id THEN
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

  -- 14 powers here; Shadow Guard (id 9) and Power Negation (id 10) are dealt
  -- separately into pinned rounds below. (id 7 = cut Extra Roster Spot.)
  -- 14 + Shadow Guard + Power Negation = 16, one per round for rounds 1-16.
  v_power_ids := ARRAY[1,2,3,4,5,6,8,11,12,13,14,15,16,17]::smallint[];

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

    INSERT INTO draft_power_assignments (league_id, member_id, round, power_id) VALUES
      (p_league_id, v_member_id, v_sg_round, 9),
      (p_league_id, v_member_id, v_pn_round, 10);

    -- The other 14 powers rank by weight (+jitter) into the 14 remaining rounds
    -- (every round except the two pinned above). Vampire Bite (weight 8) can never
    -- land in round 1 because a lower-weight power always outranks it there.
    INSERT INTO draft_power_assignments (league_id, member_id, round, power_id)
    SELECT p_league_id, v_member_id, slots.round, ranked.pid
    FROM (
      SELECT pid, row_number() OVER (ORDER BY
        CASE pid
          WHEN 11 THEN 2   -- Gunslinger (QB)
          WHEN 6  THEN 3   -- Berserker Rage (RB)
          WHEN 15 THEN 3   -- Goal Line Hammer (RB)
          WHEN 13 THEN 4   -- Red Zone Menace (WR)
          WHEN 2  THEN 4   -- Reception Specialist (WR/RB/TE)
          WHEN 17 THEN 5   -- Seam Buster (TE)
          WHEN 14 THEN 5   -- Time Stone (any star)
          WHEN 8  THEN 6   -- Telepathy
          WHEN 3  THEN 6   -- Draft Heist
          WHEN 1  THEN 7   -- Foresight Coin
          WHEN 16 THEN 8   -- Vampire Bite (never round 1)
          WHEN 4  THEN 9   -- Hero's Shield
          WHEN 5  THEN 14  -- Iron Defense (D/ST -> late)
          WHEN 12 THEN 14  -- Sniper (K -> late)
          ELSE 8
        END + random() * 3
      ) AS rnk
      FROM unnest(v_power_ids) AS pid
    ) ranked
    JOIN (
      SELECT r AS round, row_number() OVER (ORDER BY r) AS slot
      FROM generate_series(1, array_length(v_power_ids, 1) + 2) AS r
      WHERE r <> v_sg_round AND r <> v_pn_round
    ) slots ON slots.slot = ranked.rnk;
  END LOOP;
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
      PERFORM generate_schedule(p_league_id, v_commissioner_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'pick_no', v_current_pick_no,
    'round', v_current_round,
    'member_id', v_member_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.randomize_unassigned_factions(p_league_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id uuid;
  v_draft_status    text;
  v_max_teams       int;
  v_capacity        int;
  v_hero_count      int;
  v_villain_count   int;
  v_member_id       uuid;
  v_faction         text;
BEGIN
  -- Verify league exists and that the caller is the commissioner
  SELECT commissioner_id, draft_status, max_teams
  INTO   v_commissioner_id, v_draft_status, v_max_teams
  FROM   uff_leagues
  WHERE  id = p_league_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'League not found';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> v_commissioner_id THEN
    RAISE EXCEPTION 'Only the commissioner can randomize factions';
  END IF;

  IF v_draft_status != 'not_started' THEN
    RAISE EXCEPTION 'Factions are locked once the draft starts';
  END IF;

  v_capacity := v_max_teams / 2;

  -- Count existing faction assignments
  SELECT
    COUNT(*) FILTER (WHERE faction = 'hero'),
    COUNT(*) FILTER (WHERE faction = 'villain')
  INTO v_hero_count, v_villain_count
  FROM league_members
  WHERE league_id = p_league_id;

  -- Iterate over unassigned members in random order and balance hero/villain
  FOR v_member_id IN
    SELECT id FROM league_members
    WHERE  league_id = p_league_id
    AND    faction IS NULL
    ORDER  BY random()
  LOOP
    IF v_hero_count <= v_villain_count AND v_hero_count < v_capacity THEN
      v_faction       := 'hero';
      v_hero_count    := v_hero_count + 1;
    ELSIF v_villain_count < v_capacity THEN
      v_faction         := 'villain';
      v_villain_count   := v_villain_count + 1;
    ELSE
      RAISE EXCEPTION 'All faction slots are already full';
    END IF;

    UPDATE league_members SET faction = v_faction WHERE id = v_member_id;
  END LOOP;
END;
$function$;

