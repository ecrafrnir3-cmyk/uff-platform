import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface RosterOwner {
  player_id: string;
  member_id: string;
  league_members: { team_name: string } | null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const q = searchParams.get("q")?.trim() ?? "";
    const leagueId = searchParams.get("league_id") ?? "";

    if (!leagueId) return NextResponse.json({ error: "Missing league_id" }, { status: 400 });
    if (q.length < 2) return NextResponse.json({ players: [] });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Auth: verify membership
    const { data: me } = await supabase
      .from("league_members")
      .select("id")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    // Search players + fetch roster ownership for this league in parallel
    const [{ data: playerRows }, { data: rosterRows }] = await Promise.all([
      supabase
        .from("players")
        .select("id, full_name, position, team, injury_status")
        .ilike("full_name", `%${q}%`)
        .order("full_name")
        .limit(25),
      supabase
        .from("uff_roster_players")
        .select("player_id, member_id, league_members(team_name)")
        .eq("league_id", leagueId)
        .is("dropped_at", null)
        .returns<RosterOwner[]>(),
    ]);

    // Build owner map: player_id → { member_id, team_name }
    const ownerMap: Record<string, { team_name: string; member_id: string }> = {};
    for (const r of rosterRows ?? []) {
      if (r.league_members) {
        ownerMap[r.player_id] = { team_name: r.league_members.team_name, member_id: r.member_id };
      }
    }

    const players = (playerRows ?? []).map(p => ({
      player_id: p.id,
      full_name: p.full_name,
      position: p.position ?? null,
      team: p.team ?? null,
      injury_status: p.injury_status ?? null,
      owner_team: ownerMap[p.id]?.team_name ?? null,
      owner_member_id: ownerMap[p.id]?.member_id ?? null,
      is_mine: ownerMap[p.id]?.member_id === me.id,
    }));

    return NextResponse.json({ players });
  } catch (err) {
    console.error("Player search error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
