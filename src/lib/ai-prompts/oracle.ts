// Prompt, request and reply reading for /api/oracle (the post-game recap), moved verbatim out of
// the route on 2026-11-10 so the model evaluation in tools/qa builds exactly what the route sends.
// The route gathers the rows and calls these; tools/qa/check-parity.mjs proves the two agree.
// Pure: no database, no network, no clock.
import { TOKEN_NAMES } from "@/lib/token-names";
import { MODEL_HAIKU, OUTPUT_LOW, replyText } from "@/lib/ai-prompts/anthropic";

export interface OracleMatchupRow {
  id: string;
  member_id: string;
  week: number;
  points: number;
  token_bonus: number;
  is_complete: boolean;
  oracle_recap: string | null;
  league_members: { team_name: string; faction: string | null } | null;
}

export interface OracleTokenRow {
  member_id: string;
  token_id: number;
  status: string;
}

export function buildOraclePrompt(rows: OracleMatchupRow[], tokenRows: OracleTokenRow[] | null): string {
    const [a, b] = rows;
    const week = a.week;

    const tokenMap: Record<string, { token_id: number; status: string }> = {};
    for (const t of tokenRows ?? []) {
      tokenMap[t.member_id] = { token_id: t.token_id, status: t.status };
    }

    // Build prompt context
    const aWins = a.points > b.points;
    const winner = aWins ? a : b;

    const formatTeam = (row: OracleMatchupRow) => {
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

    return prompt;
}

// Haiku 5.5 at effort low: 12/12 passed FACT and voice (Haiku 4.5: 7/12). Longest reply 468 tokens, so the
// cap is 1,000. The recap is stored for good, so a cut-off reply must never get through: hence the headroom.
export function oracleRequest(prompt: string) {
  return {
        model: MODEL_HAIKU,
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
        output_config: OUTPUT_LOW,
      };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readOracleReply(anthropicData: any): string {
  return replyText(anthropicData);
}
