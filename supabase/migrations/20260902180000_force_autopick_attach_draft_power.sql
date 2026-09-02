-- APPLIED LIVE 2026-09-02 via Supabase MCP (recorded server-side as
-- force_autopick_attaches_draft_power) — deployed and end-to-end verified in an
-- isolated 2-member test league before the inaugural "The First War" draft.
--
-- Bug (audit U6 follow-up): the offline-picker safety net calls the
-- force_autopick RPC, but — unlike the manual (handlePick) and self-autodraft
-- (handleAutodraft) client paths, which both call assignPowerToPick after the
-- pick — force_autopick never attached the round's draft power. So a manager who
-- was auto-picked while offline silently forfeited the power they'd been dealt.
--
-- Fix: attach the power inside force_autopick itself, mirroring the client rules:
--   • skip the interactive powers (Vampire Bite / Foresight Coin / Draft Heist)
--     and any draft_mechanic-category power — those are forfeited on autopick;
--   • honor position-tying (ANY / WR-RB-TE / D-ST→DEF / exact) — a mismatch
--     fizzles, exactly like a mismatched manual pick;
--   • never overwrite a power already owned by a different manager;
--   • CRITICAL: credit drafted_by_user_id to the ON-THE-CLOCK member (the offline
--     manager), never to auth.uid() (the peer client that fired the safety net).
--
-- Verified 2026-09-02 across 5 scenarios (all pass):
--   1. QB-tied power + QB pick  → attaches, credited to the offline member (not caller)
--   2. QB-tied power + RB pick  → fizzles (0 rows)
--   3. Draft Heist (interactive)→ skipped (0 rows)
--   4. Hero's Shield (mechanic) → skipped via category guard (0 rows)
--   5. Shadow Guard (ANY) + RB  → attaches
--
-- Full final body also mirrored into ../schema-snapshot/functions.sql (the
-- disaster-recovery source of truth for ALL game-logic RPCs).

CREATE OR REPLACE FUNCTION public.force_autopick(p_league_id uuid)
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
  v_clock_secs      int;
  v_started_at      timestamptz;
  v_pick_count      int;
  v_total_picks     int;
  v_pick_no         int;
  v_round           int;
  v_pos_in_round    int;
  v_slot            int;
  v_member_id       uuid;
  v_anchor          timestamptz;
  v_buffer_secs     int := 0;
  v_deadline        timestamptz;
  v_player_id       text;
  -- power-attach locals (mirrors client assignPowerToPick)
  v_pw_name         text;
  v_pw_cat          text;
  v_pw_tied         text;
  v_pw_slug         text;
  v_pos             text;
  v_member_user     uuid;
  v_owner           uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM league_members WHERE league_id = p_league_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'You are not in this league';
  END IF;

  -- FOR UPDATE serializes with make_draft_pick and concurrent force calls
  SELECT draft_status, draft_order, max_teams, draft_rounds, commissioner_id,
         pick_clock_seconds, draft_started_at
  INTO v_draft_status, v_draft_order, v_max_teams, v_draft_rounds, v_commissioner_id,
       v_clock_secs, v_started_at
  FROM uff_leagues WHERE id = p_league_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF v_draft_status != 'in_progress' THEN RAISE EXCEPTION 'Draft is not in progress'; END IF;
  IF v_clock_secs IS NULL THEN RAISE EXCEPTION 'No pick clock configured for this league'; END IF;

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

  SELECT max(picked_at) INTO v_anchor FROM uff_draft_picks WHERE league_id = p_league_id;
  IF v_anchor IS NULL THEN v_anchor := v_started_at; END IF;
  IF v_anchor IS NULL THEN RAISE EXCEPTION 'No clock anchor for this pick'; END IF;

  IF (v_pick_no - 1) % v_max_teams = 0 THEN v_buffer_secs := 30; END IF;
  v_deadline := v_anchor + make_interval(secs => v_buffer_secs + v_clock_secs + 15);
  IF now() < v_deadline THEN
    RAISE EXCEPTION 'Pick clock has not expired yet';
  END IF;

  -- Queue-top of the on-the-clock member, else best available ADP
  SELECT q.player_id INTO v_player_id
  FROM draft_queue q
  WHERE q.member_id = v_member_id AND q.league_id = p_league_id
    AND NOT EXISTS (SELECT 1 FROM uff_draft_picks dp
                    WHERE dp.league_id = p_league_id AND dp.player_id = q.player_id)
  ORDER BY q.position ASC
  LIMIT 1;

  IF v_player_id IS NULL THEN
    SELECT p.id INTO v_player_id
    FROM players p
    WHERE p.adp IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM uff_draft_picks dp
                      WHERE dp.league_id = p_league_id AND dp.player_id = p.id)
    ORDER BY p.adp ASC
    LIMIT 1;
  END IF;

  IF v_player_id IS NULL THEN RAISE EXCEPTION 'No available player to autopick'; END IF;

  -- Pick-insert core — mirrors make_draft_pick
  INSERT INTO uff_draft_picks (league_id, round, pick_no, member_id, player_id)
  VALUES (p_league_id, v_round::smallint, v_pick_no, v_member_id, v_player_id);

  INSERT INTO uff_roster_players (league_id, member_id, player_id, added_at)
  VALUES (p_league_id, v_member_id, v_player_id, now());

  DELETE FROM draft_queue
  WHERE member_id = v_member_id AND league_id = p_league_id AND player_id = v_player_id;

  -- ── Attach the round's draft power to the auto-picked player ────────────────
  -- Mirrors the client assignPowerToPick + self-autodraft rules so a manager who
  -- is force-autopicked while offline keeps the power they were dealt for this
  -- round instead of silently losing it. Never attaches the interactive powers
  -- (Vampire Bite / Foresight Coin / Draft Heist) or the draft-mechanic powers;
  -- a position-tied power attaches only when the picked player's position matches
  -- (otherwise it fizzles, exactly like a mismatched manual/self-autodraft pick).
  -- The power is credited to the ON-THE-CLOCK member (the offline manager), never
  -- to auth.uid() (the peer client that fired the safety-net force).
  SELECT dp.name, dp.category, dp.tied_position
    INTO v_pw_name, v_pw_cat, v_pw_tied
  FROM draft_power_assignments dpa
  JOIN draft_powers dp ON dp.id = dpa.power_id
  WHERE dpa.league_id = p_league_id AND dpa.member_id = v_member_id AND dpa.round = v_round;

  IF v_pw_name IS NOT NULL
     AND v_pw_name NOT IN ('Vampire Bite', 'Foresight Coin', 'Draft Heist')
     AND v_pw_cat IS DISTINCT FROM 'draft_mechanic'
  THEN
    SELECT position INTO v_pos FROM players WHERE id = v_player_id;
    IF v_pw_tied IS NULL
       OR v_pw_tied = 'ANY'
       OR (v_pw_tied = 'WR/RB/TE' AND v_pos IN ('WR', 'RB', 'TE'))
       OR (v_pw_tied = 'D/ST'     AND v_pos = 'DEF')
       OR (v_pw_tied = v_pos)
    THEN
      SELECT user_id INTO v_member_user FROM league_members WHERE id = v_member_id;
      SELECT drafted_by_user_id INTO v_owner
        FROM player_draft_powers
        WHERE league_id = p_league_id AND player_id = v_player_id;
      IF v_owner IS NULL OR v_owner = v_member_user THEN
        v_pw_slug := lower(regexp_replace(v_pw_name, '[^a-zA-Z0-9]+', '_', 'g'));
        INSERT INTO player_draft_powers (league_id, player_id, power, round, drafted_by_user_id)
        VALUES (p_league_id, v_player_id, v_pw_slug, v_round, v_member_user)
        ON CONFLICT (league_id, player_id) DO UPDATE
          SET power = EXCLUDED.power,
              round = EXCLUDED.round,
              drafted_by_user_id = EXCLUDED.drafted_by_user_id;
      END IF;
    END IF;
  END IF;

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

  RETURN v_player_id;
END;
$function$
;
