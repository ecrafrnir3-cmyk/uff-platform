import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ── League Assistant Chat ─────────────────────────────────────────────────────
// POST { league_id, messages: [{role, content}] }
// Returns streaming text (text/event-stream)

export async function POST(req: NextRequest) {
  try {
    const { league_id: leagueId, messages } = await req.json();
    if (!leagueId || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Missing league_id or messages" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: me } = await supabase
      .from("league_members")
      .select("id, team_name, faction")
      .eq("league_id", leagueId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    // ── Gather league context ─────────────────────────────────────────────────
    const [
      { data: league },
      { data: members },
      { data: matchups },
      { data: recentTx },
    ] = await Promise.all([
      supabase
        .from("uff_leagues")
        .select("name, current_week, waiver_type, median_scoring, commissioner_id")
        .eq("id", leagueId)
        .maybeSingle(),
      supabase
        .from("league_members")
        .select("id, team_name, faction, wins, losses, points_for, waiver_priority")
        .eq("league_id", leagueId)
        .order("wins", { ascending: false }),
      supabase
        .from("uff_matchups")
        .select("member_id, opponent_id, week, member_score, opponent_score, is_complete, median_win")
        .eq("league_id", leagueId)
        .order("week", { ascending: false })
        .limit(30),
      supabase
        .from("uff_transactions")
        .select("type, player_name, member_id, created_at")
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    // Build member map
    const memberMap: Record<string, string> = {};
    for (const m of members ?? []) memberMap[m.id] = m.team_name;

    // Standings summary
    const standings = (members ?? [])
      .map((m, i) => `${i + 1}. ${m.team_name} (${m.wins ?? 0}-${m.losses ?? 0}, ${(m.points_for ?? 0).toFixed(1)} PF)${m.faction ? ` [${m.faction}]` : ""}`)
      .join("\n");

    // Recent matchups
    const recentMatchups = (matchups ?? [])
      .filter(m => m.is_complete)
      .slice(0, 6)
      .map(m => `Week ${m.week}: ${memberMap[m.member_id] ?? "?"} ${m.member_score?.toFixed(1)} vs ${memberMap[m.opponent_id] ?? "?"} ${m.opponent_score?.toFixed(1)}`)
      .join("\n");

    // Recent transactions
    const txFeed = (recentTx ?? [])
      .map(t => `${t.type.toUpperCase()}: ${t.player_name ?? "?"} (${memberMap[t.member_id] ?? "?"})`)
      .join("\n");

    const systemPrompt = `You are the League Assistant for Ultimate Fantasy Football (UFF) — ${league?.name ?? "this league"}.
You are a knowledgeable, witty fantasy football advisor embedded directly in the league platform.

You know everything about this league and all of UFF's custom rules. Here is the current state:

WEEK: ${league?.current_week ?? "unknown"}
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
13. Quick Feet — Lets you make lineup changes past the per-player game-time lock deadline. You can swap players even after their NFL game has started, as long as the player hasn't yet played a snap.
14. Momentum — If you are currently on a 2+ game winning streak, you get +1.5 bonus points added to your total.
15. Underdog — If you lose the matchup, you receive a +3 point consolation bonus. This does not flip the result — it just softens the loss.
16. Iron Will — Your lowest-projected starting player has their actual score doubled.
17. Clutch Gene — If the matchup is within 5 points and you are losing, you get +1 point added to your total.
18. Second Wind — Replay any token you have already used this season. You pick which past token to re-activate.

── DRAFT POWERS ──────────────────────────────────
Draft powers are one-time abilities assigned to specific players during the draft. They are permanent for the season (unless otherwise noted) and either boost that player's weekly scoring or affect draft-room mechanics.

SCORING BOOST POWERS (affect the attached player's points every week):
• Gunslinger — The player earns an extra +1 point per passing touchdown.
• Berserker Rage — The player earns an extra +0.1 points per rushing yard.
• Reception Specialist — The player earns an extra +0.5 points per reception.
• Iron Defense — The player's score is floored at 0 — they can never score negative points.
• Red Zone Menace — The player earns an extra +1 point per receiving touchdown.
• Goal Line Hammer — The player earns an extra +1 point per rushing touchdown.
• Seam Buster — The player earns an extra +1 point per receiving touchdown.
• Sniper — Kicker earns bonus points for 50+ yard field goals (applied on top of standard scoring).
• Power Negation — Reduces the attached player's score by 50% (used to debuff an opponent's player or weaken one of your own low-value starters to activate a counter-strategy).

SPECIAL MECHANICS POWERS (unique rules, not simple stat boosts):
• Vampire Bite — During the draft, you target an opponent's specific player. Each week, you siphon 10% of that player's score into your own total. (The targeted player's score is unchanged — you just copy 10%.)
• Time Stone — If the attached player suffers an injury, their score is frozen at their last healthy week's performance (or current week's score if it's ≥ 8 pts). Once healthy, they resume scoring normally. The freeze breaks if they go to bench while injured.
• Hero's Shield — Protects one of your players from being targeted by an opponent's Vampire Bite. (Defensive power.)
• Draft Heist — During the draft, steal a player off another team's roster. The target team must pick a replacement.
• Telepathy — During the draft, see your opponents' draft boards and queued picks in real time.
• Cloak — During the draft, hide your own draft board and queue from all opponents.
• Foresight Coin — During the draft, flip the coin to peek at upcoming available players before they appear in the draft pool.

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

    // ── Call Anthropic (streaming) ────────────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "AI unavailable" }, { status: 500 });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        stream: true,
        system: systemPrompt,
        messages: messages.slice(-12), // last 12 turns for context window efficiency
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      console.error("[chat] Anthropic error:", err);
      return NextResponse.json({ error: "AI error" }, { status: 502 });
    }

    // Forward the SSE stream directly
    return new NextResponse(anthropicRes.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("[chat] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
