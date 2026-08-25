-- APPLIED LIVE 2026-08-25 via Supabase MCP. Bulletproof double-submit guard.
--
-- The client button-disable and a 20s "recent duplicate" check both failed to
-- stop a ~120ms double-click (verified: it created two identical leagues) — the
-- two requests raced and each read "no duplicate" before either committed.
--
-- FIX: a partial unique index makes a duplicate physically impossible — a
-- commissioner can have only one 'forming' league of a given (case-insensitive)
-- name at a time. A concurrent double-insert now fails the second with 23505 at
-- the DB (atomic); createLeague catches it and redirects to the winning league.
-- The WHERE status = 'forming' scope still lets the same name recur in a future
-- season (the old league will be 'active'/'completed' by then).

CREATE UNIQUE INDEX IF NOT EXISTS uq_forming_league_name_per_commissioner
  ON public.uff_leagues (commissioner_id, lower(name))
  WHERE status = 'forming';
