-- 2026-09-26 — OPEN-LOOPS #77 / code-audit A1-07 and A1-10: two writes that the app validated
-- and the database did not.
--
--   A1-07  vampire_bites: the INSERT policy checked league membership only, so a member could
--          record a bite without holding Vampire Bite, on behalf of any member, on their own or
--          a Shadow-Guarded player, or a second bite — and the scoring engine siphons 10% per
--          row. assign_vampire_bite(p_league_id, p_target_player_id, p_round) now holds every
--          rule the two server actions applied, in one transaction, as the function owner:
--            * the caller was dealt Vampire Bite (power 16); p_round, when given, must be that
--              round;
--            * during the draft the bite is allowed only right after the caller's pick in that
--              round (their latest pick round equals it) — the rulebook's in-draft timing;
--            * after the draft it is allowed until the season's first kickoff (the post-draft
--              window the 2026-09-07 draft needed), never once games have started;
--            * one bite per manager; never your own player; never a Shadow-Guarded player;
--              a target can be bitten once (the unique constraint, reported in plain words).
--          The INSERT policy is dropped and app roles lose every write on the table.
--   A1-10  power_restore_chips: the owner could UPDATE any column (set used back to false and
--          spend the chip again), the action was read-then-write with no used = false predicate
--          (two submits, two restores, one chip) and the chip was consumed even when the restore
--          matched nothing. use_restore_chip(p_league_id, p_chip_id, p_player_id) locks the chip
--          row, requires it unused and owned by the caller, requires the player on the caller's
--          roster with an unrestored Power Negation, restores it and marks the chip used, all in
--          one transaction. The UPDATE policy is dropped and app roles lose every write.
--
-- App: draft/actions.ts assignVampireBite and postDraftVampireBite call assign_vampire_bite;
-- player-actions.ts useRestoreChip calls use_restore_chip. Their own pre-checks stay for the UI.
--
-- Rollback:
--   DROP FUNCTION public.assign_vampire_bite(uuid, text, integer);
--   DROP FUNCTION public.use_restore_chip(uuid, uuid, text);
--   CREATE POLICY "league members can insert vampire bites" ON public.vampire_bites FOR INSERT TO public
--     WITH CHECK (EXISTS (SELECT 1 FROM league_members WHERE league_members.league_id = vampire_bites.league_id AND league_members.user_id = auth.uid()));
--   CREATE POLICY "chip owner can use their chip" ON public.power_restore_chips FOR UPDATE TO public
--     USING (EXISTS (SELECT 1 FROM league_members lm WHERE lm.id = power_restore_chips.member_id AND lm.user_id = auth.uid()));
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.vampire_bites, public.power_restore_chips TO anon, authenticated;
--   and revert the two app files (git has them).
--
-- Applied live 2026-09-26 via the Supabase MCP as vampire_bite_and_restore_chip_rpcs (20260926143947).
-- Proven in rolled-back blocks as a real manager: own player, Shadow-Guarded player, wrong round,
-- second bite all refused, a valid post-draft bite recorded, direct insert permission denied; chip
-- used once on an own negated player, a second use and a direct reset refused, another manager
-- cannot use it; anon permission denied on both functions.

-- ── A1-07 ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_vampire_bite(p_league_id uuid, p_target_player_id text, p_round integer DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id  uuid;
  v_status     text;
  v_season     int;
  v_round      int;
  v_last_round int;
  v_first_kick timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  SELECT id INTO v_member_id FROM league_members WHERE league_id = p_league_id AND user_id = auth.uid();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Not a member of this league.';
  END IF;

  SELECT draft_status, season::int INTO v_status, v_season FROM uff_leagues WHERE id = p_league_id;

  -- Must have been dealt Vampire Bite; p_round, when given, must be that round
  SELECT round INTO v_round
    FROM draft_power_assignments
   WHERE league_id = p_league_id AND member_id = v_member_id AND power_id = 16;
  IF v_round IS NULL THEN
    RAISE EXCEPTION 'You weren''t dealt Vampire Bite.';
  END IF;
  IF p_round IS NOT NULL AND p_round <> v_round THEN
    RAISE EXCEPTION 'You don''t hold Vampire Bite this round.';
  END IF;

  -- When: during the draft, right after the pick in that round; or after the draft, before
  -- the season's first kickoff.
  IF v_status = 'in_progress' THEN
    SELECT max(round) INTO v_last_round FROM uff_draft_picks WHERE league_id = p_league_id AND member_id = v_member_id;
    IF v_last_round IS NULL OR v_last_round <> v_round THEN
      RAISE EXCEPTION 'Vampire Bite is used right after your pick in the round you hold it.';
    END IF;
  ELSIF v_status = 'completed' THEN
    SELECT min(kickoff_utc) INTO v_first_kick FROM uff_game_schedule WHERE season = v_season AND week = 1;
    IF v_first_kick IS NULL OR now() >= v_first_kick THEN
      RAISE EXCEPTION 'The Vampire Bite window closed at Week 1 kickoff.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Vampire Bite can be used during the draft or before Week 1 kickoff.';
  END IF;

  IF EXISTS (SELECT 1 FROM vampire_bites WHERE league_id = p_league_id AND biting_member_id = v_member_id) THEN
    RAISE EXCEPTION 'You''ve already used your Vampire Bite.';
  END IF;
  IF EXISTS (SELECT 1 FROM uff_roster_players
             WHERE league_id = p_league_id AND player_id = p_target_player_id AND member_id = v_member_id AND dropped_at IS NULL) THEN
    RAISE EXCEPTION 'You can''t bite your own player — choose an opponent''s player.';
  END IF;
  IF EXISTS (SELECT 1 FROM player_draft_powers
             WHERE league_id = p_league_id AND player_id = p_target_player_id AND power = 'shadow_guard') THEN
    RAISE EXCEPTION 'That player is protected by Shadow Guard — the bite fizzles. Choose a different target.';
  END IF;

  INSERT INTO vampire_bites (league_id, biting_member_id, target_player_id, round)
  VALUES (p_league_id, v_member_id, p_target_player_id, v_round);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'That player has already been bitten. Choose someone else.';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.assign_vampire_bite(uuid, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.assign_vampire_bite(uuid, text, integer) TO authenticated;

DROP POLICY IF EXISTS "league members can insert vampire bites" ON public.vampire_bites;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vampire_bites FROM anon, authenticated;

-- ── A1-10 ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.use_restore_chip(p_league_id uuid, p_chip_id uuid, p_player_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id uuid;
  v_chip      power_restore_chips%ROWTYPE;
  n           int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  SELECT id INTO v_member_id FROM league_members WHERE league_id = p_league_id AND user_id = auth.uid();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Not a member of this league.';
  END IF;

  -- Lock the chip: two submits cannot both spend it
  SELECT * INTO v_chip FROM power_restore_chips
   WHERE id = p_chip_id AND league_id = p_league_id AND member_id = v_member_id
     FOR UPDATE;
  IF v_chip.id IS NULL THEN
    RAISE EXCEPTION 'Restore chip not found.';
  END IF;
  IF v_chip.used THEN
    RAISE EXCEPTION 'That chip has already been used.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM uff_roster_players
                 WHERE league_id = p_league_id AND member_id = v_member_id AND player_id = p_player_id AND dropped_at IS NULL) THEN
    RAISE EXCEPTION 'That player is not on your roster.';
  END IF;

  UPDATE player_draft_powers
     SET restored_at = now()
   WHERE league_id = p_league_id AND player_id = p_player_id
     AND power = 'power_negation' AND restored_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'That player has no Power Negation to restore.';
  END IF;

  UPDATE power_restore_chips
     SET used = true, used_at = now(), used_on_player_id = p_player_id
   WHERE id = p_chip_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.use_restore_chip(uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.use_restore_chip(uuid, uuid, text) TO authenticated;

DROP POLICY IF EXISTS "chip owner can use their chip" ON public.power_restore_chips;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.power_restore_chips FROM anon, authenticated;
