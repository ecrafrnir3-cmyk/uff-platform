-- 2026-09-24 — enforce "a player who is not on your active roster is not in your
-- lineup" once, in a trigger, instead of in every function that moves a roster row.
--
-- Survey of the live functions that mutate uff_roster_players:
--
--   function                    updates roster   touches uff_lineups
--   add_and_drop_player              yes                no
--   approve_trade                    yes                no
--   drop_player                      yes                no
--   move_to_ir                       yes               YES  (fixed 2026-09-24)
--   process_priority_waivers         yes                no
--   process_waiver_bids              yes                no
--   respond_to_trade                 yes                no
--
-- Seven paths out of the active roster, one of them aware of lineups. Drop a starter,
-- trade him, or lose him on a waiver claim and his uff_lineups row survives: the slot
-- renders empty, the engine plays nobody in it, and the manager's next save fails with
-- "Player not on your active roster" (OPEN-LOOPS #54/#70). Patching the other six —
-- and remembering forever for the next one — is the wrong shape. The invariant belongs
-- on the table.
--
-- uff_lineups carries only a SELECT policy, so the trigger must be SECURITY DEFINER;
-- an authenticated caller has no DELETE path of its own.
--
-- The delete keeps the same two guards proven on move_to_ir:
--   * only weeks whose matchup is NOT complete — a scored week is history;
--   * only weeks where the player's own game has not kicked off — a man who is out
--     there scoring keeps his slot even if his roster row moves mid-game.
-- It also only ever clears rows for the member LOSING the player (OLD.member_id), so a
-- trade cannot disturb the receiving team's board.

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
  -- Did this player just leave OLD.member_id's active roster?
  v_left :=
       (NEW.dropped_at IS NOT NULL AND OLD.dropped_at IS NULL)          -- dropped / waived away
    OR (OLD.slot = 'active' AND NEW.slot IS DISTINCT FROM 'active')     -- moved to IR or elsewhere
    OR (NEW.member_id IS DISTINCT FROM OLD.member_id);                  -- traded to another team

  IF NOT v_left THEN
    RETURN NEW;
  END IF;

  SELECT season::int INTO v_season FROM uff_leagues WHERE id = OLD.league_id;

  DELETE FROM uff_lineups ln
   WHERE ln.member_id = OLD.member_id
     AND ln.player_id = OLD.player_id
     AND EXISTS (SELECT 1 FROM uff_matchups m
                  WHERE m.league_id = OLD.league_id
                    AND m.member_id = OLD.member_id
                    AND m.week = ln.week
                    AND m.is_complete = false)
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

DROP TRIGGER IF EXISTS trg_clear_lineup_on_roster_exit ON public.uff_roster_players;

CREATE TRIGGER trg_clear_lineup_on_roster_exit
AFTER UPDATE ON public.uff_roster_players
FOR EACH ROW
EXECUTE FUNCTION public.clear_lineup_on_roster_exit();

-- NOTE: move_to_ir keeps its own explicit DELETE. It is now redundant with this
-- trigger and deliberately left in place — it carries the RAISE NOTICE that says how
-- many rows were cleared, and belt-and-braces is cheap on an invariant this load-bearing.
