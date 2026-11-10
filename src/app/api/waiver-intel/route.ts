import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildWaiverIntelPrompt,
  readWaiverIntelReply,
  waiverIntelRequest,
  type WaiverPlayerRow as PlayerRow,
  type WaiverRosterRow as RosterRow,
} from "@/lib/ai-prompts/waiver-intel";

export async function POST(req: NextRequest) {
  try {
    const { league_id, player_id } = await req.json();
    if (!league_id || !player_id) {
      return NextResponse.json({ error: "Missing league_id or player_id" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Membership check
    const { data: me } = await supabase
      .from("league_members")
      .select("id")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const rl = await checkRateLimit(`${user.id}:waiver-intel`, 5);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

    // Fetch target player
    const { data: player } = await supabase
      .from("players")
      .select("id, full_name, position, team, status")
      .eq("id", player_id)
      .maybeSingle<PlayerRow>();

    if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404 });

    // Fetch my current active roster
    const { data: rosterRaw } = await supabase
      .from("uff_roster_players")
      .select("players(full_name, position)")
      .eq("member_id", me.id)
      .eq("slot", "active")
      .is("dropped_at", null)
      .returns<RosterRow[]>();

    // The roster summary and the prompt are built in @/lib/ai-prompts/waiver-intel.
    const prompt = buildWaiverIntelPrompt(player, rosterRaw);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Oracle not configured" }, { status: 500 });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(waiverIntelRequest(prompt)),
    });

    if (!anthropicRes.ok) {
      console.error("Anthropic error (waiver-intel):", await anthropicRes.text());
      return NextResponse.json({ error: "Oracle unavailable" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const intel: string = readWaiverIntelReply(resData);
    if (!intel) return NextResponse.json({ error: "No intel returned" }, { status: 500 });

    return NextResponse.json({ intel });
  } catch (err) {
    console.error("Waiver intel error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
