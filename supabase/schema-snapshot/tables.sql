-- UFF table snapshot: generated 2026-09-26 by scripts/snapshot-schema.mjs from the live DB
-- (project synfuvgdamhjboobjmls). NOT a migration — disaster-recovery source of truth. Regenerate after
-- every migration; never hand-edit.

CREATE TABLE public.alliance_war (
  league_id uuid NOT NULL,
  week smallint NOT NULL,
  hero_battle_wins integer DEFAULT 0 NOT NULL,
  villain_battle_wins integer DEFAULT 0 NOT NULL,
  front_position numeric DEFAULT 0 NOT NULL
);
ALTER TABLE public.alliance_war ADD CONSTRAINT alliance_war_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.alliance_war ADD CONSTRAINT alliance_war_pkey PRIMARY KEY (league_id, week);
ALTER TABLE public.alliance_war ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.campaign_events (
  id bigint NOT NULL,
  league_id uuid NOT NULL,
  event text NOT NULL,
  week smallint NOT NULL,
  squad_size smallint NOT NULL,
  status text DEFAULT 'scheduled'::text NOT NULL,
  result jsonb
);
ALTER TABLE public.campaign_events ADD CONSTRAINT campaign_events_event_check CHECK ((event = ANY (ARRAY['first_clash'::text, 'siege'::text, 'last_front'::text])));
ALTER TABLE public.campaign_events ADD CONSTRAINT campaign_events_league_id_event_key UNIQUE (league_id, event);
ALTER TABLE public.campaign_events ADD CONSTRAINT campaign_events_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.campaign_events ADD CONSTRAINT campaign_events_pkey PRIMARY KEY (id);
ALTER TABLE public.campaign_events ADD CONSTRAINT campaign_events_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'resolved'::text])));
ALTER TABLE public.campaign_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.character_feats (
  league_id uuid NOT NULL,
  character_id smallint NOT NULL,
  week smallint NOT NULL,
  feat text NOT NULL,
  attr text NOT NULL
);
ALTER TABLE public.character_feats ADD CONSTRAINT character_feats_character_id_fkey FOREIGN KEY (character_id) REFERENCES uff_characters(id);
ALTER TABLE public.character_feats ADD CONSTRAINT character_feats_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.character_feats ADD CONSTRAINT character_feats_pkey PRIMARY KEY (league_id, character_id, week, feat);
ALTER TABLE public.character_feats ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.character_legend (
  league_id uuid NOT NULL,
  character_id smallint NOT NULL,
  member_id uuid,
  is_free_legend boolean DEFAULT false NOT NULL,
  legend_points integer DEFAULT 0 NOT NULL,
  rank smallint DEFAULT 0 NOT NULL,
  decline_state text DEFAULT 'stable'::text NOT NULL,
  earned_epithets text[] DEFAULT '{}'::text[] NOT NULL,
  attr_strike smallint DEFAULT 0 NOT NULL,
  attr_guard smallint DEFAULT 0 NOT NULL,
  attr_burst smallint DEFAULT 0 NOT NULL,
  attr_nerve smallint DEFAULT 0 NOT NULL,
  attr_omen smallint DEFAULT 0 NOT NULL,
  week_surge integer DEFAULT 0 NOT NULL,
  ultimate_unlocked boolean DEFAULT false NOT NULL,
  ultimate_used_week smallint,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.character_legend ADD CONSTRAINT character_legend_character_id_fkey FOREIGN KEY (character_id) REFERENCES uff_characters(id);
ALTER TABLE public.character_legend ADD CONSTRAINT character_legend_decline_state_check CHECK ((decline_state = ANY (ARRAY['stable'::text, 'faltering'::text, 'waning'::text, 'fallen'::text])));
ALTER TABLE public.character_legend ADD CONSTRAINT character_legend_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.character_legend ADD CONSTRAINT character_legend_member_id_fkey FOREIGN KEY (member_id) REFERENCES league_members(id) ON DELETE SET NULL;
ALTER TABLE public.character_legend ADD CONSTRAINT character_legend_pkey PRIMARY KEY (league_id, character_id);
ALTER TABLE public.character_legend ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.draft_power_assignments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  member_id uuid NOT NULL,
  round smallint NOT NULL,
  power_id smallint NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.draft_power_assignments ADD CONSTRAINT draft_power_assignments_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.draft_power_assignments ADD CONSTRAINT draft_power_assignments_member_id_fkey FOREIGN KEY (member_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.draft_power_assignments ADD CONSTRAINT draft_power_assignments_member_id_power_id_key UNIQUE (member_id, power_id);
ALTER TABLE public.draft_power_assignments ADD CONSTRAINT draft_power_assignments_member_id_round_key UNIQUE (member_id, round);
ALTER TABLE public.draft_power_assignments ADD CONSTRAINT draft_power_assignments_pkey PRIMARY KEY (id);
ALTER TABLE public.draft_power_assignments ADD CONSTRAINT draft_power_assignments_power_id_fkey FOREIGN KEY (power_id) REFERENCES draft_powers(id);
ALTER TABLE public.draft_power_assignments ADD CONSTRAINT draft_power_assignments_round_check CHECK (((round >= 1) AND (round <= 16)));
CREATE INDEX idx_draft_power_assignments_league_id ON public.draft_power_assignments USING btree (league_id);
CREATE INDEX idx_draft_power_assignments_power_id ON public.draft_power_assignments USING btree (power_id);
ALTER TABLE public.draft_power_assignments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.draft_powers (
  id smallint NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  tied_position text,
  category text NOT NULL,
  excluded_rounds smallint[]
);
ALTER TABLE public.draft_powers ADD CONSTRAINT draft_powers_category_check CHECK ((category = ANY (ARRAY['tied_to_pick'::text, 'draft_mechanic'::text, 'self_cost'::text, 'season_effect'::text])));
ALTER TABLE public.draft_powers ADD CONSTRAINT draft_powers_pkey PRIMARY KEY (id);
ALTER TABLE public.draft_powers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.draft_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  member_id uuid NOT NULL,
  player_id text NOT NULL,
  position smallint DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.draft_queue ADD CONSTRAINT draft_queue_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.draft_queue ADD CONSTRAINT draft_queue_member_id_fkey FOREIGN KEY (member_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.draft_queue ADD CONSTRAINT draft_queue_member_id_player_id_key UNIQUE (member_id, player_id);
ALTER TABLE public.draft_queue ADD CONSTRAINT draft_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.draft_queue ADD CONSTRAINT draft_queue_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
CREATE INDEX draft_queue_member_pos_idx ON public.draft_queue USING btree (member_id, "position");
ALTER TABLE public.draft_queue ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.email_send_log (
  day date NOT NULL,
  sent integer DEFAULT 0 NOT NULL
);
ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_pkey PRIMARY KEY (day);
ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.league_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  user_id uuid NOT NULL,
  team_name text NOT NULL,
  is_commissioner boolean DEFAULT false NOT NULL,
  joined_at timestamp with time zone DEFAULT now() NOT NULL,
  faction faction,
  faab_balance smallint,
  eliminated_at timestamp with time zone,
  waiver_priority integer,
  season_title text,
  character_id smallint
);
ALTER TABLE public.league_members ADD CONSTRAINT league_members_character_id_fkey FOREIGN KEY (character_id) REFERENCES uff_characters(id);
ALTER TABLE public.league_members ADD CONSTRAINT league_members_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.league_members ADD CONSTRAINT league_members_league_id_user_id_key UNIQUE (league_id, user_id);
ALTER TABLE public.league_members ADD CONSTRAINT league_members_pkey PRIMARY KEY (id);
ALTER TABLE public.league_members ADD CONSTRAINT league_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
CREATE INDEX idx_league_members_user_id ON public.league_members USING btree (user_id);
CREATE UNIQUE INDEX uq_league_member_character ON public.league_members USING btree (league_id, character_id) WHERE (character_id IS NOT NULL);
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.league_newsletters (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  week integer NOT NULL,
  content text NOT NULL,
  generated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.league_newsletters ADD CONSTRAINT league_newsletters_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.league_newsletters ADD CONSTRAINT league_newsletters_league_id_week_key UNIQUE (league_id, week);
ALTER TABLE public.league_newsletters ADD CONSTRAINT league_newsletters_pkey PRIMARY KEY (id);
ALTER TABLE public.league_newsletters ADD CONSTRAINT league_newsletters_week_check CHECK (((week >= 1) AND (week <= 18)));
ALTER TABLE public.league_newsletters ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.legend_events (
  id bigint NOT NULL,
  league_id uuid NOT NULL,
  character_id smallint NOT NULL,
  week smallint NOT NULL,
  kind text NOT NULL,
  detail text,
  lp_delta integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.legend_events ADD CONSTRAINT legend_events_character_id_fkey FOREIGN KEY (character_id) REFERENCES uff_characters(id);
ALTER TABLE public.legend_events ADD CONSTRAINT legend_events_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.legend_events ADD CONSTRAINT legend_events_pkey PRIMARY KEY (id);
CREATE INDEX idx_legend_events_league_week ON public.legend_events USING btree (league_id, week);
ALTER TABLE public.legend_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.nfl_teams (
  abbr text NOT NULL,
  name text NOT NULL,
  conference text NOT NULL,
  faction faction NOT NULL
);
ALTER TABLE public.nfl_teams ADD CONSTRAINT nfl_teams_conference_check CHECK ((conference = ANY (ARRAY['AFC'::text, 'NFC'::text])));
ALTER TABLE public.nfl_teams ADD CONSTRAINT nfl_teams_faction_matches_conference CHECK ((((conference = 'AFC'::text) AND (faction = 'hero'::faction)) OR ((conference = 'NFC'::text) AND (faction = 'villain'::faction))));
ALTER TABLE public.nfl_teams ADD CONSTRAINT nfl_teams_pkey PRIMARY KEY (abbr);
ALTER TABLE public.nfl_teams ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.player_draft_powers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  player_id text NOT NULL,
  power text NOT NULL,
  round integer NOT NULL,
  drafted_by_user_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  restored_at timestamp with time zone,
  frozen_score numeric,
  last_healthy_score numeric,
  prev_healthy_score numeric,
  freeze_broken_at timestamp with time zone
);
ALTER TABLE public.player_draft_powers ADD CONSTRAINT player_draft_powers_drafted_by_user_id_fkey FOREIGN KEY (drafted_by_user_id) REFERENCES auth.users(id);
ALTER TABLE public.player_draft_powers ADD CONSTRAINT player_draft_powers_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.player_draft_powers ADD CONSTRAINT player_draft_powers_league_id_player_id_key UNIQUE (league_id, player_id);
ALTER TABLE public.player_draft_powers ADD CONSTRAINT player_draft_powers_pkey PRIMARY KEY (id);
CREATE INDEX idx_player_draft_powers_drafted_by_user_id ON public.player_draft_powers USING btree (drafted_by_user_id);
ALTER TABLE public.player_draft_powers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.player_projections (
  player_id text NOT NULL,
  season smallint NOT NULL,
  week smallint NOT NULL,
  stats jsonb DEFAULT '{}'::jsonb NOT NULL,
  pts_ppr numeric,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.player_projections ADD CONSTRAINT player_projections_pkey PRIMARY KEY (player_id, season, week);
ALTER TABLE public.player_projections ADD CONSTRAINT player_projections_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
CREATE INDEX idx_player_projections_season_week ON public.player_projections USING btree (season, week);
ALTER TABLE public.player_projections ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.players (
  id text NOT NULL,
  full_name text NOT NULL,
  position text,
  team text,
  status text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  adp numeric(6,2),
  injury_status text
);
ALTER TABLE public.players ADD CONSTRAINT players_pkey PRIMARY KEY (id);
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.power_restore_chips (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  member_id uuid NOT NULL,
  earned_week smallint,
  used boolean DEFAULT false NOT NULL,
  used_at timestamp with time zone,
  used_on_player_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.power_restore_chips ADD CONSTRAINT power_restore_chips_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.power_restore_chips ADD CONSTRAINT power_restore_chips_member_id_earned_week_key UNIQUE (member_id, earned_week);
ALTER TABLE public.power_restore_chips ADD CONSTRAINT power_restore_chips_member_id_fkey FOREIGN KEY (member_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.power_restore_chips ADD CONSTRAINT power_restore_chips_pkey PRIMARY KEY (id);
CREATE INDEX idx_power_restore_chips_league_id ON public.power_restore_chips USING btree (league_id);
CREATE INDEX power_restore_chips_league_idx ON public.power_restore_chips USING btree (league_id);
CREATE INDEX power_restore_chips_member_idx ON public.power_restore_chips USING btree (member_id);
ALTER TABLE public.power_restore_chips ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  username text NOT NULL,
  display_name text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rate_limits (
  key text NOT NULL,
  count integer DEFAULT 0 NOT NULL,
  reset_at timestamp with time zone NOT NULL
);
ALTER TABLE public.rate_limits ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (key);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.story_battles (
  id bigint NOT NULL,
  league_id uuid NOT NULL,
  week smallint NOT NULL,
  kind text NOT NULL,
  hero_side jsonb DEFAULT '[]'::jsonb NOT NULL,
  villain_side jsonb DEFAULT '[]'::jsonb NOT NULL,
  hero_force numeric DEFAULT 0 NOT NULL,
  villain_force numeric DEFAULT 0 NOT NULL,
  winner text,
  moves_war boolean DEFAULT false NOT NULL,
  narration text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  winner_character_id smallint
);
ALTER TABLE public.story_battles ADD CONSTRAINT story_battles_kind_check CHECK ((kind = ANY (ARRAY['war'::text, 'internal'::text, 'interloper'::text, 'first_clash'::text, 'siege'::text, 'last_front'::text])));
ALTER TABLE public.story_battles ADD CONSTRAINT story_battles_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.story_battles ADD CONSTRAINT story_battles_pkey PRIMARY KEY (id);
ALTER TABLE public.story_battles ADD CONSTRAINT story_battles_winner_character_id_fkey FOREIGN KEY (winner_character_id) REFERENCES uff_characters(id);
ALTER TABLE public.story_battles ADD CONSTRAINT story_battles_winner_check CHECK ((winner = ANY (ARRAY['hero'::text, 'villain'::text, 'draw'::text])));
CREATE INDEX idx_story_battles_league_week ON public.story_battles USING btree (league_id, week);
ALTER TABLE public.story_battles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.team_active_powers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  assignment_id uuid NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  tied_player_id text,
  target_player_id text,
  notes jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.team_active_powers ADD CONSTRAINT team_active_powers_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES draft_power_assignments(id) ON DELETE CASCADE;
ALTER TABLE public.team_active_powers ADD CONSTRAINT team_active_powers_assignment_id_key UNIQUE (assignment_id);
ALTER TABLE public.team_active_powers ADD CONSTRAINT team_active_powers_pkey PRIMARY KEY (id);
ALTER TABLE public.team_active_powers ADD CONSTRAINT team_active_powers_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'fizzled'::text, 'negated'::text, 'restored'::text])));
ALTER TABLE public.team_active_powers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_announcements (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  author_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  pinned boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.uff_announcements ADD CONSTRAINT uff_announcements_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.uff_announcements ADD CONSTRAINT uff_announcements_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.uff_announcements ADD CONSTRAINT uff_announcements_pkey PRIMARY KEY (id);
ALTER TABLE public.uff_announcements ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_cant_cut_list (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  player_id text NOT NULL,
  added_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.uff_cant_cut_list ADD CONSTRAINT uff_cant_cut_list_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.uff_cant_cut_list ADD CONSTRAINT uff_cant_cut_list_league_id_player_id_key UNIQUE (league_id, player_id);
ALTER TABLE public.uff_cant_cut_list ADD CONSTRAINT uff_cant_cut_list_pkey PRIMARY KEY (id);
CREATE INDEX idx_cant_cut_league ON public.uff_cant_cut_list USING btree (league_id);
ALTER TABLE public.uff_cant_cut_list ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_characters (
  id smallint NOT NULL,
  faction text NOT NULL,
  name text NOT NULL,
  epithet text NOT NULL,
  domain text NOT NULL,
  starter_story text NOT NULL,
  secret_story text,
  art_url text,
  signature_name text,
  signature_effect text,
  ultimate_name text,
  ultimate_effect text
);
ALTER TABLE public.uff_characters ADD CONSTRAINT uff_characters_faction_check CHECK ((faction = ANY (ARRAY['hero'::text, 'villain'::text])));
ALTER TABLE public.uff_characters ADD CONSTRAINT uff_characters_pkey PRIMARY KEY (id);
ALTER TABLE public.uff_characters ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_draft_picks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  round smallint NOT NULL,
  pick_no integer NOT NULL,
  member_id uuid NOT NULL,
  player_id text NOT NULL,
  picked_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.uff_draft_picks ADD CONSTRAINT uff_draft_picks_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.uff_draft_picks ADD CONSTRAINT uff_draft_picks_league_id_pick_no_key UNIQUE (league_id, pick_no);
ALTER TABLE public.uff_draft_picks ADD CONSTRAINT uff_draft_picks_league_id_player_id_key UNIQUE (league_id, player_id);
ALTER TABLE public.uff_draft_picks ADD CONSTRAINT uff_draft_picks_member_id_fkey FOREIGN KEY (member_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.uff_draft_picks ADD CONSTRAINT uff_draft_picks_pick_no_check CHECK ((pick_no >= 1));
ALTER TABLE public.uff_draft_picks ADD CONSTRAINT uff_draft_picks_pkey PRIMARY KEY (id);
ALTER TABLE public.uff_draft_picks ADD CONSTRAINT uff_draft_picks_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);
ALTER TABLE public.uff_draft_picks ADD CONSTRAINT uff_draft_picks_round_check CHECK (((round >= 1) AND (round <= 16)));
CREATE INDEX idx_uff_draft_picks_member_id ON public.uff_draft_picks USING btree (member_id);
CREATE INDEX idx_uff_draft_picks_player_id ON public.uff_draft_picks USING btree (player_id);
ALTER TABLE public.uff_draft_picks ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_game_schedule (
  id bigint NOT NULL,
  season integer NOT NULL,
  week integer NOT NULL,
  team text NOT NULL,
  kickoff_utc timestamp with time zone NOT NULL
);
ALTER TABLE public.uff_game_schedule ADD CONSTRAINT uff_game_schedule_pkey PRIMARY KEY (id);
ALTER TABLE public.uff_game_schedule ADD CONSTRAINT uff_game_schedule_season_week_team_key UNIQUE (season, week, team);
CREATE INDEX uff_game_schedule_season_week ON public.uff_game_schedule USING btree (season, week);
ALTER TABLE public.uff_game_schedule ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_leagues (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  commissioner_id uuid NOT NULL,
  join_code text NOT NULL,
  season text DEFAULT '2026'::text NOT NULL,
  max_teams integer DEFAULT 12 NOT NULL,
  scoring_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'forming'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  draft_rounds smallint DEFAULT 16 NOT NULL,
  draft_order jsonb,
  draft_status text DEFAULT 'not_started'::text NOT NULL,
  ir_spots integer DEFAULT 2 NOT NULL,
  lineup_slots jsonb DEFAULT '{"K": 1, "QB": 1, "RB": 2, "TE": 1, "WR": 2, "DEF": 1, "FLEX": 1}'::jsonb NOT NULL,
  heist_state jsonb,
  season_weeks smallint DEFAULT 14 NOT NULL,
  playoff_teams smallint DEFAULT 6 NOT NULL,
  playoff_start_week smallint DEFAULT 15 NOT NULL,
  championship_week smallint DEFAULT 17 NOT NULL,
  median_scoring boolean DEFAULT false NOT NULL,
  trade_deadline_week smallint,
  faab_budget smallint DEFAULT 0,
  commissioner_review boolean DEFAULT false,
  max_adds_per_week smallint DEFAULT 0,
  max_adds_per_season smallint DEFAULT 0,
  waiver_auto boolean DEFAULT false,
  waiver_day smallint DEFAULT 3,
  waiver_hour smallint DEFAULT 3,
  waiver_type text DEFAULT 'faab'::text NOT NULL,
  pick_clock_seconds integer,
  draft_started_at timestamp with time zone,
  story_engine_enabled boolean DEFAULT false NOT NULL
);
ALTER TABLE public.uff_leagues ADD CONSTRAINT uff_leagues_commissioner_id_fkey FOREIGN KEY (commissioner_id) REFERENCES profiles(id);
ALTER TABLE public.uff_leagues ADD CONSTRAINT uff_leagues_draft_rounds_locked CHECK ((draft_rounds = 16));
ALTER TABLE public.uff_leagues ADD CONSTRAINT uff_leagues_draft_status_check CHECK ((draft_status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'completed'::text])));
ALTER TABLE public.uff_leagues ADD CONSTRAINT uff_leagues_join_code_key UNIQUE (join_code);
ALTER TABLE public.uff_leagues ADD CONSTRAINT uff_leagues_max_teams_even CHECK (((max_teams % 2) = 0));
ALTER TABLE public.uff_leagues ADD CONSTRAINT uff_leagues_max_teams_range CHECK (((max_teams >= 2) AND (max_teams <= 16)));
ALTER TABLE public.uff_leagues ADD CONSTRAINT uff_leagues_pkey PRIMARY KEY (id);
ALTER TABLE public.uff_leagues ADD CONSTRAINT uff_leagues_waiver_type_check CHECK ((waiver_type = ANY (ARRAY['faab'::text, 'priority'::text])));
CREATE INDEX idx_uff_leagues_commissioner_id ON public.uff_leagues USING btree (commissioner_id);
CREATE UNIQUE INDEX uq_forming_league_name_per_commissioner ON public.uff_leagues USING btree (commissioner_id, lower(name)) WHERE (status = 'forming'::text);
ALTER TABLE public.uff_leagues ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_lineups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  member_id uuid NOT NULL,
  player_id text NOT NULL,
  week smallint NOT NULL,
  slot text NOT NULL,
  lineup_source text DEFAULT 'manual'::text NOT NULL
);
ALTER TABLE public.uff_lineups ADD CONSTRAINT uff_lineups_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.uff_lineups ADD CONSTRAINT uff_lineups_lineup_source_check CHECK ((lineup_source = ANY (ARRAY['manual'::text, 'carried'::text, 'auto'::text])));
ALTER TABLE public.uff_lineups ADD CONSTRAINT uff_lineups_member_id_fkey FOREIGN KEY (member_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.uff_lineups ADD CONSTRAINT uff_lineups_member_id_week_player_id_key UNIQUE (member_id, week, player_id);
ALTER TABLE public.uff_lineups ADD CONSTRAINT uff_lineups_member_id_week_slot_key UNIQUE (member_id, week, slot);
ALTER TABLE public.uff_lineups ADD CONSTRAINT uff_lineups_pkey PRIMARY KEY (id);
CREATE INDEX idx_lineups_member_week ON public.uff_lineups USING btree (member_id, week);
CREATE INDEX idx_uff_lineups_league_member_week ON public.uff_lineups USING btree (league_id, member_id, week);
ALTER TABLE public.uff_lineups ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_matchups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  matchup_id integer NOT NULL,
  league_id uuid NOT NULL,
  week smallint NOT NULL,
  season text DEFAULT '2026'::text NOT NULL,
  member_id uuid NOT NULL,
  points numeric(8,2) DEFAULT 0 NOT NULL,
  projected numeric(8,2),
  is_complete boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  void_result boolean DEFAULT false NOT NULL,
  token_bonus numeric DEFAULT 0,
  oracle_recap text,
  is_playoff boolean DEFAULT false NOT NULL,
  playoff_round smallint,
  median_win boolean DEFAULT false,
  score_adjustment numeric DEFAULT 0 NOT NULL
);
ALTER TABLE public.uff_matchups ADD CONSTRAINT uff_matchups_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.uff_matchups ADD CONSTRAINT uff_matchups_league_id_week_member_id_key UNIQUE (league_id, week, member_id);
ALTER TABLE public.uff_matchups ADD CONSTRAINT uff_matchups_member_id_fkey FOREIGN KEY (member_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.uff_matchups ADD CONSTRAINT uff_matchups_pkey PRIMARY KEY (id);
CREATE INDEX idx_uff_matchups_league_season_week ON public.uff_matchups USING btree (league_id, season, week);
CREATE INDEX uff_matchups_league_week_idx ON public.uff_matchups USING btree (league_id, week);
CREATE INDEX uff_matchups_member_idx ON public.uff_matchups USING btree (member_id);
ALTER TABLE public.uff_matchups ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  read boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.uff_notifications ADD CONSTRAINT uff_notifications_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.uff_notifications ADD CONSTRAINT uff_notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.uff_notifications ADD CONSTRAINT uff_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX uff_notifications_user_league_created ON public.uff_notifications USING btree (user_id, league_id, created_at DESC);
CREATE INDEX uff_notifications_user_league_unread ON public.uff_notifications USING btree (user_id, league_id, read) WHERE (read = false);
ALTER TABLE public.uff_notifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_playoff_bracket (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  season text NOT NULL,
  round smallint NOT NULL,
  week smallint NOT NULL,
  slot smallint NOT NULL,
  seed_a smallint,
  seed_b smallint,
  member_id_a uuid,
  member_id_b uuid,
  points_a numeric(8,2) DEFAULT 0 NOT NULL,
  points_b numeric(8,2) DEFAULT 0 NOT NULL,
  winner_id uuid,
  is_complete boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.uff_playoff_bracket ADD CONSTRAINT uff_playoff_bracket_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.uff_playoff_bracket ADD CONSTRAINT uff_playoff_bracket_league_id_season_round_slot_key UNIQUE (league_id, season, round, slot);
ALTER TABLE public.uff_playoff_bracket ADD CONSTRAINT uff_playoff_bracket_member_id_a_fkey FOREIGN KEY (member_id_a) REFERENCES league_members(id);
ALTER TABLE public.uff_playoff_bracket ADD CONSTRAINT uff_playoff_bracket_member_id_b_fkey FOREIGN KEY (member_id_b) REFERENCES league_members(id);
ALTER TABLE public.uff_playoff_bracket ADD CONSTRAINT uff_playoff_bracket_pkey PRIMARY KEY (id);
ALTER TABLE public.uff_playoff_bracket ADD CONSTRAINT uff_playoff_bracket_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES league_members(id);
ALTER TABLE public.uff_playoff_bracket ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_push_subscriptions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.uff_push_subscriptions ADD CONSTRAINT uff_push_subscriptions_endpoint_key UNIQUE (endpoint);
ALTER TABLE public.uff_push_subscriptions ADD CONSTRAINT uff_push_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.uff_push_subscriptions ADD CONSTRAINT uff_push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_uff_push_subscriptions_user ON public.uff_push_subscriptions USING btree (user_id);
CREATE INDEX uff_push_subscriptions_user_id_idx ON public.uff_push_subscriptions USING btree (user_id);
ALTER TABLE public.uff_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_roster_players (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  member_id uuid NOT NULL,
  player_id text NOT NULL,
  added_at timestamp with time zone DEFAULT now() NOT NULL,
  dropped_at timestamp with time zone,
  slot text DEFAULT 'active'::text NOT NULL,
  on_trade_block boolean DEFAULT false NOT NULL,
  week_added smallint
);
ALTER TABLE public.uff_roster_players ADD CONSTRAINT uff_roster_players_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.uff_roster_players ADD CONSTRAINT uff_roster_players_member_id_fkey FOREIGN KEY (member_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.uff_roster_players ADD CONSTRAINT uff_roster_players_pkey PRIMARY KEY (id);
ALTER TABLE public.uff_roster_players ADD CONSTRAINT uff_roster_players_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id);
ALTER TABLE public.uff_roster_players ADD CONSTRAINT uff_roster_players_slot_check CHECK ((slot = ANY (ARRAY['active'::text, 'ir'::text])));
CREATE INDEX idx_roster_players_slot ON public.uff_roster_players USING btree (member_id, slot) WHERE (dropped_at IS NULL);
CREATE INDEX idx_uff_roster_players_player_id ON public.uff_roster_players USING btree (player_id);
CREATE UNIQUE INDEX uff_roster_players_active_unique ON public.uff_roster_players USING btree (league_id, player_id) WHERE (dropped_at IS NULL);
CREATE INDEX uff_roster_players_member_idx ON public.uff_roster_players USING btree (member_id) WHERE (dropped_at IS NULL);
ALTER TABLE public.uff_roster_players ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_trades (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  proposer_id uuid NOT NULL,
  receiver_id uuid NOT NULL,
  proposer_player_ids text[] DEFAULT '{}'::text[] NOT NULL,
  receiver_player_ids text[] DEFAULT '{}'::text[] NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  veto_reason text
);
ALTER TABLE public.uff_trades ADD CONSTRAINT uff_trades_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.uff_trades ADD CONSTRAINT uff_trades_pkey PRIMARY KEY (id);
ALTER TABLE public.uff_trades ADD CONSTRAINT uff_trades_proposer_id_fkey FOREIGN KEY (proposer_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.uff_trades ADD CONSTRAINT uff_trades_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.uff_trades ADD CONSTRAINT uff_trades_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'pending_review'::text, 'accepted'::text, 'rejected'::text, 'vetoed'::text, 'cancelled'::text])));
ALTER TABLE public.uff_trades ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_waiver_bids (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  member_id uuid NOT NULL,
  player_id text NOT NULL,
  drop_player_id text,
  bid_amount smallint DEFAULT 0 NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  week smallint NOT NULL,
  season text NOT NULL,
  processed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.uff_waiver_bids ADD CONSTRAINT uff_waiver_bids_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.uff_waiver_bids ADD CONSTRAINT uff_waiver_bids_member_id_fkey FOREIGN KEY (member_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.uff_waiver_bids ADD CONSTRAINT uff_waiver_bids_pkey PRIMARY KEY (id);
ALTER TABLE public.uff_waiver_bids ADD CONSTRAINT uff_waiver_bids_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'won'::text, 'lost'::text, 'cancelled'::text])));
ALTER TABLE public.uff_waiver_bids ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.uff_watchlist (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  member_id uuid NOT NULL,
  player_id text NOT NULL,
  added_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.uff_watchlist ADD CONSTRAINT uff_watchlist_member_id_fkey FOREIGN KEY (member_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.uff_watchlist ADD CONSTRAINT uff_watchlist_member_id_player_id_key UNIQUE (member_id, player_id);
ALTER TABLE public.uff_watchlist ADD CONSTRAINT uff_watchlist_pkey PRIMARY KEY (id);
ALTER TABLE public.uff_watchlist ADD CONSTRAINT uff_watchlist_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.uff_watchlist ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vampire_bites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  biting_member_id uuid NOT NULL,
  target_player_id text NOT NULL,
  round integer NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);
ALTER TABLE public.vampire_bites ADD CONSTRAINT vampire_bites_biting_member_id_fkey FOREIGN KEY (biting_member_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.vampire_bites ADD CONSTRAINT vampire_bites_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.vampire_bites ADD CONSTRAINT vampire_bites_league_id_target_player_id_key UNIQUE (league_id, target_player_id);
ALTER TABLE public.vampire_bites ADD CONSTRAINT vampire_bites_pkey PRIMARY KEY (id);
ALTER TABLE public.vampire_bites ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.weekly_token_assignments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  league_id uuid NOT NULL,
  member_id uuid NOT NULL,
  week smallint NOT NULL,
  token_id smallint NOT NULL,
  revealed boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  choice text,
  status text DEFAULT 'pending'::text NOT NULL,
  used_at timestamp with time zone
);
ALTER TABLE public.weekly_token_assignments ADD CONSTRAINT weekly_token_assignments_league_id_fkey FOREIGN KEY (league_id) REFERENCES uff_leagues(id) ON DELETE CASCADE;
ALTER TABLE public.weekly_token_assignments ADD CONSTRAINT weekly_token_assignments_member_id_fkey FOREIGN KEY (member_id) REFERENCES league_members(id) ON DELETE CASCADE;
ALTER TABLE public.weekly_token_assignments ADD CONSTRAINT weekly_token_assignments_member_id_week_key UNIQUE (member_id, week);
ALTER TABLE public.weekly_token_assignments ADD CONSTRAINT weekly_token_assignments_pkey PRIMARY KEY (id);
ALTER TABLE public.weekly_token_assignments ADD CONSTRAINT weekly_token_assignments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'used'::text, 'expired'::text])));
ALTER TABLE public.weekly_token_assignments ADD CONSTRAINT weekly_token_assignments_token_id_fkey FOREIGN KEY (token_id) REFERENCES weekly_tokens(id);
ALTER TABLE public.weekly_token_assignments ADD CONSTRAINT weekly_token_assignments_week_check CHECK (((week >= 1) AND (week <= 18)));
CREATE INDEX idx_weekly_token_assignments_league_id ON public.weekly_token_assignments USING btree (league_id);
CREATE INDEX idx_weekly_token_assignments_token_id ON public.weekly_token_assignments USING btree (token_id);
CREATE INDEX idx_wta_league_week ON public.weekly_token_assignments USING btree (league_id, week);
CREATE INDEX idx_wta_member ON public.weekly_token_assignments USING btree (league_id, member_id);
CREATE UNIQUE INDEX weekly_token_assignments_league_member_week_key ON public.weekly_token_assignments USING btree (league_id, member_id, week);
ALTER TABLE public.weekly_token_assignments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.weekly_tokens (
  id smallint NOT NULL,
  name text NOT NULL,
  description text NOT NULL
);
ALTER TABLE public.weekly_tokens ADD CONSTRAINT weekly_tokens_pkey PRIMARY KEY (id);
ALTER TABLE public.weekly_tokens ENABLE ROW LEVEL SECURITY;

