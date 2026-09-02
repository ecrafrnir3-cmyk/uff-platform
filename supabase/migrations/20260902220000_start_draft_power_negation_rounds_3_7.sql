-- APPLIED LIVE 2026-09-02 via Supabase MCP (start_draft_power_negation_rounds_3_7).
-- Follows 20260902210000 (Shadow Guard -> rounds 1-5). Now Power Negation (id 10,
-- the self-cost power that HALVES the drafted player's scoring all season) is dealt
-- to a random round 3-7 for every manager, instead of its old last-throwaway-round
-- placement (~round 15-16). Rationale: dealt late it only ever hit a scrub, so the
-- Power Restore Chip (which un-halves the player) was pointless to hold. Landing it
-- on a startable player (rounds 3-7) makes the chip a real strategic asset.
--
-- Power Negation's round is drawn distinct from Shadow Guard's (1-5) so the two pins
-- never collide. The other 14 powers rank by the same weight(+jitter) scheme into the
-- 14 remaining rounds (Vampire Bite still never round 1). Verified over 10 sim drafts
-- (140 manager-draws): Shadow Guard always 1-5, Power Negation always 3-7, never the
-- same round, VB never round 1, 16 powers/manager one-per-round with no dupes.

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
