import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { CompletedMatchupRow } from "@/lib/get-record";
import {
  TOKEN_INFO,
  buildTokenAdvisorPrompt,
  readTokenAdvisorReply,
  tokenAdvisorRequest,
} from "@/lib/ai-prompts/token-advisor";

export async function POST(req: NextRequest) {
  try {
    const { league_id, week } = await req.json();
    if (!league_id || !week) {
      return NextResponse.json({ error: "Missing league_id or week" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: me } = await supabase
      .from("league_members")
      .select("id, team_name, faction")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const rl = await checkRateLimit(`${user.id}:token-advisor`, 5);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

    // Fetch this week's token
    const { data: tokenRow } = await supabase
      .from("weekly_token_assignments")
      .select("token_id, status, choice")
      .eq("league_id", league_id)
      .eq("member_id", me.id)
      .eq("week", week)
      .maybeSingle();

    if (!tokenRow || tokenRow.status !== "pending") {
      return NextResponse.json({ error: "No active token to advise on" }, { status: 400 });
    }

    const tokenInfo = TOKEN_INFO[tokenRow.token_id];
    if (!tokenInfo) {
      return NextResponse.json({ error: "Unknown token" }, { status: 400 });
    }

    // Compute W/L record from completed matchups
    const { data: allMatchups } = await supabase
      .from("uff_matchups")
      .select("matchup_id, member_id, points")
      .eq("league_id", league_id)
      .eq("is_complete", true)
      .returns<CompletedMatchupRow[]>();

    // Fetch this week's matchup for opponent context
    const { data: myMatchupRow } = await supabase
      .from("uff_matchups")
      .select("matchup_id, projected")
      .eq("league_id", league_id)
      .eq("member_id", me.id)
      .eq("week", week)
      .maybeSingle();

    let oppRow: { projected: number | null; league_members: unknown } | null = null;

    if (myMatchupRow) {
      const { data } = await supabase
        .from("uff_matchups")
        .select("projected, league_members(team_name, faction)")
        .eq("league_id", league_id)
        .eq("matchup_id", myMatchupRow.matchup_id)
        .eq("week", week)
        .neq("member_id", me.id)
        .maybeSingle();
      oppRow = data;
    }

    // Fetch active roster for position context (token 7 Position Power needs this)
    const { data: rosterRaw } = await supabase
      .from("uff_roster_players")
      .select("player_id, players(full_name, position)")
      .eq("member_id", me.id)
      .eq("slot", "active")
      .is("dropped_at", null);

    // Record, opponent, roster groups and the prompt are built in @/lib/ai-prompts/token-advisor.
    const prompt = buildTokenAdvisorPrompt({ me, tokenInfo, allMatchups, myMatchupRow, oppRow, rosterRaw });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Oracle not configured" }, { status: 500 });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(tokenAdvisorRequest(prompt)),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error (token-advisor):", errText);
      return NextResponse.json({ error: "Oracle is silent — try again shortly" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const advice: string = readTokenAdvisorReply(resData);
    if (!advice) return NextResponse.json({ error: "Oracle returned no guidance" }, { status: 500 });

    return NextResponse.json({ advice });
  } catch (err) {
    console.error("Token advisor error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
