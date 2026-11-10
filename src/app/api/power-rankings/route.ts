import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";
import {
  buildPowerRankingsPrompt,
  powerRankingsRequest,
  readPowerRankingsReply,
  type PowerRankingsMatchupRow as MatchupRow,
} from "@/lib/ai-prompts/power-rankings";

export async function POST(req: NextRequest) {
  try {
    const { league_id } = await req.json();
    if (!league_id) return NextResponse.json({ error: "Missing league_id" }, { status: 400 });

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

    const rl = await checkRateLimit(`${user.id}:power-rankings`, 3);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

    // Fetch all completed matchup rows with faction data
    const { data: allRows } = await supabase
      .from("uff_matchups")
      .select("matchup_id, member_id, week, points, is_complete, void_result, league_members(team_name, faction)")
      .eq("league_id", league_id)
      .eq("is_complete", true)
      .order("week", { ascending: true })
      .returns<MatchupRow[]>();

    const rows = allRows ?? [];
    if (rows.length < 2) {
      return NextResponse.json({ error: "Not enough game data yet to generate power rankings" }, { status: 400 });
    }

    // Standings, recent form and the prompt are built in @/lib/ai-prompts/power-rankings.
    const currentWeek = getCurrentNFLWeek();
    const prompt = buildPowerRankingsPrompt(rows, currentWeek);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Oracle not configured" }, { status: 500 });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(powerRankingsRequest(prompt)),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error (power-rankings):", errText);
      return NextResponse.json({ error: "Oracle is silent — try again shortly" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const rankings: string = readPowerRankingsReply(resData);
    if (!rankings) return NextResponse.json({ error: "Oracle returned no rankings" }, { status: 500 });

    return NextResponse.json({ rankings, week: currentWeek });
  } catch (err) {
    console.error("Power rankings error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
