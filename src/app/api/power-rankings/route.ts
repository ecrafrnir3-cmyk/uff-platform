import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentNFLWeek } from "@/lib/nfl-utils";

interface MatchupRow {
  matchup_id: number;
  member_id: string;
  week: number;
  points: number;
  is_complete: boolean;
  void_result: boolean;
  league_members: { team_name: string; faction: "hero" | "villain" | null } | null;
}

export async function POST(req: NextRequest) {
  try {
    const { league_id } = await req.json();
    if (!league_id) return NextResponse.json({ error: "Missing league_id" }, { status: 400 });

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

    // Fetch all completed matchup rows with faction data
    const { data: allRows } = await supabase
      .from("uff_matchups")
      .select("matchup_id, member_id, week, points, is_complete, void_result, league_members(team_name, faction)")
      .eq("league_id", league_id)
      .eq("is_complete", true)
      .order("week", { ascending: true })
      .returns<MatchupRow[]>();

    const rows = allRows ?? [];
    if (rows.length < 2) {
      return NextResponse.json({ error: "Not enough game data yet to generate power rankings" }, { status: 400 });
    }

    // ── Build full standings ──────────────────────────────────────────────────
    const memberData: Record<string, {
      name: string;
      faction: string;
      wins: number;
      losses: number;
      ties: number;
      pf: number;
      pa: number;
      weeklyPts: Record<number, number>; // week → pts
    }> = {};

    // Initialize members from all rows
    for (const r of rows) {
      if (!memberData[r.member_id]) {
        memberData[r.member_id] = {
          name: r.league_members?.team_name ?? r.member_id,
          faction: r.league_members?.faction ?? "unknown",
          wins: 0, losses: 0, ties: 0, pf: 0, pa: 0,
          weeklyPts: {},
        };
      }
      memberData[r.member_id].pf += r.points;
      memberData[r.member_id].weeklyPts[r.week] = r.points;
    }

    // W/L from pairs
    const byMatchup: Record<number, MatchupRow[]> = {};
    for (const r of rows) {
      if (!byMatchup[r.matchup_id]) byMatchup[r.matchup_id] = [];
      byMatchup[r.matchup_id].push(r);
    }

    for (const pair of Object.values(byMatchup)) {
      if (pair.length < 2) continue;
      const [a, b] = pair;
      memberData[a.member_id].pa += b.points;
      memberData[b.member_id].pa += a.points;

      if (a.points > b.points) {
        memberData[a.member_id].wins++;
        if (!b.void_result) memberData[b.member_id].losses++;
      } else if (b.points > a.points) {
        memberData[b.member_id].wins++;
        if (!a.void_result) memberData[a.member_id].losses++;
      } else {
        memberData[a.member_id].ties++;
        memberData[b.member_id].ties++;
      }
    }

    // ── Sort by standings (W then PF) ────────────────────────────────────────
    const sorted = Object.entries(memberData)
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => b.wins - a.wins || b.pf - a.pf);

    // ── Recent form: last 3 weeks ─────────────────────────────────────────────
    const currentWeek = getCurrentNFLWeek();
    // Find last 3 weeks that have actual completed games
    const allWeeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => b - a);
    const recentWeeks = allWeeks.slice(0, 3).reverse(); // e.g. [5, 6, 7]

    // ── Build prompt ─────────────────────────────────────────────────────────
    const teamLines = sorted.map((t, i) => {
      const recentStr = recentWeeks.length > 0
        ? recentWeeks.map((w) => `Wk${w}: ${(t.weeklyPts[w] ?? 0).toFixed(1)}`).join(", ")
        : "No recent data";
      const record = `${t.wins}W-${t.losses}L${t.ties > 0 ? `-${t.ties}T` : ""}`;
      return `${i + 1}. ${t.name} [${t.faction}] — ${record} | ${t.pf.toFixed(1)} PF | Recent: ${recentStr}`;
    });

    const prompt = `You are the Oracle of Ultimate Fantasy Football — an opinionated power ranker who cuts through W/L records to reveal true team strength.

Week ${currentWeek} Power Rankings — ${sorted.length} teams

CURRENT STANDINGS (listed W/L order, NOT true power order):
${teamLines.join("\n")}

Re-rank ALL ${sorted.length} teams by TRUE POWER. Consider:
- Points scored volume (a 5-2 team at 650 PF is weaker than a 5-2 team at 850 PF)
- Recent momentum (are they rising or falling in the last 3 weeks?)
- Whether their record reflects genuine dominance or scheduling luck
- Faction warfare (Heroes vs Villains — which side is stronger?)

Respond with ONLY the ranked list. For each team, write their rank, name, record, and exactly 2 sentences (1 = why they rank here, 1 = what to watch). Format exactly as:
#1. [Team Name] ([W-L]) — [2 sentences of analysis.]
#2. [Team Name] ([W-L]) — [2 sentences of analysis.]
...continue for all ${sorted.length} teams.

No intro text, no outro text. Just the numbered rankings.`;

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
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error (power-rankings):", errText);
      return NextResponse.json({ error: "Oracle is silent — try again shortly" }, { status: 502 });
    }

    const resData = await anthropicRes.json();
    const rankings: string = resData.content?.[0]?.text ?? "";
    if (!rankings) return NextResponse.json({ error: "Oracle returned no rankings" }, { status: 500 });

    return NextResponse.json({ rankings, week: currentWeek });
  } catch (err) {
    console.error("Power rankings error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
