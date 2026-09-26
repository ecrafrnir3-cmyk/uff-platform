-- 2026-09-26 — OPEN-LOOPS #77 / code-audit yellows in the database layer, plus the helpers the
-- same-day app changes rely on:
--   A1-16  advance_playoff_bracket gets SET search_path = public like every other SECURITY
--          DEFINER function (reset_waiver_priority and seed_playoffs were pinned earlier today).
--   A1-19  Five legacy tables (leagues, matchups, rosters, oracle_recaps, sleeper_users) — empty,
--          readable with the anon key, referenced by no code, only by each other — are dropped.
--   A1-21  move_to_ir and clear_lineup_on_roster_exit clear the lineup row unless the week is
--          actually complete (NOT EXISTS is_complete = true) instead of only when an incomplete
--          matchup row exists — a bye, an unseeded playoff week or a week beyond season_weeks
--          kept the stale row.
--   A1-22  The six commissioner FOR ALL policies (uff_matchups, uff_draft_picks,
--          uff_roster_players, uff_playoff_bracket, draft_power_assignments, team_active_powers)
--          are dropped: every commissioner write goes through a SECURITY DEFINER function or the
--          admin client, and a direct points write bypassed score_adjustment.
--   A2-02  set_trade_block(p_league_id, p_player_id, p_block): the Trade Block toggle wrote with
--          the user client under a policy that admitted no member row, so it was a silent no-op.
--   A3-04  email_send_log + email_budget_reserve(p_count, p_limit, p_floor): a per-day counter so
--          sendEmail can stop fan-out before the provider's daily cap and keep headroom for
--          auth mail.
--   A3-05  finalize_all_active_leagues returns skipped_leagues [{id, error}] and logs a WARNING.
--   A3-06  rate_limits + rate_limit_hit(p_key, p_max, p_window_seconds): a shared counter so the
--          per-minute limits hold across serverless instances (the in-memory map was per instance).
-- The three edited bodies are the LIVE pg_get_functiondef with the lines above changed (generated,
-- asserted one match each, re-diffed after applying). Pre-change bodies archived at
-- One Mind/Archive/uff-m3-pre-bodies-2026-09-26/.
--
-- Rollback: re-run the archived bodies; DROP FUNCTION set_trade_block, email_budget_reserve,
-- rate_limit_hit; DROP TABLE email_send_log, rate_limits; re-create the six policies from the
-- snapshot at the parent commit. The five legacy tables held zero rows; their definitions are in
-- the snapshot at the parent commit if ever wanted back.
--
-- Applied live 2026-09-26 via the Supabase MCP as audit_yellows_db_and_helpers (20260926145534); the
-- three bodies re-read afterwards and identical. Proven in a rolled-back block: rate_limit_hit refuses
-- the 11th call in a minute and allows a fresh key; email_budget_reserve grants 3 of 5, refuses a
-- low-priority 3 under a floor of 2, then grants the last 2; finalize_all_active_leagues(99) returns
-- skipped_leagues []; set_trade_block flags an own player and refuses an opponent's; a member cannot
-- update uff_roster_players directly (0 rows), call email_budget_reserve, or read rate_limits.

-- ── A1-16 ─────────────────────────────────────────────────────────────────────────────
ALTER FUNCTION public.advance_playoff_bracket(uuid, smallint) SET search_path = public;

-- ── A3-06: shared rate limiter ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key      text PRIMARY KEY,
  count    integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  INSERT INTO rate_limits AS r (key, count, reset_at)
  VALUES (p_key, 1, now() + make_interval(secs => p_window_seconds))
  ON CONFLICT (key) DO UPDATE
    SET count    = CASE WHEN r.reset_at <= now() THEN 1 ELSE r.count + 1 END,
        reset_at = CASE WHEN r.reset_at <= now() THEN now() + make_interval(secs => p_window_seconds) ELSE r.reset_at END
  RETURNING r.count INTO v_count;
  -- Opportunistic housekeeping: drop expired keys now and then
  IF random() < 0.01 THEN
    DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day';
  END IF;
  RETURN jsonb_build_object('allowed', v_count <= p_max, 'remaining', GREATEST(p_max - v_count, 0));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) TO anon, authenticated, service_role;

-- ── A3-04: daily email budget ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_send_log (
  day  date PRIMARY KEY,
  sent integer NOT NULL DEFAULT 0
);
ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_send_log FROM PUBLIC, anon, authenticated;

-- Reserve up to p_count sends for today. p_floor is headroom kept back for critical mail: a
-- low-priority fan-out passes p_floor > 0 and gets nothing once fewer than p_floor sends are
-- left. Returns how many sends were granted (0..p_count).
CREATE OR REPLACE FUNCTION public.email_budget_reserve(p_count integer, p_limit integer, p_floor integer DEFAULT 0)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sent    int;
  v_granted int;
BEGIN
  INSERT INTO email_send_log (day, sent) VALUES (current_date, 0) ON CONFLICT (day) DO NOTHING;
  SELECT sent INTO v_sent FROM email_send_log WHERE day = current_date FOR UPDATE;
  v_granted := LEAST(GREATEST(p_count, 0), GREATEST(p_limit - GREATEST(p_floor, 0) - v_sent, 0));
  UPDATE email_send_log SET sent = sent + v_granted WHERE day = current_date;
  RETURN v_granted;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.email_budget_reserve(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.email_budget_reserve(integer, integer, integer) TO service_role;

-- ── A2-02: the Trade Block toggle, as a function ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_trade_block(p_league_id uuid, p_player_id text, p_block boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id uuid;
  n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  SELECT id INTO v_member_id FROM league_members WHERE league_id = p_league_id AND user_id = auth.uid();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Not a member of this league.';
  END IF;
  UPDATE uff_roster_players
     SET on_trade_block = p_block
   WHERE league_id = p_league_id AND member_id = v_member_id AND player_id = p_player_id AND dropped_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'That player is not on your roster.';
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.set_trade_block(uuid, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_trade_block(uuid, text, boolean) TO authenticated;

-- ── move_to_ir ──
CREATE OR REPLACE FUNCTION public.move_to_ir(p_league_id uuid, p_user_id uuid, p_player_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id     uuid;
  v_roster_id     uuid;
  v_player_status text;
  v_injury_status text;
  v_ir_count      int;
  v_ir_spots      int;
  v_eliminated    timestamptz;
  v_season        int;
  v_cleared       int;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'You can only act for your own team';
  END IF;
  SELECT id INTO v_member_id
  FROM league_members
  WHERE league_id = p_league_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not a member of this league'; END IF;

  SELECT eliminated_at INTO v_eliminated FROM league_members WHERE id = v_member_id;
  IF v_eliminated IS NOT NULL THEN
    RAISE EXCEPTION 'Your roster is locked — your team was eliminated from the playoffs.';
  END IF;

  SELECT id INTO v_roster_id
  FROM uff_roster_players
  WHERE member_id = v_member_id
    AND player_id = p_player_id
    AND dropped_at IS NULL
    AND slot = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Player not on your active roster'; END IF;

  SELECT status, injury_status INTO v_player_status, v_injury_status
  FROM players WHERE id = p_player_id;
  IF NOT (v_player_status = 'Injured Reserve'
          OR COALESCE(v_injury_status, '') IN ('IR', 'Out', 'Doubtful', 'PUP')) THEN
    RAISE EXCEPTION 'Player must be designated IR, Out, or Doubtful to use an IR slot';
  END IF;

  SELECT COUNT(*) INTO v_ir_count
  FROM uff_roster_players
  WHERE member_id = v_member_id AND dropped_at IS NULL AND slot = 'ir';
  SELECT ir_spots INTO v_ir_spots FROM uff_leagues WHERE id = p_league_id;
  IF v_ir_count >= v_ir_spots THEN
    RAISE EXCEPTION 'IR is full (% of % slots used)', v_ir_count, v_ir_spots;
  END IF;

  UPDATE uff_roster_players SET slot = 'ir' WHERE id = v_roster_id;

  -- A player on IR is not in a lineup. Narrow on purpose: never a scored week, and
  -- never a man whose game has already kicked off.
  SELECT season::int INTO v_season FROM uff_leagues WHERE id = p_league_id;

  WITH gone AS (
    DELETE FROM uff_lineups ln
     WHERE ln.member_id = v_member_id
       AND ln.player_id = p_player_id
       AND NOT EXISTS (SELECT 1 FROM uff_matchups m
                    WHERE m.league_id = p_league_id
                      AND m.member_id = v_member_id
                      AND m.week = ln.week
                      AND m.is_complete = true)
       AND NOT EXISTS (SELECT 1
                         FROM uff_game_schedule g
                         JOIN players pl ON pl.id = p_player_id
                        WHERE g.season = v_season
                          AND g.week = ln.week
                          AND g.team = pl.team
                          AND g.kickoff_utc <= now())
    RETURNING 1
  )
  SELECT count(*) INTO v_cleared FROM gone;

  RAISE NOTICE 'move_to_ir: % lineup row(s) cleared for player %', v_cleared, p_player_id;
END;
$function$;

-- ── clear_lineup_on_roster_exit ──
CREATE OR REPLACE FUNCTION public.clear_lineup_on_roster_exit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_season int;
  v_left   boolean;
BEGIN
  v_left :=
       (NEW.dropped_at IS NOT NULL AND OLD.dropped_at IS NULL)
    OR (OLD.slot = 'active' AND NEW.slot IS DISTINCT FROM 'active')
    OR (NEW.member_id IS DISTINCT FROM OLD.member_id);

  IF NOT v_left THEN
    RETURN NEW;
  END IF;

  SELECT season::int INTO v_season FROM uff_leagues WHERE id = OLD.league_id;

  DELETE FROM uff_lineups ln
   WHERE ln.member_id = OLD.member_id
     AND ln.player_id = OLD.player_id
     AND NOT EXISTS (SELECT 1 FROM uff_matchups m
                  WHERE m.league_id = OLD.league_id
                    AND m.member_id = OLD.member_id
                    AND m.week = ln.week
                    AND m.is_complete = true)
     AND NOT EXISTS (SELECT 1
                       FROM uff_game_schedule g
                       JOIN players pl ON pl.id = OLD.player_id
                      WHERE g.season = v_season
                        AND g.week = ln.week
                        AND g.team = pl.team
                        AND g.kickoff_utc <= now());

  RETURN NEW;
END;
$function$;

-- ── finalize_all_active_leagues ──
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
  v_errors            jsonb := '[]'::jsonb;
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
      -- Say which league and why (audit A3-05); the route turns this into a 207
      v_errors  := v_errors || jsonb_build_object('id', v_league.id, 'error', SQLERRM);
      RAISE WARNING 'finalize week % skipped league %: %', p_week, v_league.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'finalized',        v_finalized,
    'skipped',          v_skipped,
    'week',             p_week,
    'tokens_assigned',  v_tokens_assigned,
    'skipped_leagues',  v_errors
  );
END;
$function$;


-- ── A1-22: six commissioner FOR ALL policies ───────────────────────────────────────────
DROP POLICY IF EXISTS "commissioner manage matchups"                       ON public.uff_matchups;
DROP POLICY IF EXISTS "commissioner manage league draft picks"             ON public.uff_draft_picks;
DROP POLICY IF EXISTS "commissioner manage league rosters"                 ON public.uff_roster_players;
DROP POLICY IF EXISTS "Commissioner can manage playoff bracket"            ON public.uff_playoff_bracket;
DROP POLICY IF EXISTS "commissioner manage league draft_power_assignments" ON public.draft_power_assignments;
DROP POLICY IF EXISTS "commissioner manage league active powers"           ON public.team_active_powers;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.uff_matchups        FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.uff_playoff_bracket FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.uff_roster_players  FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.team_active_powers  FROM anon;

-- ── A1-19: legacy tables, empty and unreferenced ──────────────────────────────────────
DROP TABLE IF EXISTS public.rosters;
DROP TABLE IF EXISTS public.matchups;
DROP TABLE IF EXISTS public.oracle_recaps;
DROP TABLE IF EXISTS public.sleeper_users;
DROP TABLE IF EXISTS public.leagues;
