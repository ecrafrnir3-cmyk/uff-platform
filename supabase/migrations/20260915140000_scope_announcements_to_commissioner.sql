-- 2026-09-15 — League announcements were writable by anyone (One Mind OPEN-LOOPS #37).
-- Approved by Nate: "yes close the announcements one too".
--
-- The only write policy, named "commissioner can manage announcements", was actually
-- FOR ALL TO public USING (true) WITH CHECK (true), and both anon and authenticated held
-- INSERT/UPDATE/DELETE on the table — so anyone with the public anon key could post,
-- edit or delete any league's announcements. (0 rows existed when this was applied.)
--
-- The app only writes announcements from announcements/actions.ts with the signed-in
-- user's client, after its own commissioner check: insert (author_id = user.id),
-- update pinned, delete. Reads use "league members can read announcements", unchanged.
-- No SECURITY DEFINER function or service-role code touches this table.
--
-- Rollback (if ever needed):
--   DROP POLICY "commissioner can post announcements" / "commissioner can edit announcements" /
--     "commissioner can delete announcements" ON public.uff_announcements;
--   CREATE POLICY "commissioner can manage announcements" ON public.uff_announcements FOR ALL TO public USING (true) WITH CHECK (true);
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.uff_announcements TO anon;
--   GRANT TRUNCATE ON public.uff_announcements TO authenticated;

DROP POLICY IF EXISTS "commissioner can manage announcements" ON public.uff_announcements;

-- Post: only the league's commissioner, and only as themselves
CREATE POLICY "commissioner can post announcements" ON public.uff_announcements
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.uff_leagues ul
       WHERE ul.id = uff_announcements.league_id
         AND ul.commissioner_id = (SELECT auth.uid())
    )
  );

-- Edit (pin/unpin): only the commissioner of the row's league, and it cannot be moved to another league
CREATE POLICY "commissioner can edit announcements" ON public.uff_announcements
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.uff_leagues ul
       WHERE ul.id = uff_announcements.league_id
         AND ul.commissioner_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.uff_leagues ul
       WHERE ul.id = uff_announcements.league_id
         AND ul.commissioner_id = (SELECT auth.uid())
    )
  );

-- Delete: only the commissioner of the row's league
CREATE POLICY "commissioner can delete announcements" ON public.uff_announcements
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.uff_leagues ul
       WHERE ul.id = uff_announcements.league_id
         AND ul.commissioner_id = (SELECT auth.uid())
    )
  );

-- Defense in depth: the anon key never writes announcements; TRUNCATE ignores RLS entirely
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.uff_announcements FROM anon;
REVOKE TRUNCATE ON public.uff_announcements FROM authenticated;
