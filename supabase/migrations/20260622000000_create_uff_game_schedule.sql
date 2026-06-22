-- Per-player lineup lock: one row per team per game, Sleeper abbreviations
CREATE TABLE IF NOT EXISTS uff_game_schedule (
  id          bigint generated always as identity primary key,
  season      int          not null,
  week        int          not null,
  team        text         not null,  -- Sleeper team abbreviation (matches players.team)
  kickoff_utc timestamptz  not null,
  UNIQUE (season, week, team)
);

-- Fast lookup: give me all games for a specific week
CREATE INDEX IF NOT EXISTS uff_game_schedule_season_week
  ON uff_game_schedule(season, week);

-- Public read only — seeded by admin script, never written by clients
ALTER TABLE uff_game_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read game schedule"
  ON uff_game_schedule FOR SELECT USING (true);
