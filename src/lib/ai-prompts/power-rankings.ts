// Prompt, request and reply reading for /api/power-rankings, moved verbatim out of the route on
// 2026-11-10 so the model evaluation in tools/qa builds exactly what the route sends. The route
// gathers the rows and calls these; tools/qa/check-parity.mjs proves the two agree byte for byte.
// Pure: no database, no network, no clock (the week is passed in).
import { MODEL_SONNET, OUTPUT_LOW, replyText } from "@/lib/ai-prompts/anthropic";

export interface PowerRankingsMatchupRow {
  matchup_id: number;
  member_id: string;
  week: number;
  points: number;
  is_complete: boolean;
  void_result: boolean;
  league_members: { team_name: string; faction: "hero" | "villain" | null } | null;
}

export function buildPowerRankingsPrompt(rows: PowerRankingsMatchupRow[], currentWeek: number): string {
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
    const byMatchup: Record<number, PowerRankingsMatchupRow[]> = {};
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

    return prompt;
}

// Sonnet 5.5 at effort low: 6/8 passed FACT (Haiku 5.5: 1/8, misread ranks; Haiku 4.5: 0/8). At the old
// 600-token cap every reply was cut off and the card showed 8 to 13 of 14 teams. Longest reply 1,412
// tokens, so the cap is 2,900.
export function powerRankingsRequest(prompt: string) {
  return {
        model: MODEL_SONNET,
        max_tokens: 2900,
        messages: [{ role: "user", content: prompt }],
        output_config: OUTPUT_LOW,
      };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readPowerRankingsReply(resData: any): string {
  return replyText(resData);
}
