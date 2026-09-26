-- 2026-09-26 — OPEN-LOOPS #77, part a (privileges only). Two more commissioner RPCs were
-- EXECUTE-able by anon: the public key, no account. reset_waiver_priority rewrites every
-- member's waiver_priority from the standings; commissioner_draft_pick makes the on-the-clock
-- pick once a draft is in progress. Both guards are null-permissive
-- (IF auth.uid() IS NOT NULL AND ...), so anon skipped them entirely.
-- Same shape as 20260926120000 part a; the fail-closed bodies follow in a second migration.
-- Every app caller uses the cookie-based user client (authenticated); service_role keeps its
-- explicit grant; no edge function, cron job, trigger or DB function calls either one.
--
-- Applied live 2026-09-26 via the Supabase MCP as
--   revoke_anon_reset_waiver_priority_and_commissioner_draft_pick.

REVOKE EXECUTE ON FUNCTION public.reset_waiver_priority(uuid, integer)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.commissioner_draft_pick(uuid, uuid, text)  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.reset_waiver_priority(uuid, integer),
  public.commissioner_draft_pick(uuid, uuid, text)
TO authenticated;

-- Rollback: GRANT EXECUTE ON FUNCTION <each> TO anon; (PUBLIC also held EXECUTE before.)
