-- APPLIED LIVE 2026-09-02 via Supabase MCP (start_draft_shadow_guard_early_rounds).
-- Shadow Guard (power id 9) is now dealt into a random EARLY round (1-5) for every
-- manager, instead of its old mid/late weight (~rounds 8-13). Rationale: Shadow
-- Guard attaches to the player you draft in the round you hold it and shields that
-- one player from Vampire Bite; dealt mid/late it only ever protected a bench-tier
-- pick, so it was a dead counter. Early (1-5) it can shield a genuinely draftable
-- player, making it a real answer to Vampire Bite (which never lands before ~round 8).
--
-- Mechanics: Shadow Guard gets floor(random()*5)+1; the other 15 powers rank by the
-- same weight(+jitter) scheme into the 15 remaining rounds. Verified over 10 sim
-- drafts (140 manager-draws) in an isolated 14-team league: Shadow Guard ALWAYS in
-- rounds 1-5 (evenly spread), Vampire Bite never round 1, every manager gets exactly
-- 16 powers one-per-round with no dupes.

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

  -- 15 powers here; Shadow Guard (id 9) is dealt separately into an early round
  -- below. (id 7 = cut Extra Roster Spot.) 15 + Shadow Guard = 16, one per round.
  v_power_ids := ARRAY[1,2,3,4,5,6,8,10,11,12,13,14,15,16,17]::smallint[];

  -- Round-aware placement: lower weight => earlier round; jitter keeps it random
  -- per manager. Late-tier weights (14-15) always sort after everyone else.
  FOREACH v_member_id IN ARRAY v_shuffled_order LOOP
    -- Shadow Guard is dealt to a random EARLY round (1-5) so it can shield a
    -- genuinely draftable player and act as a real Vampire Bite counter — it was
    -- previously weighted mid/late, where it only ever protected a bench-tier pick.
    v_sg_round := floor(random() * 5)::int + 1;   -- 1..5

    INSERT INTO draft_power_assignments (league_id, member_id, round, power_id)
    VALUES (p_league_id, v_member_id, v_sg_round, 9);

    -- The other 15 powers rank by weight (+jitter) into the 15 remaining rounds
    -- (every round except the one Shadow Guard took). Vampire Bite (weight 8) can
    -- never land in round 1 because a lower-weight power always outranks it there.
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
          WHEN 10 THEN 15  -- Power Negation (self-cost -> throwaway rounds)
          ELSE 8
        END + random() * 3
      ) AS rnk
      FROM unnest(v_power_ids) AS pid
    ) ranked
    JOIN (
      SELECT r AS round, row_number() OVER (ORDER BY r) AS slot
      FROM generate_series(1, array_length(v_power_ids, 1) + 1) AS r
      WHERE r <> v_sg_round
    ) slots ON slots.slot = ranked.rnk;
  END LOOP;
END;
$function$;
