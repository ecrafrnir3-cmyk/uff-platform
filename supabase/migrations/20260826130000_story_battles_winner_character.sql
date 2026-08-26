-- APPLIED LIVE 2026-08-26 via Supabase MCP. Story Engine — Phase 3.
-- story_battles.winner already records the winning FACTION (hero/villain/draw);
-- add the winning CHARACTER so internal duels (same-faction) and group-battle
-- MVPs can be identified. Nullable (draws / not-yet-resolved leave it null).
alter table public.story_battles
  add column if not exists winner_character_id smallint references public.uff_characters(id);
