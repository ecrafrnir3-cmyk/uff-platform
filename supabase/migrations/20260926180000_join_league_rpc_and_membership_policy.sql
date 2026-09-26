-- 2026-09-26 — OPEN-LOOPS #77 / code-audit A1-01 + A2-01: joining a league was enforced only
-- in the app. The one database rule on league_members INSERT was "user_id = me", so any
-- signed-in account could POST a membership row straight to PostgREST for ANY league — no join
-- code, no capacity, no draft-state check — and set is_commissioner, faction, faab_balance,
-- waiver_priority, season_title or character_id on the way in (the column-level UPDATE grant
-- never applied to INSERT). anon also held INSERT, DELETE and TRUNCATE on the table. And the
-- app's own joinLeague counted then inserted with no lock, so two joins to the last seat both
-- succeeded, and it never checked draft_status, so a join code shared after the draft added a
-- rosterless team to an active league.
--
-- What changes:
--   a. join_league(p_join_code, p_team_name, p_faction) — SECURITY DEFINER, authenticated only.
--      One transaction under SELECT … FOR UPDATE on the league row: code must match, the
--      league must be 'forming' with draft_status 'not_started', the caller must not already
--      be a member, the seat count must be under max_teams, and a chosen side must have room
--      (the faction-balance trigger still fires as a second net). Inserts as auth.uid(), never
--      as commissioner, with every engine-owned column left NULL. Returns
--      {league_id, member_id} so the app can sync the character and redirect.
--   b. The INSERT policy becomes "a commissioner seats themselves in their own league" — the
--      createLeague path (uff_leagues insert, then the commissioner's own membership) keeps
--      working unchanged; nobody else can insert a membership directly any more.
--   c. anon loses INSERT/DELETE/TRUNCATE; authenticated loses DELETE/TRUNCATE (no DELETE
--      policy existed and no app path deletes a membership, so this changes nothing legit).
--
-- App: src/app/dashboard/actions.ts joinLeague now calls join_league instead of select +
-- count + insert. createLeague is unchanged. No other app path, edge function, cron job or
-- DB function inserts into league_members (checked in src/, supabase/functions and pg_proc).
--
-- Noted, not fixed here: uff_leagues is SELECT-able by every signed-in user including
-- join_code, so among signed-in accounts the code is not a secret. Column-level SELECT would
-- break the dashboard's own-league listing and the settings page; it needs a view or RPC.
--
-- Rollback:
--   DROP POLICY "commissioner seats themselves in their own league" ON public.league_members;
--   CREATE POLICY "users can join a league as themselves" ON public.league_members FOR INSERT TO public
--     WITH CHECK ((SELECT auth.uid()) = user_id);
--   DROP FUNCTION public.join_league(text, text, text);
--   GRANT INSERT, DELETE, TRUNCATE ON public.league_members TO anon;
--   GRANT DELETE, TRUNCATE ON public.league_members TO authenticated;
--   and revert joinLeague in src/app/dashboard/actions.ts to the direct insert (git has it).
--
-- Applied live 2026-09-26 via the Supabase MCP as join_league_rpc_and_membership_policy
-- (20260926135847) and proven in rolled-back blocks with two throwaway leagues and three real
-- users: commissioner self-seat OK; commissioner seating another user REFUSED; joiner direct
-- insert REFUSED; join by code OK (lower-case, padded); join twice, full league, wrong code,
-- drafting league, The First War, blank team name all REFUSED with the app's own messages;
-- anon permission denied on the function and the table.

-- ── a. The one way in ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_league(p_join_code text, p_team_name text, p_faction text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_code         text := upper(btrim(coalesce(p_join_code, '')));
  v_team_name    text := btrim(coalesce(p_team_name, ''));
  v_league_id    uuid;
  v_max_teams    int;
  v_status       text;
  v_draft_status text;
  v_count        int;
  v_side_count   int;
  v_member_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_code = '' OR v_team_name = '' THEN
    RAISE EXCEPTION 'Join code and team name are required.';
  END IF;
  IF length(v_team_name) > 40 THEN
    RAISE EXCEPTION 'Team name is too long (40 characters max).';
  END IF;
  IF p_faction IS NOT NULL AND p_faction NOT IN ('hero', 'villain') THEN
    RAISE EXCEPTION 'Faction must be hero, villain, or left blank.';
  END IF;

  -- Lock the league row: concurrent joins to the last seat queue behind each other.
  SELECT id, max_teams, status, draft_status
    INTO v_league_id, v_max_teams, v_status, v_draft_status
    FROM uff_leagues
   WHERE join_code = v_code
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No league found with that join code.';
  END IF;

  IF v_draft_status <> 'not_started' OR v_status <> 'forming' THEN
    RAISE EXCEPTION 'That league has already started its draft — new managers can''t join.';
  END IF;

  IF EXISTS (SELECT 1 FROM league_members WHERE league_id = v_league_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'You''re already in that league.';
  END IF;

  SELECT count(*) INTO v_count FROM league_members WHERE league_id = v_league_id;
  IF v_count >= v_max_teams THEN
    RAISE EXCEPTION 'That league is already full.';
  END IF;

  IF p_faction IS NOT NULL THEN
    SELECT count(*) INTO v_side_count
      FROM league_members
     WHERE league_id = v_league_id AND faction = p_faction::faction;
    IF v_side_count >= v_max_teams / 2 THEN
      RAISE EXCEPTION 'The % side is already full for that league. Pick the other side or "Decide later".',
        CASE WHEN p_faction = 'hero' THEN 'Hero' ELSE 'Villain' END;
    END IF;
  END IF;

  INSERT INTO league_members (league_id, user_id, team_name, is_commissioner, faction)
  VALUES (v_league_id, v_uid, v_team_name, false, p_faction::faction)
  RETURNING id INTO v_member_id;

  RETURN jsonb_build_object('league_id', v_league_id, 'member_id', v_member_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.join_league(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.join_league(text, text, text) TO authenticated;

-- ── b. Direct inserts: only a commissioner seating themselves ────────────────────────
DROP POLICY IF EXISTS "users can join a league as themselves" ON public.league_members;

CREATE POLICY "commissioner seats themselves in their own league" ON public.league_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.uff_leagues ul
       WHERE ul.id = league_members.league_id
         AND ul.commissioner_id = (SELECT auth.uid())
    )
    AND faab_balance    IS NULL
    AND eliminated_at   IS NULL
    AND waiver_priority IS NULL
    AND season_title    IS NULL
    AND character_id    IS NULL
  );

-- ── c. Grants ─────────────────────────────────────────────────────────────────────────
REVOKE INSERT, DELETE, TRUNCATE ON public.league_members FROM anon;
REVOKE DELETE, TRUNCATE ON public.league_members FROM authenticated;
