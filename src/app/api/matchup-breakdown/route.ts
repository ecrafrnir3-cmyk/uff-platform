import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { scoreWithPower, POWER_LABELS } from "@/lib/scoring";

interface LineupRow { slot: string; player_id: string; }
interface RosterRow {
  player_id: string;
  slot: string | null;
  players: {
    full_name: string;
    position: string | null;
    team: string | null;
    injury_status: string | null;
  } | null;
}
interface PowerRow {
  player_id: string;
  power: string;
  restored_at: string | null;
  frozen_score: number | null;
  freeze_broken_at: string | null;
}

// Time Stone freezes an injured starter at a held score instead of paying a
// bonus, so it is a substitution and scoreWithPower deliberately ignores it.
// Mirrors TS_INJURED_STATUSES in the engine.
const TS_INJURED = new Set(["Out", "Doubtful", "IR", "PUP", "Sus", "COV", "NA", "DNR"]);

export async function POST(req: NextRequest) {
  try {
    const { league_id, week, member_a_id, member_b_id } = await req.json();
    if (!league_id || !week || !member_a_id || !member_b_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Verify membership
    const { data: me } = await supabase
      .from("league_members")
      .select("id")
      .eq("league_id", league_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    // The most expensive unlimited endpoint (audit A3-07): a full-week stat feed per call.
    const rl = await checkRateLimit(`${user.id}:matchup-breakdown`, 10);
    if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded — try again in a minute." }, { status: 429 });

    const { data: league } = await supabase
      .from("uff_leagues")
      .select("season, scoring_settings")
      .eq("id", league_id)
      .maybeSingle();
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 });

    const scoringSettings: Record<string, number> =
      (league.scoring_settings as Record<string, number>) ?? {};

    // Fetch lineups, rosters, and team names in parallel
    const [
      { data: lineupA }, { data: lineupB },
      { data: rosterA }, { data: rosterB },
      { data: memberA }, { data: memberB },
      { data: powerRows },
      { data: boardRows }, { data: factionRows },
      { data: nflTeamRows }, { data: biteRows },
    ] = await Promise.all([
      supabase
        .from("uff_lineups")
        .select("slot, player_id")
        .eq("member_id", member_a_id)
        .eq("week", week)
        .returns<LineupRow[]>(),
      supabase
        .from("uff_lineups")
        .select("slot, player_id")
        .eq("member_id", member_b_id)
        .eq("week", week)
        .returns<LineupRow[]>(),
      supabase
        .from("uff_roster_players")
        .select("player_id, slot, players(full_name, position, team, injury_status)")
        .eq("member_id", member_a_id)
        .is("dropped_at", null)
        .eq("slot", "active")
        .returns<RosterRow[]>(),
      supabase
        .from("uff_roster_players")
        .select("player_id, slot, players(full_name, position, team, injury_status)")
        .eq("member_id", member_b_id)
        .is("dropped_at", null)
        .eq("slot", "active")
        .returns<RosterRow[]>(),
      supabase
        .from("league_members")
        .select("team_name")
        .eq("id", member_a_id)
        .maybeSingle(),
      supabase
        .from("league_members")
        .select("team_name")
        .eq("id", member_b_id)
        .maybeSingle(),
      // Tied-to-pick draft powers. The engine adds these to a player's score;
      // without them this route returns a number the engine never used.
      supabase
        .from("player_draft_powers")
        .select("player_id, power, restored_at, frozen_score, freeze_broken_at")
        .eq("league_id", league_id)
        .returns<PowerRow[]>(),
      // ── The team-level terms, so the card can be made to add up ──────────────
      // Nine starters never summed to the board and the gap looked like a scoring
      // bug for two days. It is not: the engine also adds a FACTION BONUS (0.5 per
      // same-faction active player, up to +8.00), the VAMPIRE SIPHON (0.1 × the
      // bitten player's score) and the week's TOKEN bonus. All three attach to the
      // team rather than to any player, so no per-player list can ever reconcile
      // without them shown alongside.
      supabase
        .from("uff_matchups")
        .select("member_id, points, token_bonus")
        .eq("league_id", league_id)
        .eq("week", week)
        .in("member_id", [member_a_id, member_b_id]),
      supabase
        .from("league_members")
        .select("id, faction")
        .in("id", [member_a_id, member_b_id]),
      supabase.from("nfl_teams").select("abbr, faction"),
      supabase
        .from("vampire_bites")
        .select("biting_member_id, target_player_id")
        .eq("league_id", league_id),
    ]);

    const startingA = new Set((lineupA ?? []).map(l => l.player_id));
    const startingB = new Set((lineupB ?? []).map(l => l.player_id));

    // Build player info maps
    type Info = { name: string; pos: string; team: string; injury: string | null };
    const toInfo = (rows: RosterRow[] | null): Record<string, Info> => {
      const map: Record<string, Info> = {};
      for (const r of rows ?? []) {
        if (r.players) {
          map[r.player_id] = {
            name: r.players.full_name,
            pos: r.players.position ?? "?",
            team: r.players.team ?? "FA",
            injury: r.players.injury_status ?? null,
          };
        }
      }
      return map;
    };
    const nameMapA = toInfo(rosterA);
    const nameMapB = toInfo(rosterB);

    const powerMap: Record<string, PowerRow> = {};
    for (const p of powerRows ?? []) powerMap[p.player_id] = p;

    // Fetch Sleeper stats for that week
    let statsMap: Record<string, Record<string, number>> = {};
    try {
      const statsRes = await fetch(
        // /stats/nfl/regular/... — the ?season_type= form returns rank fields
        // only, with no real stats (verified 2026-09-08).
        `https://api.sleeper.app/v1/stats/nfl/regular/${league.season}/${week}`,
        { next: { revalidate: 300 } }
      );
      if (statsRes.ok) {
        statsMap = await statsRes.json();
      }
    } catch { /* stats unavailable */ }

        function formatStatLine(stats: Record<string, number>, pos: string): string {
      const p: string[] = [];
      const n = (k: string) => Math.round(stats[k] ?? 0);
      if (pos === "QB") {
        if (n("pass_yd")) p.push(`${n("pass_yd")} pass yds`);
        if (n("pass_td")) p.push(`${n("pass_td")} TD`);
        if (n("pass_int")) p.push(`${n("pass_int")} INT`);
        if (n("rush_yd")) p.push(`${n("rush_yd")} rush yds`);
        if (n("rush_td")) p.push(`${n("rush_td")} rush TD`);
      } else if (pos === "RB") {
        if (n("rush_yd")) p.push(`${n("rush_yd")} rush yds`);
        if (n("rush_td")) p.push(`${n("rush_td")} rush TD`);
        if (n("rec")) p.push(`${n("rec")} rec`);
        if (n("rec_yd")) p.push(`${n("rec_yd")} rec yds`);
        if (n("rec_td")) p.push(`${n("rec_td")} rec TD`);
      } else if (pos === "WR" || pos === "TE") {
        if (n("rec")) p.push(`${n("rec")} rec`);
        if (n("rec_yd")) p.push(`${n("rec_yd")} yds`);
        if (n("rec_td")) p.push(`${n("rec_td")} TD`);
      } else if (pos === "K") {
        if (stats.fgm != null || stats.fga != null) p.push(`${n("fgm")}/${n("fga")} FG`);
        if (n("xpm")) p.push(`${n("xpm")} XP`);
      } else if (pos === "DEF" || pos === "DST") {
        if (n("sack")) p.push(`${n("sack")} sck`);
        if (n("int")) p.push(`${n("int")} INT`);
        if (n("fum_rec")) p.push(`${n("fum_rec")} FR`);
        if (n("def_td")) p.push(`${n("def_td")} TD`);
        const pa = stats.pts_allow; if (pa != null) p.push(`${n("pts_allow")} PA`);
      }
      return p.join(" · ");
    }

    function buildBreakdown(
      startingIds: Set<string>,
      nameMap: Record<string, Info>
    ) {
      const haveSettings = Object.keys(scoringSettings).length > 0;
      return [...startingIds]
        .map(pid => {
          const info = nameMap[pid];
          const stats = statsMap[pid] ?? {};
          const pe = powerMap[pid];
          const pos = info?.pos ?? "?";

          // Base + tied-to-pick bonus, exactly as the engine scores it.
          const scored = haveSettings
            ? scoreWithPower(stats, scoringSettings, pe ? { power: pe.power, restored: pe.restored_at != null } : null)
            : { base: 0, bonus: 0, total: 0, power: null as string | null };
          const base = scored.base;
          let { bonus, total, power } = scored;

          // Time Stone substitutes a held score for an injured starter rather
          // than adding to it. Only mirror the case the engine has already
          // settled — a live freeze on a player who is still out. The engine
          // also DERIVES a freeze the first time it sees an injured starter with
          // no frozen_score; that path writes to the DB, so it is left to the
          // engine and this route shows the raw score until it runs.
          if (pe?.power === "time_stone" && pe.frozen_score != null &&
              pe.freeze_broken_at == null && TS_INJURED.has(info?.injury ?? "")) {
            total = pe.frozen_score;
            bonus = Math.round((total - base) * 100) / 100;
            power = "time_stone";
          }

          return {
            player_id: pid,
            name: info?.name ?? "Unknown",
            pos,
            team: info?.team ?? "FA",
            points: total,
            basePoints: base,
            bonus,
            power,
            powerLabel: power ? (POWER_LABELS[power] ?? "Time Stone") : null,
            // A player absent from the stats feed is not a zero — say so rather
            // than rendering 0.00 next to a name that scored.
            noData: haveSettings && Object.keys(stats).length === 0,
            statLine: formatStatLine(stats, pos),
          };
        })
        .sort((a, b) => b.points - a.points);
    }

    // ── Team-level terms ───────────────────────────────────────────────────────
    // Mirrors the engine: faction bonus 0.5 per same-faction active player, vampire
    // siphon 0.1 × the bitten player's score (skipped when the target holds Shadow
    // Guard), plus the week's token bonus. `board` is what the engine actually wrote,
    // so any residual is visible instead of being argued about.
    const teamFaction: Record<string, string | null> = {};
    for (const f of factionRows ?? []) teamFaction[f.id] = f.faction ?? null;
    const nflFaction: Record<string, string> = {};
    for (const t of nflTeamRows ?? []) if (t.abbr && t.faction) nflFaction[t.abbr] = t.faction;
    const board: Record<string, { points: number; token: number }> = {};
    for (const b of boardRows ?? []) {
      board[b.member_id] = { points: Number(b.points ?? 0), token: Number(b.token_bonus ?? 0) };
    }

    const scoreOf = (pid: string) => {
      const pe = powerMap[pid];
      return scoreWithPower(statsMap[pid] ?? {}, scoringSettings,
        pe ? { power: pe.power, restored: pe.restored_at != null } : null).total;
    };

    function teamTotals(memberId: string, roster: RosterRow[] | null, players: { points: number }[]) {
      const starters = Math.round(players.reduce((s, p) => s + p.points, 0) * 100) / 100;
      const mf = teamFaction[memberId];
      let factionBonus = 0;
      for (const r of roster ?? []) {
        const t = r.players?.team ?? "";
        if (mf && t && nflFaction[t] === mf) factionBonus += 0.5;
      }
      let siphon = 0;
      for (const bite of biteRows ?? []) {
        if (bite.biting_member_id !== memberId) continue;
        if (powerMap[bite.target_player_id]?.power === "shadow_guard") continue;
        siphon += scoreOf(bite.target_player_id) * 0.1;
      }
      const token = board[memberId]?.token ?? 0;
      const modelled = Math.round((starters + factionBonus + siphon + token) * 100) / 100;
      const actual = board[memberId]?.points ?? null;
      return {
        starters,
        factionBonus: Math.round(factionBonus * 100) / 100,
        siphon: Math.round(siphon * 100) / 100,
        token: Math.round(token * 100) / 100,
        modelled,
        board: actual,
        unexplained: actual == null ? null : Math.round((actual - modelled) * 100) / 100,
      };
    }

    const hasData = startingA.size > 0 || startingB.size > 0;

    return NextResponse.json({
      hasData,
      a: (() => {
        const players = buildBreakdown(startingA, nameMapA);
        return { team_name: memberA?.team_name ?? "Team A", players, totals: teamTotals(member_a_id, rosterA, players) };
      })(),
      b: (() => {
        const players = buildBreakdown(startingB, nameMapB);
        return { team_name: memberB?.team_name ?? "Team B", players, totals: teamTotals(member_b_id, rosterB, players) };
      })(),
    });
  } catch (err) {
    console.error("Matchup breakdown error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
