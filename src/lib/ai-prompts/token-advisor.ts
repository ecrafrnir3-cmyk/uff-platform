// Token table, prompt, request and reply reading for /api/token-advisor, moved verbatim out of the
// route on 2026-11-10 so the model evaluation in tools/qa builds exactly what the route sends. The
// route gathers the rows and calls these; tools/qa/check-parity.mjs proves the two agree byte for
// byte. Pure: no database, no network, no clock.
import { getRecord, type CompletedMatchupRow } from "@/lib/get-record";
import { MODEL_HAIKU, OUTPUT_LOW, replyText } from "@/lib/ai-prompts/anthropic";

export const TOKEN_INFO: Record<number, { name: string; effect: string }> = {
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

export interface TokenAdvisorInputs {
  me: { id: string; team_name: string; faction: string | null };
  tokenInfo: { name: string; effect: string };
  allMatchups: CompletedMatchupRow[] | null;
  myMatchupRow: { matchup_id: number; projected: number | null } | null;
  // The opponent's row; null when there is no matchup row this week or no opponent row.
  oppRow: { projected: number | null; league_members: unknown } | null;
  rosterRaw: unknown[] | null;
}

export function buildTokenAdvisorPrompt({ me, tokenInfo, allMatchups, myMatchupRow, oppRow, rosterRaw }: TokenAdvisorInputs): string {
    const { wins, losses } = getRecord(me.id, allMatchups ?? []);

    let oppProjected: number | null = null;
    let oppTeamName: string | null = null;
    let oppFaction: string | null = null;
    const myProjected: number | null = myMatchupRow?.projected ?? null;

    if (myMatchupRow) {
      if (oppRow) {
        oppProjected = oppRow.projected ?? null;
        const lm = oppRow.league_members as unknown as { team_name: string; faction: string } | null;
        oppTeamName = lm?.team_name ?? null;
        oppFaction = lm?.faction ?? null;
      }
    }

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

    return prompt;
}

// Haiku 5.5 at effort low: 10/12 passed FACT (Haiku 4.5: 7/12, Sonnet 5.5: 7/12). Longest reply 734
// tokens, so the cap is 1,500.
export function tokenAdvisorRequest(prompt: string) {
  return {
        model: MODEL_HAIKU,
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
        output_config: OUTPUT_LOW,
      };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readTokenAdvisorReply(resData: any): string {
  return replyText(resData);
}
