-- APPLIED LIVE 2026-09-02 via Supabase MCP (finalize_playoff_token_leak_fix).
-- Adds AND a.is_playoff = false to the faction-war + token-award CTEs in BOTH
-- finalize paths so weekly draft tokens are no longer granted for PLAYOFF-week
-- wins (audit: playoff matchups were treated as faction-war games, handing
-- advancing teams extra powers for the next round). Mirrors the is_playoff=false
-- filters the median/power-restore-chip blocks already use. No-op during the
-- regular season (all regular matchups are is_playoff=false).

CREATE OR REPLACE FUNCTION public.finalize_all_active_leagues(p_week integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_league            record;
  v_top_member_id     uuid;
  v_chip_count        int;
  v_finalized         int := 0;
  v_skipped           int := 0;
  v_tokens_assigned   int := 0;
  v_hero_wins         int;
  v_villain_wins      int;
  v_hero_pts          numeric;
  v_villain_pts       numeric;
  v_winning_faction   text;
  v_member            record;
  v_available_token   int;
  v_median_score      numeric;
BEGIN
  FOR v_league IN
    SELECT DISTINCT l.id, l.max_teams, l.median_scoring
    FROM uff_leagues l
    JOIN uff_matchups m ON m.league_id = l.id
    WHERE l.status = 'active'
      AND m.week = p_week::smallint
      AND m.is_complete = false
  LOOP
    BEGIN
      UPDATE uff_matchups
         SET is_complete = true
       WHERE league_id = v_league.id
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
            WHERE a.league_id = v_league.id
              AND a.week = p_week::smallint
              AND a.points <> b.points
          ) losers
          WHERE loser_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM weekly_token_assignments wta
              WHERE wta.league_id = v_league.id
                AND wta.member_id = losers.loser_id
                AND wta.week      = p_week::smallint
                AND wta.token_id  = 11
                AND wta.status    = 'pending'
            )
        ) insurance_losers
       WHERE m.league_id  = v_league.id
         AND m.week       = p_week::smallint
         AND m.member_id  = insurance_losers.loser_id;

      IF v_league.median_scoring THEN
        SELECT AVG(pts) INTO v_median_score
          FROM (
            SELECT points AS pts,
                   ROW_NUMBER() OVER (ORDER BY points) AS rn,
                   COUNT(*) OVER () AS cnt
              FROM uff_matchups
             WHERE league_id   = v_league.id
               AND week        = p_week::smallint
               AND is_playoff  = false
          ) ranked
         WHERE rn IN (FLOOR((cnt + 1) / 2.0), CEIL((cnt + 1) / 2.0));

        UPDATE uff_matchups
           SET median_win = (points > v_median_score)
         WHERE league_id  = v_league.id
           AND week       = p_week::smallint
           AND is_playoff = false;
      END IF;

      UPDATE weekly_token_assignments
         SET status = 'used',
             used_at = now()
       WHERE league_id = v_league.id
         AND week = p_week::smallint
         AND status = 'pending';

      PERFORM advance_playoff_bracket(v_league.id, p_week::smallint);

      SELECT member_id
        INTO v_top_member_id
        FROM uff_matchups
       WHERE league_id = v_league.id
         AND week = p_week::smallint
         AND is_playoff = false
       ORDER BY points DESC NULLS LAST
       LIMIT 1;

      IF v_top_member_id IS NOT NULL THEN
        SELECT count(*) INTO v_chip_count
          FROM power_restore_chips
         WHERE league_id = v_league.id
           AND used = false;
        IF v_chip_count < v_league.max_teams THEN
          INSERT INTO power_restore_chips (league_id, member_id, earned_week)
          VALUES (v_league.id, v_top_member_id, p_week::smallint)
          ON CONFLICT (member_id, earned_week) DO NOTHING;
        END IF;
      END IF;

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
        WHERE a.league_id = v_league.id
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

      -- Token award: for NEXT week's use (none after the final week)
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
            WHERE a.league_id = v_league.id
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
            WHERE league_id = v_league.id
              AND member_id = v_member.member_id
          )
          ORDER BY random()
          LIMIT 1;

          IF v_available_token IS NULL THEN
            v_available_token := floor(random() * 18 + 1)::int;
          END IF;

          INSERT INTO weekly_token_assignments (league_id, member_id, week, token_id)
          VALUES (v_league.id, v_member.member_id, p_week + 1, v_available_token)
          ON CONFLICT (league_id, member_id, week) DO NOTHING;

          v_tokens_assigned := v_tokens_assigned + 1;
        END LOOP;
      END IF;

      v_finalized := v_finalized + 1;

    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'finalized',        v_finalized,
    'skipped',          v_skipped,
    'week',             p_week,
    'tokens_assigned',  v_tokens_assigned
  );
END;
$function$
;

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
  IF auth.uid() IS NOT NULL THEN
    IF auth.uid() != v_commissioner_id THEN
      RAISE EXCEPTION 'Only the commissioner can finalize a week';
    END IF;
  ELSIF v_commissioner_id != p_user_id THEN
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
$function$
;
