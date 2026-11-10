import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { CompletedMatchupRow } from "@/lib/get-record";
import {
  buildTradeVetoPrompt,
  readTradeVetoReply,
  tradeVetoRequest,
  tradeVetoVerdict,
} from "@/lib/ai-prompts/trades";

export async function POST(req: NextRequest) {
  try {
    const { league_id, trade_id } = await req.json();
    if (!league_id || !trade_id) {
      return NextResponse.json({ error: "Missing league_id or trade_id" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Verify caller is commissioner
    const { data: league } = await supabase
      .from("uff_leagues")
      .select("commissioner_id, name")
      .eq("id", league_id)
      .maybeSingle();
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });
    if (league.commissioner_id !== user.id) {
      return NextResponse.json({ error: "Only the commissioner can use this" }, { status: 403 });
    }

    const rl = await checkRateLimit(`${user.id}:trade-veto-analysis`, 5);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

    // Fetch trade
    const { data: trade } = await supabase
      .from("uff_trades")
      .select("proposer_id, receiver_id, proposer_player_ids, receiver_player_ids")
      .eq("id", trade_id)
      .maybeSingle();
    if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 });

    const allPlayerIds = [...new Set([...trade.proposer_player_ids, ...trade.receiver_player_ids])];

    const [{ data: playerRows }, { data: proposerMember }, { data: receiverMember }, { data: allMatchups }] = await Promise.all([
      supabase
        .from("players")
        .select("id, full_name, position, team")
        .in("id", allPlayerIds),
      supabase
        .from("league_members")
        .select("team_name, faction")
        .eq("id", trade.proposer_id)
        .maybeSingle(),
      supabase
        .from("league_members")
        .select("team_name, faction")
        .eq("id", trade.receiver_id)
        .maybeSingle(),
      supabase
        .from("uff_matchups")
        .select("matchup_id, member_id, points")
        .eq("league_id", league_id)
        .eq("is_complete", true)
        .returns<CompletedMatchupRow[]>(),
    ]);

    // Records, both sides and the prompt are built in @/lib/ai-prompts/trades.
    const prompt = buildTradeVetoPrompt({ trade, playerRows, proposerMember, receiverMember, allMatchups });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Oracle not configured" }, { status: 500 });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(tradeVetoRequest(prompt)),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error (trade-veto-analysis):", errText);
      return NextResponse.json({ error: "Oracle is silent — try again" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const analysis: string = readTradeVetoReply(resData);
    if (!analysis) return NextResponse.json({ error: "No analysis returned" }, { status: 500 });

    // Extract verdict
    const verdict = tradeVetoVerdict(analysis);

    return NextResponse.json({ analysis, verdict });
  } catch (err) {
    console.error("Trade veto analysis error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
