import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface TrendingEntry {
  player_id: string;
  count: number;
}

interface PlayerRow {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  injury_status: string | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") === "drop" ? "drop" : "add";
  const hours = Math.min(parseInt(searchParams.get("hours") ?? "24", 10), 168);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 50);

  try {
    const res = await fetch(
      `https://api.sleeper.app/v1/players/nfl/trending/${type}?lookback_hours=${hours}&limit=${limit}`,
      { next: { revalidate: 300 } } // cache 5 min
    );
    if (!res.ok) throw new Error("Sleeper fetch failed");

    const trending: TrendingEntry[] = await res.json();
    const playerIds = trending.map((t) => t.player_id);

    if (playerIds.length === 0) return NextResponse.json([]);

    const supabase = createAdminClient();
    const { data: players } = await supabase
      .from("players")
      .select("id, full_name, position, team, injury_status")
      .in("id", playerIds)
      .returns<PlayerRow[]>();

    const playerMap: Record<string, PlayerRow> = {};
    for (const p of players ?? []) playerMap[p.id] = p;

    const result = trending
      .map((t) => {
        const p = playerMap[t.player_id];
        if (!p) return null;
        return {
          player_id: t.player_id,
          count: t.count,
          full_name: p.full_name,
          position: p.position,
          team: p.team,
          injury_status: p.injury_status,
        };
      })
      .filter(Boolean);

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Failed to fetch trending data" }, { status: 500 });
  }
}
