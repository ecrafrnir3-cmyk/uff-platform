// Thin client for the Sleeper API (free, no auth, read-only).
// Docs: https://docs.sleeper.com/
//
// For local dev where outbound network is restricted, set USE_FIXTURES=true
// to read from src/lib/fixtures/* instead of hitting the live API.

import leagueFixture from "./fixtures/league.json";
import usersFixture from "./fixtures/users.json";
import rostersFixture from "./fixtures/rosters.json";
import matchupsFixture from "./fixtures/matchups-week1.json";

const BASE = "https://api.sleeper.app/v1";
const USE_FIXTURES = process.env.USE_FIXTURES === "true";

export interface League {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
}

export interface SleeperUser {
  user_id: string;
  display_name: string;
  team_name?: string;
}

export interface Roster {
  roster_id: number;
  owner_id: string;
  wins: number;
  losses: number;
  fpts: number;
}

export interface Matchup {
  roster_id: number;
  matchup_id: number;
  points: number;
  starters_points: number[];
}

async function getJSON<T, R = T>(
  path: string,
  fixture: T,
  transform?: (raw: R) => T
): Promise<T> {
  if (USE_FIXTURES) return fixture;
  try {
    const res = await fetch(`${BASE}${path}`, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`Sleeper API ${path} -> ${res.status}`);
    const raw = (await res.json()) as R;
    return transform ? transform(raw) : (raw as unknown as T);
  } catch (err) {
    console.warn(`[sleeper] falling back to fixture for ${path}:`, err);
    return fixture;
  }
}

// Raw shapes returned by the live Sleeper API — these nest a few fields
// (team_name, wins/losses/fpts) under metadata/settings, unlike our
// flattened fixtures and Supabase tables.
interface RawSleeperUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
}

interface RawRoster {
  roster_id: number;
  owner_id: string;
  settings?: { wins?: number; losses?: number; fpts?: number; fpts_decimal?: number };
}

export function getLeague(leagueId: string): Promise<League> {
  return getJSON<League>(`/league/${leagueId}`, leagueFixture as League);
}

export function getUsers(leagueId: string): Promise<SleeperUser[]> {
  return getJSON<SleeperUser[], RawSleeperUser[]>(
    `/league/${leagueId}/users`,
    usersFixture as SleeperUser[],
    (raw) =>
      raw.map((u) => ({
        user_id: u.user_id,
        display_name: u.display_name,
        team_name: u.metadata?.team_name,
      }))
  );
}

export function getRosters(leagueId: string): Promise<Roster[]> {
  return getJSON<Roster[], RawRoster[]>(
    `/league/${leagueId}/rosters`,
    rostersFixture as unknown as Roster[],
    (raw) =>
      raw.map((r) => ({
        roster_id: r.roster_id,
        owner_id: r.owner_id,
        wins: r.settings?.wins ?? 0,
        losses: r.settings?.losses ?? 0,
        fpts: (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
      }))
  );
}

export function getMatchups(leagueId: string, week: number): Promise<Matchup[]> {
  return getJSON<Matchup[]>(
    `/league/${leagueId}/matchups/${week}`,
    matchupsFixture as Matchup[]
  );
}

// The demo league shipped with this repo for local prototyping.
// Swap for Nate's real league_id (find it in the Sleeper app URL) when ready.
export const DEMO_LEAGUE_ID = "289646328504385536";
export const DEMO_WEEK = 1;
