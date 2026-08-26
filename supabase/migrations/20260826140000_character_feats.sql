-- APPLIED LIVE 2026-08-26 via Supabase MCP. Story Engine — Phase 2b (feats).
-- Per-week stat feats a character's roster earns (computed once when a week is
-- finalized, from the Sleeper stat line — the LP replay reads these so it never
-- has to re-fetch external stats). Idempotent per (league, character, week, feat).
create table if not exists public.character_feats (
  league_id    uuid     not null references public.uff_leagues(id) on delete cascade,
  character_id smallint not null references public.uff_characters(id),
  week         smallint not null,
  feat         text     not null,   -- explosion | stonewall | breakaway | twist_of_fate
  attr         text     not null,   -- STRIKE | GUARD | BURST | OMEN
  primary key (league_id, character_id, week, feat)
);
alter table public.character_feats enable row level security;
drop policy if exists "story layer public read" on public.character_feats;
create policy "story layer public read" on public.character_feats for select to anon, authenticated using (true);
