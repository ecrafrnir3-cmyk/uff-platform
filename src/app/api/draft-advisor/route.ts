import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildDraftAdvisorPrompt,
  draftAdvisorRequest,
  readDraftAdvisorReply,
  type DraftPickRow as PickRow,
  type DraftPlayerRow as PlayerRow,
} from "@/lib/ai-prompts/draft-advisor";

export async function POST(req: NextRequest) {
  try {
    const { league_id } = await req.json();
    if (!league_id) return NextResponse.json({ error: "Missing league_id" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Get my membership + faction
    const { data: me } = await supabase
      .from("league_members")
      .select("id, team_name, faction")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const rl = await checkRateLimit(`${user.id}:draft-advisor`, 8);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

    // Get league info (max_teams for round calculation)
    const { data: league } = await supabase
      .from("uff_leagues")
      .select("max_teams, draft_rounds, draft_status")
      .eq("id", league_id)
      .maybeSingle();
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

    if (league.draft_status !== "in_progress") {
      return NextResponse.json({ error: "Draft is not in progress" }, { status: 400 });
    }

    // Get all picks for this league (to know what's taken + my roster)
    const { data: allPicks } = await supabase
      .from("uff_draft_picks")
      .select("member_id, player_id, round, pick_no, players(full_name, position, team)")
      .eq("league_id", league_id)
      .order("pick_no", { ascending: true })
      .returns<PickRow[]>();

    // Get top available players by ADP (not already picked)
    const { data: allPlayers } = await supabase
      .from("players")
      .select("id, full_name, position, team, adp")
      .not("position", "is", null)
      .order("adp", { ascending: true, nullsFirst: false })
      .limit(200)
      .returns<PlayerRow[]>();

    // My roster, the top 30 available and the prompt are built in @/lib/ai-prompts/draft-advisor.
    const { prompt, currentRound, available } = buildDraftAdvisorPrompt({ me, league, allPicks, allPlayers });

    if (available.length === 0) {
      return NextResponse.json({ error: "No available player data found" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Oracle not configured" }, { status: 500 });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(draftAdvisorRequest(prompt)),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error (draft-advisor):", errText);
      return NextResponse.json({ error: "Oracle is silent — try again" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const advice: string = readDraftAdvisorReply(resData);
    if (!advice) return NextResponse.json({ error: "Oracle returned no advice" }, { status: 500 });

    return NextResponse.json({ advice, round: currentRound });
  } catch (err) {
    console.error("Draft advisor error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
