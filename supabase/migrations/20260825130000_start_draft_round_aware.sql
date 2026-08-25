-- APPLIED LIVE 2026-08-25 via Supabase MCP (execute_sql; apply_migration mangles
-- dollar-quoted bodies). Round-aware draft-power dealing.
--
-- Before: each manager's 16 powers were placed into rounds by a uniform
-- Fisher-Yates shuffle, with the single exception that Vampire Bite couldn't be
-- dealt in round 1. That made a power's value pure luck of placement: a D/ST
-- power (Iron Defense) or a self-halving cost (Power Negation) dealt in round 1
-- was a trap, while a star-scaling power (e.g. Berserker Rage) dealt in round 15
-- was dead weight.
--
-- After: each power carries a target-round weight; placement = ORDER BY
-- (weight + random()*3) per manager, so it stays randomized each draft BUT:
--   * Iron Defense (5, DEF), Sniper (12, K), Power Negation (10, self-cost)
--     always land in the last few rounds (weights 14-15 exceed every other
--     power's max key of 13),
--   * offensive star powers skew early-mid,
--   * draft-mechanic powers sit in the middle,
--   * Vampire Bite (16, weight 8) can never land in round 1 (the five
--     lowest-weight powers always precede it) — preserving the old rule.
-- Verified: 10-team sim placed Gunslinger avg R1.5 ... Power Negation avg R15.9,
-- full 160-pick draft completed and generated 140 matchups.

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

  -- 16 powers (id 7 = cut Extra Roster Spot), one per round for rounds 1-16.
  v_power_ids := ARRAY[1,2,3,4,5,6,8,9,10,11,12,13,14,15,16,17]::smallint[];

  -- Round-aware placement: lower weight => earlier round; jitter keeps it random
  -- per manager. Late-tier weights (14-15) always sort after everyone else.
  FOREACH v_member_id IN ARRAY v_shuffled_order LOOP
    INSERT INTO draft_power_assignments (league_id, member_id, round, power_id)
    SELECT
      p_league_id,
      v_member_id,
      (row_number() OVER (ORDER BY
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
          WHEN 9  THEN 10  -- Shadow Guard
          WHEN 5  THEN 14  -- Iron Defense (D/ST -> late)
          WHEN 12 THEN 14  -- Sniper (K -> late)
          WHEN 10 THEN 15  -- Power Negation (self-cost -> throwaway rounds)
          ELSE 8
        END + random() * 3
      ))::smallint AS round,
      pid AS power_id
    FROM unnest(v_power_ids) AS pid;
  END LOOP;
END;
$function$;
