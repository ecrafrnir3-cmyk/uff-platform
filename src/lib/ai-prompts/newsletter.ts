// Prompt, request, reply reading and the store-or-refuse checks for the weekly newsletter
// (/api/cron/generate-newsletter), moved verbatim out of the route on 2026-11-10 so the model
// evaluation in tools/qa builds exactly what the cron sends and applies its exact acceptance rule
// without ever calling the cron (it emails the league). The route gathers the rows and calls
// these; tools/qa/check-parity.mjs proves the two agree byte for byte.
// Pure: no database, no network, no clock.
import { TOKEN_NAMES } from "@/lib/token-names";

export interface NewsletterMatchupRow {
  matchup_id: number;
  member_id: string;
  points: number;
  token_bonus: number;
  is_complete: boolean;
  league_members: { team_name: string; faction: "hero" | "villain" | null } | null;
}

export interface NewsletterTokenRow {
  member_id: string;
  token_id: number;
  status: string;
}

export function buildStandings(
  allRows: NewsletterMatchupRow[],
  memberNames: Record<string, string>,
): { name: string; wins: number; losses: number; pf: number }[] {
  const stats: Record<string, { wins: number; losses: number; pf: number }> = {};

  // Group by matchup to determine W/L
  const byMatchup: Record<number, NewsletterMatchupRow[]> = {};
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

export interface NewsletterPromptInputs {
  league: { id: string; name: string };
  week: number;
  weekMatchups: NewsletterMatchupRow[];
  allCompleted: NewsletterMatchupRow[];
  tokenRows: NewsletterTokenRow[] | null;
}

export function buildNewsletterPrompt({ league, week, weekMatchups, allCompleted, tokenRows }: NewsletterPromptInputs): string {
  // Build member name map
  const memberNames: Record<string, string> = {};
  for (const r of allCompleted) {
    memberNames[r.member_id] = r.league_members?.team_name ?? r.member_id;
  }

  const tokenMap: Record<string, number | null> = {};
  for (const t of (tokenRows ?? [])) tokenMap[t.member_id] = t.token_id;

  // 4. Group this week's matchups into pairs and format
  const byMatchup: Record<number, NewsletterMatchupRow[]> = {};
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

  return prompt;
}

export function newsletterRequest(prompt: string) {
  return {
      model: "claude-haiku-4-5-20251001",
      // 700 was the ceiling until 2026-09-30, against a prompt that asks for "under
      // 450 words" (~600 tokens) — about 40 characters of margin. Week 1 landed at
      // 2,768 chars and week 2 at 2,759; both were near-misses, not successes. Week 3
      // ran to 2,811 and was cut mid-sentence ("...it asks"), stored and emailed to
      // the league that way. The target stays 450 words so the model does not simply
      // expand to fill; this is headroom, not a longer newsletter.
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readNewsletterReply(resData: any): string {
  return resData.content?.[0]?.text ?? "";
}

// Why a reply must NOT be stored (the route throws this message), or null when it may be stored.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function newsletterProblem(resData: any, content: string): string | null {
  if (!content) return "Anthropic returned empty content";

  // A newsletter that stops mid-sentence must never reach the table or the league.
  // Two independent checks, because either alone can miss:
  //   1. stop_reason — the API says plainly when it ran out of room. This is the
  //      authoritative signal and it was being discarded.
  //   2. terminal punctuation — catches a truncation that stop_reason does not
  //      explain (a refusal, a trailing partial word, a mangled response).
  // Throwing here is deliberate: the caller records the league as failed and the
  // NEXT run retries. A missing newsletter is recoverable; a published half
  // sentence is not (it is already in fourteen inboxes).
  if (resData.stop_reason === "max_tokens") {
    return (
      `Newsletter was cut off by max_tokens (${content.length} chars). Raise max_tokens or shorten the prompt target.`
    );
  }
  if (!/[.!?"'’”]\s*$/.test(content)) {
    return (
      `Newsletter does not end in terminal punctuation (stop_reason=${resData.stop_reason}); refusing to store a truncated newsletter. Tail: ${JSON.stringify(content.slice(-60))}`
    );
  }
  return null;
}
