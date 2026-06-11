// Supabase reads for the UFF platform.
//
// The Supabase project ("uff-platform") holds a persisted copy of league
// data (leagues, sleeper_users, rosters, matchups, oracle_recaps), seeded
// from the same demo league as src/lib/fixtures/*. Tables are public-read
// (RLS policies allow `select` for anon) since this is prototype data.
//
// If Supabase env vars aren't set, or a query fails, every function here
// returns null so callers can fall back to the Sleeper API / fixtures.

import { createClient } from "@supabase/supabase-js";
import type { League, Matchup, Roster, SleeperUser } from "./sleeper";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

export async function getLeagueFromDb(leagueId: string): Promise<League | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("leagues")
    .select("league_id, name, season, status, total_rosters, roster_positions, scoring_settings")
    .eq("league_id", leagueId)
    .single();

  if (error || !data) return null;
  return data as League;
}

export async function getUsersFromDb(leagueId: string): Promise<SleeperUser[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("sleeper_users")
    .select("user_id, display_name, team_name")
    .eq("league_id", leagueId);

  if (error || !data || data.length === 0) return null;
  return data as SleeperUser[];
}

export async function getRostersFromDb(leagueId: string): Promise<Roster[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("rosters")
    .select("roster_id, owner_id, wins, losses, fpts")
    .eq("league_id", leagueId)
    .order("roster_id");

  if (error || !data || data.length === 0) return null;
  return data.map((r) => ({ ...r, fpts: Number(r.fpts) })) as Roster[];
}

export async function getMatchupsFromDb(
  leagueId: string,
  week: number
): Promise<Matchup[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("matchups")
    .select("roster_id, matchup_id, points, starters_points")
    .eq("league_id", leagueId)
    .eq("week", week);

  if (error || !data || data.length === 0) return null;
  return data.map((m) => ({ ...m, points: Number(m.points) })) as Matchup[];
}
