-- 2026-09-24 — a player moved to Injured Reserve must leave the lineup with him.
--
-- move_to_ir set uff_roster_players.slot = 'ir' and stopped there, so an IR'd
-- STARTER kept his uff_lineups row. Live proof on the day this shipped: Reveille had
-- Jaxson Dart on IR *and* starting at QB in week 3 at the same time. The slot renders
-- empty, the engine plays nobody in it, and the manager's next save fails with
-- "Player not on your active roster" — which is also why step 1 of the lineup merge
-- could not backfill it (OPEN-LOOPS #54).
--
-- uff_lineups carries only a SELECT policy, so no client can clear the row itself;
-- every write goes through a SECURITY DEFINER function. The invariant "a player on IR
-- is not in a lineup" therefore belongs in the same transaction as the IR move.
--
-- The delete is deliberately narrow:
--   * only weeks whose matchup is NOT complete — a scored week is history and must
--     never be rewritten;
--   * only weeks where the player's own game has not kicked off — a Doubtful player
--     who suited up and is scoring right now keeps his slot.
--
-- ⚠️ This function still trusts a caller-supplied p_user_id (OPEN-LOOPS #55). That is
-- a separate, larger change across six RPCs awaiting a decision, and it is NOT
-- bundled here on purpose: one change, one reason.

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

  -- Official IR designation OR an injury status the roster UI treats as
  -- IR-eligible (IR / Out / Doubtful / PUP)
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

  -- ── NEW: take him out of the lineup too ─────────────────────────────────────
  SELECT season::int INTO v_season FROM uff_leagues WHERE id = p_league_id;

  WITH gone AS (
    DELETE FROM uff_lineups ln
     WHERE ln.member_id = v_member_id
       AND ln.player_id = p_player_id
       -- never touch a week that has already been scored
       AND EXISTS (SELECT 1 FROM uff_matchups m
                    WHERE m.league_id = p_league_id
                      AND m.member_id = v_member_id
                      AND m.week = ln.week
                      AND m.is_complete = false)
       -- never pull a man out of a game that has already started
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
