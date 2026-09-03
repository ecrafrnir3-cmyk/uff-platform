-- APPLIED LIVE 2026-09-02 via Supabase MCP (disable_draft_heist_20260902).
-- KILL-SWITCH (reversible): Draft Heist's slot swap + restore is split across
-- client effects with per-client state, and the restore fires from whichever
-- client's round advances first. A straggler client holding stale round-N heist
-- state restored the draft order DURING round N+1, clobbering a round-N+1 heist
-- mid-round -- which skipped one manager's pick and doubled another's during the
-- inaugural "The First War" draft (2026-09-02, since killed + reset).
--
-- Disabled by the commissioner for the rest of that draft. To RE-ENABLE after the
-- swap/restore is reworked server-side (see the heist-fix design in memory
-- uff-audit-fix-2026-07-21): remove the RAISE guard in each function below (the
-- original body is preserved beneath it) and flip the client HEIST_ENABLED flag.

CREATE OR REPLACE FUNCTION public.update_draft_heist_order(p_league_id uuid, p_new_order jsonb, p_heist_state jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_member_id uuid; v_status text; v_order jsonb; v_heist jsonb; v_max_teams int; v_pick_count int; v_current_round int;
BEGIN
  RAISE EXCEPTION 'Draft Heist is disabled by the commissioner for the rest of this draft.';

  -- ---- original body preserved below (unreachable while the guard is present) ----
  SELECT id INTO v_member_id FROM league_members WHERE league_id = p_league_id AND user_id = auth.uid();
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'Not a member of this league'; END IF;
  SELECT draft_status, draft_order, heist_state, max_teams INTO v_status, v_order, v_heist, v_max_teams
    FROM uff_leagues WHERE id = p_league_id FOR UPDATE;
  IF v_status != 'in_progress' THEN RAISE EXCEPTION 'Draft is not in progress'; END IF;
  IF v_heist IS NOT NULL THEN RAISE EXCEPTION 'A heist is already active this round'; END IF;
  SELECT COUNT(*) INTO v_pick_count FROM uff_draft_picks WHERE league_id = p_league_id;
  v_current_round := ceil((v_pick_count + 1)::float / v_max_teams)::int;
  IF NOT EXISTS (SELECT 1 FROM draft_power_assignments WHERE league_id = p_league_id AND member_id = v_member_id AND round = v_current_round AND power_id = 3) THEN
    RAISE EXCEPTION 'You do not hold Draft Heist this round';
  END IF;
  IF (SELECT COUNT(*) FROM jsonb_array_elements_text(v_order)) != (SELECT COUNT(*) FROM jsonb_array_elements_text(p_new_order))
     OR EXISTS (SELECT value FROM jsonb_array_elements_text(v_order) EXCEPT SELECT value FROM jsonb_array_elements_text(p_new_order)) THEN
    RAISE EXCEPTION 'Invalid draft order';
  END IF;
  UPDATE uff_leagues SET draft_order = p_new_order, heist_state = p_heist_state WHERE id = p_league_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.commissioner_heist(p_league_id uuid, p_acting_member_id uuid, p_target_member_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Draft Heist is disabled by the commissioner for the rest of this draft.';
END;
$function$;
