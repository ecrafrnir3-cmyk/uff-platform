-- UFF RLS policy snapshot: every policy in schema public (project synfuvgdamhjboobjmls)
-- Generated 2026-08-17. NOT a migration — disaster-recovery source of truth (audit item 13).
-- Hand-aligned 2026-09-26 with 20260926170000 (#77 / A1-02): the two player_draft_powers write
-- policies; every other policy is as generated.
-- Hand-aligned again 2026-09-26 with 20260926180000 (#77 / A1-01): league_members INSERT policy.
-- Hand-aligned again 2026-09-26 with 20260926210000 + 20260926220000: six member write policies dropped
-- (draft_power_assignments x2, uff_trades, uff_draft_picks, vampire_bites, power_restore_chips).
-- 67 policies (65 @ 2026-08-17 + 2 push-subscription policies @ 2026-08-24).

CREATE POLICY "authenticated read draft_power_assignments" ON public.draft_power_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "commissioner manage league draft_power_assignments" ON public.draft_power_assignments FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = draft_power_assignments.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = draft_power_assignments.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "public read draft_powers" ON public.draft_powers FOR SELECT TO public USING (true);
CREATE POLICY "Members manage own draft queue" ON public.draft_queue FOR ALL TO public USING ((member_id IN ( SELECT league_members.id
   FROM league_members
  WHERE (league_members.user_id = auth.uid())))) WITH CHECK ((member_id IN ( SELECT league_members.id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))));
CREATE POLICY "commissioner manage league_members" ON public.league_members FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = league_members.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = league_members.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "members are viewable by authenticated users" ON public.league_members FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));
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
CREATE POLICY "users can update their own membership" ON public.league_members FOR UPDATE TO public USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
-- NOTE (2026-08-25 harden): league_members table UPDATE revoked from anon/authenticated; only GRANT UPDATE (faction) TO authenticated. faab_balance/waiver_priority set via SECURITY DEFINER RPCs init_faab_balances/set_waiver_order; character_id via service role.
CREATE POLICY "league members can read newsletters" ON public.league_newsletters FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.league_id = league_newsletters.league_id) AND (lm.user_id = auth.uid())))));
CREATE POLICY "public read leagues" ON public.leagues FOR SELECT TO public USING (true);
CREATE POLICY "public read matchups" ON public.matchups FOR SELECT TO public USING (true);
CREATE POLICY "public read nfl_teams" ON public.nfl_teams FOR SELECT TO public USING (true);
CREATE POLICY "public read oracle_recaps" ON public.oracle_recaps FOR SELECT TO public USING (true);
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
CREATE POLICY "league members can view player powers" ON public.player_draft_powers FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM league_members
  WHERE ((league_members.league_id = player_draft_powers.league_id) AND (league_members.user_id = auth.uid())))));
CREATE POLICY "service role can delete player powers" ON public.player_draft_powers FOR DELETE TO public USING ((auth.role() = 'service_role'::text));
CREATE POLICY "players are publicly readable" ON public.players FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "authenticated read power_restore_chips" ON public.power_restore_chips FOR SELECT TO authenticated USING (true);
CREATE POLICY "league members can view chips" ON public.power_restore_chips FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.league_id = power_restore_chips.league_id) AND (lm.user_id = auth.uid())))));
-- "service role can insert chips" (FOR INSERT TO public WITH CHECK (true)) DROPPED 2026-09-15,
-- migration 20260915130000_lock_down_anon_admin_functions: it let anyone forge chips. Finalize inserts as the function owner.
CREATE POLICY "profiles are viewable by authenticated users" ON public.profiles FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "users can insert their own profile" ON public.profiles FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = id));
CREATE POLICY "users can update their own profile" ON public.profiles FOR UPDATE TO public USING ((( SELECT auth.uid() AS uid) = id));
CREATE POLICY "public read rosters" ON public.rosters FOR SELECT TO public USING (true);
CREATE POLICY "public read sleeper_users" ON public.sleeper_users FOR SELECT TO public USING (true);
CREATE POLICY "active powers are readable by authenticated users" ON public.team_active_powers FOR SELECT TO authenticated USING (true);
CREATE POLICY "commissioner manage league active powers" ON public.team_active_powers FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM (draft_power_assignments dpa
     JOIN uff_leagues ul ON ((ul.id = dpa.league_id)))
  WHERE ((dpa.id = team_active_powers.assignment_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (draft_power_assignments dpa
     JOIN uff_leagues ul ON ((ul.id = dpa.league_id)))
  WHERE ((dpa.id = team_active_powers.assignment_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "members manage own active powers" ON public.team_active_powers FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM (draft_power_assignments dpa
     JOIN league_members lm ON ((lm.id = dpa.member_id)))
  WHERE ((dpa.id = team_active_powers.assignment_id) AND (lm.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (draft_power_assignments dpa
     JOIN league_members lm ON ((lm.id = dpa.member_id)))
  WHERE ((dpa.id = team_active_powers.assignment_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))));
-- "commissioner can manage announcements" (FOR ALL TO public USING (true) WITH CHECK (true)) REPLACED 2026-09-15,
-- migration 20260915140000_scope_announcements_to_commissioner: anyone could post/edit/delete announcements.
-- Also: anon lost INSERT/UPDATE/DELETE/TRUNCATE on uff_announcements; authenticated lost TRUNCATE.
CREATE POLICY "commissioner can delete announcements" ON public.uff_announcements FOR DELETE TO authenticated USING (EXISTS ( SELECT 1 FROM uff_leagues ul WHERE ((ul.id = uff_announcements.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "commissioner can edit announcements" ON public.uff_announcements FOR UPDATE TO authenticated USING (EXISTS ( SELECT 1 FROM uff_leagues ul WHERE ((ul.id = uff_announcements.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))) WITH CHECK (EXISTS ( SELECT 1 FROM uff_leagues ul WHERE ((ul.id = uff_announcements.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "commissioner can post announcements" ON public.uff_announcements FOR INSERT TO authenticated WITH CHECK (((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM uff_leagues ul WHERE ((ul.id = uff_announcements.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid)))))));
CREATE POLICY "league members can read announcements" ON public.uff_announcements FOR SELECT TO public USING ((league_id IN ( SELECT league_members.league_id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))));
CREATE POLICY cant_cut_managed_by_commissioner ON public.uff_cant_cut_list FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = uff_cant_cut_list.league_id) AND (ul.commissioner_id = auth.uid())))));
CREATE POLICY cant_cut_readable_by_members ON public.uff_cant_cut_list FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.league_id = uff_cant_cut_list.league_id) AND (lm.user_id = auth.uid())))));
CREATE POLICY "commissioner manage league draft picks" ON public.uff_draft_picks FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = uff_draft_picks.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = uff_draft_picks.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "draft picks are readable by authenticated users" ON public.uff_draft_picks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Public read game schedule" ON public.uff_game_schedule FOR SELECT TO public USING (true);
CREATE POLICY "commissioner can update their league" ON public.uff_leagues FOR UPDATE TO public USING ((( SELECT auth.uid() AS uid) = commissioner_id));
CREATE POLICY "leagues are viewable by authenticated users" ON public.uff_leagues FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "users can create leagues" ON public.uff_leagues FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = commissioner_id));
CREATE POLICY "members read league lineups" ON public.uff_lineups FOR SELECT TO public USING ((league_id IN ( SELECT league_members.league_id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))));
CREATE POLICY "commissioner manage matchups" ON public.uff_matchups FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = uff_matchups.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "matchups readable by authenticated" ON public.uff_matchups FOR SELECT TO authenticated USING (true);
CREATE POLICY "users read own notifications" ON public.uff_notifications FOR SELECT TO public USING ((user_id = auth.uid()));
CREATE POLICY "users update own notifications" ON public.uff_notifications FOR UPDATE TO public USING ((user_id = auth.uid()));
CREATE POLICY "Commissioner can manage playoff bracket" ON public.uff_playoff_bracket FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM uff_leagues l
  WHERE ((l.id = uff_playoff_bracket.league_id) AND (l.commissioner_id = auth.uid())))));
CREATE POLICY "Members can read playoff bracket" ON public.uff_playoff_bracket FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.league_id = uff_playoff_bracket.league_id) AND (lm.user_id = auth.uid())))));
CREATE POLICY "commissioner manage league rosters" ON public.uff_roster_players FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = uff_roster_players.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = uff_roster_players.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "members read league rosters" ON public.uff_roster_players FOR SELECT TO public USING ((league_id IN ( SELECT league_members.league_id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))));
CREATE POLICY "members read own roster" ON public.uff_roster_players FOR SELECT TO public USING ((member_id IN ( SELECT league_members.id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))));
CREATE POLICY "rosters are readable by authenticated users" ON public.uff_roster_players FOR SELECT TO authenticated USING (true);
CREATE POLICY "league members can view trades" ON public.uff_trades FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.league_id = uff_trades.league_id) AND (lm.user_id = auth.uid())))));
CREATE POLICY "bids visibility" ON public.uff_waiver_bids FOR SELECT TO public USING (((member_id IN ( SELECT league_members.id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))) OR ((status <> 'pending'::text) AND (league_id IN ( SELECT league_members.league_id
   FROM league_members
  WHERE (league_members.user_id = auth.uid())))) OR (league_id IN ( SELECT uff_leagues.id
   FROM uff_leagues
  WHERE (uff_leagues.commissioner_id = auth.uid())))));
CREATE POLICY "members can manage own watchlist" ON public.uff_watchlist FOR ALL TO public USING ((member_id IN ( SELECT league_members.id
   FROM league_members
  WHERE (league_members.user_id = auth.uid())))) WITH CHECK ((member_id IN ( SELECT league_members.id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))));
CREATE POLICY "league members can view vampire bites" ON public.vampire_bites FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM league_members
  WHERE ((league_members.league_id = vampire_bites.league_id) AND (league_members.user_id = auth.uid())))));
CREATE POLICY "authenticated read weekly_token_assignments" ON public.weekly_token_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "members can read league tokens" ON public.weekly_token_assignments FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.league_id = weekly_token_assignments.league_id) AND (lm.user_id = auth.uid())))));
-- "members insert own weekly_token_assignments" (FOR INSERT) DROPPED 2026-09-15, migration 20260915130000_lock_down_anon_admin_functions:
-- a member could pre-insert their own next-week token so the real finalize award was silently skipped. Finalize inserts as the function owner.
CREATE POLICY "members update own weekly_token_assignments" ON public.weekly_token_assignments FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.id = weekly_token_assignments.member_id) AND (lm.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.id = weekly_token_assignments.member_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))));
CREATE POLICY "public read weekly_tokens" ON public.weekly_tokens FOR SELECT TO public USING (true);
-- uff_push_subscriptions (added 2026-08-24, Session 36 push layer)
CREATE POLICY "users read own push subscriptions" ON public.uff_push_subscriptions FOR SELECT TO public USING ((user_id = auth.uid()));
CREATE POLICY "users delete own push subscriptions" ON public.uff_push_subscriptions FOR DELETE TO public USING ((user_id = auth.uid()));
