-- 2026-09-24 — six SECURITY DEFINER RPCs trusted a caller-supplied p_user_id.
--
-- set_lineup, drop_player, add_player, add_and_drop_player, move_to_ir and
-- move_from_ir each took p_user_id and looked up membership with
-- "WHERE league_id = p_league_id AND user_id = p_user_id" — the VICTIM's row. None of
-- the six referenced auth.uid() anywhere, and SECURITY DEFINER bypasses RLS, so any
-- signed-in manager could pass another manager's id and act as that team. Proven live
-- 2026-09-22 inside rolled-back blocks: one manager wiped another's week-2 lineup from
-- 9 rows to 1 (OPEN-LOOPS #55).
--
-- Worse for set_lineup: the hijacked write lands as lineup_source = 'manual', so
-- persist_effective_lineup then refuses to repair it and the damage stands until the
-- victim saves again.
--
-- The guard matches the style already used by make_draft_pick:
--   IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN RAISE
-- auth.uid() IS NULL is allowed ON PURPOSE — that is the service_role path used by the
-- scoring engine and the crons, and a stricter guard would break lineup persistence.
-- Verified safe first: no database function calls any of these six internally, and
-- every application caller passes the authenticated user's own id (player-actions.ts,
-- lineup-actions.ts).
--
-- The patch is derived from pg_get_functiondef rather than retyping ~13 KB of bodies,
-- so each function is byte-identical apart from the inserted guard. It skips any
-- function that already mentions auth.uid(), so re-running is a no-op.
--
-- PROVEN AFTER APPLYING, live, all inside rolled-back blocks — signed in as one
-- manager and aimed at another's team:
--   set_lineup          REFUSED   drop_player   REFUSED   move_to_ir   REFUSED
--   add_player          REFUSED   add_and_drop  REFUSED   move_from_ir REFUSED
--   own set_lineup      OK (9 rows)        service_role path  ALLOWED as designed
-- And anon EXECUTE, checked with has_function_privilege: false on all seven.

DO $mig$
DECLARE
  f      record;
  src    text;
  guard  text := E'  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN\n'
               || E'    RAISE EXCEPTION ''You can only act for your own team'';\n'
               || E'  END IF;\n';
  pos    int;
  n      int := 0;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('set_lineup','drop_player','add_player',
                         'add_and_drop_player','move_to_ir','move_from_ir')
  LOOP
    src := pg_get_functiondef(f.oid);

    IF src ILIKE '%auth.uid()%' THEN
      RAISE NOTICE 'skip % — already references auth.uid()', f.proname;
      CONTINUE;
    END IF;

    pos := strpos(src, E'\nBEGIN\n');
    IF pos = 0 THEN
      RAISE EXCEPTION 'could not find the body BEGIN of %', f.proname;
    END IF;

    EXECUTE left(src, pos + 6) || guard || substr(src, pos + 7);
    n := n + 1;
    RAISE NOTICE 'guarded %', f.proname;
  END LOOP;

  RAISE NOTICE 'functions guarded: %', n;
END $mig$;

-- Three were EXECUTE-able by PUBLIC (=X/postgres) and anon, so a logged-out caller
-- holding only the public anon key could reach them. approve_trade already checks
-- auth.uid() and so needs the revoke but not the guard.
REVOKE EXECUTE ON FUNCTION public.add_player(uuid, uuid, text, smallint)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_and_drop_player(uuid, uuid, text, text, smallint) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_trade(uuid)                                   FROM PUBLIC, anon;
