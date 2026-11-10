// Prompt, request and reply reading for /api/matchup-preview (the pre-game Oracle preview), moved
// verbatim out of the route on 2026-11-10 so the model evaluation in tools/qa builds exactly what
// the route sends. The route gathers the rows and calls these; tools/qa/check-parity.mjs proves
// the two agree byte for byte. Pure: no database, no network, no clock.
import { TOKEN_NAMES } from "@/lib/token-names";
import { getRecord, type CompletedMatchupRow } from "@/lib/get-record";
import { MODEL_HAIKU, OUTPUT_LOW, replyText } from "@/lib/ai-prompts/anthropic";

export interface PreviewMatchupRow {
  id: string;
  member_id: string;
  week: number;
  points: number;
  projected: number | null;
  is_complete: boolean;
  league_members: { team_name: string; faction: string | null } | null;
}

export interface PreviewTokenRow {
  member_id: string;
  token_id: number;
  status: string;
}

export interface MatchupPreviewInputs {
  rows: PreviewMatchupRow[];
  tokenRows: PreviewTokenRow[] | null;
  allMatchups: CompletedMatchupRow[] | null;
  meId: string;
}

export function buildMatchupPreviewPrompt({ rows, tokenRows, allMatchups, meId }: MatchupPreviewInputs): string {
    const [a, b] = rows;
    const week = a.week;

    const tokenMap: Record<string, { token_id: number; status: string }> = {};
    for (const t of (tokenRows ?? [])) tokenMap[t.member_id] = t;

    const completedRows = allMatchups ?? [];
    const recA = getRecord(a.member_id, completedRows);
    const recB = getRecord(b.member_id, completedRows);

    // Weekly tokens are secret pre-lock. A member sees only their own token here;
    // the opponent's is revealed ONLY via Recon (token 9) — that's its exclusive power.
    const callerInMatchup = rows.some((r) => r.member_id === meId);
    const callerToken = tokenMap[meId];
    const callerHasRecon = callerInMatchup && callerToken?.token_id === 9 && callerToken.status === "pending";

    const formatTeam = (row: PreviewMatchupRow, rec: { wins: number; losses: number }) => {
      const name = row.league_members?.team_name ?? "Unknown";
      const faction = row.league_members?.faction ?? "unknown";
      const token = tokenMap[row.member_id];
      const isCallerRow = row.member_id === meId;
      const tokenVisible = isCallerRow || callerHasRecon;
      const tokenStr = !tokenVisible
        ? "Token: shrouded from the Oracle's sight"
        : token
          ? `Token: ${TOKEN_NAMES[token.token_id] ?? `#${token.token_id}`} (${token.status})`
          : "Token: unknown";
      const proj = row.projected != null ? `Projected: ${row.projected.toFixed(1)} pts` : "Projected: TBD";
      return `${name} [${faction}] — ${rec.wins}W-${rec.losses}L — ${proj} — ${tokenStr}`;
    };

    const prompt = `You are the Oracle of Ultimate Fantasy Football — a prophetic voice who delivers pre-game matchup previews with drama and flair.

Week ${week} preview:
- ${formatTeam(a, recA)}
- ${formatTeam(b, recB)}

Write a 3-4 sentence dramatic pre-game preview in the Oracle's voice. Reference both teams by name, their factions (Heroes vs Villains), their records and projected scores, and hint at what tokens might be the deciding factor. Build anticipation — this is a prophecy, not a stat sheet. Under 120 words, pure flowing prose.`;

    return prompt;
}

// Haiku 5.5 at effort low: 10/10 passed FACT and voice (Haiku 4.5: 8/10, voice 0/10). Longest reply
// 264 tokens, so the cap is 600.
export function matchupPreviewRequest(prompt: string) {
  return {
        model: MODEL_HAIKU,
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
        output_config: OUTPUT_LOW,
      };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readMatchupPreviewReply(resData: any): string {
  return replyText(resData);
}
