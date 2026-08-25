-- APPLIED LIVE 2026-08-25 via Supabase MCP (execute_sql). Character/lore layer
-- (Hero/Villain universe, season 1 = pure story, no mechanics).
-- 20 canon characters seeded via scripts/seed-characters.mjs (source of truth
-- mirrors the Notion writers' room). Each manager is cast as one unique
-- character of their faction when they lock a side (see src/lib/characters.ts).

CREATE TABLE IF NOT EXISTS public.uff_characters (
  id            smallint PRIMARY KEY,
  faction       text NOT NULL CHECK (faction IN ('hero','villain')),
  name          text NOT NULL,
  epithet       text NOT NULL,
  domain        text NOT NULL,
  starter_story text NOT NULL,
  secret_story  text,            -- hidden-dossier content, not surfaced yet
  art_url       text             -- null => render silhouette placeholder
);

ALTER TABLE public.uff_characters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "characters are publicly readable" ON public.uff_characters;
CREATE POLICY "characters are publicly readable" ON public.uff_characters
  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.league_members
  ADD COLUMN IF NOT EXISTS character_id smallint REFERENCES public.uff_characters(id);

-- secret_story is spoiler content. The table is publicly readable at the row
-- level, so hide the secret at the COLUMN level from the public REST API. A
-- table-level SELECT grant covers every column, so we drop it and re-grant only
-- the public columns. The app only ever selects explicit columns (never *);
-- the future hidden-dossier feature reads secret_story via the service role.
REVOKE SELECT ON public.uff_characters FROM anon, authenticated;
GRANT SELECT (id, faction, name, epithet, domain, starter_story, art_url)
  ON public.uff_characters TO anon, authenticated;
