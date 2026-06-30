import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRecord, CompletedMatchupRow } from "@/lib/get-record";

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

    const playerMap: Record<string, { full_name: string; position: string | null; team: string | null }> = {};
    for (const p of playerRows ?? []) playerMap[p.id] = p;

    const rows = allMatchups ?? [];
    const proposerRecord = getRecord(trade.proposer_id, rows);
    const receiverRecord = getRecord(trade.receiver_id, rows);

    const formatPlayers = (ids: string[]) =>
      ids.map(id => {
        const p = playerMap[id];
        return p ? `${p.full_name} (${p.position ?? "?"}, ${p.team ?? "FA"})` : id;
      }).join(", ");

    const proposerTeam = proposerMember?.team_name ?? "Team A";
    const receiverTeam = receiverMember?.team_name ?? "Team B";

    const prompt = `You are advising a fantasy football commissioner on whether to APPROVE or VETO this trade. Be direct and fair.

${proposerTeam} [${proposerMember?.faction ?? "?"}] (${proposerRecord.wins}W-${proposerRecord.losses}L) SENDS: ${formatPlayers(trade.proposer_player_ids)}
${receiverTeam} [${receiverMember?.faction ?? "?"}] (${receiverRecord.wins}W-${receiverRecord.losses}L) SENDS BACK: ${formatPlayers(trade.receiver_player_ids)}

Evaluate in 2-3 sentences: Is this trade reasonably fair, or does one team clearly get fleeced? Consider position value, player quality, record context, and competitive balance. Then give your verdict on its own line:

VERDICT: APPROVE — [one-sentence reason]
or
VERDICT: VETO — [one-sentence reason]`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Oracle not configured" }, { status: 500 });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 250,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error (trade-veto-analysis):", errText);
      return NextResponse.json({ error: "Oracle is silent — try again" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const analysis: string = resData.content?.[0]?.text ?? "";
    if (!analysis) return NextResponse.json({ error: "No analysis returned" }, { status: 500 });

    // Extract verdict
    const verdictMatch = analysis.match(/VERDICT:\s*(APPROVE|VETO)/i);
    const verdict = verdictMatch ? verdictMatch[1].toUpperCase() as "APPROVE" | "VETO" : null;

    return NextResponse.json({ analysis, verdict });
  } catch (err) {
    console.error("Trade veto analysis error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
