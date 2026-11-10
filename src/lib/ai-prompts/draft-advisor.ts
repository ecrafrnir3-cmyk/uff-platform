// Prompt, request and reply reading for /api/draft-advisor, moved verbatim out of the route on
// 2026-11-10 so the model evaluation in tools/qa builds exactly what the route sends. The route
// gathers the rows and calls these; tools/qa/check-parity.mjs proves the two agree byte for byte.
// Pure: no database, no network, no clock.
import { MODEL_HAIKU, OUTPUT_LOW, replyText } from "@/lib/ai-prompts/anthropic";

// AFC and NFC team lookup for faction-alignment advice
const AFC_TEAMS = new Set([
  "BAL","CIN","CLE","PIT",        // AFC North
  "BUF","MIA","NE","NYJ",         // AFC East
  "HOU","IND","JAC","TEN",        // AFC South
  "DEN","KC","LV","LAC",          // AFC West
]);

function conference(team: string | null): string {
  if (!team) return "?";
  return AFC_TEAMS.has(team.toUpperCase()) ? "AFC" : "NFC";
}

export interface DraftPlayerRow {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  adp: number | null;
}

export interface DraftPickRow {
  member_id: string;
  player_id: string;
  round: number;
  pick_no: number;
  players: { full_name: string; position: string | null; team: string | null } | null;
}

export interface DraftAdvisorInputs {
  me: { id: string; team_name: string; faction: string | null };
  league: { max_teams: number; draft_rounds: number };
  allPicks: DraftPickRow[] | null;
  allPlayers: DraftPlayerRow[] | null;
}

// Returns the prompt with the round it was built for and the available list the route checks.
export function buildDraftAdvisorPrompt({ me, league, allPicks, allPlayers }: DraftAdvisorInputs): { prompt: string; currentRound: number; available: DraftPlayerRow[] } {
    const picks = allPicks ?? [];
    const pickedIds = new Set(picks.map((p) => p.player_id));
    const myPicks = picks.filter((p) => p.member_id === me.id);
    const totalPicksSoFar = picks.length;
    const currentRound = Math.ceil((totalPicksSoFar + 1) / league.max_teams);

    // Build my current roster grouped by position
    const rosterByPos: Record<string, string[]> = {};
    for (const pick of myPicks) {
      const pos = pick.players?.position ?? "UNK";
      if (!rosterByPos[pos]) rosterByPos[pos] = [];
      const conf = conference(pick.players?.team ?? null);
      rosterByPos[pos].push(`${pick.players?.full_name ?? "?"}  (${pick.players?.team ?? "?"}, ${conf})`);
    }

    const rosterStr = Object.entries(rosterByPos)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pos, names]) => `  ${pos}: ${names.join(", ")}`)
      .join("\n") || "  (no picks yet)";

    const available = (allPlayers ?? [])
      .filter((p) => !pickedIds.has(p.id))
      .slice(0, 30);

    const availableStr = available.map((p, i) => {
      const conf = conference(p.team);
      const factionMatch = (me.faction === "hero" && conf === "AFC") || (me.faction === "villain" && conf === "NFC");
      const tag = factionMatch ? " ⚡FACTION" : "";
      return `${i + 1}. ${p.full_name} — ${p.position ?? "?"} — ${p.team ?? "FA"} (${conf})${tag}`;
    }).join("\n");

    const factionDesc = me.faction === "hero"
      ? "Hero (AFC) — gets bonus points from AFC players"
      : me.faction === "villain"
      ? "Villain (NFC) — gets bonus points from NFC players"
      : "No faction assigned";

    const picksLeft = (league.draft_rounds * league.max_teams) - totalPicksSoFar;

    const prompt = `You are the Oracle Draft Advisor for Ultimate Fantasy Football.

Team: ${me.team_name} — ${factionDesc}
Current round: ${currentRound} of ${league.draft_rounds}
Total picks remaining in draft: ${picksLeft}

My current roster:
${rosterStr}

Top 30 available players (by ADP — ⚡FACTION = matches my faction bonus):
${availableStr}

Give concise draft advice (2-3 sentences): consider position scarcity (TE/QB dry up fast in later rounds), roster balance needs, and faction-alignment value (⚡FACTION players score bonus points for me). Then state:
PICK: [Full Player Name] ([POS], [TEAM])

No intro, just advice + PICK line.`;

    return { prompt, currentRound, available };
}

// Haiku 5.5 at effort low: 9/10 passed FACT (Haiku 4.5: 6/10), every PICK line parsed. Longest reply 524
// tokens, so the cap is 1,100.
export function draftAdvisorRequest(prompt: string) {
  return {
        model: MODEL_HAIKU,
        max_tokens: 1100,
        messages: [{ role: "user", content: prompt }],
        output_config: OUTPUT_LOW,
      };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readDraftAdvisorReply(resData: any): string {
  return replyText(resData);
}
