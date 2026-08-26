-- APPLIED LIVE 2026-08-26 via Supabase MCP (apply_migration). Story Engine — Phase 1 (foundation).
-- The parallel "Legend & the War" story layer. Spec: docs/legend-and-the-war.md.
-- READ-ONLY on fantasy data; writes only to these new isolated tables. Gated per league
-- by uff_leagues.story_engine_enabled (default FALSE = dark everywhere) so it can never
-- affect a live game until deliberately switched on.
-- Character powers are canon on uff_characters (seeded by scripts/seed-powers.mjs from lore/powers.md).

-- 1. Signature power + ultimate live on the canon character (1:1 with the 20 legends).
alter table public.uff_characters
  add column if not exists signature_name   text,
  add column if not exists signature_effect text,
  add column if not exists ultimate_name    text,
  add column if not exists ultimate_effect  text;

-- The table-level SELECT grant was revoked in the character_lore_layer migration and
-- replaced with a column list. Column grants are additive, so grant the new columns too.
grant select (signature_name, signature_effect, ultimate_name, ultimate_effect)
  on public.uff_characters to anon, authenticated;

-- 2. Per-league feature flag — OFF by default (the whole engine no-ops unless a league opts in).
alter table public.uff_leagues
  add column if not exists story_engine_enabled boolean not null default false;

-- 3. Per-(league, character) Legend state. Keyed by character_id, NOT member — so an
--    unassigned character (a Free Legend) still gets a row. member_id null = Free Legend.
create table if not exists public.character_legend (
  league_id          uuid     not null references public.uff_leagues(id) on delete cascade,
  character_id       smallint not null references public.uff_characters(id),
  member_id          uuid     references public.league_members(id) on delete set null,
  is_free_legend     boolean  not null default false,
  legend_points      integer  not null default 0,
  rank               smallint not null default 0,        -- 0..5 on the Legend Ladder
  decline_state      text     not null default 'stable'
                     check (decline_state in ('stable','faltering','waning','fallen')),
  earned_epithets    text[]   not null default '{}',
  attr_strike        smallint not null default 0,
  attr_guard         smallint not null default 0,
  attr_burst         smallint not null default 0,
  attr_nerve         smallint not null default 0,
  attr_omen          smallint not null default 0,
  week_surge         integer  not null default 0,
  ultimate_unlocked  boolean  not null default false,
  ultimate_used_week smallint,
  updated_at         timestamptz not null default now(),
  primary key (league_id, character_id)
);

-- 4. Append-only event log (feats, LP deltas, rank changes, epithets, ultimates).
create table if not exists public.legend_events (
  id           bigint generated always as identity primary key,
  league_id    uuid     not null references public.uff_leagues(id) on delete cascade,
  character_id smallint not null references public.uff_characters(id),
  week         smallint not null,
  kind         text     not null,        -- feat | lp | rank_up | rank_down | epithet | ultimate | note
  detail       text,
  lp_delta     integer  not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_legend_events_league_week on public.legend_events (league_id, week);

-- 5. Story battles. Squads as jsonb so one table holds 1v1s (war/internal/interloper)
--    AND the force-vs-force group battles (first_clash / siege / last_front).
create table if not exists public.story_battles (
  id            bigint generated always as identity primary key,
  league_id     uuid     not null references public.uff_leagues(id) on delete cascade,
  week          smallint not null,
  kind          text     not null
                check (kind in ('war','internal','interloper','first_clash','siege','last_front')),
  hero_side     jsonb    not null default '[]'::jsonb,   -- [{character_id, rating}]
  villain_side  jsonb    not null default '[]'::jsonb,
  hero_force    numeric  not null default 0,
  villain_force numeric  not null default 0,
  winner        text     check (winner in ('hero','villain','draw')),
  moves_war     boolean  not null default false,
  narration     text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_story_battles_league_week on public.story_battles (league_id, week);

-- 6. Campaign set-piece schedule (First Clash / Siege / Last Front) per league.
create table if not exists public.campaign_events (
  id         bigint generated always as identity primary key,
  league_id  uuid     not null references public.uff_leagues(id) on delete cascade,
  event      text     not null check (event in ('first_clash','siege','last_front')),
  week       smallint not null,
  squad_size smallint not null,
  status     text     not null default 'scheduled' check (status in ('scheduled','resolved')),
  result     jsonb,
  unique (league_id, event)
);

-- 7. Alliance war standing per league per week.
create table if not exists public.alliance_war (
  league_id           uuid     not null references public.uff_leagues(id) on delete cascade,
  week                smallint not null,
  hero_battle_wins    integer  not null default 0,
  villain_battle_wins integer  not null default 0,
  front_position      numeric  not null default 0,   -- cumulative; + = hero ground, - = villain
  primary key (league_id, week)
);

-- RLS: the story layer is the shared comic/universe — PUBLIC READ (mirrors uff_characters);
-- WRITE is service-role only (no write policies → only the weekly job, via service role, writes).
alter table public.character_legend enable row level security;
drop policy if exists "story layer public read" on public.character_legend;
create policy "story layer public read" on public.character_legend for select to anon, authenticated using (true);

alter table public.legend_events enable row level security;
drop policy if exists "story layer public read" on public.legend_events;
create policy "story layer public read" on public.legend_events for select to anon, authenticated using (true);

alter table public.story_battles enable row level security;
drop policy if exists "story layer public read" on public.story_battles;
create policy "story layer public read" on public.story_battles for select to anon, authenticated using (true);

alter table public.campaign_events enable row level security;
drop policy if exists "story layer public read" on public.campaign_events;
create policy "story layer public read" on public.campaign_events for select to anon, authenticated using (true);

alter table public.alliance_war enable row level security;
drop policy if exists "story layer public read" on public.alliance_war;
create policy "story layer public read" on public.alliance_war for select to anon, authenticated using (true);
