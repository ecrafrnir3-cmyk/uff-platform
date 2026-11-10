// Prompt, request and reply reading for /api/start-sit, moved verbatim out of the route on
// 2026-11-10 so the model evaluation in tools/qa builds exactly what the route sends. The route
// gathers the rows and calls these; tools/qa/check-parity.mjs proves the two agree byte for byte.
// Pure: no database, no network, no clock.

const FLAG_KEYS = new Set([
  "pts_allow_0","pts_allow_1_6","pts_allow_7_13","pts_allow_14_20",
  "pts_allow_21_27","pts_allow_28_34","pts_allow_35p",
]);

export interface StartSitRosterRow {
  player_id: string;
  slot: string;
  players: { full_name: string; position: string | null; team: string | null; injury_status: string | null } | null;
}

export function startSitActiveRoster(rosterRows: StartSitRosterRow[] | null): StartSitRosterRow[] {
  return (rosterRows ?? []).filter(r => r.slot === "active" && r.players?.position);
}

// Scores Sleeper's projected stat lines through the league's scoring settings, into projMap.
export function fillStartSitProjections(
  projMap: Record<string, number>,
  activeRoster: StartSitRosterRow[],
  allProj: Record<string, Record<string, number>>,
  scoringSettings: Record<string, number>,
): void {
  for (const r of activeRoster) {
    const stats = allProj[r.player_id] ?? {};
    let score = 0;
    for (const [key, mult] of Object.entries(scoringSettings)) {
      const val = stats[key];
      if (val == null || val === 0) continue;
      score += FLAG_KEYS.has(key) ? mult : val * mult;
    }
    projMap[r.player_id] = Math.round(score * 100) / 100;
  }
}

export interface StartSitPromptInputs {
  week: number;
  me: { team_name: string; faction: string | null };
  lineupSlots: unknown;
  activeRoster: StartSitRosterRow[];
  lineupRows: { player_id: string }[] | null;
  scheduleRows: { team: string }[] | null;
  projMap: Record<string, number>;
}

export function buildStartSitPrompt({ week, me, lineupSlots, activeRoster, lineupRows, scheduleRows, projMap }: StartSitPromptInputs): string {
    const startingPlayerIds = new Set((lineupRows ?? []).map((l: { player_id: string }) => l.player_id));

    // 🛑 The inverse failure matters more than the one being fixed: if the schedule has
    // NO rows for this week (a week not yet loaded by sync-projections, or the table
    // empty), then "absent from the schedule" is true of all 32 teams and EVERY player
    // would be reported on bye. Only trust the bye derivation when the week looks whole.
    const playingTeams = new Set((scheduleRows ?? []).map((g: { team: string }) => g.team));
    const byeDataUsable = playingTeams.size >= 20;
    const isOnBye = (team: string | null) =>
      byeDataUsable && !!team && !playingTeams.has(team);

    const slotsConfig: Record<string, number> =
      (lineupSlots as Record<string, number>) ?? { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };
    const slotSummary = Object.entries(slotsConfig)
      .map(([pos, n]) => `${n}x ${pos}`)
      .join(", ");

    // Group players by position for the prompt
    const byPos: Record<string, { name: string; team: string; injury: string | null; proj: number; isStarting: boolean; onBye: boolean; noTeam: boolean }[]> = {};
    for (const r of activeRoster) {
      const pos = r.players!.position!.toUpperCase();
      if (!byPos[pos]) byPos[pos] = [];
      byPos[pos].push({
        name: r.players!.full_name,
        team: r.players!.team ?? "FA",
        injury: r.players!.injury_status,
        proj: projMap[r.player_id] ?? 0,
        isStarting: startingPlayerIds.has(r.player_id),
        onBye: isOnBye(r.players!.team),
        // A free agent cannot score either and has no bye to detect: the Dan Bailey
        // case in OPEN-LOOPS #70, started three straight weeks because the UI's BYE
        // badge needs player.team and silently renders nothing without one.
        noTeam: !r.players!.team,
      });
    }

    const POSITION_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "DST"];
    const rosterStr = Object.entries(byPos)
      .sort(([a], [b]) => {
        const ai = POSITION_ORDER.indexOf(a);
        const bi = POSITION_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })
      .map(([pos, players]) => {
        const lines = players
          .sort((a, b) => b.proj - a.proj)
          .map(p => {
            const tag = p.isStarting ? "[START]" : "[BENCH]";
            const inj = p.injury ? ` ⚠️${p.injury}` : "";
            const dead = p.noTeam
              ? " ❌ NO NFL TEAM — SCORES 0"
              : p.onBye
                ? " ❌ ON BYE THIS WEEK — SCORES 0"
                : "";
            const proj = p.proj > 0
              ? ` proj ${p.proj.toFixed(1)}`
              : (p.noTeam || p.onBye ? "" : " (no projection available)");
            return `    ${tag} ${p.name} (${p.team})${proj}${dead}${inj}`;
          }).join("\n");
        return `  ${pos}:\n${lines}`;
      }).join("\n");

    const hasLineup = startingPlayerIds.size > 0;

    const prompt = `You are the UFF Start/Sit Advisor for Week ${week}.

Team: ${me.team_name}${me.faction ? ` (${me.faction} faction)` : ""}
Lineup format: ${slotSummary} | FLEX = RB/WR/TE eligible
${hasLineup ? "Lineup is already set — flag any urgent changes." : "No lineup set yet — recommend who to start."}

Roster:
${rosterStr}

Any player marked ❌ scores EXACTLY ZERO this week — on bye, or not on an NFL roster at all. If one is in a [START] slot that is the most urgent problem on the board: name it first, say it scores 0, and name the specific bench player to replace it with. Do not soften it and do not bury it below other advice.${byeDataUsable ? "" : " (Bye data was unavailable for this week, so no player could be checked for a bye — say so in one short line.)"}

Then give 3-5 direct recommendations. Flag any BENCH player projecting higher than their STARTER at the same position, call out injury risks, and note obvious FLEX upgrades. A player shown as "(no projection available)" is NOT on bye — the number is simply missing, so judge him on his own merits rather than treating the blank as zero. Under 150 words — no fluff, just moves.`;

    return prompt;
}

export function startSitRequest(prompt: string) {
  return {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readStartSitReply(resData: any): string {
  return resData.content?.[0]?.text ?? "";
}
