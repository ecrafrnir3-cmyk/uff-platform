import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRecord, CompletedMatchupRow } from "@/lib/get-record";

const TOKEN_INFO: Record<number, { name: string; effect: string }> = {
  1:  { name: "Power Surge",      effect: "+2.0 flat points added to your score this week." },
  2:  { name: "Triple Threat",    effect: "Your kicker's points are tripled this week." },
  3:  { name: "Bench Vault",      effect: "Your highest-scoring bench player's points are added to your score on top of starters." },
  4:  { name: "Mulligan",         effect: "After games, your worst underperforming starter is retroactively swapped with the best eligible bench player who outscored them." },
  5:  { name: "Mirror Match",     effect: "Your score gains a bonus equal to the total extra points your opponent's draft powers generated for them this week." },
  6:  { name: "Faction Surge",    effect: "Your Faction Roster Bonus is doubled this week (1.0 pts/player instead of 0.5)." },
  7:  { name: "Position Power",   effect: "Choose a position — your top-scoring starter at that position gets a 1.5x boost this week." },
  8:  { name: "Fortress",         effect: "Your D/ST score is doubled this week." },
  9:  { name: "Recon",            effect: "Reveals your opponent's weekly token selection before the normal lock-and-reveal." },
  10: { name: "Air Raid",         effect: "+1 extra point per passing TD for your QB(s) this week." },
  11: { name: "Insurance",        effect: "If you lose this week, the loss doesn't count toward your record — logged as a no contest." },
  12: { name: "Last Stand",       effect: "If you trail by 20+ points after all players lock, all your bench points are retroactively added to your score." },
  13: { name: "Quick Feet",       effect: "You may make one late injury swap after games start this week." },
  14: { name: "Momentum",         effect: "If you're on a 2+ game win streak, +1.5 pts added to your score this week." },
  15: { name: "Underdog",         effect: "If you lose this week, +3 pts is added to your score as a consolation bonus (does not flip the result)." },
  16: { name: "Iron Will",        effect: "Your starter with the lowest pre-game projection this week gets 2x their actual points." },
  17: { name: "Clutch Gene",      effect: "If your matchup is within 5 pts, your score is rounded up by 1 full point." },
  18: { name: "Second Wind",      effect: "Reuse any one weekly token you've already used earlier this season." },
};

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

    const { wins, losses } = getRecord(me.id, allMatchups ?? []);

    // Fetch this week's matchup for opponent context
    const { data: myMatchupRow } = await supabase
      .from("uff_matchups")
      .select("matchup_id, projected")
      .eq("league_id", league_id)
      .eq("member_id", me.id)
      .eq("week", week)
      .maybeSingle();

    let oppProjected: number | null = null;
    let oppTeamName: string | null = null;
    let oppFaction: string | null = null;
    let myProjected: number | null = myMatchupRow?.projected ?? null;

    if (myMatchupRow) {
      const { data: oppRow } = await supabase
        .from("uff_matchups")
        .select("projected, league_members(team_name, faction)")
        .eq("league_id", league_id)
        .eq("matchup_id", myMatchupRow.matchup_id)
        .eq("week", week)
        .neq("member_id", me.id)
        .maybeSingle();

      if (oppRow) {
        oppProjected = oppRow.projected ?? null;
        const lm = oppRow.league_members as unknown as { team_name: string; faction: string } | null;
        oppTeamName = lm?.team_name ?? null;
        oppFaction = lm?.faction ?? null;
      }
    }

    // Fetch active roster for position context (token 7 Position Power needs this)
    const { data: rosterRaw } = await supabase
      .from("uff_roster_players")
      .select("player_id, players(full_name, position)")
      .eq("member_id", me.id)
      .eq("slot", "active")
      .is("dropped_at", null);

    type RosterRaw = { player_id: string; players: { full_name: string; position: string | null } | null };
    const roster = (rosterRaw ?? []) as unknown as RosterRaw[];

    const positionGroups: Record<string, string[]> = {};
    for (const r of roster) {
      const pos = r.players?.position?.toUpperCase() ?? "?";
      if (!positionGroups[pos]) positionGroups[pos] = [];
      positionGroups[pos].push(r.players?.full_name ?? r.player_id);
    }
    const rosterStr = Object.entries(positionGroups)
      .map(([pos, names]) => `${pos}: ${names.join(", ")}`)
      .join(" | ");

    // Build win/loss streak context
    const streakNote = wins > losses
      ? `on a ${wins}W-${losses}L run and in a strong position`
      : losses > wins
      ? `struggling at ${wins}W-${losses}L and needing a win`
      : `at .500 (${wins}W-${losses}L)`;

    const matchupCtx = myMatchupRow
      ? `This week: ${me.team_name} (proj ${(myProjected ?? 0).toFixed(1)} pts) vs ${oppTeamName ?? "opponent"} [${oppFaction ?? "?"}]${oppProjected != null ? ` (proj ${oppProjected.toFixed(1)} pts)` : ""}. ${myProjected != null && oppProjected != null ? `You are ${myProjected > oppProjected ? `projected to WIN by ${(myProjected - oppProjected).toFixed(1)} pts` : `projected to LOSE by ${(oppProjected - myProjected).toFixed(1)} pts`}.` : ""}`
      : "This week's matchup projections are not yet available.";

    const prompt = `You are the Oracle of Ultimate Fantasy Football — an expert strategist who advises managers on weekly power tokens.

Manager: ${me.team_name} [${me.faction ?? "unassigned"}] — ${streakNote} this season.
${matchupCtx}
Active roster: ${rosterStr || "not yet available"}

This week's token: ${tokenInfo.name}
Effect: ${tokenInfo.effect}

Give concise, actionable advice in 3-4 sentences. Should they use it this week or hold it? If their token requires a choice (e.g., Position Power — pick a position), recommend the optimal choice based on their roster. Factor in the matchup projection and record context. Be specific and tactical.`;

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
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error (token-advisor):", errText);
      return NextResponse.json({ error: "Oracle is silent — try again shortly" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const advice: string = resData.content?.[0]?.text ?? "";
    if (!advice) return NextResponse.json({ error: "Oracle returned no guidance" }, { status: 500 });

    return NextResponse.json({ advice });
  } catch (err) {
    console.error("Token advisor error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
