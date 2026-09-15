-- 2026-09-15 — First lockdown of admin RPCs reachable with the public anon key
-- (One Mind OPEN-LOOPS #37). Approved by Nate: "yes lock them down".
--
-- These SECURITY DEFINER functions were EXECUTE-able by anon, mostly through a
-- PUBLIC grant (=X/postgres), so revoking only `anon` changed nothing. Proven in
-- rolled-back tests as SET LOCAL ROLE anon: finalize_all_active_leagues finalized
-- the unplayed Week 2 (and, with the 09-15 unique index, Week 1), irreversibly;
-- mark_week_tokens_used / process_priority_waivers let anon past their
-- `auth.uid() IS NOT NULL AND ...` guards because anon's auth.uid() is NULL.
--
-- Who still needs them:
--   * finalize_all_active_leagues      — /api/cron/finalize-week (service_role key)
--   * process_waiver_bids / _priority_ — /api/cron/process-waivers (service_role key)
--                                        and settings/actions.ts:204-205 (authenticated)
--   * mark_week_tokens_used            — matchups/actions.ts:30 (authenticated)
--   * advance_playoff_bracket          — called inside finalize_week / finalize_all_active_leagues;
--                                        a SECURITY DEFINER body runs with its owner's rights
--   * mark_week_tokens_used_all        — no caller found in src/, supabase/functions or scripts
--
-- The two INSERT policies let anyone (chips) or any member (their own token row)
-- insert rows that change finalize results: 14 forged chips hit the max_teams cap
-- so the real chip is never awarded; a pre-inserted next-week token silently wins
-- over the real award (ON CONFLICT DO NOTHING). No app code inserts into either
-- table — only finalize does, as the function owner, which RLS does not restrict.
--
-- Rollback (if ever needed):
--   GRANT EXECUTE ON FUNCTION <each function> TO PUBLIC;
--   CREATE POLICY "service role can insert chips" ON public.power_restore_chips FOR INSERT TO public WITH CHECK (true);
--   CREATE POLICY "members insert own weekly_token_assignments" ON public.weekly_token_assignments FOR INSERT TO public
--     WITH CHECK (EXISTS (SELECT 1 FROM league_members lm WHERE lm.id = weekly_token_assignments.member_id AND lm.user_id = (SELECT auth.uid())));

-- Cron-only / uncalled: nobody but service_role
REVOKE EXECUTE ON FUNCTION public.finalize_all_active_leagues(integer)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_week_tokens_used_all(integer)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.advance_playoff_bracket(uuid, smallint)  FROM PUBLIC, anon, authenticated;

-- Called from signed-in server actions: keep authenticated, remove anon/PUBLIC
REVOKE EXECUTE ON FUNCTION public.mark_week_tokens_used(uuid, integer)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.process_priority_waivers(uuid, integer)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.process_waiver_bids(uuid, uuid, smallint) FROM PUBLIC, anon;

-- Make the intended grants explicit so the result does not depend on what PUBLIC held
GRANT EXECUTE ON FUNCTION
  public.finalize_all_active_leagues(integer),
  public.mark_week_tokens_used_all(integer),
  public.advance_playoff_bracket(uuid, smallint),
  public.mark_week_tokens_used(uuid, integer),
  public.process_priority_waivers(uuid, integer),
  public.process_waiver_bids(uuid, uuid, smallint)
TO service_role;

GRANT EXECUTE ON FUNCTION
  public.mark_week_tokens_used(uuid, integer),
  public.process_priority_waivers(uuid, integer),
  public.process_waiver_bids(uuid, uuid, smallint)
TO authenticated;

-- Forged chips / pre-inserted tokens
DROP POLICY IF EXISTS "service role can insert chips" ON public.power_restore_chips;
DROP POLICY IF EXISTS "members insert own weekly_token_assignments" ON public.weekly_token_assignments;
