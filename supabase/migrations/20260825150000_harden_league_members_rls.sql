-- APPLIED LIVE 2026-08-25 via Supabase MCP (execute_sql; unique dollar-quote
-- tags because the tool mangles $$/$function$). Hardens league_members writes.
--
-- BUG (pre-existing, surfaced during the character-layer review): the
-- "users can update their own membership" UPDATE policy had NO WITH CHECK and
-- the table granted UPDATE on ALL columns to authenticated. A member could
-- therefore self-set any column on their own row via the REST API — including
-- faab_balance and waiver_priority (real waiver-cheat vectors), is_commissioner,
-- wins/losses/points, etc.
--
-- FIX: (1) add WITH CHECK to the user policy; (2) revoke blanket table UPDATE and
-- grant only the one column a regular user legitimately self-edits (faction);
-- (3) move the two commissioner-only writes (faab_balance init, waiver order)
-- into commissioner-checked SECURITY DEFINER RPCs so they bypass the column grant
-- but verify auth.uid() = commissioner. character_id is written by the service
-- role (admin client) and is unaffected.
-- Verified: a regular member is denied on faab_balance/waiver_priority/
-- character_id/is_commissioner, allowed on faction; RPCs reject non-commissioners
-- and succeed for the commissioner.

CREATE OR REPLACE FUNCTION public.init_faab_balances(p_league_id uuid, p_amount smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $faab$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uff_leagues WHERE id = p_league_id AND commissioner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the commissioner can set FAAB balances';
  END IF;
  UPDATE league_members SET faab_balance = p_amount
   WHERE league_id = p_league_id AND faab_balance IS NULL;
END;
$faab$;

CREATE OR REPLACE FUNCTION public.set_waiver_order(p_league_id uuid, p_member_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $wvr$
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
$wvr$;

DROP POLICY IF EXISTS "users can update their own membership" ON public.league_members;
CREATE POLICY "users can update their own membership" ON public.league_members
  FOR UPDATE TO public
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE UPDATE ON public.league_members FROM anon, authenticated;
GRANT UPDATE (faction) ON public.league_members TO authenticated;
