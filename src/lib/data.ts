// Data layer for the UFF platform: Supabase first, falling back to the
// Sleeper API / local fixtures (see sleeper.ts) if Supabase has no data
// or isn't configured. Pages should import from here, not sleeper.ts
// directly, so the fallback chain stays in one place.

import * as sleeper from "./sleeper";
import * as db from "./db";
import type { League, Matchup, Roster, SleeperUser } from "./sleeper";

export type { League, Matchup, Roster, SleeperUser };
export const DEMO_LEAGUE_ID = sleeper.DEMO_LEAGUE_ID;
export const DEMO_WEEK = sleeper.DEMO_WEEK;

export async function getLeague(leagueId: string): Promise<League> {
  return (await db.getLeagueFromDb(leagueId)) ?? sleeper.getLeague(leagueId);
}

export async function getUsers(leagueId: string): Promise<SleeperUser[]> {
  return (await db.getUsersFromDb(leagueId)) ?? sleeper.getUsers(leagueId);
}

export async function getRosters(leagueId: string): Promise<Roster[]> {
  return (await db.getRostersFromDb(leagueId)) ?? sleeper.getRosters(leagueId);
}

export async function getMatchups(leagueId: string, week: number): Promise<Matchup[]> {
  return (await db.getMatchupsFromDb(leagueId, week)) ?? sleeper.getMatchups(leagueId, week);
}
