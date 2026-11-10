// Prompt, request and reply reading for /api/waiver-intel, moved verbatim out of the route on
// 2026-11-10 so the model evaluation in tools/qa builds exactly what the route sends. The route
// gathers the rows and calls these; tools/qa/check-parity.mjs proves the two agree byte for byte.
// Pure: no database, no network, no clock.
import { MODEL_HAIKU, OUTPUT_LOW, replyText } from "@/lib/ai-prompts/anthropic";

export interface WaiverRosterRow {
  players: { full_name: string; position: string | null } | null;
}

export interface WaiverPlayerRow {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  status: string | null;
}

export function buildWaiverIntelPrompt(player: WaiverPlayerRow, rosterRaw: WaiverRosterRow[] | null): string {
    const rosterPlayers = (rosterRaw ?? []).map((r) => r.players).filter(Boolean);

    // Summarize roster by position
    const byPos: Record<string, string[]> = {};
    for (const rp of rosterPlayers) {
      if (!rp) continue;
      const pos = rp.position ?? "UNK";
      if (!byPos[pos]) byPos[pos] = [];
      byPos[pos].push(rp.full_name);
    }
    const rosterStr = Object.entries(byPos)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pos, names]) => `${pos}: ${names.join(", ")}`)
      .join(" | ") || "empty roster";

    const statusStr = player.status && player.status !== "Active"
      ? ` — ⚠️ ${player.status}`
      : "";

    const prompt = `Fantasy football analyst. Give exactly 1-2 sentences on whether to add this waiver wire player.

Target: ${player.full_name} (${player.position ?? "?"}, ${player.team ?? "FA"})${statusStr}
My roster: ${rosterStr}

Is this player worth adding given my roster needs? Be direct and specific. 1-2 sentences only.`;

    return prompt;
}

// Haiku 5.5 at effort low: 9/10 passed FACT (Haiku 4.5: 8/10). Longest reply 450 tokens, so the cap is 900.
export function waiverIntelRequest(prompt: string) {
  return {
        model: MODEL_HAIKU,
        max_tokens: 900,
        messages: [{ role: "user", content: prompt }],
        output_config: OUTPUT_LOW,
      };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readWaiverIntelReply(resData: any): string {
  return replyText(resData).trim();
}
