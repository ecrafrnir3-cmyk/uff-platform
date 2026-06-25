import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";

// ─── Called by GitHub Actions every Wednesday at 07:30 UTC ──────────────────
// Fires 30 minutes after finalize-week (07:00 UTC) to ensure all matchups
// are marked complete and all records are settled before newsletter generation.

const TOKEN_NAMES: Record<number, string> = {
  1: "Power Surge", 2: "Triple Threat", 3: "Bench Vault", 4: "Mulligan",
  5: "Mirror Match", 6: "Faction Surge", 7: "Position Power", 8: "Fortress",
  9: "Recon", 10: "Air Raid", 11: "Insurance", 12: "Last Stand",
  13: "Quick Feet", 14: "Momentum", 15: "Underdog", 16: "Iron Will",
  17: "Clutch Gene", 18: "Second Wind",
};

interface LeagueRow { id: string; name: string; }

interface MatchupDbRow {
  matchup_id: number;
  member_id: string;
  points: number;
  token_bonus: number;
  is_complete: boolean;
  league_members: { team_name: string; faction: "hero" | "villain" | null } | null;
}

interface TokenRow {
  member_id: string;
  token_id: number;
  status: string;
}

interface SupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildStandings(
  allRows: MatchupDbRow[],
  memberNames: Record<string, string>,
): { name: string; wins: number; losses: number; pf: number }[] {
  const stats: Record<string, { wins: number; losses: number; pf: number }> = {};

  // Group by matchup to determine W/L
  const byMatchup: Record<number, MatchupDbRow[]> = {};
  for (const r of allRows) {
    if (!byMatchup[r.matchup_id]) byMatchup[r.matchup_id] = [];
    byMatchup[r.matchup_id].push(r);
  }

  for (const pair of Object.values(byMatchup)) {
    for (const r of pair) {
      if (!stats[r.member_id]) stats[r.member_id] = { wins: 0, losses: 0, pf: 0 };
      stats[r.member_id].pf += r.points;
    }
    if (pair.length === 2) {
      const [a, b] = pair;
      if (!stats[a.member_id]) stats[a.member_id] = { wins: 0, losses: 0, pf: 0 };
      if (!stats[b.member_id]) stats[b.member_id] = { wins: 0, losses: 0, pf: 0 };
      if (a.points > b.points) { stats[a.member_id].wins++; stats[b.member_id].losses++; }
      else if (b.points > a.points) { stats[b.member_id].wins++; stats[a.member_id].losses++; }
    }
  }

  return Object.entries(stats)
    .map(([id, s]) => ({ name: memberNames[id] ?? id, ...s }))
    .sort((a, b) => b.wins - a.wins || b.pf - a.pf);
}

async function generateLeagueNewsletter(
  supabase: SupabaseClient,
  league: LeagueRow,
  week: number,
): Promise<string> {
  // 1. Fetch this week's matchup rows (must be complete)
  const { data: weekRows } = await supabase
    .from("uff_matchups")
    .select("matchup_id, member_id, points, token_bonus, is_complete, league_members(team_name, faction)")
    .eq("league_id", league.id)
    .eq("week", week)
    .returns<MatchupDbRow[]>();

  const weekMatchups = (weekRows ?? []) as MatchupDbRow[];

  // Only generate if at least one complete matchup exists
  const hasComplete = weekMatchups.some((r) => r.is_complete);
  if (!hasComplete || weekMatchups.length < 2) {
    throw new Error(`No complete matchups found for league ${league.id} week ${week}`);
  }

  // 2. Fetch all-time completed rows for standings
  const { data: allRows } = await supabase
    .from("uff_matchups")
    .select("matchup_id, member_id, points, token_bonus, is_complete, league_members(team_name, faction)")
    .eq("league_id", league.id)
    .eq("is_complete", true)
    .returns<MatchupDbRow[]>();

  const allCompleted = (allRows ?? []) as MatchupDbRow[];

  // Build member name map
  const memberNames: Record<string, string> = {};
  for (const r of allCompleted) {
    memberNames[r.member_id] = r.league_members?.team_name ?? r.member_id;
  }

  // 3. Fetch weekly tokens for all members
  const memberIds = [...new Set(weekMatchups.map((r) => r.member_id))];
  const { data: tokenRows } = await supabase
    .from("weekly_token_assignments")
    .select("member_id, token_id, status")
    .eq("league_id", league.id)
    .eq("week", week)
    .in("member_id", memberIds)
    .returns<TokenRow[]>();

  const tokenMap: Record<string, number | null> = {};
  for (const t of (tokenRows ?? [])) tokenMap[t.member_id] = t.token_id;

  // 4. Group this week's matchups into pairs and format
  const byMatchup: Record<number, MatchupDbRow[]> = {};
  for (const r of weekMatchups) {
    if (!byMatchup[r.matchup_id]) byMatchup[r.matchup_id] = [];
    byMatchup[r.matchup_id].push(r);
  }

  const matchupLines: string[] = [];
  let closestMargin = Infinity;
  let closestGame = "";
  let biggestMargin = 0;
  let biggestGame = "";
  let highScore = 0;
  let highScorer = "";

  for (const pair of Object.values(byMatchup)) {
    if (pair.length < 2) continue;
    const [a, b] = pair;
    const aName = a.league_members?.team_name ?? "Team A";
    const bName = b.league_members?.team_name ?? "Team B";
    const aFaction = a.league_members?.faction ?? "unknown";
    const bFaction = b.league_members?.faction ?? "unknown";
    const winner = a.points > b.points ? a : b;
    const loser = a.points > b.points ? b : a;
    const margin = Math.abs(a.points - b.points);
    const winnerName = winner.league_members?.team_name ?? "?";
    const loserName = loser.league_members?.team_name ?? "?";

    const aToken = tokenMap[a.member_id] ? TOKEN_NAMES[tokenMap[a.member_id]!] : null;
    const bToken = tokenMap[b.member_id] ? TOKEN_NAMES[tokenMap[b.member_id]!] : null;
    const tokenStr = [aToken ? `${aName}: ${aToken}` : null, bToken ? `${bName}: ${bToken}` : null]
      .filter(Boolean).join(" | ") || "no tokens";

    const bonusNote = (winner.token_bonus > 0 || loser.token_bonus > 0)
      ? ` (token bonuses: ${winnerName} +${winner.token_bonus.toFixed(2)}, ${loserName} +${loser.token_bonus.toFixed(2)})`
      : "";

    matchupLines.push(
      `${aName} [${aFaction}] ${a.points.toFixed(2)} vs ${bName} [${bFaction}] ${b.points.toFixed(2)} — WINNER: ${winnerName} by ${margin.toFixed(2)} pts${bonusNote} | Tokens: ${tokenStr}`,
    );

    if (margin < closestMargin) {
      closestMargin = margin;
      closestGame = `${winnerName} edged ${loserName} ${winner.points.toFixed(2)}-${loser.points.toFixed(2)} (${margin.toFixed(2)} pts)`;
    }
    if (margin > biggestMargin) {
      biggestMargin = margin;
      biggestGame = `${winnerName} crushed ${loserName} by ${margin.toFixed(2)} pts`;
    }
    if (a.points > highScore) { highScore = a.points; highScorer = aName; }
    if (b.points > highScore) { highScore = b.points; highScorer = bName; }
  }

  // 5. Compute faction war for this week
  let heroTotal = 0, villainTotal = 0;
  for (const r of weekMatchups) {
    if (r.league_members?.faction === "hero") heroTotal += r.points;
    else if (r.league_members?.faction === "villain") villainTotal += r.points;
  }
  const factionWinner = heroTotal > villainTotal ? "Heroes" : heroTotal < villainTotal ? "Villains" : "tied";
  const factionLine = `Heroes: ${heroTotal.toFixed(2)} pts | Villains: ${villainTotal.toFixed(2)} pts — ${factionWinner} won the faction war`;

  // 6. Standings (post-week)
  const standings = buildStandings(allCompleted, memberNames);
  const standingsStr = standings
    .slice(0, Math.min(standings.length, 8))
    .map((s, i) => `${i + 1}. ${s.name} (${s.wins}W-${s.losses}L, ${s.pf.toFixed(1)} PF)`)
    .join("\n");

  // 7. Build prompt
  const prompt = `You are the Oracle-Correspondent of Ultimate Fantasy Football — a charismatic sports journalist with dramatic flair who writes the weekly league newsletter after every week's final scores settle.

League: "${league.name}"
Week ${week} — All results are final.

WEEK ${week} MATCHUP RESULTS:
${matchupLines.join("\n")}

NOTABLE STATS:
- Closest game: ${closestGame}
- Biggest blowout: ${biggestGame}
- Week's high scorer: ${highScorer} (${highScore.toFixed(2)} pts)

FACTION WAR — WEEK ${week}:
${factionLine}

CURRENT STANDINGS:
${standingsStr}

Write a compelling 5-paragraph weekly newsletter for this league. Structure:
1. **Opening** — dramatic hook setting the tone for Week ${week} results
2. **Game of the Week** — spotlight the closest or most dramatic matchup with commentary
3. **Around the League** — brief, colorful takes on the other matchups
4. **Power Rankings** — comment on who's rising and falling in the standings, call out the leader
5. **Faction War + Closing** — who won the faction battle this week and a teaser for next week

Voice: bold, witty, dramatic — like a fantasy sports columnist who takes the Oracle persona seriously. Reference team names, factions (Heroes/Villains), tokens where relevant. Under 450 words. Pure prose — no headers, no bullet points, no markdown.`;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    throw new Error(`Anthropic API error: ${errText}`);
  }

  const resData = await anthropicRes.json();
  const content: string = resData.content?.[0]?.text ?? "";
  if (!content) throw new Error("Anthropic returned empty content");

  return content;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey      = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceKey || !apiKey) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  // Wednesday morning: current week has already advanced, so finalized week is currentWeek - 1
  const currentWeek = getCurrentNFLWeek();
  const week = Math.max(currentWeek - 1, 1);

  const supabase = createClient(supabaseUrl, serviceKey);

  // Fetch all leagues with completed drafts
  const { data: leagues, error: leagueErr } = await supabase
    .from("uff_leagues")
    .select("id, name")
    .eq("draft_status", "completed")
    .returns<LeagueRow[]>();

  if (leagueErr || !leagues) {
    console.error("Failed to fetch leagues:", leagueErr);
    return NextResponse.json({ error: "Failed to fetch leagues" }, { status: 500 });
  }

  if (leagues.length === 0) {
    return NextResponse.json({ ok: true, week, message: "No active leagues", results: [] });
  }

  const results: { league_id: string; name: string; ok: boolean; error?: string }[] = [];

  for (const league of leagues) {
    try {
      const content = await generateLeagueNewsletter(supabase, league, week);

      // Upsert — if newsletter already exists for this league+week, overwrite it
      const { error: upsertErr } = await supabase
        .from("league_newsletters")
        .upsert(
          { league_id: league.id, week, content, generated_at: new Date().toISOString() },
          { onConflict: "league_id,week" },
        );

      if (upsertErr) throw new Error(`Upsert failed: ${upsertErr.message}`);

      console.log(`Newsletter generated: ${league.name} week ${week}`);
      results.push({ league_id: league.id, name: league.name, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Newsletter failed for ${league.name}:`, msg);
      results.push({ league_id: league.id, name: league.name, ok: false, error: msg });
    }
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: allOk, week, results }, { status: allOk ? 200 : 207 });
}
