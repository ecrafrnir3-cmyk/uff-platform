import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const FLAG_KEYS = new Set([
  "pts_allow_0","pts_allow_1_6","pts_allow_7_13","pts_allow_14_20",
  "pts_allow_21_27","pts_allow_28_34","pts_allow_35p",
]);

interface LineupRow { slot: string; player_id: string; }
interface RosterRow {
  player_id: string;
  players: { full_name: string; position: string | null; team: string | null } | null;
}

function computeScore(
  stats: Record<string, number>,
  scoringSettings: Record<string, number>
): number {
  let score = 0;
  for (const [key, mult] of Object.entries(scoringSettings)) {
    const val = stats[key];
    if (val == null || val === 0) continue;
    score += FLAG_KEYS.has(key) ? mult : val * mult;
  }
  return Math.round(score * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const { league_id, week, member_a_id, member_b_id } = await req.json();
    if (!league_id || !week || !member_a_id || !member_b_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Verify membership
    const { data: me } = await supabase
      .from("league_members")
      .select("id")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const { data: league } = await supabase
      .from("uff_leagues")
      .select("season, scoring_settings")
      .eq("id", league_id)
      .maybeSingle();
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

    const scoringSettings: Record<string, number> =
      (league.scoring_settings as Record<string, number>) ?? {};

    // Fetch lineups, rosters, and team names in parallel
    const [
      { data: lineupA }, { data: lineupB },
      { data: rosterA }, { data: rosterB },
      { data: memberA }, { data: memberB },
    ] = await Promise.all([
      supabase
        .from("uff_lineups")
        .select("slot, player_id")
        .eq("member_id", member_a_id)
        .eq("week", week)
        .returns<LineupRow[]>(),
      supabase
        .from("uff_lineups")
        .select("slot, player_id")
        .eq("member_id", member_b_id)
        .eq("week", week)
        .returns<LineupRow[]>(),
      supabase
        .from("uff_roster_players")
        .select("player_id, players(full_name, position, team)")
        .eq("member_id", member_a_id)
        .is("dropped_at", null)
        .returns<RosterRow[]>(),
      supabase
        .from("uff_roster_players")
        .select("player_id, players(full_name, position, team)")
        .eq("member_id", member_b_id)
        .is("dropped_at", null)
        .returns<RosterRow[]>(),
      supabase
        .from("league_members")
        .select("team_name")
        .eq("id", member_a_id)
        .maybeSingle(),
      supabase
        .from("league_members")
        .select("team_name")
        .eq("id", member_b_id)
        .maybeSingle(),
    ]);

    const startingA = new Set((lineupA ?? []).map(l => l.player_id));
    const startingB = new Set((lineupB ?? []).map(l => l.player_id));

    // Build player info maps
    const nameMapA: Record<string, { name: string; pos: string; team: string }> = {};
    for (const r of rosterA ?? []) {
      if (r.players) {
        nameMapA[r.player_id] = {
          name: r.players.full_name,
          pos: r.players.position ?? "?",
          team: r.players.team ?? "FA",
        };
      }
    }
    const nameMapB: Record<string, { name: string; pos: string; team: string }> = {};
    for (const r of rosterB ?? []) {
      if (r.players) {
        nameMapB[r.player_id] = {
          name: r.players.full_name,
          pos: r.players.position ?? "?",
          team: r.players.team ?? "FA",
        };
      }
    }

    // Fetch Sleeper stats for that week
    let statsMap: Record<string, Record<string, number>> = {};
    try {
      const statsRes = await fetch(
        `https://api.sleeper.app/v1/stats/nfl/${league.season}/${week}?season_type=regular`,
        { next: { revalidate: 300 } }
      );
      if (statsRes.ok) {
        statsMap = await statsRes.json();
      }
    } catch { /* stats unavailable */ }

    function buildBreakdown(
      startingIds: Set<string>,
      nameMap: Record<string, { name: string; pos: string; team: string }>
    ) {
      return [...startingIds]
        .map(pid => {
          const info = nameMap[pid];
          const stats = statsMap[pid] ?? {};
          const points = Object.keys(scoringSettings).length > 0
            ? computeScore(stats, scoringSettings)
            : 0;
          return {
            player_id: pid,
            name: info?.name ?? "Unknown",
            pos: info?.pos ?? "?",
            team: info?.team ?? "FA",
            points,
          };
        })
        .sort((a, b) => b.points - a.points);
    }

    const hasData = startingA.size > 0 || startingB.size > 0;

    return NextResponse.json({
      hasData,
      a: {
        team_name: memberA?.team_name ?? "Team A",
        players: buildBreakdown(startingA, nameMapA),
      },
      b: {
        team_name: memberB?.team_name ?? "Team B",
        players: buildBreakdown(startingB, nameMapB),
      },
    });
  } catch (err) {
    console.error("Matchup breakdown error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
