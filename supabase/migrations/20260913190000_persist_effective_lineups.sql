-- Persist the lineup the scoring engine actually plays (2026-09-13, OPEN-LOOPS #33)
--
-- When a manager never set a lineup, score-matchups built an effective lineup
-- (saved -> carried forward -> auto-filled) IN MEMORY ONLY and scored it. Every
-- other reader of uff_lineups -- the roster page, api/matchup-breakdown, and the
-- Story Engine's feat detection -- saw no rows, so the team showed "no lineup
-- set" while scoring points, and would have earned zero feats at finalize-week.
-- The auto-pick was also re-chosen on every run from live projections with no
-- kickoff lock, and ranked on raw projections that ignore draft powers.
--
-- This migration:
--   1. tags every lineup row with where it came from. Existing rows, and every
--      row written by set_lineup(), default to 'manual'.
--   2. adds persist_effective_lineup(), which the engine (service role) calls to
--      save a 'carried' or 'auto' lineup. It never overwrites or deletes a manual
--      lineup -- even one saved concurrently -- and anon/authenticated users
--      cannot call it.

ALTER TABLE public.uff_lineups
  ADD COLUMN IF NOT EXISTS lineup_source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.uff_lineups
  DROP CONSTRAINT IF EXISTS uff_lineups_lineup_source_check;

ALTER TABLE public.uff_lineups
  ADD CONSTRAINT uff_lineups_lineup_source_check
  CHECK (lineup_source IN ('manual', 'carried', 'auto'));

CREATE OR REPLACE FUNCTION public.persist_effective_lineup(
  p_league_id uuid,
  p_member_id uuid,
  p_week      integer,
  p_source    text,
  p_slots     jsonb
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $persist_lineup$
DECLARE
  v_inserted integer;
BEGIN
  IF p_source NOT IN ('carried', 'auto') THEN
    RAISE EXCEPTION 'persist_effective_lineup writes only carried or auto lineups (got %)', p_source;
  END IF;

  IF jsonb_typeof(p_slots) <> 'array' OR jsonb_array_length(p_slots) = 0 THEN
    RETURN false;
  END IF;

  -- A lineup the manager saved always wins.
  IF EXISTS (
    SELECT 1 FROM public.uff_lineups
     WHERE member_id = p_member_id AND week = p_week::smallint AND lineup_source = 'manual'
  ) THEN
    RETURN false;
  END IF;

  -- Replace only engine-written rows, never a manual one.
  DELETE FROM public.uff_lineups
   WHERE member_id = p_member_id AND week = p_week::smallint AND lineup_source <> 'manual';

  -- Re-check inside the INSERT so a manual save that committed a moment ago is
  -- never buried under an auto lineup.
  INSERT INTO public.uff_lineups (league_id, member_id, player_id, week, slot, lineup_source)
  SELECT p_league_id, p_member_id, r->>'player_id', p_week::smallint, r->>'slot', p_source
    FROM jsonb_array_elements(p_slots) AS r
   WHERE NOT EXISTS (
     SELECT 1 FROM public.uff_lineups
      WHERE member_id = p_member_id AND week = p_week::smallint AND lineup_source = 'manual'
   );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted > 0;
END;
$persist_lineup$;

REVOKE ALL ON FUNCTION public.persist_effective_lineup(uuid, uuid, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.persist_effective_lineup(uuid, uuid, integer, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_effective_lineup(uuid, uuid, integer, text, jsonb) TO service_role;
