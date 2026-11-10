import { checkRateLimit } from "@/lib/rate-limit";
import { buildChatSystemPrompt, chatRequest } from "@/lib/ai-prompts/chat";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ── League Assistant Chat ─────────────────────────────────────────────────────
// POST { league_id, messages: [{role, content}] }
// Returns streaming text (text/event-stream)

export async function POST(req: NextRequest) {
  try {
    const { league_id: leagueId, messages } = await req.json();
    if (!leagueId || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Missing league_id or messages" }, { status: 400 });
    }
    // Bound message sizes — rate limiting caps request COUNT, but a single
    // oversized message could still run up Anthropic spend.
    const totalChars = messages.reduce(
      (s: number, m: { content?: unknown }) => s + (typeof m?.content === "string" ? m.content.length : 0), 0);
    if (totalChars > 8000 || messages.some((m: { content?: unknown }) => typeof m?.content === "string" && m.content.length > 2000)) {
      return NextResponse.json({ error: "Message too long — keep it under 2000 characters." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: me } = await supabase
      .from("league_members")
      .select("id, team_name, faction")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const rl = await checkRateLimit(`${user.id}:chat`, 10);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

    // ── Gather league context ─────────────────────────────────────────────────
    // Only columns that exist (audit A3-02): records come from uff_matchups through
    // getRecord like every other page, the transaction feed from uff_roster_players,
    // and the rulebook's draft powers from the draft_powers table (audit A3-03).
    const [
      { data: league },
      { data: members },
      { data: matchupRows },
      { data: rosterRows },
      { data: powerRows },
    ] = await Promise.all([
      supabase
        .from("uff_leagues")
        .select("name, waiver_type, median_scoring, commissioner_id")
        .eq("id", leagueId)
        .maybeSingle(),
      supabase
        .from("league_members")
        .select("id, team_name, faction, waiver_priority")
        .eq("league_id", leagueId),
      supabase
        .from("uff_matchups")
        .select("matchup_id, member_id, week, points, is_complete")
        .eq("league_id", leagueId)
        .order("week", { ascending: false }),
      supabase
        .from("uff_roster_players")
        .select("member_id, player_id, added_at, dropped_at, week_added, players(full_name)")
        .eq("league_id", leagueId)
        .order("added_at", { ascending: false })
        .limit(60),
      supabase
        .from("draft_powers")
        .select("name, category, description")
        .order("id"),
    ]);

    // The system prompt (standings, recent matchups, transactions, rulebook) is built in
    // @/lib/ai-prompts/chat from exactly these rows.
    const systemPrompt = buildChatSystemPrompt({
      week: getCurrentNFLWeek(),
      league,
      me,
      members,
      matchupRows,
      rosterRows,
      powerRows,
    });

    // ── Call Anthropic (streaming) ────────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "AI unavailable" }, { status: 500 });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(chatRequest(systemPrompt, messages)),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      console.error("[chat] Anthropic error:", err);
      return NextResponse.json({ error: "AI error" }, { status: 502 });
    }

    // Forward the SSE stream directly
    return new NextResponse(anthropicRes.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("[chat] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
