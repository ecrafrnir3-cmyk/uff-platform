import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { CompletedMatchupRow } from "@/lib/get-record";
import { buildTradeEvalPrompt, readTradeEvalReply, tradeEvalRequest } from "@/lib/ai-prompts/trades";

export async function POST(req: NextRequest) {
  try {
    const { league_id, proposer_player_ids, receiver_player_ids, partner_member_id } = await req.json();

    if (!league_id || !proposer_player_ids?.length || !receiver_player_ids?.length || !partner_member_id) {
      return NextResponse.json({ error: "Missing required fields — need league_id, both player arrays, and partner_member_id" }, { status: 400 });
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

    const rl = await checkRateLimit(`${user.id}:trade-eval`, 5);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

    // Fetch partner info
    const { data: partner } = await supabase
      .from("league_members")
      .select("id, team_name, faction")
      .eq("id", partner_member_id)
      .maybeSingle();
    if (!partner) return NextResponse.json({ error: "Trade partner not found" }, { status: 404 });

    // Fetch all player details
    const allPlayerIds: string[] = [...new Set([...proposer_player_ids, ...receiver_player_ids])];
    const { data: playerRows } = await supabase
      .from("players")
      .select("id, full_name, position, team")
      .in("id", allPlayerIds);

    // Compute both records
    const { data: allMatchups } = await supabase
      .from("uff_matchups")
      .select("matchup_id, member_id, points")
      .eq("league_id", league_id)
      .eq("is_complete", true)
      .returns<CompletedMatchupRow[]>();

    // Records, both sides and the prompt are built in @/lib/ai-prompts/trades.
    const prompt = buildTradeEvalPrompt({
      me,
      partner,
      playerRows,
      allMatchups,
      proposerPlayerIds: proposer_player_ids,
      receiverPlayerIds: receiver_player_ids,
    });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Oracle not configured" }, { status: 500 });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(tradeEvalRequest(prompt)),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error (trade-eval):", errText);
      return NextResponse.json({ error: "Oracle is silent — try again shortly" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const verdict: string = readTradeEvalReply(resData);
    if (!verdict) return NextResponse.json({ error: "Oracle returned no verdict" }, { status: 500 });

    return NextResponse.json({ verdict });
  } catch (err) {
    console.error("Trade eval error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
