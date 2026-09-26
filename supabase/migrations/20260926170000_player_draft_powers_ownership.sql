-- 2026-09-26 — OPEN-LOOPS #77 / code-audit A1-02: player_draft_powers write policies checked
-- league MEMBERSHIP, not ownership. Any signed-in manager could UPDATE an opponent's row to
-- power = 'power_negation' (the scoring engine halves that player), give their own players
-- 'shadow_guard' or 'time_stone' they were never dealt, reassign drafted_by_user_id, or INSERT
-- a power row for any player in the league that has none. The engine reads this table for
-- every score, so this was a direct line into the standings. (130 rows, no sign of abuse:
-- every row matches a real draft pick and the power actually dealt to that manager for that
-- round — verified before writing this.)
--
-- Who legitimately writes this table:
--   * draft/actions.ts assignPowerToPick — the picker attaches THEIR dealt power to THEIR pick
--     (upsert on league_id, player_id) through the signed-in user's client. Both draft-room
--     call sites are the picker's own pick.
--   * player-actions.ts useRestoreChip — the roster owner sets restored_at on a negated player.
--   * SECURITY DEFINER functions (run as postgres, so RLS never applied to them and still
--     does not): force_autopick and commissioner_draft_pick INSERT; approve_trade and
--     respond_to_trade move drafted_by_user_id to the receiver.
--   * The scoring engine (service_role, bypasses RLS) writes the Time Stone fields.
--
-- What changes:
--   a. anon loses INSERT/UPDATE/DELETE/TRUNCATE; authenticated loses TRUNCATE (same hygiene
--      as 20260915140000). The SELECT and service-role DELETE policies are untouched.
--   b. INSERT: only as yourself, only for a player you drafted in that round and still roster,
--      only the power that was dealt to you for that round, and only where the draft rules
--      (interactive and mechanic powers never attach; position-tied powers need a matching
--      position) would have attached it — the same rules force_autopick applies. The engine's
--      Time Stone fields and restored_at must be NULL on a manager's insert.
--   c. UPDATE: only rows for players on your active roster (the current owner, not the
--      original drafter, which is who the restore chip belongs to after a waiver pickup).
--   d. A BEFORE UPDATE trigger: when the caller is the app client (current_user is
--      authenticated or anon) the only column that may change is restored_at, and only from
--      NULL. current_user — not auth.role() — is the test on purpose: inside a SECURITY
--      DEFINER function current_user is postgres while the JWT role claim is still
--      'authenticated', so auth.role() would have blocked approve_trade and the draft RPCs.
--
-- Known slug mismatch, harmless today: the app maps "Hero's Shield" to 'hero_shield' while
-- the database regex (used by force_autopick and this policy) gives 'hero_s_shield'. It is a
-- draft-mechanic power that never attaches to a player, so neither form ever reaches this
-- table; if that ever changes, fix POWER_SLUG_MAP first.
--
-- Rollback:
--   DROP TRIGGER player_draft_powers_guard_manager_updates ON public.player_draft_powers;
--   DROP FUNCTION public.player_draft_powers_guard_manager_updates();
--   DROP POLICY "manager attaches own dealt power to own pick" ON public.player_draft_powers;
--   DROP POLICY "roster owner can update the power row"       ON public.player_draft_powers;
--   CREATE POLICY "league members can insert player powers" ON public.player_draft_powers FOR INSERT TO public
--     WITH CHECK (EXISTS (SELECT 1 FROM league_members WHERE league_members.league_id = player_draft_powers.league_id AND league_members.user_id = auth.uid()));
--   CREATE POLICY "league members can update player powers" ON public.player_draft_powers FOR UPDATE TO public
--     USING      (EXISTS (SELECT 1 FROM league_members WHERE league_members.league_id = player_draft_powers.league_id AND league_members.user_id = auth.uid()))
--     WITH CHECK (EXISTS (SELECT 1 FROM league_members WHERE league_members.league_id = player_draft_powers.league_id AND league_members.user_id = auth.uid()));
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.player_draft_powers TO anon;
--   GRANT TRUNCATE ON public.player_draft_powers TO authenticated;
--
-- Applied live 2026-09-26 via the Supabase MCP as player_draft_powers_ownership; proven in
-- rolled-back blocks (see OPEN-LOOPS #77): manager refused on an opponent's player, on a
-- fizzled power, on an undealt power, on any field but restored_at; restore allowed once;
-- postgres and service_role paths untouched; anon permission denied.

-- ── a. Grants ─────────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.player_draft_powers FROM anon;
REVOKE TRUNCATE ON public.player_draft_powers FROM authenticated;

-- ── b. + c. Policies ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "league members can insert player powers" ON public.player_draft_powers;
DROP POLICY IF EXISTS "league members can update player powers" ON public.player_draft_powers;

CREATE POLICY "manager attaches own dealt power to own pick" ON public.player_draft_powers
  FOR INSERT TO authenticated
  WITH CHECK (
    drafted_by_user_id = (SELECT auth.uid())
    AND restored_at IS NULL AND frozen_score IS NULL AND last_healthy_score IS NULL
    AND prev_healthy_score IS NULL AND freeze_broken_at IS NULL
    -- the player is this manager's own pick, in this round
    AND EXISTS (
      SELECT 1 FROM public.uff_draft_picks dp
      JOIN public.league_members lm ON lm.id = dp.member_id
      WHERE dp.league_id = player_draft_powers.league_id
        AND dp.player_id = player_draft_powers.player_id
        AND dp.round     = player_draft_powers.round
        AND lm.user_id   = (SELECT auth.uid())
    )
    -- and still on this manager's active roster
    AND EXISTS (
      SELECT 1 FROM public.uff_roster_players rp
      JOIN public.league_members lm ON lm.id = rp.member_id
      WHERE rp.league_id  = player_draft_powers.league_id
        AND rp.player_id  = player_draft_powers.player_id
        AND rp.dropped_at IS NULL
        AND lm.user_id    = (SELECT auth.uid())
    )
    -- and the power is the one dealt to this manager for this round, attachable under the
    -- draft rules (mirrors force_autopick and commissioner_draft_pick exactly)
    AND EXISTS (
      SELECT 1 FROM public.draft_power_assignments dpa
      JOIN public.draft_powers   dpw ON dpw.id = dpa.power_id
      JOIN public.league_members lm  ON lm.id  = dpa.member_id
      JOIN public.players        p   ON p.id   = player_draft_powers.player_id
      WHERE dpa.league_id = player_draft_powers.league_id
        AND dpa.round     = player_draft_powers.round
        AND lm.user_id    = (SELECT auth.uid())
        AND lower(regexp_replace(dpw.name, '[^a-zA-Z0-9]+', '_', 'g')) = player_draft_powers.power
        AND dpw.name NOT IN ('Vampire Bite', 'Foresight Coin', 'Draft Heist')
        AND dpw.category IS DISTINCT FROM 'draft_mechanic'
        AND (   dpw.tied_position IS NULL
             OR dpw.tied_position = 'ANY'
             OR (dpw.tied_position = 'WR/RB/TE' AND p.position IN ('WR', 'RB', 'TE'))
             OR (dpw.tied_position = 'D/ST'     AND p.position = 'DEF')
             OR  dpw.tied_position = p.position)
    )
  );

CREATE POLICY "roster owner can update the power row" ON public.player_draft_powers
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.uff_roster_players rp
      JOIN public.league_members lm ON lm.id = rp.member_id
      WHERE rp.league_id  = player_draft_powers.league_id
        AND rp.player_id  = player_draft_powers.player_id
        AND rp.dropped_at IS NULL
        AND lm.user_id    = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.uff_roster_players rp
      JOIN public.league_members lm ON lm.id = rp.member_id
      WHERE rp.league_id  = player_draft_powers.league_id
        AND rp.player_id  = player_draft_powers.player_id
        AND rp.dropped_at IS NULL
        AND lm.user_id    = (SELECT auth.uid())
    )
  );

-- ── d. A manager's UPDATE may only set restored_at, once ─────────────────────────────
CREATE OR REPLACE FUNCTION public.player_draft_powers_guard_manager_updates()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- The app client arrives as 'authenticated' (or 'anon'). SECURITY DEFINER functions run
  -- as postgres and the scoring engine as service_role; both pass through untouched.
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.league_id          IS DISTINCT FROM OLD.league_id
    OR NEW.player_id          IS DISTINCT FROM OLD.player_id
    OR NEW.power              IS DISTINCT FROM OLD.power
    OR NEW.round              IS DISTINCT FROM OLD.round
    OR NEW.drafted_by_user_id IS DISTINCT FROM OLD.drafted_by_user_id
    OR NEW.created_at         IS DISTINCT FROM OLD.created_at
    OR NEW.frozen_score       IS DISTINCT FROM OLD.frozen_score
    OR NEW.last_healthy_score IS DISTINCT FROM OLD.last_healthy_score
    OR NEW.prev_healthy_score IS DISTINCT FROM OLD.prev_healthy_score
    OR NEW.freeze_broken_at   IS DISTINCT FROM OLD.freeze_broken_at
    THEN
      RAISE EXCEPTION 'A manager can only restore a power; everything else on this row is set by the draft and the scoring engine';
    END IF;
    IF OLD.restored_at IS NOT NULL AND NEW.restored_at IS DISTINCT FROM OLD.restored_at THEN
      RAISE EXCEPTION 'A restored power stays restored';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS player_draft_powers_guard_manager_updates ON public.player_draft_powers;
CREATE TRIGGER player_draft_powers_guard_manager_updates
  BEFORE UPDATE ON public.player_draft_powers
  FOR EACH ROW EXECUTE FUNCTION public.player_draft_powers_guard_manager_updates();
