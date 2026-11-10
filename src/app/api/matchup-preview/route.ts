import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { CompletedMatchupRow } from "@/lib/get-record";
import {
  buildMatchupPreviewPrompt,
  matchupPreviewRequest,
  readMatchupPreviewReply,
  type PreviewMatchupRow as MatchupDbRow,
  type PreviewTokenRow as TokenRow,
} from "@/lib/ai-prompts/matchup-preview";

export async function POST(req: NextRequest) {
  try {
    const { matchup_id, league_id } = await req.json();
    if (!matchup_id || !league_id) {
      return NextResponse.json({ error: "Missing matchup_id or league_id" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: me } = await supabase
      .from("league_members")
      .select("id")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const rl = await checkRateLimit(`${user.id}:matchup-preview`, 5);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

    // Fetch matchup rows
    const { data: rows, error: rowsErr } = await supabase
      .from("uff_matchups")
      .select("id, member_id, week, points, projected, is_complete, league_members(team_name, faction)")
      .eq("matchup_id", matchup_id)
      .eq("league_id", league_id)
      .returns<MatchupDbRow[]>();

    if (rowsErr || !rows || rows.length < 2) {
      return NextResponse.json({ error: "Matchup not found" }, { status: 404 });
    }

    if (rows.every((r) => r.is_complete)) {
      return NextResponse.json({ error: "Matchup already complete — use the Oracle recap instead" }, { status: 400 });
    }

    const [a, b] = rows;
    const week = a.week;

    // Fetch tokens for both members this week
    const { data: tokenRows } = await supabase
      .from("weekly_token_assignments")
      .select("member_id, token_id, status")
      .in("member_id", [a.member_id, b.member_id])
      .eq("week", week)
      .eq("league_id", league_id)
      .returns<TokenRow[]>();

    // Compute season records
    const { data: allMatchups } = await supabase
      .from("uff_matchups")
      .select("matchup_id, member_id, points")
      .eq("league_id", league_id)
      .eq("is_complete", true)
      .returns<CompletedMatchupRow[]>();

    // The preview prompt (records, token secrecy, Recon) is built in
    // @/lib/ai-prompts/matchup-preview from exactly these rows.
    const prompt = buildMatchupPreviewPrompt({ rows, tokenRows, allMatchups, meId: me.id });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Oracle not configured" }, { status: 500 });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(matchupPreviewRequest(prompt)),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error (matchup-preview):", errText);
      return NextResponse.json({ error: "Oracle is silent — try again shortly" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const preview: string = readMatchupPreviewReply(resData);
    if (!preview) return NextResponse.json({ error: "Oracle returned no vision" }, { status: 500 });

    return NextResponse.json({ preview });
  } catch (err) {
    console.error("Matchup preview error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
