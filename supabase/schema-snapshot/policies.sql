-- UFF RLS policy snapshot: generated 2026-09-26 by scripts/snapshot-schema.mjs from the live DB
-- (project synfuvgdamhjboobjmls). NOT a migration — disaster-recovery source of truth. Regenerate after
-- every migration; never hand-edit.

CREATE POLICY "story layer public read" ON public.alliance_war FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "story layer public read" ON public.campaign_events FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "story layer public read" ON public.character_feats FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "story layer public read" ON public.character_legend FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "authenticated read draft_power_assignments" ON public.draft_power_assignments FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "public read draft_powers" ON public.draft_powers FOR SELECT TO public
  USING (true);

CREATE POLICY "Members manage own draft queue" ON public.draft_queue FOR ALL TO public
  USING ((member_id IN ( SELECT league_members.id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))))
  WITH CHECK ((member_id IN ( SELECT league_members.id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))));

CREATE POLICY "commissioner manage league_members" ON public.league_members FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = league_members.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = league_members.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "commissioner seats themselves in their own league" ON public.league_members FOR INSERT TO authenticated
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = league_members.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))) AND (faab_balance IS NULL) AND (eliminated_at IS NULL) AND (waiver_priority IS NULL) AND (season_title IS NULL) AND (character_id IS NULL)));

CREATE POLICY "members are viewable by authenticated users" ON public.league_members FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "users can update their own membership" ON public.league_members FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = user_id))
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "league members can read newsletters" ON public.league_newsletters FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.league_id = league_newsletters.league_id) AND (lm.user_id = auth.uid())))));

CREATE POLICY "story layer public read" ON public.legend_events FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "public read nfl_teams" ON public.nfl_teams FOR SELECT TO public
  USING (true);

CREATE POLICY "league members can view player powers" ON public.player_draft_powers FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM league_members
  WHERE ((league_members.league_id = player_draft_powers.league_id) AND (league_members.user_id = auth.uid())))));

CREATE POLICY "manager attaches own dealt power to own pick" ON public.player_draft_powers FOR INSERT TO authenticated
  WITH CHECK (((drafted_by_user_id = ( SELECT auth.uid() AS uid)) AND (restored_at IS NULL) AND (frozen_score IS NULL) AND (last_healthy_score IS NULL) AND (prev_healthy_score IS NULL) AND (freeze_broken_at IS NULL) AND (EXISTS ( SELECT 1
   FROM (uff_draft_picks dp
     JOIN league_members lm ON ((lm.id = dp.member_id)))
  WHERE ((dp.league_id = player_draft_powers.league_id) AND (dp.player_id = player_draft_powers.player_id) AND (dp.round = player_draft_powers.round) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) AND (EXISTS ( SELECT 1
   FROM (uff_roster_players rp
     JOIN league_members lm ON ((lm.id = rp.member_id)))
  WHERE ((rp.league_id = player_draft_powers.league_id) AND (rp.player_id = player_draft_powers.player_id) AND (rp.dropped_at IS NULL) AND (lm.user_id = ( SELECT auth.uid() AS uid))))) AND (EXISTS ( SELECT 1
   FROM (((draft_power_assignments dpa
     JOIN draft_powers dpw ON ((dpw.id = dpa.power_id)))
     JOIN league_members lm ON ((lm.id = dpa.member_id)))
     JOIN players p ON ((p.id = player_draft_powers.player_id)))
  WHERE ((dpa.league_id = player_draft_powers.league_id) AND (dpa.round = player_draft_powers.round) AND (lm.user_id = ( SELECT auth.uid() AS uid)) AND (lower(regexp_replace(dpw.name, '[^a-zA-Z0-9]+'::text, '_'::text, 'g'::text)) = player_draft_powers.power) AND (dpw.name <> ALL (ARRAY['Vampire Bite'::text, 'Foresight Coin'::text, 'Draft Heist'::text])) AND (dpw.category IS DISTINCT FROM 'draft_mechanic'::text) AND ((dpw.tied_position IS NULL) OR (dpw.tied_position = 'ANY'::text) OR ((dpw.tied_position = 'WR/RB/TE'::text) AND (p."position" = ANY (ARRAY['WR'::text, 'RB'::text, 'TE'::text]))) OR ((dpw.tied_position = 'D/ST'::text) AND (p."position" = 'DEF'::text)) OR (dpw.tied_position = p."position")))))));

CREATE POLICY "roster owner can update the power row" ON public.player_draft_powers FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM (uff_roster_players rp
     JOIN league_members lm ON ((lm.id = rp.member_id)))
  WHERE ((rp.league_id = player_draft_powers.league_id) AND (rp.player_id = player_draft_powers.player_id) AND (rp.dropped_at IS NULL) AND (lm.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (uff_roster_players rp
     JOIN league_members lm ON ((lm.id = rp.member_id)))
  WHERE ((rp.league_id = player_draft_powers.league_id) AND (rp.player_id = player_draft_powers.player_id) AND (rp.dropped_at IS NULL) AND (lm.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "service role can delete player powers" ON public.player_draft_powers FOR DELETE TO public
  USING ((auth.role() = 'service_role'::text));

CREATE POLICY "authenticated read player_projections" ON public.player_projections FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "players are publicly readable" ON public.players FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "authenticated read power_restore_chips" ON public.power_restore_chips FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "league members can view chips" ON public.power_restore_chips FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.league_id = power_restore_chips.league_id) AND (lm.user_id = auth.uid())))));

CREATE POLICY "profiles are viewable by authenticated users" ON public.profiles FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "users can insert their own profile" ON public.profiles FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "users can update their own profile" ON public.profiles FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "story layer public read" ON public.story_battles FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "active powers are readable by authenticated users" ON public.team_active_powers FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "members manage own active powers" ON public.team_active_powers FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM (draft_power_assignments dpa
     JOIN league_members lm ON ((lm.id = dpa.member_id)))
  WHERE ((dpa.id = team_active_powers.assignment_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (draft_power_assignments dpa
     JOIN league_members lm ON ((lm.id = dpa.member_id)))
  WHERE ((dpa.id = team_active_powers.assignment_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "commissioner can delete announcements" ON public.uff_announcements FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = uff_announcements.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "commissioner can edit announcements" ON public.uff_announcements FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = uff_announcements.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = uff_announcements.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "commissioner can post announcements" ON public.uff_announcements FOR INSERT TO authenticated
  WITH CHECK (((author_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = uff_announcements.league_id) AND (ul.commissioner_id = ( SELECT auth.uid() AS uid)))))));

CREATE POLICY "league members can read announcements" ON public.uff_announcements FOR SELECT TO public
  USING ((league_id IN ( SELECT league_members.league_id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))));

CREATE POLICY "cant_cut_managed_by_commissioner" ON public.uff_cant_cut_list FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM uff_leagues ul
  WHERE ((ul.id = uff_cant_cut_list.league_id) AND (ul.commissioner_id = auth.uid())))));

CREATE POLICY "cant_cut_readable_by_members" ON public.uff_cant_cut_list FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.league_id = uff_cant_cut_list.league_id) AND (lm.user_id = auth.uid())))));

CREATE POLICY "characters are publicly readable" ON public.uff_characters FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "draft picks are readable by authenticated users" ON public.uff_draft_picks FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Public read game schedule" ON public.uff_game_schedule FOR SELECT TO public
  USING (true);

CREATE POLICY "commissioner can update their league" ON public.uff_leagues FOR UPDATE TO public
  USING ((( SELECT auth.uid() AS uid) = commissioner_id));

CREATE POLICY "leagues are viewable by authenticated users" ON public.uff_leagues FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "users can create leagues" ON public.uff_leagues FOR INSERT TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = commissioner_id));

CREATE POLICY "members read league lineups" ON public.uff_lineups FOR SELECT TO public
  USING ((league_id IN ( SELECT league_members.league_id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))));

CREATE POLICY "matchups readable by authenticated" ON public.uff_matchups FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "users read own notifications" ON public.uff_notifications FOR SELECT TO public
  USING ((user_id = auth.uid()));

CREATE POLICY "users update own notifications" ON public.uff_notifications FOR UPDATE TO public
  USING ((user_id = auth.uid()));

CREATE POLICY "Members can read playoff bracket" ON public.uff_playoff_bracket FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.league_id = uff_playoff_bracket.league_id) AND (lm.user_id = auth.uid())))));

CREATE POLICY "Users manage own push subscriptions" ON public.uff_push_subscriptions FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "users delete own push subscriptions" ON public.uff_push_subscriptions FOR DELETE TO public
  USING ((user_id = auth.uid()));

CREATE POLICY "users read own push subscriptions" ON public.uff_push_subscriptions FOR SELECT TO public
  USING ((user_id = auth.uid()));

CREATE POLICY "members read league rosters" ON public.uff_roster_players FOR SELECT TO public
  USING ((league_id IN ( SELECT league_members.league_id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))));

CREATE POLICY "members read own roster" ON public.uff_roster_players FOR SELECT TO public
  USING ((member_id IN ( SELECT league_members.id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))));

CREATE POLICY "rosters are readable by authenticated users" ON public.uff_roster_players FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "league members can view trades" ON public.uff_trades FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.league_id = uff_trades.league_id) AND (lm.user_id = auth.uid())))));

CREATE POLICY "bids visibility" ON public.uff_waiver_bids FOR SELECT TO public
  USING (((member_id IN ( SELECT league_members.id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))) OR ((status <> 'pending'::text) AND (league_id IN ( SELECT league_members.league_id
   FROM league_members
  WHERE (league_members.user_id = auth.uid())))) OR (league_id IN ( SELECT uff_leagues.id
   FROM uff_leagues
  WHERE (uff_leagues.commissioner_id = auth.uid())))));

CREATE POLICY "members can manage own watchlist" ON public.uff_watchlist FOR ALL TO public
  USING ((member_id IN ( SELECT league_members.id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))))
  WITH CHECK ((member_id IN ( SELECT league_members.id
   FROM league_members
  WHERE (league_members.user_id = auth.uid()))));

CREATE POLICY "league members can view vampire bites" ON public.vampire_bites FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM league_members
  WHERE ((league_members.league_id = vampire_bites.league_id) AND (league_members.user_id = auth.uid())))));

CREATE POLICY "authenticated read weekly_token_assignments" ON public.weekly_token_assignments FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "members can read league tokens" ON public.weekly_token_assignments FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.league_id = weekly_token_assignments.league_id) AND (lm.user_id = auth.uid())))));

CREATE POLICY "members update own weekly_token_assignments" ON public.weekly_token_assignments FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.id = weekly_token_assignments.member_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM league_members lm
  WHERE ((lm.id = weekly_token_assignments.member_id) AND (lm.user_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "public read weekly_tokens" ON public.weekly_tokens FOR SELECT TO public
  USING (true);
