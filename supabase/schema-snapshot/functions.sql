-- UFF game-logic snapshot: every public function in the live DB (project synfuvgdamhjboobjmls)
-- Generated 2026-08-17 after the season-readiness migrations. NOT a migration --
-- disaster-recovery source of truth so the game rules live in git (audit item 13).

CREATE OR REPLACE FUNCTION public.add_and_drop_player(p_league_id uuid, p_user_id uuid, p_add_player_id text, p_drop_player_id text, p_week smallint DEFAULT NULL::smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id        uuid;
  v_on_roster        int;
  v_already_on       int;
  v_max_adds_week    smallint;
  v_max_adds_season  smallint;
  v_week_adds        int;
  v_season_adds      int;
  v_eliminated       timestamptz;
BEGIN
  SELECT id INTO v_member_id
    FROM league_members WHERE league_id = p_league_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not a member of this league'; END IF;

  -- Elimination check
  SELECT eliminated_at INTO v_eliminated FROM league_members WHERE id = v_member_id;
  IF v_eliminated IS NOT NULL THEN
    RAISE EXCEPTION 'Your roster is locked — your team was eliminated from the playoffs.';
  END IF;

  -- Can't cut check on the player being dropped
  IF EXISTS (
    SELECT 1 FROM uff_cant_cut_list
    WHERE league_id = p_league_id AND player_id = p_drop_player_id
  ) THEN
    RAISE EXCEPTION 'This player is on the commissioner''s Can''t Cut List and cannot be dropped.';
  END IF;

  -- The player to drop must be on MY active roster
  SELECT COUNT(*) INTO v_on_roster
    FROM uff_roster_players
   WHERE member_id = v_member_id AND player_id = p_drop_player_id AND slot = 'active' AND dropped_at IS NULL;
  IF v_on_roster = 0 THEN
    RAISE EXCEPTION 'The player you are dropping is not on your active roster';
  END IF;

  -- The player to add must not be on any roster in this league
  SELECT COUNT(*) INTO v_already_on
    FROM uff_roster_players WHERE league_id = p_league_id AND player_id = p_add_player_id AND dropped_at IS NULL;
  IF v_already_on > 0 THEN
    RAISE EXCEPTION 'Player is already on a roster in this league';
  END IF;

  -- Fetch limits
  SELECT max_adds_per_week, max_adds_per_season
    INTO v_max_adds_week, v_max_adds_season
    FROM uff_leagues WHERE id = p_league_id;

  -- Per-week limit
  IF p_week IS NOT NULL AND v_max_adds_week > 0 THEN
    SELECT COUNT(*) INTO v_week_adds
      FROM uff_roster_players WHERE member_id = v_member_id AND week_added = p_week;
    IF v_week_adds >= v_max_adds_week THEN
      RAISE EXCEPTION 'Weekly acquisition limit reached (% of % adds used this week).', v_week_adds, v_max_adds_week;
    END IF;
  END IF;

  -- Per-season limit
  IF v_max_adds_season > 0 THEN
    SELECT COUNT(*) INTO v_season_adds
      FROM uff_roster_players WHERE member_id = v_member_id AND week_added IS NOT NULL AND week_added > 0;
    IF v_season_adds >= v_max_adds_season THEN
      RAISE EXCEPTION 'Season acquisition limit reached (% of % adds used this season).', v_season_adds, v_max_adds_season;
    END IF;
  END IF;

  -- Drop the outgoing player
  UPDATE uff_roster_players
     SET dropped_at = now()
   WHERE member_id = v_member_id AND player_id = p_drop_player_id AND slot = 'active' AND dropped_at IS NULL;

  -- Add the incoming player
  INSERT INTO uff_roster_players (league_id, member_id, player_id, slot, week_added)
  VALUES (p_league_id, v_member_id, p_add_player_id, 'active', p_week);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.add_player(p_league_id uuid, p_user_id uuid, p_player_id text, p_week smallint DEFAULT NULL::smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id        uuid;
  v_active_count     int;
  v_max_active       int;
  v_already_on       int;
  v_max_adds_week    smallint;
  v_max_adds_season  smallint;
  v_week_adds        int;
  v_season_adds      int;
  v_eliminated       timestamptz;
BEGIN
  SELECT id INTO v_member_id
    FROM league_members WHERE league_id = p_league_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not a member of this league'; END IF;

  -- Elimination check
  SELECT eliminated_at INTO v_eliminated FROM league_members WHERE id = v_member_id;
  IF v_eliminated IS NOT NULL THEN
    RAISE EXCEPTION 'Your roster is locked — your team was eliminated from the playoffs.';
  END IF;

  -- Player must not already be on an active roster in this league
  SELECT COUNT(*) INTO v_already_on
    FROM uff_roster_players WHERE league_id = p_league_id AND player_id = p_player_id AND dropped_at IS NULL;
  IF v_already_on > 0 THEN RAISE EXCEPTION 'Player is already on a roster in this league'; END IF;

  -- Active roster must have room
  SELECT COUNT(*) INTO v_active_count
    FROM uff_roster_players WHERE member_id = v_member_id AND dropped_at IS NULL AND slot = 'active';
  SELECT draft_rounds, max_adds_per_week, max_adds_per_season
    INTO v_max_active, v_max_adds_week, v_max_adds_season
    FROM uff_leagues WHERE id = p_league_id;
  IF v_active_count >= v_max_active THEN
    RAISE EXCEPTION 'Active roster is full (% players). Drop someone first.', v_max_active;
  END IF;

  -- Per-week limit (0 = unlimited)
  IF p_week IS NOT NULL AND v_max_adds_week > 0 THEN
    SELECT COUNT(*) INTO v_week_adds
      FROM uff_roster_players WHERE member_id = v_member_id AND week_added = p_week;
    IF v_week_adds >= v_max_adds_week THEN
      RAISE EXCEPTION 'Weekly acquisition limit reached (% of % adds used this week).', v_week_adds, v_max_adds_week;
    END IF;
  END IF;

  -- Per-season limit (0 = unlimited)
  IF v_max_adds_season > 0 THEN
    SELECT COUNT(*) INTO v_season_adds
      FROM uff_roster_players WHERE member_id = v_member_id AND week_added IS NOT NULL AND week_added > 0;
    IF v_season_adds >= v_max_adds_season THEN
      RAISE EXCEPTION 'Season acquisition limit reached (% of % adds used this season).', v_season_adds, v_max_adds_season;
    END IF;
  END IF;

  INSERT INTO uff_roster_players (league_id, member_id, player_id, slot, week_added)
  VALUES (p_league_id, v_member_id, p_player_id, 'active', p_week);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.add_to_cant_cut(p_league_id uuid, p_user_id uuid, p_player_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Only the commissioner can manage the Can''t Cut List';
  END IF;

  INSERT INTO uff_cant_cut_list (league_id, player_id)
  VALUES (p_league_id, p_player_id)
  ON CONFLICT (league_id, player_id) DO NOTHING;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.advance_playoff_bracket(p_league_id uuid, p_week smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_season          text;
  v_playoff_teams   smallint;
  v_bracket_slot    record;
  v_pts_a           numeric;
  v_pts_b           numeric;
  v_winner_id       uuid;
  v_loser_id        uuid;
  v_next_matchup_id int;
  v_next_slot       record;
  v_next_round      smallint;
  v_next_slot_no    smallint;
  v_next_position   text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the commissioner can advance the playoff bracket';
  END IF;

  SELECT season, playoff_teams INTO v_season, v_playoff_teams
    FROM uff_leagues WHERE id = p_league_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM uff_playoff_bracket WHERE league_id = p_league_id AND season = v_season
  ) THEN RETURN; END IF;

  FOR v_bracket_slot IN
    SELECT pb.*
      FROM uff_playoff_bracket pb
     WHERE pb.league_id   = p_league_id
       AND pb.season      = v_season
       AND pb.week        = p_week
       AND pb.is_complete = false
       AND pb.member_id_a IS NOT NULL
       AND pb.member_id_b IS NOT NULL
  LOOP
    SELECT points INTO v_pts_a
      FROM uff_matchups
     WHERE league_id  = p_league_id AND week = p_week
       AND is_playoff = true AND is_complete = true
       AND member_id  = v_bracket_slot.member_id_a LIMIT 1;

    SELECT points INTO v_pts_b
      FROM uff_matchups
     WHERE league_id  = p_league_id AND week = p_week
       AND is_playoff = true AND is_complete = true
       AND member_id  = v_bracket_slot.member_id_b LIMIT 1;

    IF v_pts_a IS NULL OR v_pts_b IS NULL THEN CONTINUE; END IF;

    v_winner_id := CASE WHEN v_pts_a >= v_pts_b THEN v_bracket_slot.member_id_a ELSE v_bracket_slot.member_id_b END;
    v_loser_id  := CASE WHEN v_pts_a >= v_pts_b THEN v_bracket_slot.member_id_b ELSE v_bracket_slot.member_id_a END;

    UPDATE uff_playoff_bracket
       SET is_complete = true, winner_id = v_winner_id, points_a = v_pts_a, points_b = v_pts_b
     WHERE id = v_bracket_slot.id;

    UPDATE league_members SET eliminated_at = now() WHERE id = v_loser_id;

    IF v_bracket_slot.round = 1 THEN
      v_next_round := 2;

      IF v_playoff_teams = 4 THEN
        v_next_slot_no  := 1;
        v_next_position := CASE WHEN v_bracket_slot.slot = 1 THEN 'a' ELSE 'b' END;
      ELSIF v_playoff_teams = 6 THEN
        v_next_slot_no  := v_bracket_slot.slot;
        v_next_position := 'b';
      ELSIF v_playoff_teams = 8 THEN
        CASE v_bracket_slot.slot
          WHEN 1 THEN v_next_slot_no := 1; v_next_position := 'a';
          WHEN 2 THEN v_next_slot_no := 1; v_next_position := 'b';
          WHEN 3 THEN v_next_slot_no := 2; v_next_position := 'a';
          WHEN 4 THEN v_next_slot_no := 2; v_next_position := 'b';
          ELSE         v_next_slot_no := 1; v_next_position := 'a';
        END CASE;
      END IF;

      IF v_next_position = 'a' THEN
        UPDATE uff_playoff_bracket SET member_id_a = v_winner_id
         WHERE league_id = p_league_id AND season = v_season AND round = v_next_round AND slot = v_next_slot_no;
      ELSE
        UPDATE uff_playoff_bracket SET member_id_b = v_winner_id
         WHERE league_id = p_league_id AND season = v_season AND round = v_next_round AND slot = v_next_slot_no;
      END IF;

      SELECT * INTO v_next_slot
        FROM uff_playoff_bracket
       WHERE league_id = p_league_id AND season = v_season AND round = v_next_round AND slot = v_next_slot_no;

      IF v_next_slot.member_id_a IS NOT NULL AND v_next_slot.member_id_b IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM uff_matchups
            WHERE league_id    = p_league_id AND season = v_season
              AND is_playoff   = true AND playoff_round = v_next_round
              AND member_id    = v_next_slot.member_id_a
         )
      THEN
        SELECT COALESCE(MAX(matchup_id), 0) + 1 INTO v_next_matchup_id FROM uff_matchups WHERE league_id = p_league_id;
        INSERT INTO uff_matchups (matchup_id, league_id, week, season, member_id, points, is_playoff, playoff_round)
        VALUES
          (v_next_matchup_id, p_league_id, v_next_slot.week, v_season, v_next_slot.member_id_a, 0, true, v_next_round),
          (v_next_matchup_id, p_league_id, v_next_slot.week, v_season, v_next_slot.member_id_b, 0, true, v_next_round);
      END IF;

    ELSIF v_bracket_slot.round = 2 THEN
      IF v_playoff_teams = 4 THEN
        NULL;
      ELSE
        IF v_bracket_slot.slot = 1 THEN
          UPDATE uff_playoff_bracket SET member_id_a = v_winner_id
           WHERE league_id = p_league_id AND season = v_season AND round = 3 AND slot = 1;
        ELSE
          UPDATE uff_playoff_bracket SET member_id_b = v_winner_id
           WHERE league_id = p_league_id AND season = v_season AND round = 3 AND slot = 1;
        END IF;

        SELECT * INTO v_next_slot
          FROM uff_playoff_bracket
         WHERE league_id = p_league_id AND season = v_season AND round = 3 AND slot = 1;

        IF v_next_slot.member_id_a IS NOT NULL AND v_next_slot.member_id_b IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM uff_matchups
              WHERE league_id  = p_league_id AND season = v_season
                AND is_playoff = true AND playoff_round = 3
           )
        THEN
          SELECT COALESCE(MAX(matchup_id), 0) + 1 INTO v_next_matchup_id FROM uff_matchups WHERE league_id = p_league_id;
          INSERT INTO uff_matchups (matchup_id, league_id, week, season, member_id, points, is_playoff, playoff_round)
          VALUES
            (v_next_matchup_id, p_league_id, v_next_slot.week, v_season, v_next_slot.member_id_a, 0, true, 3),
            (v_next_matchup_id, p_league_id, v_next_slot.week, v_season, v_next_slot.member_id_b, 0, true, 3);
        END IF;
      END IF;

    ELSIF v_bracket_slot.round = 3 THEN
      NULL;
    END IF;

  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_trade(p_trade_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trade             uff_trades%ROWTYPE;
  v_commissioner_id   uuid;
  v_proposer_user_id  uuid;
  v_receiver_user_id  uuid;
BEGIN
  SELECT * INTO v_trade FROM uff_trades WHERE id = p_trade_id FOR UPDATE;
  IF v_trade.id IS NULL THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_trade.status != 'pending_review' THEN RAISE EXCEPTION 'Trade is not awaiting commissioner review'; END IF;

  SELECT commissioner_id INTO v_commissioner_id FROM uff_leagues WHERE id = v_trade.league_id;
  IF v_commissioner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the commissioner can approve trades';
  END IF;

  -- Re-validate ownership at approval time (players may have moved since acceptance)
  IF EXISTS (
    SELECT 1 FROM unnest(v_trade.proposer_player_ids) AS pid
    WHERE NOT EXISTS (
      SELECT 1 FROM uff_roster_players
      WHERE member_id = v_trade.proposer_id AND player_id = pid AND dropped_at IS NULL
    )
  ) THEN RAISE EXCEPTION 'Proposer no longer has one or more offered players — trade cannot be completed'; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_trade.receiver_player_ids) AS pid
    WHERE NOT EXISTS (
      SELECT 1 FROM uff_roster_players
      WHERE member_id = v_trade.receiver_id AND player_id = pid AND dropped_at IS NULL
    )
  ) THEN RAISE EXCEPTION 'Receiver no longer has one or more requested players — trade cannot be completed'; END IF;

  SELECT user_id INTO v_proposer_user_id FROM league_members WHERE id = v_trade.proposer_id;
  SELECT user_id INTO v_receiver_user_id FROM league_members WHERE id = v_trade.receiver_id;

  UPDATE uff_roster_players SET member_id = v_trade.receiver_id
   WHERE member_id = v_trade.proposer_id
     AND player_id = ANY(v_trade.proposer_player_ids) AND dropped_at IS NULL;

  UPDATE uff_roster_players SET member_id = v_trade.proposer_id
   WHERE member_id = v_trade.receiver_id
     AND player_id = ANY(v_trade.receiver_player_ids) AND dropped_at IS NULL;

  UPDATE player_draft_powers SET drafted_by_user_id = v_receiver_user_id
   WHERE league_id = v_trade.league_id
     AND player_id = ANY(v_trade.proposer_player_ids)
     AND drafted_by_user_id = v_proposer_user_id;

  UPDATE player_draft_powers SET drafted_by_user_id = v_proposer_user_id
   WHERE league_id = v_trade.league_id
     AND player_id = ANY(v_trade.receiver_player_ids)
     AND drafted_by_user_id = v_receiver_user_id;

  UPDATE uff_trades SET status = 'accepted', updated_at = now() WHERE id = p_trade_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.award_season_titles(p_league_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bracket_total    int;
  v_bracket_open     int;
  v_champ_week       smallint;
  v_champ_matchup_id integer;
  v_champ_winner_id  uuid;
  v_champ_loser_id   uuid;
  v_winner_faction   text;
  v_rank             integer;
  r                  record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM uff_leagues
    WHERE id = p_league_id AND commissioner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the commissioner can award season titles.';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE NOT is_complete)
    INTO v_bracket_total, v_bracket_open
  FROM uff_playoff_bracket
  WHERE league_id = p_league_id;

  IF v_bracket_total > 0 THEN
    -- Bracket is the source of truth: every matchup must be decided, and the
    -- champion is the FINAL round's recorded winner — not a points heuristic.
    IF v_bracket_open > 0 THEN
      RAISE EXCEPTION 'Playoffs are not finished — % bracket matchup(s) still open.', v_bracket_open;
    END IF;

    SELECT winner_id,
           CASE WHEN winner_id = member_id_a THEN member_id_b ELSE member_id_a END
      INTO v_champ_winner_id, v_champ_loser_id
    FROM uff_playoff_bracket
    WHERE league_id = p_league_id
      AND round = (SELECT max(round) FROM uff_playoff_bracket WHERE league_id = p_league_id)
    ORDER BY slot
    LIMIT 1;

    IF v_champ_winner_id IS NULL THEN
      RAISE EXCEPTION 'The championship has no recorded winner yet.';
    END IF;
  ELSE
    -- Legacy fallback (no bracket rows): only after the league's configured
    -- championship week is fully complete — running early crowned semifinalists.
    SELECT championship_week INTO v_champ_week
    FROM uff_leagues WHERE id = p_league_id;
    IF v_champ_week IS NULL THEN
      RAISE EXCEPTION 'No playoff bracket and no championship week configured.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM uff_matchups
      WHERE league_id = p_league_id AND week = v_champ_week AND is_playoff = true
    ) THEN
      RAISE EXCEPTION 'Championship week (%) has no playoff matchups yet.', v_champ_week;
    END IF;
    IF EXISTS (
      SELECT 1 FROM uff_matchups
      WHERE league_id = p_league_id AND week = v_champ_week
        AND is_playoff = true AND is_complete = false
    ) THEN
      RAISE EXCEPTION 'Championship week (%) is not complete yet.', v_champ_week;
    END IF;

    SELECT matchup_id INTO v_champ_matchup_id
    FROM uff_matchups
    WHERE league_id = p_league_id
      AND week = v_champ_week
      AND is_playoff = true
      AND is_complete = true
    GROUP BY matchup_id
    ORDER BY SUM(points) DESC
    LIMIT 1;

    SELECT member_id INTO v_champ_winner_id
    FROM uff_matchups
    WHERE league_id = p_league_id AND matchup_id = v_champ_matchup_id
      AND week = v_champ_week
    ORDER BY points DESC
    LIMIT 1;

    SELECT member_id INTO v_champ_loser_id
    FROM uff_matchups
    WHERE league_id = p_league_id AND matchup_id = v_champ_matchup_id
      AND week = v_champ_week
      AND member_id != v_champ_winner_id
    LIMIT 1;
  END IF;

  SELECT faction INTO v_winner_faction
  FROM league_members WHERE id = v_champ_winner_id;

  UPDATE league_members
  SET season_title = CASE WHEN v_winner_faction = 'villain' THEN 'Super Villain' ELSE 'Super Hero' END
  WHERE id = v_champ_winner_id AND league_id = p_league_id;

  UPDATE league_members SET season_title = 'Nemesis'
  WHERE id = v_champ_loser_id AND league_id = p_league_id;

  v_rank := 1;
  FOR r IN
    SELECT m.member_id, lm.faction
    FROM uff_matchups m
    JOIN league_members lm ON lm.id = m.member_id
    WHERE m.league_id = p_league_id
      AND m.is_playoff = true
      AND m.member_id NOT IN (v_champ_winner_id, v_champ_loser_id)
    GROUP BY m.member_id, lm.faction
    ORDER BY SUM(m.points) DESC
  LOOP
    IF v_rank <= 2 THEN
      UPDATE league_members
      SET season_title = CASE WHEN r.faction = 'villain' THEN 'Henchman' ELSE 'Side Kick' END
      WHERE id = r.member_id AND league_id = p_league_id;
    ELSE
      UPDATE league_members SET season_title = 'Cast'
      WHERE id = r.member_id AND league_id = p_league_id;
    END IF;
    v_rank := v_rank + 1;
  END LOOP;

  UPDATE league_members
  SET season_title = 'Cast'
  WHERE league_id = p_league_id
    AND season_title IS NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_faction_roster_bonus(p_member_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(count(*), 0)::numeric * 0.5
  from public.uff_roster_players rp
  join public.players p on p.id = rp.player_id
  join public.nfl_teams nt on nt.abbr = p.team
  join public.league_members lm on lm.id = rp.member_id
  where rp.member_id = p_member_id
    and rp.dropped_at is null
    and lm.faction is not null
    and nt.faction = lm.faction;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_trade(p_trade_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trade uff_trades%ROWTYPE;
BEGIN
  -- FOR UPDATE serializes against a concurrent accept; the status re-check plus
  -- the guarded UPDATE make cancel a no-op if the trade already executed.
  SELECT * INTO v_trade FROM uff_trades WHERE id = p_trade_id FOR UPDATE;

  IF v_trade.id IS NULL THEN
    RAISE EXCEPTION 'Trade not found';
  END IF;

  IF v_trade.status != 'pending' THEN
    RAISE EXCEPTION 'Can only cancel pending trades';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM league_members WHERE id = v_trade.proposer_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the trade proposer can cancel this trade';
  END IF;

  UPDATE uff_trades SET status = 'cancelled', updated_at = now()
   WHERE id = p_trade_id AND status = 'pending';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_waiver_bid(p_bid_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE uff_waiver_bids
     SET status = 'cancelled'
   WHERE id = p_bid_id
     AND status = 'pending'
     AND member_id IN (SELECT id FROM league_members WHERE user_id = auth.uid());

  IF NOT FOUND THEN RAISE EXCEPTION 'Bid not found or already processed'; END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_faction_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_max_teams int;
  v_capacity int;
  v_count int;
BEGIN
  IF NEW.faction IS NULL THEN RETURN NEW; END IF;
  SELECT max_teams INTO v_max_teams FROM uff_leagues WHERE id = NEW.league_id;
  v_capacity := v_max_teams / 2;
  SELECT COUNT(*) INTO v_count
  FROM league_members
  WHERE league_id = NEW.league_id AND faction = NEW.faction AND id != NEW.id;
  IF v_count >= v_capacity THEN
    RAISE EXCEPTION 'The % side is already full', NEW.faction;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.clear_heist_state(p_league_id uuid, p_original_order jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_heist jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM league_members
    WHERE league_id = p_league_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not a member of this league';
  END IF;

  SELECT heist_state INTO v_heist FROM uff_leagues WHERE id = p_league_id FOR UPDATE;
  IF v_heist IS NULL THEN RETURN; END IF;

  -- Restore from the STORED pre-heist order; the client-supplied argument is
  -- kept only for signature compatibility and no longer trusted.
  UPDATE uff_leagues
     SET draft_order = COALESCE(v_heist->'originalOrder', p_original_order),
         heist_state = NULL
   WHERE id = p_league_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.drop_player(p_league_id uuid, p_user_id uuid, p_player_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id  uuid;
  v_roster_id  uuid;
  v_eliminated timestamptz;
BEGIN
  SELECT id INTO v_member_id
  FROM league_members
  WHERE league_id = p_league_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not a member of this league'; END IF;

  -- Elimination check
  SELECT eliminated_at INTO v_eliminated FROM league_members WHERE id = v_member_id;
  IF v_eliminated IS NOT NULL THEN
    RAISE EXCEPTION 'Your roster is locked — your team was eliminated from the playoffs.';
  END IF;

  -- Can't cut check
  IF EXISTS (
    SELECT 1 FROM uff_cant_cut_list
    WHERE league_id = p_league_id AND player_id = p_player_id
  ) THEN
    RAISE EXCEPTION 'This player is on the commissioner''s Can''t Cut List and cannot be dropped.';
  END IF;

  SELECT id INTO v_roster_id
  FROM uff_roster_players
  WHERE member_id = v_member_id
    AND player_id = p_player_id
    AND dropped_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player not on your roster'; END IF;

  UPDATE uff_roster_players SET dropped_at = now() WHERE id = v_roster_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.extend_schedule(p_league_id uuid, p_user_id uuid, p_new_weeks smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id uuid;
  v_season          text;
  v_member_ids      uuid[];
  v_n               int;
  v_teams           uuid[];
  v_dummy           uuid := gen_random_uuid();
  v_current_max     smallint;
  v_matchup_id      int;
  v_home            uuid;
  v_away            uuid;
  v_week            int;
  i                 int;
  j                 int;
  tmp               uuid;
BEGIN
  SELECT commissioner_id, season
    INTO v_commissioner_id, v_season
    FROM uff_leagues WHERE id = p_league_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF auth.uid() IS NOT NULL THEN
    IF auth.uid() != v_commissioner_id THEN
      RAISE EXCEPTION 'Only the commissioner can extend the schedule';
    END IF;
  ELSIF v_commissioner_id != p_user_id THEN
    RAISE EXCEPTION 'Only the commissioner can extend the schedule';
  END IF;
  IF p_new_weeks < 1 OR p_new_weeks > 18 THEN RAISE EXCEPTION 'season_weeks must be 1–18'; END IF;

  SELECT COALESCE(MAX(week), 0) INTO v_current_max
    FROM uff_matchups WHERE league_id = p_league_id AND is_playoff = false;

  IF p_new_weeks <= v_current_max THEN
    RAISE EXCEPTION 'New week count (%) must be greater than current max week (%)', p_new_weeks, v_current_max;
  END IF;

  SELECT ARRAY_AGG(id ORDER BY joined_at) INTO v_member_ids
    FROM league_members WHERE league_id = p_league_id;

  v_n := array_length(v_member_ids, 1);
  IF v_n < 2 THEN RAISE EXCEPTION 'Need at least 2 teams'; END IF;

  IF v_n % 2 = 1 THEN
    v_teams := v_member_ids || ARRAY[v_dummy];
  ELSE
    v_teams := v_member_ids;
  END IF;

  SELECT COALESCE(MAX(matchup_id), 0) + 1 INTO v_matchup_id
    FROM uff_matchups WHERE league_id = p_league_id;

  FOR v_week IN 1..v_current_max LOOP
    tmp := v_teams[array_length(v_teams, 1)];
    FOR j IN REVERSE array_length(v_teams, 1)..3 LOOP
      v_teams[j] := v_teams[j - 1];
    END LOOP;
    v_teams[2] := tmp;
  END LOOP;

  FOR v_week IN (v_current_max + 1)..p_new_weeks LOOP
    FOR i IN 1..(array_length(v_teams, 1) / 2) LOOP
      v_home := v_teams[i];
      v_away := v_teams[array_length(v_teams, 1) - i + 1];

      IF v_home != v_dummy AND v_away != v_dummy THEN
        INSERT INTO uff_matchups (matchup_id, league_id, week, season, member_id, points, is_playoff)
        VALUES
          (v_matchup_id, p_league_id, v_week::smallint, v_season, v_home, 0, false),
          (v_matchup_id, p_league_id, v_week::smallint, v_season, v_away, 0, false);
        v_matchup_id := v_matchup_id + 1;
      END IF;
    END LOOP;

    tmp := v_teams[array_length(v_teams, 1)];
    FOR j IN REVERSE array_length(v_teams, 1)..3 LOOP
      v_teams[j] := v_teams[j - 1];
    END LOOP;
    v_teams[2] := tmp;
  END LOOP;

  UPDATE uff_leagues SET season_weeks = p_new_weeks WHERE id = p_league_id;
END;
$function$
;

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

CREATE OR REPLACE FUNCTION public.generate_schedule(p_league_id uuid, p_user_id uuid, p_weeks smallint DEFAULT 14)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id uuid;
  v_season          text;
  v_member_ids      uuid[];
  v_n               int;
  v_teams           uuid[];
  v_dummy           uuid := gen_random_uuid();
  v_week            int;
  v_matchup_id      int;
  v_home            uuid;
  v_away            uuid;
  v_existing        int;
  i                 int;
  j                 int;
  tmp               uuid;
BEGIN
  SELECT commissioner_id, season INTO v_commissioner_id, v_season
  FROM uff_leagues WHERE id = p_league_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF auth.uid() IS NOT NULL THEN
    IF auth.uid() != v_commissioner_id THEN
      RAISE EXCEPTION 'Only the commissioner can generate the schedule';
    END IF;
  ELSIF v_commissioner_id != p_user_id THEN
    RAISE EXCEPTION 'Only the commissioner can generate the schedule';
  END IF;

  IF p_weeks < 1 OR p_weeks > 18 THEN
    RAISE EXCEPTION 'season_weeks must be between 1 and 18';
  END IF;

  SELECT COUNT(*) INTO v_existing FROM uff_matchups WHERE league_id = p_league_id;
  IF v_existing > 0 THEN RAISE EXCEPTION 'Schedule already exists for this league'; END IF;

  SELECT ARRAY_AGG(id ORDER BY joined_at) INTO v_member_ids
  FROM league_members WHERE league_id = p_league_id;

  v_n := array_length(v_member_ids, 1);
  IF v_n < 2 THEN RAISE EXCEPTION 'Need at least 2 teams to generate a schedule'; END IF;

  IF v_n % 2 = 1 THEN
    v_teams := v_member_ids || ARRAY[v_dummy];
  ELSE
    v_teams := v_member_ids;
  END IF;

  UPDATE uff_leagues SET season_weeks = p_weeks WHERE id = p_league_id;

  v_matchup_id := 1;
  FOR v_week IN 1..p_weeks LOOP
    FOR i IN 1..(array_length(v_teams, 1) / 2) LOOP
      v_home := v_teams[i];
      v_away := v_teams[array_length(v_teams, 1) - i + 1];

      IF v_home != v_dummy AND v_away != v_dummy THEN
        INSERT INTO uff_matchups (matchup_id, league_id, week, season, member_id, points)
        VALUES
          (v_matchup_id, p_league_id, v_week::smallint, v_season, v_home, 0),
          (v_matchup_id, p_league_id, v_week::smallint, v_season, v_away, 0);
        v_matchup_id := v_matchup_id + 1;
      END IF;
    END LOOP;

    tmp := v_teams[array_length(v_teams, 1)];
    FOR j IN REVERSE array_length(v_teams, 1)..3 LOOP
      v_teams[j] := v_teams[j - 1];
    END LOOP;
    v_teams[2] := tmp;
  END LOOP;
END;
$function$
;

-- NOTE: the redundant 2-arg generate_schedule(uuid, uuid) wrapper was DROPPED
-- 2026-08-25 (migration fix_generate_schedule_ambiguous_overload) — it made
-- 2-arg calls ambiguous with the 3-arg DEFAULT version below, silently breaking
-- make_draft_pick's end-of-draft schedule generation. The 3-arg version's
-- DEFAULT 14 covers all 2-arg callers.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  base_username text;
  candidate text;
  suffix int := 0;
begin
  base_username := lower(split_part(coalesce(new.email, 'user'), '@', 1));
  base_username := regexp_replace(base_username, '[^a-z0-9_]', '', 'g');
  if base_username = '' then
    base_username := 'user';
  end if;

  candidate := base_username;
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := base_username || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    candidate,
    coalesce(new.raw_user_meta_data->>'display_name', base_username)
  );

  return new;
end;
$function$
;

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
  -- Session-verified identity: a direct RPC call cannot pick as someone else.
  -- Service-role callers (no auth.uid()) keep the explicit-id path.
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
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
$function$
;

CREATE OR REPLACE FUNCTION public.mark_week_tokens_used(p_league_id uuid, p_week integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the commissioner can mark tokens used';
  END IF;

  UPDATE weekly_token_assignments
     SET status = 'used', used_at = now()
   WHERE league_id = p_league_id AND week = p_week AND status = 'pending';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_week_tokens_used_all(p_week integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer;
BEGIN
  UPDATE weekly_token_assignments
  SET status = 'used', used_at = now()
  WHERE week = p_week AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.move_from_ir(p_league_id uuid, p_user_id uuid, p_player_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id    uuid;
  v_roster_id    uuid;
  v_active_count int;
  v_max_active   int;
  v_eliminated   timestamptz;
BEGIN
  SELECT id INTO v_member_id
  FROM league_members
  WHERE league_id = p_league_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not a member of this league'; END IF;

  -- Elimination check
  SELECT eliminated_at INTO v_eliminated FROM league_members WHERE id = v_member_id;
  IF v_eliminated IS NOT NULL THEN
    RAISE EXCEPTION 'Your roster is locked — your team was eliminated from the playoffs.';
  END IF;

  SELECT id INTO v_roster_id
  FROM uff_roster_players
  WHERE member_id = v_member_id
    AND player_id = p_player_id
    AND dropped_at IS NULL
    AND slot = 'ir';
  IF NOT FOUND THEN RAISE EXCEPTION 'Player not on your IR'; END IF;

  -- Active roster must have room
  SELECT COUNT(*) INTO v_active_count
  FROM uff_roster_players
  WHERE member_id = v_member_id AND dropped_at IS NULL AND slot = 'active';
  SELECT draft_rounds INTO v_max_active FROM uff_leagues WHERE id = p_league_id;
  IF v_active_count >= v_max_active THEN
    RAISE EXCEPTION 'Active roster is full. Drop someone before moving off IR.';
  END IF;

  UPDATE uff_roster_players SET slot = 'active' WHERE id = v_roster_id;
END;
$function$
;

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
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_priority_waivers(p_league_id uuid, p_week integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id uuid;
  v_max_active      int;
  v_max_adds_week   smallint;
  v_max_adds_season smallint;
  v_bid             record;
  v_on_roster       boolean;
  v_active_count    int;
  v_week_adds       int;
  v_season_adds     int;
  v_has_valid_drop  boolean;
  v_awarded         int := 0;
  v_max_priority    int;
BEGIN
  SELECT commissioner_id, draft_rounds, max_adds_per_week, max_adds_per_season
    INTO v_commissioner_id, v_max_active, v_max_adds_week, v_max_adds_season
    FROM uff_leagues WHERE id = p_league_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;

  -- Service-role calls (cron) carry no auth.uid(); interactive callers must be the commissioner
  IF auth.uid() IS NOT NULL AND auth.uid() != v_commissioner_id THEN
    RAISE EXCEPTION 'Only the commissioner can process waivers';
  END IF;

  LOOP
    -- Re-select the single best pending claim each pass so an award's new
    -- bottom-priority applies to the winner's remaining claims.
    SELECT wb.id, wb.member_id, wb.player_id, wb.drop_player_id, lm.eliminated_at
      INTO v_bid
      FROM uff_waiver_bids wb
      JOIN league_members lm ON lm.id = wb.member_id
     WHERE wb.league_id = p_league_id
       AND wb.week     <= p_week
       AND wb.status    = 'pending'
     ORDER BY lm.waiver_priority ASC NULLS LAST, wb.created_at ASC
     LIMIT 1;
    EXIT WHEN NOT FOUND;

    IF v_bid.eliminated_at IS NOT NULL THEN
      UPDATE uff_waiver_bids SET status = 'rejected', processed_at = now() WHERE id = v_bid.id;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM uff_roster_players
       WHERE league_id = p_league_id AND player_id = v_bid.player_id AND dropped_at IS NULL
    ) INTO v_on_roster;
    IF v_on_roster THEN
      UPDATE uff_waiver_bids SET status = 'rejected', processed_at = now() WHERE id = v_bid.id;
      CONTINUE;
    END IF;

    IF v_bid.drop_player_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM uff_cant_cut_list WHERE league_id = p_league_id AND player_id = v_bid.drop_player_id
    ) THEN
      UPDATE uff_waiver_bids SET status = 'rejected', processed_at = now() WHERE id = v_bid.id;
      CONTINUE;
    END IF;

    v_has_valid_drop := v_bid.drop_player_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM uff_roster_players
       WHERE member_id = v_bid.member_id AND player_id = v_bid.drop_player_id AND dropped_at IS NULL
    );

    SELECT COUNT(*) INTO v_active_count FROM uff_roster_players
     WHERE member_id = v_bid.member_id AND slot = 'active' AND dropped_at IS NULL;
    IF v_active_count >= v_max_active AND NOT v_has_valid_drop THEN
      UPDATE uff_waiver_bids SET status = 'rejected', processed_at = now() WHERE id = v_bid.id;
      CONTINUE;
    END IF;

    IF v_max_adds_week > 0 THEN
      SELECT COUNT(*) INTO v_week_adds FROM uff_roster_players
       WHERE member_id = v_bid.member_id AND week_added = p_week;
      IF v_week_adds >= v_max_adds_week THEN
        UPDATE uff_waiver_bids SET status = 'rejected', processed_at = now() WHERE id = v_bid.id;
        CONTINUE;
      END IF;
    END IF;

    IF v_max_adds_season > 0 THEN
      SELECT COUNT(*) INTO v_season_adds FROM uff_roster_players
       WHERE member_id = v_bid.member_id AND week_added IS NOT NULL AND week_added > 0;
      IF v_season_adds >= v_max_adds_season THEN
        UPDATE uff_waiver_bids SET status = 'rejected', processed_at = now() WHERE id = v_bid.id;
        CONTINUE;
      END IF;
    END IF;

    IF v_has_valid_drop THEN
      UPDATE uff_roster_players SET dropped_at = now()
       WHERE member_id = v_bid.member_id AND player_id = v_bid.drop_player_id AND dropped_at IS NULL;
    END IF;

    -- slot must be 'active': the table CHECK only allows 'active'/'ir'
    INSERT INTO uff_roster_players (league_id, member_id, player_id, slot, added_at, week_added)
    VALUES (p_league_id, v_bid.member_id, v_bid.player_id, 'active', now(), p_week)
    ON CONFLICT DO NOTHING;

    UPDATE uff_waiver_bids SET status = 'awarded', processed_at = now() WHERE id = v_bid.id;

    UPDATE uff_waiver_bids SET status = 'rejected', processed_at = now()
     WHERE league_id = p_league_id AND week <= p_week AND player_id = v_bid.player_id AND status = 'pending';

    SELECT COALESCE(MAX(waiver_priority), 0) INTO v_max_priority
      FROM league_members WHERE league_id = p_league_id;
    UPDATE league_members SET waiver_priority = v_max_priority + 1 WHERE id = v_bid.member_id;

    v_awarded := v_awarded + 1;
  END LOOP;

  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY waiver_priority ASC NULLS LAST) AS new_priority
    FROM league_members WHERE league_id = p_league_id
  )
  UPDATE league_members lm SET waiver_priority = ranked.new_priority
    FROM ranked WHERE lm.id = ranked.id;

  RETURN v_awarded;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.process_waiver_bids(p_league_id uuid, p_user_id uuid, p_week smallint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commissioner_id  uuid;
  v_faab_budget      smallint;
  v_max_active       int;
  v_max_adds_week    smallint;
  v_max_adds_season  smallint;
  v_target_player    text;
  v_winner           record;
  v_active_count     int;
  v_week_adds        int;
  v_season_adds      int;
  v_has_valid_drop   boolean;
  v_claims           int := 0;
  v_done             boolean;
BEGIN
  SELECT commissioner_id, faab_budget, draft_rounds, max_adds_per_week, max_adds_per_season
    INTO v_commissioner_id, v_faab_budget, v_max_active, v_max_adds_week, v_max_adds_season
    FROM uff_leagues WHERE id = p_league_id;

  -- Interactive callers must BE the commissioner (session-verified);
  -- service-role callers (cron) have no auth.uid() and pass the id explicitly.
  IF auth.uid() IS NOT NULL THEN
    IF auth.uid() != v_commissioner_id THEN
      RAISE EXCEPTION 'Only the commissioner can process waivers';
    END IF;
  ELSIF v_commissioner_id != p_user_id THEN
    RAISE EXCEPTION 'Only the commissioner can process waivers';
  END IF;

  FOR v_target_player IN
    SELECT DISTINCT player_id FROM uff_waiver_bids
     WHERE league_id = p_league_id AND week <= p_week AND status = 'pending'
     ORDER BY player_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM uff_roster_players
       WHERE league_id = p_league_id AND player_id = v_target_player AND dropped_at IS NULL
    ) THEN
      UPDATE uff_waiver_bids SET status = 'lost', processed_at = now()
       WHERE league_id = p_league_id AND week <= p_week AND player_id = v_target_player AND status = 'pending';
      CONTINUE;
    END IF;

    v_done := false;
    WHILE NOT v_done LOOP
      SELECT wb.*, COALESCE(lm.faab_balance, v_faab_budget) AS effective_balance
        INTO v_winner
        FROM uff_waiver_bids wb
        JOIN league_members lm ON lm.id = wb.member_id
       WHERE wb.league_id = p_league_id AND wb.week <= p_week
         AND wb.status = 'pending' AND wb.player_id = v_target_player
         AND lm.eliminated_at IS NULL
         AND COALESCE(lm.faab_balance, v_faab_budget) >= wb.bid_amount
       ORDER BY wb.bid_amount DESC, wb.created_at ASC
       LIMIT 1;

      IF v_winner IS NULL THEN
        UPDATE uff_waiver_bids SET status = 'lost', processed_at = now()
         WHERE league_id = p_league_id AND week <= p_week AND player_id = v_target_player AND status = 'pending';
        v_done := true;
        CONTINUE;
      END IF;

      -- Can't Cut List protects the named drop; this bid fails, next-best bidder retries
      IF v_winner.drop_player_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM uff_cant_cut_list WHERE league_id = p_league_id AND player_id = v_winner.drop_player_id
      ) THEN
        UPDATE uff_waiver_bids SET status = 'lost', processed_at = now() WHERE id = v_winner.id;
        CONTINUE;
      END IF;

      -- The named drop only creates roster room if it is actually still droppable
      v_has_valid_drop := v_winner.drop_player_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM uff_roster_players
         WHERE member_id = v_winner.member_id AND player_id = v_winner.drop_player_id AND dropped_at IS NULL
      );

      SELECT COUNT(*) INTO v_active_count FROM uff_roster_players
       WHERE member_id = v_winner.member_id AND slot = 'active' AND dropped_at IS NULL;
      IF v_active_count >= v_max_active AND NOT v_has_valid_drop THEN
        UPDATE uff_waiver_bids SET status = 'lost', processed_at = now() WHERE id = v_winner.id;
        CONTINUE;
      END IF;

      IF v_max_adds_week > 0 THEN
        SELECT COUNT(*) INTO v_week_adds FROM uff_roster_players
         WHERE member_id = v_winner.member_id AND week_added = p_week;
        IF v_week_adds >= v_max_adds_week THEN
          UPDATE uff_waiver_bids SET status = 'lost', processed_at = now() WHERE id = v_winner.id;
          CONTINUE;
        END IF;
      END IF;

      IF v_max_adds_season > 0 THEN
        SELECT COUNT(*) INTO v_season_adds FROM uff_roster_players
         WHERE member_id = v_winner.member_id AND week_added IS NOT NULL AND week_added > 0;
        IF v_season_adds >= v_max_adds_season THEN
          UPDATE uff_waiver_bids SET status = 'lost', processed_at = now() WHERE id = v_winner.id;
          CONTINUE;
        END IF;
      END IF;

      IF v_has_valid_drop THEN
        UPDATE uff_roster_players SET dropped_at = now()
         WHERE member_id = v_winner.member_id AND player_id = v_winner.drop_player_id AND dropped_at IS NULL;
      END IF;

      INSERT INTO uff_roster_players (member_id, league_id, player_id, slot, week_added)
      VALUES (v_winner.member_id, p_league_id, v_target_player, 'active', p_week);

      UPDATE league_members
         SET faab_balance = COALESCE(faab_balance, v_faab_budget) - v_winner.bid_amount
       WHERE id = v_winner.member_id;

      UPDATE uff_waiver_bids SET status = 'won', processed_at = now() WHERE id = v_winner.id;
      UPDATE uff_waiver_bids SET status = 'lost', processed_at = now()
       WHERE league_id = p_league_id AND week <= p_week AND player_id = v_target_player AND status = 'pending';

      v_claims := v_claims + 1;
      v_done := true;
    END LOOP;
  END LOOP;

  RETURN v_claims;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.propose_trade(p_league_id uuid, p_receiver_id uuid, p_proposer_player_ids text[], p_receiver_player_ids text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_proposer_id uuid;
  v_trade_id    uuid;
BEGIN
  SELECT id INTO v_proposer_id
  FROM league_members
  WHERE league_id = p_league_id AND user_id = auth.uid();

  IF v_proposer_id IS NULL THEN
    RAISE EXCEPTION 'You are not a member of this league';
  END IF;

  IF v_proposer_id = p_receiver_id THEN
    RAISE EXCEPTION 'You cannot trade with yourself';
  END IF;

  -- Receiver must be a member of the SAME league
  IF NOT EXISTS (
    SELECT 1 FROM league_members WHERE id = p_receiver_id AND league_id = p_league_id
  ) THEN
    RAISE EXCEPTION 'The other team is not in this league';
  END IF;

  IF array_length(p_proposer_player_ids, 1) IS NULL OR array_length(p_receiver_player_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Both sides of the trade must include at least one player';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_proposer_player_ids) AS pid
    WHERE NOT EXISTS (
      SELECT 1 FROM uff_roster_players
      WHERE member_id = v_proposer_id AND player_id = pid AND dropped_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'One or more offered players are not on your active roster';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_receiver_player_ids) AS pid
    WHERE NOT EXISTS (
      SELECT 1 FROM uff_roster_players
      WHERE member_id = p_receiver_id AND player_id = pid AND dropped_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'One or more requested players are not on the other team''s roster';
  END IF;

  INSERT INTO uff_trades (league_id, proposer_id, receiver_id, proposer_player_ids, receiver_player_ids)
  VALUES (p_league_id, v_proposer_id, p_receiver_id, p_proposer_player_ids, p_receiver_player_ids)
  RETURNING id INTO v_trade_id;

  RETURN v_trade_id;
END;
$function$
;

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

  IF v_commissioner_id != p_user_id THEN
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
$function$
;

CREATE OR REPLACE FUNCTION public.remove_from_cant_cut(p_league_id uuid, p_user_id uuid, p_player_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Only the commissioner can manage the Can''t Cut List';
  END IF;

  DELETE FROM uff_cant_cut_list
  WHERE league_id = p_league_id AND player_id = p_player_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reset_waiver_priority(p_league_id uuid, p_season integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_commissioner_id uuid;
  v_member RECORD;
  v_rank   INT := 1;
BEGIN
  SELECT commissioner_id INTO v_commissioner_id FROM uff_leagues WHERE id = p_league_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() != v_commissioner_id THEN
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
$function$
;

CREATE OR REPLACE FUNCTION public.respond_to_trade(p_trade_id uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trade               uff_trades%ROWTYPE;
  v_receiver_member_id  uuid;
  v_proposer_user_id    uuid;
  v_receiver_user_id    uuid;
  v_commissioner_review boolean;
BEGIN
  SELECT * INTO v_trade FROM uff_trades WHERE id = p_trade_id FOR UPDATE;
  IF v_trade.id IS NULL THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_trade.status != 'pending' THEN RAISE EXCEPTION 'Trade is no longer pending'; END IF;

  SELECT id INTO v_receiver_member_id
    FROM league_members WHERE id = v_trade.receiver_id AND user_id = auth.uid();
  IF v_receiver_member_id IS NULL THEN
    RAISE EXCEPTION 'Only the trade recipient can respond to this trade';
  END IF;

  IF NOT p_accept THEN
    UPDATE uff_trades SET status = 'rejected', updated_at = now() WHERE id = p_trade_id;
    RETURN;
  END IF;

  -- Re-validate ownership at acceptance time
  IF EXISTS (
    SELECT 1 FROM unnest(v_trade.proposer_player_ids) AS pid
    WHERE NOT EXISTS (
      SELECT 1 FROM uff_roster_players
      WHERE member_id = v_trade.proposer_id AND player_id = pid AND dropped_at IS NULL
    )
  ) THEN RAISE EXCEPTION 'Proposer no longer has one or more offered players'; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_trade.receiver_player_ids) AS pid
    WHERE NOT EXISTS (
      SELECT 1 FROM uff_roster_players
      WHERE member_id = v_trade.receiver_id AND player_id = pid AND dropped_at IS NULL
    )
  ) THEN RAISE EXCEPTION 'You no longer have one or more of the requested players'; END IF;

  -- Check if commissioner review is enabled for this league
  SELECT commissioner_review INTO v_commissioner_review
    FROM uff_leagues WHERE id = v_trade.league_id;

  IF v_commissioner_review THEN
    -- Hold for review instead of executing
    UPDATE uff_trades SET status = 'pending_review', updated_at = now() WHERE id = p_trade_id;
    RETURN;
  END IF;

  -- Execute immediately (no review required)
  SELECT user_id INTO v_proposer_user_id FROM league_members WHERE id = v_trade.proposer_id;
  SELECT user_id INTO v_receiver_user_id FROM league_members WHERE id = v_trade.receiver_id;

  UPDATE uff_roster_players SET member_id = v_trade.receiver_id
   WHERE member_id = v_trade.proposer_id
     AND player_id = ANY(v_trade.proposer_player_ids) AND dropped_at IS NULL;

  UPDATE uff_roster_players SET member_id = v_trade.proposer_id
   WHERE member_id = v_trade.receiver_id
     AND player_id = ANY(v_trade.receiver_player_ids) AND dropped_at IS NULL;

  UPDATE player_draft_powers SET drafted_by_user_id = v_receiver_user_id
   WHERE league_id = v_trade.league_id
     AND player_id = ANY(v_trade.proposer_player_ids)
     AND drafted_by_user_id = v_proposer_user_id;

  UPDATE player_draft_powers SET drafted_by_user_id = v_proposer_user_id
   WHERE league_id = v_trade.league_id
     AND player_id = ANY(v_trade.receiver_player_ids)
     AND drafted_by_user_id = v_receiver_user_id;

  UPDATE uff_trades SET status = 'accepted', updated_at = now() WHERE id = p_trade_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_playoffs(p_league_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_commissioner_id   uuid;
  v_season            text;
  v_playoff_teams     smallint;
  v_playoff_start     smallint;
  v_championship_week smallint;
  v_seeds             uuid[];
  v_matchup_id        int;
BEGIN
  SELECT commissioner_id, season, playoff_teams, playoff_start_week, championship_week
    INTO v_commissioner_id, v_season, v_playoff_teams, v_playoff_start, v_championship_week
    FROM uff_leagues WHERE id = p_league_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'League not found'; END IF;
  IF auth.uid() IS NOT NULL THEN
    IF auth.uid() != v_commissioner_id THEN
      RAISE EXCEPTION 'Only the commissioner can seed playoffs';
    END IF;
  ELSIF v_commissioner_id != p_user_id THEN
    RAISE EXCEPTION 'Only the commissioner can seed playoffs';
  END IF;

  IF EXISTS (SELECT 1 FROM uff_playoff_bracket WHERE league_id = p_league_id AND season = v_season) THEN
    RAISE EXCEPTION 'Playoff bracket already seeded for this season';
  END IF;

  IF v_playoff_teams NOT IN (4, 6, 8) THEN
    RAISE EXCEPTION 'Playoff teams must be 4, 6, or 8 (got %)', v_playoff_teams;
  END IF;

  -- Opponent join is league/season-scoped: matchup_id restarts at 1 per league
  SELECT ARRAY_AGG(member_id ORDER BY wins DESC, pf DESC)
    INTO v_seeds
    FROM (
      SELECT
        m.member_id,
        COUNT(*) FILTER (WHERE m.points > opp.points AND NOT m.void_result) AS wins,
        SUM(m.points) AS pf
      FROM uff_matchups m
      JOIN uff_matchups opp
        ON opp.league_id   = m.league_id
       AND opp.season      = m.season
       AND opp.matchup_id  = m.matchup_id
       AND opp.member_id  != m.member_id
      WHERE m.league_id   = p_league_id
        AND m.season      = v_season
        AND m.is_complete = true
        AND m.is_playoff  = false
      GROUP BY m.member_id
    ) standings
    LIMIT v_playoff_teams;

  IF array_length(v_seeds, 1) < v_playoff_teams THEN
    RAISE EXCEPTION 'Not enough teams with completed games to seed % playoff spots', v_playoff_teams;
  END IF;

  SELECT COALESCE(MAX(matchup_id), 0) + 1 INTO v_matchup_id FROM uff_matchups WHERE league_id = p_league_id;

  UPDATE league_members
     SET eliminated_at = now()
   WHERE league_id = p_league_id
     AND id NOT IN (SELECT unnest(v_seeds[1:v_playoff_teams]));

  IF v_playoff_teams = 4 THEN
    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b, member_id_a, member_id_b)
    VALUES
      (p_league_id, v_season, 1, v_playoff_start, 1, 1, 4, v_seeds[1], v_seeds[4]),
      (p_league_id, v_season, 1, v_playoff_start, 2, 2, 3, v_seeds[2], v_seeds[3]);

    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b)
    VALUES
      (p_league_id, v_season, 2, v_championship_week, 1, NULL, NULL);

    INSERT INTO uff_matchups (matchup_id, league_id, week, season, member_id, points, is_playoff, playoff_round)
    VALUES
      (v_matchup_id,     p_league_id, v_playoff_start, v_season, v_seeds[1], 0, true, 1),
      (v_matchup_id,     p_league_id, v_playoff_start, v_season, v_seeds[4], 0, true, 1),
      (v_matchup_id + 1, p_league_id, v_playoff_start, v_season, v_seeds[2], 0, true, 1),
      (v_matchup_id + 1, p_league_id, v_playoff_start, v_season, v_seeds[3], 0, true, 1);

  ELSIF v_playoff_teams = 6 THEN
    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b, member_id_a, member_id_b)
    VALUES
      (p_league_id, v_season, 1, v_playoff_start,     1, 3, 6, v_seeds[3], v_seeds[6]),
      (p_league_id, v_season, 1, v_playoff_start,     2, 4, 5, v_seeds[4], v_seeds[5]);

    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b, member_id_a, member_id_b)
    VALUES
      (p_league_id, v_season, 2, v_playoff_start + 1, 1, 1, NULL, v_seeds[1], NULL),
      (p_league_id, v_season, 2, v_playoff_start + 1, 2, 2, NULL, v_seeds[2], NULL);

    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b)
    VALUES
      (p_league_id, v_season, 3, v_championship_week, 1, NULL, NULL);

    INSERT INTO uff_matchups (matchup_id, league_id, week, season, member_id, points, is_playoff, playoff_round)
    VALUES
      (v_matchup_id,     p_league_id, v_playoff_start, v_season, v_seeds[3], 0, true, 1),
      (v_matchup_id,     p_league_id, v_playoff_start, v_season, v_seeds[6], 0, true, 1),
      (v_matchup_id + 1, p_league_id, v_playoff_start, v_season, v_seeds[4], 0, true, 1),
      (v_matchup_id + 1, p_league_id, v_playoff_start, v_season, v_seeds[5], 0, true, 1);

  ELSIF v_playoff_teams = 8 THEN
    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b, member_id_a, member_id_b)
    VALUES
      (p_league_id, v_season, 1, v_playoff_start, 1, 1, 8, v_seeds[1], v_seeds[8]),
      (p_league_id, v_season, 1, v_playoff_start, 2, 4, 5, v_seeds[4], v_seeds[5]),
      (p_league_id, v_season, 1, v_playoff_start, 3, 2, 7, v_seeds[2], v_seeds[7]),
      (p_league_id, v_season, 1, v_playoff_start, 4, 3, 6, v_seeds[3], v_seeds[6]);

    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b)
    VALUES
      (p_league_id, v_season, 2, v_playoff_start + 1, 1, NULL, NULL),
      (p_league_id, v_season, 2, v_playoff_start + 1, 2, NULL, NULL);

    INSERT INTO uff_playoff_bracket (league_id, season, round, week, slot, seed_a, seed_b)
    VALUES
      (p_league_id, v_season, 3, v_championship_week, 1, NULL, NULL);

    INSERT INTO uff_matchups (matchup_id, league_id, week, season, member_id, points, is_playoff, playoff_round)
    VALUES
      (v_matchup_id,     p_league_id, v_playoff_start, v_season, v_seeds[1], 0, true, 1),
      (v_matchup_id,     p_league_id, v_playoff_start, v_season, v_seeds[8], 0, true, 1),
      (v_matchup_id + 1, p_league_id, v_playoff_start, v_season, v_seeds[4], 0, true, 1),
      (v_matchup_id + 1, p_league_id, v_playoff_start, v_season, v_seeds[5], 0, true, 1),
      (v_matchup_id + 2, p_league_id, v_playoff_start, v_season, v_seeds[2], 0, true, 1),
      (v_matchup_id + 2, p_league_id, v_playoff_start, v_season, v_seeds[7], 0, true, 1),
      (v_matchup_id + 3, p_league_id, v_playoff_start, v_season, v_seeds[3], 0, true, 1),
      (v_matchup_id + 3, p_league_id, v_playoff_start, v_season, v_seeds[6], 0, true, 1);
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_lineup(p_league_id uuid, p_user_id uuid, p_week integer, p_slots jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id  uuid;
  v_rec        jsonb;
  v_slot       text;
  v_player_id  text;
  v_player_pos text;
  v_slot_base  text;
  v_eligible   text[];
BEGIN
  SELECT id INTO v_member_id
  FROM public.league_members
  WHERE league_id = p_league_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this league';
  END IF;

  -- Validate each entry
  FOR v_rec IN SELECT value FROM jsonb_array_elements(p_slots) AS value LOOP
    v_slot      := v_rec->>'slot';
    v_player_id := v_rec->>'player_id';

    IF v_slot IS NULL OR v_player_id IS NULL THEN
      RAISE EXCEPTION 'Each slot entry must have slot and player_id';
    END IF;

    -- Player must be on active roster
    IF NOT EXISTS (
      SELECT 1 FROM public.uff_roster_players
      WHERE member_id = v_member_id
        AND player_id = v_player_id
        AND slot = 'active'
        AND dropped_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Player % is not on your active roster', v_player_id;
    END IF;

    -- Position eligibility
    SELECT position INTO v_player_pos FROM public.players WHERE id = v_player_id;
    v_slot_base := regexp_replace(v_slot, '_[0-9]+$', '');

    CASE v_slot_base
      WHEN 'QB'   THEN v_eligible := ARRAY['QB'];
      WHEN 'RB'   THEN v_eligible := ARRAY['RB'];
      WHEN 'WR'   THEN v_eligible := ARRAY['WR'];
      WHEN 'TE'   THEN v_eligible := ARRAY['TE'];
      WHEN 'FLEX' THEN v_eligible := ARRAY['RB','WR','TE'];
      WHEN 'K'    THEN v_eligible := ARRAY['K'];
      WHEN 'DEF'  THEN v_eligible := ARRAY['DEF','DST'];
      WHEN 'DST'  THEN v_eligible := ARRAY['DEF','DST'];
      ELSE RAISE EXCEPTION 'Unknown slot type: %', v_slot_base;
    END CASE;

    IF v_player_pos IS NULL OR NOT (v_player_pos = ANY(v_eligible)) THEN
      RAISE EXCEPTION 'Position % cannot be placed in % slot', v_player_pos, v_slot;
    END IF;
  END LOOP;

  -- Atomic replace
  DELETE FROM public.uff_lineups
  WHERE member_id = v_member_id AND week = p_week::smallint;

  INSERT INTO public.uff_lineups (league_id, member_id, player_id, week, slot)
  SELECT p_league_id, v_member_id, (r->>'player_id'), p_week::smallint, (r->>'slot')
  FROM jsonb_array_elements(p_slots) AS r;
END;
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.submit_waiver_bid(p_league_id uuid, p_player_id text, p_drop_player_id text, p_bid_amount smallint, p_week smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id   uuid;
  v_balance     smallint;
  v_faab_budget smallint;
  v_season      text;
  v_waiver_type text;
BEGIN
  SELECT lm.id, lm.faab_balance, l.faab_budget, l.season, l.waiver_type
    INTO v_member_id, v_balance, v_faab_budget, v_season, v_waiver_type
    FROM league_members lm
    JOIN uff_leagues    l ON l.id = lm.league_id
   WHERE lm.league_id = p_league_id AND lm.user_id = auth.uid()
   LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'Not a member of this league'; END IF;

  IF COALESCE(v_waiver_type, 'faab') = 'priority' THEN
    -- Priority claims carry no dollar amount; no FAAB budget required
    p_bid_amount := 0;
  ELSE
    IF COALESCE(v_faab_budget, 0) = 0 THEN RAISE EXCEPTION 'FAAB bidding is not enabled for this league'; END IF;
    IF p_bid_amount < 0 THEN RAISE EXCEPTION 'Bid amount cannot be negative'; END IF;
    IF COALESCE(v_balance, v_faab_budget) < p_bid_amount THEN
      RAISE EXCEPTION 'Bid of $% exceeds your FAAB balance ($%)', p_bid_amount, COALESCE(v_balance, v_faab_budget);
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM uff_roster_players
     WHERE league_id = p_league_id AND player_id = p_player_id AND dropped_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This player is already on a roster';
  END IF;

  UPDATE uff_waiver_bids
     SET status = 'cancelled'
   WHERE league_id = p_league_id AND member_id = v_member_id
     AND player_id = p_player_id AND week = p_week AND status = 'pending';

  INSERT INTO uff_waiver_bids
    (league_id, member_id, player_id, drop_player_id, bid_amount, week, season)
  VALUES
    (p_league_id, v_member_id, p_player_id, p_drop_player_id, p_bid_amount, p_week, v_season);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.swap_foresight_powers(p_league_id uuid, p_current_round smallint, p_swap_round smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id uuid;
  v_curr record;
  v_swap record;
BEGIN
  SELECT id INTO v_member_id FROM league_members
   WHERE league_id = p_league_id AND user_id = auth.uid();
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'Not a member of this league'; END IF;

  IF p_swap_round <= p_current_round OR p_swap_round > 16 THEN
    RAISE EXCEPTION 'Foresight Coin can only swap with a future round';
  END IF;

  SELECT id, power_id INTO v_curr FROM draft_power_assignments
   WHERE league_id = p_league_id AND member_id = v_member_id AND round = p_current_round FOR UPDATE;
  SELECT id, power_id INTO v_swap FROM draft_power_assignments
   WHERE league_id = p_league_id AND member_id = v_member_id AND round = p_swap_round FOR UPDATE;

  IF v_curr.id IS NULL OR v_swap.id IS NULL THEN
    RAISE EXCEPTION 'Power assignments not found';
  END IF;

  -- Foresight Coin is power_id 1; the caller must hold it in the current round
  IF v_curr.power_id != 1 THEN
    RAISE EXCEPTION 'You do not hold Foresight Coin this round';
  END IF;

  UPDATE draft_power_assignments SET power_id = v_swap.power_id WHERE id = v_curr.id;
  UPDATE draft_power_assignments SET power_id = v_curr.power_id WHERE id = v_swap.id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_draft_heist_order(p_league_id uuid, p_new_order jsonb, p_heist_state jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id     uuid;
  v_status        text;
  v_order         jsonb;
  v_heist         jsonb;
  v_max_teams     int;
  v_pick_count    int;
  v_current_round int;
BEGIN
  SELECT id INTO v_member_id FROM league_members
   WHERE league_id = p_league_id AND user_id = auth.uid();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Not a member of this league';
  END IF;

  SELECT draft_status, draft_order, heist_state, max_teams
    INTO v_status, v_order, v_heist, v_max_teams
    FROM uff_leagues WHERE id = p_league_id FOR UPDATE;

  IF v_status != 'in_progress' THEN RAISE EXCEPTION 'Draft is not in progress'; END IF;
  IF v_heist IS NOT NULL THEN RAISE EXCEPTION 'A heist is already active this round'; END IF;

  SELECT COUNT(*) INTO v_pick_count FROM uff_draft_picks WHERE league_id = p_league_id;
  v_current_round := ceil((v_pick_count + 1)::float / v_max_teams)::int;

  -- Caller must actually hold Draft Heist (power_id 3) this round
  IF NOT EXISTS (
    SELECT 1 FROM draft_power_assignments
     WHERE league_id = p_league_id AND member_id = v_member_id
       AND round = v_current_round AND power_id = 3
  ) THEN
    RAISE EXCEPTION 'You do not hold Draft Heist this round';
  END IF;

  -- The new order must be a permutation of the current draft order
  IF (SELECT COUNT(*) FROM jsonb_array_elements_text(v_order))
     != (SELECT COUNT(*) FROM jsonb_array_elements_text(p_new_order))
     OR EXISTS (
       SELECT value FROM jsonb_array_elements_text(v_order)
       EXCEPT
       SELECT value FROM jsonb_array_elements_text(p_new_order)
     ) THEN
    RAISE EXCEPTION 'Invalid draft order';
  END IF;

  UPDATE uff_leagues
     SET draft_order  = p_new_order,
         heist_state  = p_heist_state
   WHERE id = p_league_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_scoring_settings(p_league_id uuid, p_user_id uuid, p_settings jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = p_user_id) THEN
    RAISE EXCEPTION 'Only the commissioner can update scoring settings';
  END IF;
  UPDATE uff_leagues SET scoring_settings = p_settings WHERE id = p_league_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.veto_trade(p_trade_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trade           uff_trades%ROWTYPE;
  v_commissioner_id uuid;
BEGIN
  SELECT * INTO v_trade FROM uff_trades WHERE id = p_trade_id FOR UPDATE;
  IF v_trade.id IS NULL THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_trade.status != 'pending_review' THEN RAISE EXCEPTION 'Trade is not awaiting commissioner review'; END IF;

  SELECT commissioner_id INTO v_commissioner_id FROM uff_leagues WHERE id = v_trade.league_id;
  IF v_commissioner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the commissioner can veto trades';
  END IF;

  UPDATE uff_trades
     SET status = 'vetoed', veto_reason = p_reason, updated_at = now()
   WHERE id = p_trade_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.init_faab_balances(p_league_id uuid, p_amount smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the commissioner can set FAAB balances';
  END IF;
  UPDATE league_members SET faab_balance = p_amount
   WHERE league_id = p_league_id AND faab_balance IS NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_waiver_order(p_league_id uuid, p_member_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE i int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the commissioner can set waiver priority';
  END IF;
  IF p_member_ids IS NULL THEN RETURN; END IF;
  FOR i IN 1..array_length(p_member_ids, 1) LOOP
    UPDATE league_members SET waiver_priority = i
     WHERE id = p_member_ids[i] AND league_id = p_league_id;
  END LOOP;
END;
$function$
;
