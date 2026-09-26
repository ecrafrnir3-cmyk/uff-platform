import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
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
  // NaN passed straight into the Sleeper URL and guaranteed a 500 (audit A3-08)
  const hoursRaw = parseInt(searchParams.get("hours") ?? "24", 10);
  const limitRaw = parseInt(searchParams.get("limit") ?? "20", 10);
  const hours = Number.isFinite(hoursRaw) ? Math.min(Math.max(hoursRaw, 1), 168) : 24;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;

  // Unauthenticated and public: a small per-IP ceiling keeps it from being a Sleeper relay.
  const ip = (request.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rl = await checkRateLimit(`ip:${ip}:trending`, 30);
  if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

  try {
    const res = await fetch(
      `https://api.sleeper.app/v1/players/nfl/trending/${type}?lookback_hours=${hours}&limit=${limit}`,
      { next: { revalidate: 300 } } // cache 5 min
    );
    if (!res.ok) throw new Error("Sleeper fetch failed");

    const trending: TrendingEntry[] = await res.json();
    const playerIds = trending.map((t) => t.player_id);

    if (playerIds.length === 0) return NextResponse.json([]);

    // players is publicly readable; no reason to hold the service role here
    const supabase = await createClient();
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
