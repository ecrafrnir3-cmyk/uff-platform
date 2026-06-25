import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const TOKEN_NAMES: Record<number, string> = {
  1: "Power Surge", 2: "Triple Threat", 3: "Bench Vault", 4: "Mulligan",
  5: "Mirror Match", 6: "Faction Surge", 7: "Position Power", 8: "Fortress",
  9: "Recon", 10: "Air Raid", 11: "Insurance", 12: "Last Stand",
  13: "Quick Feet", 14: "Momentum", 15: "Underdog", 16: "Iron Will",
  17: "Clutch Gene", 18: "Second Wind",
};

interface MatchupDbRow {
  id: string;
  member_id: string;
  week: number;
  points: number;
  token_bonus: number;
  is_complete: boolean;
  oracle_recap: string | null;
  league_members: { team_name: string; faction: string | null } | null;
}

interface TokenRow {
  member_id: string;
  token_id: number;
  status: string;
}

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

    // Return cached recap if already generated
    if (rows[0].oracle_recap) {
      return NextResponse.json({ recap: rows[0].oracle_recap });
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

    const tokenMap: Record<string, { token_id: number; status: string }> = {};
    for (const t of tokenRows ?? []) {
      tokenMap[t.member_id] = { token_id: t.token_id, status: t.status };
    }

    // Build prompt context
    const aWins = a.points > b.points;
    const winner = aWins ? a : b;

    const formatTeam = (row: MatchupDbRow) => {
      const name = row.league_members?.team_name ?? "Unknown";
      const faction = row.league_members?.faction ?? "unknown";
      const token = tokenMap[row.member_id];
      const tokenStr = token
        ? ` | Token: ${TOKEN_NAMES[token.token_id] ?? `#${token.token_id}`} (${token.status})`
        : "";
      const bonusStr = row.token_bonus > 0 ? ` (+${row.token_bonus.toFixed(2)} token bonus)` : "";
      return `${name} [${faction}] — ${row.points.toFixed(2)} pts${bonusStr}${tokenStr}`;
    };

    const prompt = `You are the Oracle of Ultimate Fantasy Football — a mystical, dramatic voice that delivers weekly matchup recaps as if they were ancient prophecies. You speak with gravitas and flair, referencing factions (Heroes vs Villains), power tokens, and the eternal struggle for fantasy supremacy.

Week ${week} matchup:
- ${formatTeam(a)}
- ${formatTeam(b)}

Winner: ${winner.league_members?.team_name} (${(aWins ? a : b).points.toFixed(2)} pts)
Margin: ${Math.abs(a.points - b.points).toFixed(2)} pts

Write a 3-4 sentence dramatic recap of this matchup in the Oracle's voice. Reference the teams, factions, scores, and if relevant, tokens used. Be vivid and theatrical but stay under 120 words. No headers or bullet points — pure flowing prose.`;

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
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", errText);
      return NextResponse.json({ error: "Oracle is silent — try again shortly" }, { status: 502 });
    }

    const anthropicData = await anthropicRes.json();
    const recap: string = anthropicData.content?.[0]?.text ?? "";

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
