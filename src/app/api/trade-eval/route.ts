import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRecord, CompletedMatchupRow } from "@/lib/get-record";

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

    const playerMap: Record<string, { full_name: string; position: string | null; team: string | null }> = {};
    for (const p of (playerRows ?? [])) playerMap[p.id] = p;

    // Compute both records
    const { data: allMatchups } = await supabase
      .from("uff_matchups")
      .select("matchup_id, member_id, points")
      .eq("league_id", league_id)
      .eq("is_complete", true)
      .returns<CompletedMatchupRow[]>();

    const rows = allMatchups ?? [];
    const myRecord = getRecord(me.id, rows);
    const partnerRecord = getRecord(partner.id, rows);

    const formatPlayers = (ids: string[]) =>
      ids.map((id) => {
        const p = playerMap[id];
        return p ? `${p.full_name} (${p.position ?? "?"}, ${p.team ?? "FA"})` : id;
      }).join(", ");

    const mySide = formatPlayers(proposer_player_ids);
    const theirSide = formatPlayers(receiver_player_ids);

    const prompt = `You are the Oracle of Ultimate Fantasy Football — a precise trade analyst who cuts through spin and tells it straight.

Trade details:
- ${me.team_name} [${me.faction ?? "?"}] (${myRecord.wins}W-${myRecord.losses}L) SENDS: ${mySide}
- ${partner.team_name} [${partner.faction ?? "?"}] (${partnerRecord.wins}W-${partnerRecord.losses}L) SENDS BACK: ${theirSide}

Evaluate this trade in 3-4 sentences. State who benefits more and why — consider position scarcity, roster construction, playoff implications given each team's record, and overall value balance. End your response with a single verdict line formatted exactly as one of: VERDICT: FAIR | VERDICT: SLIGHT EDGE TO [team name] | VERDICT: AVOID — [team being fleeced] is getting robbed`;

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
      console.error("Anthropic error (trade-eval):", errText);
      return NextResponse.json({ error: "Oracle is silent — try again shortly" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const verdict: string = resData.content?.[0]?.text ?? "";
    if (!verdict) return NextResponse.json({ error: "Oracle returned no verdict" }, { status: 500 });

    return NextResponse.json({ verdict });
  } catch (err) {
    console.error("Trade eval error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
