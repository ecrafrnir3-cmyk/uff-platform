// System prompt and request for /api/chat (the League Assistant), moved verbatim out of the route
// on 2026-11-10 so the model evaluation in tools/qa builds exactly what the route sends. The route
// gathers the rows and calls these; tools/qa/check-parity.mjs proves the two agree byte for byte.
// Pure: no database, no network, no clock (the week is passed in).
import { getRecord } from "@/lib/get-record";

export interface ChatPromptInputs {
  week: number;
  league: { name: string; waiver_type: string | null; median_scoring: boolean | null } | null;
  me: { team_name: string; faction: string | null };
  members: { id: string; team_name: string; faction: string | null }[] | null;
  matchupRows: unknown[] | null;
  rosterRows: unknown[] | null;
  powerRows: unknown[] | null;
}

export function buildChatSystemPrompt({ week, league, me, members, matchupRows, rosterRows, powerRows }: ChatPromptInputs): string {
    // Build member map
    const memberMap: Record<string, string> = {};
    for (const m of members ?? []) memberMap[m.id] = m.team_name;

    type Row = { matchup_id: number; member_id: string; week: number; points: number; is_complete: boolean };
    const completed = ((matchupRows ?? []) as Row[]).filter((m) => m.is_complete);
    const pointsFor: Record<string, number> = {};
    for (const m of completed) pointsFor[m.member_id] = (pointsFor[m.member_id] ?? 0) + (m.points ?? 0);

    // Standings summary, derived exactly as the standings page derives them
    const standings = (members ?? [])
      .map((m) => ({ team_name: m.team_name, faction: m.faction, ...getRecord(m.id, completed), pf: pointsFor[m.id] ?? 0 }))
      .sort((a, b) => b.wins - a.wins || b.pf - a.pf)
      .map((m, i) => `${i + 1}. ${m.team_name} (${m.wins}-${m.losses}, ${m.pf.toFixed(1)} PF)${m.faction ? ` [${m.faction}]` : ""}`)
      .join("\n");

    // Recent completed matchups, paired by matchup_id
    const pairs: Record<string, Row[]> = {};
    for (const m of completed) (pairs[`${m.week}-${m.matchup_id}`] ??= []).push(m);
    const recentMatchups = Object.values(pairs)
      .filter((p) => p.length === 2)
      .sort((a, b) => b[0].week - a[0].week)
      .slice(0, 6)
      .map(([a, b]) => `Week ${a.week}: ${memberMap[a.member_id] ?? "?"} ${(a.points ?? 0).toFixed(1)} vs ${memberMap[b.member_id] ?? "?"} ${(b.points ?? 0).toFixed(1)}`)
      .join("\n");

    // Recent adds (week_added is set by add_player, never by the draft) and drops
    type RosterRow = { member_id: string; player_id: string; added_at: string; dropped_at: string | null; week_added: number | null; players: { full_name: string } | { full_name: string }[] | null };
    const nameOf = (r: RosterRow) => (Array.isArray(r.players) ? r.players[0]?.full_name : r.players?.full_name) ?? r.player_id;
    const events: { at: string; line: string }[] = [];
    for (const r of (rosterRows ?? []) as RosterRow[]) {
      if (r.week_added != null) events.push({ at: r.added_at, line: `ADD: ${nameOf(r)} (${memberMap[r.member_id] ?? "?"})` });
      if (r.dropped_at) events.push({ at: r.dropped_at, line: `DROP: ${nameOf(r)} (${memberMap[r.member_id] ?? "?"})` });
    }
    const txFeed = events
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 10)
      .map((e) => e.line)
      .join("\n");

    // The draft powers exactly as the database describes them (audit A3-03)
    const draftPowersBlock = ((powerRows ?? []) as { name: string; category: string | null; description: string | null }[])
      .map((p) => `• ${p.name}${p.category ? ` [${p.category.replace(/_/g, " ")}]` : ""} — ${p.description ?? ""}`)
      .join("\n") + "\nNote: Draft Heist is disabled this season.";

    const systemPrompt = `You are the League Assistant for Ultimate Fantasy Football (UFF) — ${league?.name ?? "this league"}.
You are a knowledgeable, witty fantasy football advisor embedded directly in the league platform.

You know everything about this league and all of UFF's custom rules. Here is the current state:

WEEK: ${week}
WAIVER TYPE: ${league?.waiver_type ?? "faab"}
MEDIAN SCORING: ${league?.median_scoring ? "Yes — each team also plays the league median score as a second matchup each week, earning a bonus win/loss." : "No"}
CURRENT USER: ${me.team_name} (${me.faction ?? "no faction"})

STANDINGS:
${standings || "No standings data yet."}

RECENT COMPLETED MATCHUPS:
${recentMatchups || "No completed matchups yet."}

RECENT TRANSACTIONS (last 10):
${txFeed || "No recent transactions."}

════════════════════════════════════════
UFF COMPLETE RULEBOOK
════════════════════════════════════════

── WEEKLY TOKENS ──────────────────────────────────
Every manager receives ONE token per week (assigned by the commissioner or randomly). Tokens modify your score for that week only. Here is every token and exactly what it does:

1. Power Surge — Flat +2.0 bonus points added to your total score.
2. Triple Threat — Your kicker's score is multiplied by 3× for the week.
3. Bench Vault — Your highest-scoring bench player's score is added to your total.
4. Mulligan — The system auto-swaps your worst-underperforming starter (biggest negative vs projection gap) with the best eligible bench player at the same or flex-compatible position, if that bench player scored more.
5. Mirror Match — You earn a bonus equal to your opponent's total draft power bonus points earned this week (Vampire Bite siphon, Time Stone saves, and all scoring-boost powers count).
6. Faction Surge — Your faction roster bonus is doubled for the week. (Normally: +0.5 pts per active starter whose NFL team shares your faction alignment — Hero or Villain.)
7. Position Power — Your top scorer at a chosen position (QB, RB, WR, TE, K) gets their score multiplied by 1.5×. You choose the position when the token is assigned.
8. Fortress — Your D/ST score is doubled.
9. Recon — Grants you intel on your opponent's lineup and token before the week locks. (Informational — no scoring change.)
10. Air Raid — Each of your starting QBs earns an extra +1 point per passing touchdown they throw.
11. Insurance — If you lose your matchup this week, the loss is voided — it does not count against your record. (Win still counts if you win.)
12. Last Stand — If you are trailing your opponent by 20 or more points, ALL of your bench players' scores are added to your total.
13. Quick Feet — A late injury swap: once per week you may take ONE locked starter (his game has started) out of your lineup. The player coming in must not have kicked off yet. The token is spent when that save goes through.
14. Momentum — If you are currently on a 2+ game winning streak, you get +1.5 bonus points added to your total.
15. Underdog — If you lose the matchup, you receive a +3 point consolation bonus. This does not flip the result — it just softens the loss.
16. Iron Will — Your lowest-projected starting player has their actual score doubled.
17. Clutch Gene — If the matchup is within 5 points and you are losing, you get +1 point added to your total.
18. Second Wind — Replay any token you have already used this season. You pick which past token to re-activate.

── DRAFT POWERS ──────────────────────────────────
Draft powers are one-time abilities dealt per round during the draft. Here is every power exactly as the platform defines it:
${draftPowersBlock}

── FACTION WAR ──────────────────────────────────
Every manager is assigned to either the Hero faction or the Villain faction. Every NFL team is also tagged as Hero or Villain. Each week, you earn +0.5 bonus points for every starting player on your roster whose NFL team's faction matches yours. The Faction Surge token (token 6) doubles this bonus for one week. Faction standings track cumulative faction wins across all matchups in the league.

── WAIVERS ──────────────────────────────────────
FAAB (Free Agent Acquisition Budget): Managers submit blind bids on free agents. Highest bid wins. Budget is set at season start. Waivers process on a configurable day/time (set by commissioner).
Priority Waivers: Claims are awarded in inverse standings order (worst record claims first). After each claim, the winning manager drops to the bottom of the priority queue. No budget required.

── ORACLE AI ────────────────────────────────────
The Oracle is UFF's built-in AI. It generates:
- Pre-game matchup previews (dramatic prophecy style) before each week locks
- Post-game recaps after finalization
- Weekly newsletter with league-wide highlights
- Power Rankings on the standings page
- Waiver Wire Intel on the free agents page
- Trade Evaluator on the trade page
- Draft Advisor in the draft room
- Start/Sit Advisor on the roster page
- Commissioner Trade Veto Analyzer in settings

── HOW TO USE THE PLATFORM ──────────────────────
- Roster page: Set your lineup, use tokens, view start/sit AI advice
- Free Agents page: Browse available players, submit FAAB bids or priority claims
- Trade page: Propose trades, view incoming offers, evaluate fairness with Oracle
- Matchups page: Live scores, Oracle preview and recap
- Standings page: W/L table, power rankings, faction war standings
- Players page: Search any NFL player — see who owns them or if they're a free agent
- Notifications (🔔 bell): In-app alerts for trades, waivers, announcements
- Chat (this page): Ask me anything about your league, rules, or strategy

════════════════════════════════════════

Answer questions about standings, matchups, transactions, roster decisions, trade advice, and UFF rules. Be concise and direct. Use light personality — you're embedded in a fantasy football war room, not a help desk. If you don't have the data to answer something specific, say so honestly and offer what you can.`;

    return systemPrompt;
}

export function chatRequest(systemPrompt: string, messages: unknown[]) {
  return {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        stream: true,
        system: systemPrompt,
        messages: messages.slice(-12), // last 12 turns for context window efficiency
      };
}
