import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  buildOraclePrompt,
  oracleRequest,
  readOracleReply,
  type OracleMatchupRow as MatchupDbRow,
  type OracleTokenRow as TokenRow,
} from "@/lib/ai-prompts/oracle";

export async function POST(req: NextRequest) {
  try {
    const { matchup_id, league_id } = await req.json();

    if (!matchup_id || !league_id) {
      return NextResponse.json({ error: "Missing matchup_id or league_id" }, { status: 400 });
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

    const rl = await checkRateLimit(`${user.id}:oracle`, 5);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

    // Fetch matchup rows
    const { data: rows, error: rowsErr } = await supabase
      .from("uff_matchups")
      .select("id, member_id, week, points, token_bonus, is_complete, oracle_recap, league_members(team_name, faction)")
      .eq("matchup_id", matchup_id)
      .eq("league_id", league_id)
      .returns<MatchupDbRow[]>();

    if (rowsErr || !rows || rows.length < 2) {
      return NextResponse.json({ error: "Matchup not found" }, { status: 404 });
    }

    if (!rows.every((r) => r.is_complete)) {
      return NextResponse.json({ error: "Matchup not finalized yet" }, { status: 400 });
    }

    // Return cached recap if already generated (check both rows — order is not guaranteed)
    const cached = rows[0].oracle_recap ?? rows[1]?.oracle_recap;
    if (cached) {
      return NextResponse.json({ recap: cached });
    }

    const [a, b] = rows;
    const week = a.week;

    // Fetch tokens for both members this week
    const memberIds = [a.member_id, b.member_id];
    const { data: tokenRows } = await supabase
      .from("weekly_token_assignments")
      .select("member_id, token_id, status")
      .in("member_id", memberIds)
      .eq("week", week)
      .returns<TokenRow[]>();

    // The recap prompt is built in @/lib/ai-prompts/oracle from exactly these rows.
    const prompt = buildOraclePrompt(rows, tokenRows);

    // Call Anthropic API
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Oracle not configured" }, { status: 500 });
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(oracleRequest(prompt)),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", errText);
      return NextResponse.json({ error: "Oracle is silent — try again shortly" }, { status: 502 });
    }

    const anthropicData = await anthropicRes.json();
    const recap: string = readOracleReply(anthropicData);

    if (!recap) {
      return NextResponse.json({ error: "Oracle returned no vision" }, { status: 500 });
    }

    // Save recap to both rows — use service role to bypass RLS (UPDATE is commissioner-only)
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    await serviceClient
      .from("uff_matchups")
      .update({ oracle_recap: recap })
      .in("id", rows.map((r) => r.id));

    return NextResponse.json({ recap });
  } catch (err) {
    console.error("Oracle route error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
