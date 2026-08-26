/**
 * The Legend & the War — story engine core (Phases 2 + 3).
 * Recomputes a league's Legend state AND resolves its story battles from the
 * finalized fantasy results (uff_matchups), then derives the Free Legends by
 * Faction-Tide and the alliance-war front.
 *
 * READ-ONLY on fantasy data. Writes ONLY to character_legend / story_battles /
 * alliance_war. Fully idempotent: it replays the whole season each run (and
 * deterministic "drama" is seeded), so re-running never double-counts or drifts.
 * Gated by uff_leagues.story_engine_enabled; { dryRun: true } computes without writing.
 *
 * Feats (raw stat categories) are Phase 2b — passed as 0 for now.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  lpForResult,
  rankFor,
  declineFor,
  factionTideLp,
  RIVALS,
  ULTIMATE_UNLOCK_RANK,
  campaignSchedule,
  highGroundBonus,
  SQUAD_FIRST_CLASH,
  SQUAD_SIEGE,
  GREAT_BATTLE_WAR_SWING,
  type Faction,
  type DeclineState,
} from "./rules";
import { resolveBattle, resolveInternal, type Combatant, type BattleOpts } from "./battles";

const INTERLOPERS_PER_WEEK = 2;

interface MemberRow {
  id: string;
  faction: Faction | null;
  character_id: number | null;
}
interface MatchRow {
  member_id: string;
  matchup_id: number;
  week: number;
  points: number;
}
interface CharMeta {
  name: string;
  faction: Faction;
}
interface Snap {
  legend: number;
  surge: number;
}

export interface LegendState {
  character_id: number;
  name: string;
  faction: Faction;
  is_free_legend: boolean;
  member_id: string | null;
  legend_points: number;
  rank: number;
  decline_state: DeclineState;
  week_surge: number;
  ultimate_unlocked: boolean;
  attr_strike: number;
  attr_guard: number;
  attr_burst: number;
  attr_nerve: number;
  attr_omen: number;
}
export interface BattleRow {
  league_id: string;
  week: number;
  kind: "war" | "internal" | "interloper" | "first_clash" | "siege" | "last_front";
  hero_side: { character_id: number; rating: number }[];
  villain_side: { character_id: number; rating: number }[];
  hero_force: number;
  villain_force: number;
  winner: "hero" | "villain" | "draw" | null;
  winner_character_id: number | null;
  moves_war: boolean;
  narration: string;
}
export interface RecomputeResult {
  leagueId: string;
  throughWeek: number;
  enabled: boolean;
  wrote: boolean;
  claimed: number;
  freeLegends: number;
  battles: number;
  frontPosition: number; // + = Vanguard ground, - = Dominion
  legends: LegendState[];
}

export async function recomputeLeagueLegends(
  admin: SupabaseClient,
  leagueId: string,
  throughWeek: number,
  opts: { dryRun?: boolean } = {},
): Promise<RecomputeResult> {
  // 1. Gate.
  const { data: league, error: lErr } = await admin
    .from("uff_leagues")
    .select("id, story_engine_enabled, season, season_weeks, championship_week")
    .eq("id", leagueId)
    .maybeSingle();
  if (lErr) throw new Error(`league: ${lErr.message}`);
  if (!league) throw new Error("league not found");
  const enabled = (league as { story_engine_enabled?: boolean }).story_engine_enabled === true;
  const season = (league as { season: string }).season;
  const seasonWeeks = (league as { season_weeks?: number }).season_weeks ?? 14;
  const championshipWeek = (league as { championship_week?: number }).championship_week ?? 0;

  // 2. Canon characters.
  const { data: chars, error: cErr } = await admin.from("uff_characters").select("id, name, faction");
  if (cErr) throw new Error(`characters: ${cErr.message}`);
  const charById = new Map<number, CharMeta>();
  for (const c of (chars ?? []) as { id: number; name: string; faction: Faction }[]) {
    charById.set(c.id, { name: c.name, faction: c.faction });
  }
  const nameOf = (cid: number | null) => (cid != null ? charById.get(cid)?.name ?? `#${cid}` : "?");

  // 3. Members → claimed characters.
  const { data: members, error: mErr } = await admin
    .from("league_members")
    .select("id, faction, character_id")
    .eq("league_id", leagueId);
  if (mErr) throw new Error(`members: ${mErr.message}`);
  const memberRows = (members ?? []) as MemberRow[];
  const memberChar = new Map<string, number>();
  const charMember = new Map<number, string>();
  const claimedCharIds = new Set<number>();
  for (const m of memberRows) {
    if (m.character_id != null) {
      memberChar.set(m.id, m.character_id);
      charMember.set(m.character_id, m.id);
      claimedCharIds.add(m.character_id);
    }
  }

  // 4. Completed matchups up to throughWeek.
  const { data: matches, error: mxErr } = await admin
    .from("uff_matchups")
    .select("member_id, matchup_id, week, points")
    .eq("league_id", leagueId)
    .eq("season", season)
    .eq("is_complete", true)
    .lte("week", throughWeek);
  if (mxErr) throw new Error(`matchups: ${mxErr.message}`);
  const matchRows = (matches ?? []) as MatchRow[];
  const weeks = [...new Set(matchRows.map((r) => r.week))].sort((a, b) => a - b);

  // Persisted stat feats (Phase 2b) → (character_id → week → feats). Ice Water is
  // derived from margins during the replay, not stored.
  const { data: featRows, error: fErr } = await admin
    .from("character_feats")
    .select("character_id, week, feat, attr")
    .eq("league_id", leagueId)
    .lte("week", throughWeek);
  if (fErr) throw new Error(`feats: ${fErr.message}`);
  const featsByCharWeek = new Map<number, Map<number, { feat: string; attr: string }[]>>();
  for (const r of (featRows ?? []) as { character_id: number; week: number; feat: string; attr: string }[]) {
    let wm = featsByCharWeek.get(r.character_id);
    if (!wm) {
      wm = new Map();
      featsByCharWeek.set(r.character_id, wm);
    }
    const arr = wm.get(r.week) ?? [];
    arr.push({ feat: r.feat, attr: r.attr });
    wm.set(r.week, arr);
  }

  // 5. Replay LP week by week; snapshot each claimed char's (legend, surge) per week,
  //    and each week's claimed-LP pools per faction (for per-week Faction-Tide).
  interface St {
    lp: number;
    lossStreak: number;
    lastWeekLp: number;
    attrs: Record<string, number>;
  }
  const zeroAttrs = (): Record<string, number> => ({ STRIKE: 0, GUARD: 0, BURST: 0, NERVE: 0, OMEN: 0 });
  const state = new Map<number, St>();
  for (const cid of claimedCharIds) state.set(cid, { lp: 0, lossStreak: 0, lastWeekLp: 0, attrs: zeroAttrs() });
  const snapByWeek = new Map<number, Map<number, Snap>>();
  const claimedPoolByWeek = new Map<number, Record<Faction, number[]>>();

  for (const wk of weeks) {
    const rankEntering = new Map<number, number>();
    for (const [cid, st] of state) rankEntering.set(cid, rankFor(st.lp));

    const wkRows = matchRows.filter((r) => r.week === wk);
    const byMatchup = new Map<number, MatchRow[]>();
    for (const r of wkRows) {
      const arr = byMatchup.get(r.matchup_id) ?? [];
      arr.push(r);
      byMatchup.set(r.matchup_id, arr);
    }
    const wkDelta = new Map<number, number>();
    for (const pair of byMatchup.values()) {
      if (pair.length !== 2) continue;
      const sides: [MatchRow, MatchRow][] = [
        [pair[0], pair[1]],
        [pair[1], pair[0]],
      ];
      for (const [me, opp] of sides) {
        const cid = memberChar.get(me.member_id);
        if (cid == null) continue;
        const oppChar = memberChar.get(opp.member_id) ?? null;
        const st = state.get(cid)!;
        const won = me.points > opp.points;
        const lost = me.points < opp.points;
        const margin = Math.abs(me.points - opp.points);
        const newStreak = lost ? st.lossStreak + 1 : 0;
        const beatRival = won && oppChar != null && RIVALS[cid] === oppChar;
        const myRank = rankEntering.get(cid) ?? 0;
        const oppRank = oppChar != null ? rankEntering.get(oppChar) ?? 0 : 0;
        const upset = won && oppChar != null && oppRank - myRank >= 2;
        const statFeats = featsByCharWeek.get(cid)?.get(wk) ?? [];
        const iceWater = won && margin <= 5; // clutch-win proxy for the NERVE feat
        const feats = statFeats.length + (iceWater ? 1 : 0);
        const delta = lpForResult({ won, lost, margin, lossStreak: newStreak, beatRival, upset, feats });
        for (const f of statFeats) st.attrs[f.attr] = (st.attrs[f.attr] ?? 0) + 1;
        if (iceWater) st.attrs.NERVE = (st.attrs.NERVE ?? 0) + 1;
        st.lp += delta;
        st.lossStreak = newStreak;
        wkDelta.set(cid, (wkDelta.get(cid) ?? 0) + delta);
      }
    }
    // snapshot this week
    const snap = new Map<number, Snap>();
    const pool: Record<Faction, number[]> = { hero: [], villain: [] };
    for (const cid of claimedCharIds) {
      const st = state.get(cid)!;
      snap.set(cid, { legend: st.lp, surge: wkDelta.get(cid) ?? 0 });
      const f = charById.get(cid)?.faction;
      if (f) pool[f].push(st.lp);
    }
    snapByWeek.set(wk, snap);
    claimedPoolByWeek.set(wk, pool);
    if (wk === throughWeek) for (const [cid, st] of state) st.lastWeekLp = wkDelta.get(cid) ?? 0;
  }

  // 6. Final legend states (claimed) + final faction pools (for the season Free-Legend tide).
  const legends: LegendState[] = [];
  const finalPool: Record<Faction, number[]> = { hero: [], villain: [] };
  for (const cid of claimedCharIds) {
    const meta = charById.get(cid);
    if (!meta) continue;
    const st = state.get(cid)!;
    const rank = rankFor(st.lp);
    legends.push({
      character_id: cid,
      name: meta.name,
      faction: meta.faction,
      is_free_legend: false,
      member_id: charMember.get(cid) ?? null,
      legend_points: st.lp,
      rank,
      decline_state: declineFor(st.lp),
      week_surge: st.lastWeekLp,
      ultimate_unlocked: rank >= ULTIMATE_UNLOCK_RANK,
      attr_strike: st.attrs.STRIKE,
      attr_guard: st.attrs.GUARD,
      attr_burst: st.attrs.BURST,
      attr_nerve: st.attrs.NERVE,
      attr_omen: st.attrs.OMEN,
    });
    finalPool[meta.faction].push(st.lp);
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const maxOf = (a: number[]) => (a.length ? Math.max(...a) : 0);
  const freeTide: Record<Faction, number> = {
    hero: factionTideLp(avg(finalPool.hero), maxOf(finalPool.hero)),
    villain: factionTideLp(avg(finalPool.villain), maxOf(finalPool.villain)),
  };
  for (const [cid, meta] of charById) {
    if (claimedCharIds.has(cid)) continue;
    const lp = freeTide[meta.faction];
    const rank = rankFor(lp);
    legends.push({
      character_id: cid,
      name: meta.name,
      faction: meta.faction,
      is_free_legend: true,
      member_id: null,
      legend_points: lp,
      rank,
      decline_state: "stable",
      week_surge: 0,
      ultimate_unlocked: rank >= ULTIMATE_UNLOCK_RANK,
      attr_strike: 0,
      attr_guard: 0,
      attr_burst: 0,
      attr_nerve: 0,
      attr_omen: 0,
    });
  }

  // 7. Resolve battles per week from the snapshots.
  const battleRows: BattleRow[] = [];
  let front = 0;
  const allianceRows: {
    league_id: string;
    week: number;
    hero_battle_wins: number;
    villain_battle_wins: number;
    front_position: number;
  }[] = [];

  const combatantOf = (cid: number, snap: Map<number, Snap>): Combatant => {
    const s = snap.get(cid) ?? { legend: 0, surge: 0 };
    return { character_id: cid, legend: s.legend, surge: s.surge, faction: charById.get(cid)!.faction };
  };

  for (const wk of weeks) {
    const snap = snapByWeek.get(wk)!;
    const pool = claimedPoolByWeek.get(wk)!;
    const wkTide: Record<Faction, number> = {
      hero: factionTideLp(avg(pool.hero), maxOf(pool.hero)),
      villain: factionTideLp(avg(pool.villain), maxOf(pool.villain)),
    };
    let heroWins = 0;
    let villainWins = 0;

    // War Battles + Internal Duels from the fantasy pairings
    const wkRows = matchRows.filter((r) => r.week === wk);
    const byMatchup = new Map<number, MatchRow[]>();
    for (const r of wkRows) {
      const arr = byMatchup.get(r.matchup_id) ?? [];
      arr.push(r);
      byMatchup.set(r.matchup_id, arr);
    }
    for (const [matchupId, pair] of byMatchup) {
      if (pair.length !== 2) continue;
      const cA = memberChar.get(pair[0].member_id);
      const cB = memberChar.get(pair[1].member_id);
      if (cA == null || cB == null) continue;
      const seed = `${leagueId}:${wk}:${matchupId}`;
      const fA = charById.get(cA)!.faction;
      const fB = charById.get(cB)!.faction;
      if (fA !== fB) {
        const heroC = fA === "hero" ? combatantOf(cA, snap) : combatantOf(cB, snap);
        const vilC = fA === "hero" ? combatantOf(cB, snap) : combatantOf(cA, snap);
        const o = resolveBattle([heroC], [vilC], seed);
        if (o.winner === "hero") heroWins++;
        else if (o.winner === "villain") villainWins++;
        battleRows.push({
          league_id: leagueId,
          week: wk,
          kind: "war",
          hero_side: o.heroSide,
          villain_side: o.villainSide,
          hero_force: o.heroForce,
          villain_force: o.villainForce,
          winner: o.winner,
          winner_character_id: o.winnerCharacterId,
          moves_war: true,
          narration:
            o.winner === "draw"
              ? `${nameOf(heroC.character_id)} and ${nameOf(vilC.character_id)} fought the front to a standstill.`
              : `${nameOf(o.winnerCharacterId)} drove ${nameOf(o.winner === "hero" ? vilC.character_id : heroC.character_id)} from the field.`,
        });
      } else {
        const o = resolveInternal(combatantOf(cA, snap), combatantOf(cB, snap), seed);
        const heroSide = fA === "hero" ? o.side : [];
        const villainSide = fA === "hero" ? [] : o.side;
        battleRows.push({
          league_id: leagueId,
          week: wk,
          kind: "internal",
          hero_side: heroSide,
          villain_side: villainSide,
          hero_force: heroSide.reduce((s, x) => s + x.rating, 0),
          villain_force: villainSide.reduce((s, x) => s + x.rating, 0),
          winner: o.draw ? "draw" : fA,
          winner_character_id: o.winnerCharacterId,
          moves_war: false,
          narration: o.draw
            ? `${nameOf(cA)} and ${nameOf(cB)} settled nothing in the ${fA === "hero" ? "Vanguard" : "Dominion"} ranks.`
            : `${nameOf(o.winnerCharacterId)} bested ${nameOf(o.winnerCharacterId === cA ? cB : cA)} in the ${fA === "hero" ? "Vanguard" : "Dominion"} ranks.`,
        });
      }
    }

    // Interlopers — Free Legends whose canon rival is a claimed champion ambush them.
    const candidates: number[] = [];
    for (const [cid, meta] of charById) {
      if (claimedCharIds.has(cid)) continue;
      const rival = RIVALS[cid];
      if (rival != null && claimedCharIds.has(rival)) candidates.push(cid);
      void meta;
    }
    candidates.sort(
      (a, b) =>
        // deterministic per-week ordering
        (parseInt(`${wk}${a}`, 10) * 2654435761) % 100000 - (parseInt(`${wk}${b}`, 10) * 2654435761) % 100000,
    );
    for (const fid of candidates.slice(0, INTERLOPERS_PER_WEEK)) {
      const rival = RIVALS[fid];
      const fMeta = charById.get(fid)!;
      const freeC: Combatant = { character_id: fid, legend: wkTide[fMeta.faction], surge: 0, faction: fMeta.faction };
      const rivalC = combatantOf(rival, snap);
      const seed = `${leagueId}:${wk}:interloper:${fid}`;
      const heroC = fMeta.faction === "hero" ? freeC : rivalC;
      const vilC = fMeta.faction === "hero" ? rivalC : freeC;
      const o = resolveBattle([heroC], [vilC], seed);
      if (o.winner === "hero") heroWins++;
      else if (o.winner === "villain") villainWins++;
      battleRows.push({
        league_id: leagueId,
        week: wk,
        kind: "interloper",
        hero_side: o.heroSide,
        villain_side: o.villainSide,
        hero_force: o.heroForce,
        villain_force: o.villainForce,
        winner: o.winner,
        winner_character_id: o.winnerCharacterId,
        moves_war: true,
        narration: `${nameOf(fid)} came out of the field to ambush ${nameOf(rival)} — ${nameOf(o.winnerCharacterId)} held it.`,
      });
    }

    front += heroWins - villainWins;
    allianceRows.push({
      league_id: leagueId,
      week: wk,
      hero_battle_wins: heroWins,
      villain_battle_wins: villainWins,
      front_position: front,
    });
  }

  // 7b. Campaign set-pieces — the Great Battles (merit squads) and The Last Front.
  const campaignEventRows: {
    league_id: string;
    event: "first_clash" | "siege" | "last_front";
    week: number;
    squad_size: number;
    status: string;
    result: Record<string, unknown>;
  }[] = [];
  {
    const { firstClash, siege, lastFront } = campaignSchedule(seasonWeeks, championshipWeek);
    const stateAt = (w: number) => {
      let best = -1;
      for (const pw of weeks) if (pw <= w && pw > best) best = pw;
      return best < 0 ? null : { snap: snapByWeek.get(best)!, pool: claimedPoolByWeek.get(best)! };
    };
    const claimedByFaction = (f: Faction) => [...claimedCharIds].filter((c) => charById.get(c)!.faction === f);
    const setpieces = [
      { event: "first_clash" as const, week: firstClash, squad: SQUAD_FIRST_CLASH, full: false },
      { event: "siege" as const, week: siege, squad: SQUAD_SIEGE, full: false },
      { event: "last_front" as const, week: lastFront, squad: 0, full: true },
    ];
    let campaignSwing = 0;
    for (const sp of setpieces) {
      if (sp.week > throughWeek) continue;
      const st = stateAt(sp.week);
      if (!st) continue;
      const heroClaimed = claimedByFaction("hero").map((c) => combatantOf(c, st.snap)).sort((a, b) => b.legend - a.legend);
      const villainClaimed = claimedByFaction("villain").map((c) => combatantOf(c, st.snap)).sort((a, b) => b.legend - a.legend);
      let heroSquad: Combatant[];
      let villainSquad: Combatant[];
      let bopts: BattleOpts = {};
      if (sp.full) {
        const tide: Record<Faction, number> = {
          hero: factionTideLp(avg(st.pool.hero), maxOf(st.pool.hero)),
          villain: factionTideLp(avg(st.pool.villain), maxOf(st.pool.villain)),
        };
        const freeOf = (f: Faction): Combatant[] =>
          [...charById]
            .filter(([c, m]) => !claimedCharIds.has(c) && m.faction === f)
            .map(([c]) => ({ character_id: c, legend: tide[f], surge: 0, faction: f }));
        heroSquad = [...heroClaimed, ...freeOf("hero")];
        villainSquad = [...villainClaimed, ...freeOf("villain")];
        bopts = {
          heroBonus: highGroundBonus(front > 0 ? front : 0),
          villainBonus: highGroundBonus(front < 0 ? -front : 0),
        };
      } else {
        heroSquad = heroClaimed.slice(0, sp.squad);
        villainSquad = villainClaimed.slice(0, sp.squad);
      }
      if (heroSquad.length === 0 && villainSquad.length === 0) continue;
      const o = resolveBattle(heroSquad, villainSquad, `${leagueId}:campaign:${sp.event}`, bopts);
      if (!sp.full) {
        campaignSwing += o.winner === "hero" ? GREAT_BATTLE_WAR_SWING : o.winner === "villain" ? -GREAT_BATTLE_WAR_SWING : 0;
      }
      const wF = o.winner === "hero" ? "Vanguard" : "Dominion";
      const lF = o.winner === "hero" ? "Dominion" : "Vanguard";
      battleRows.push({
        league_id: leagueId,
        week: sp.week,
        kind: sp.event,
        hero_side: o.heroSide,
        villain_side: o.villainSide,
        hero_force: o.heroForce,
        villain_force: o.villainForce,
        winner: o.winner,
        winner_character_id: o.winnerCharacterId,
        moves_war: false,
        narration: sp.full
          ? o.winner === "draw"
            ? "The Last Front ended in a standstill — the war unresolved."
            : `The Last Front — every legend on the field. The ${wF} broke through and claimed The First War.`
          : o.winner === "draw"
            ? "The champions clashed and neither line broke; both withdrew."
            : `The champions clashed — the ${wF} broke the line and the ${lF} retreated to regroup.`,
      });
      campaignEventRows.push({
        league_id: leagueId,
        event: sp.event,
        week: sp.week,
        squad_size: sp.full ? heroSquad.length : sp.squad,
        status: "resolved",
        result: {
          winner: o.winner,
          winner_character_id: o.winnerCharacterId,
          hero_force: o.heroForce,
          villain_force: o.villainForce,
        },
      });
    }
    front += campaignSwing;
  }

  // 8. Persist (unless dry run / flag off).
  let wrote = false;
  if (!opts.dryRun && enabled) {
    const now = new Date().toISOString();
    const legUpserts = legends.map((l) => ({
      league_id: leagueId,
      character_id: l.character_id,
      member_id: l.member_id,
      is_free_legend: l.is_free_legend,
      legend_points: l.legend_points,
      rank: l.rank,
      decline_state: l.decline_state,
      week_surge: l.week_surge,
      ultimate_unlocked: l.ultimate_unlocked,
      attr_strike: l.attr_strike,
      attr_guard: l.attr_guard,
      attr_burst: l.attr_burst,
      attr_nerve: l.attr_nerve,
      attr_omen: l.attr_omen,
      updated_at: now,
    }));
    const upRes = await admin.from("character_legend").upsert(legUpserts, { onConflict: "league_id,character_id" });
    if (upRes.error) throw new Error(`character_legend upsert: ${upRes.error.message}`);

    // story_battles + alliance_war: delete-then-insert this league for idempotency.
    const delB = await admin.from("story_battles").delete().eq("league_id", leagueId);
    if (delB.error) throw new Error(`story_battles delete: ${delB.error.message}`);
    if (battleRows.length) {
      const insB = await admin.from("story_battles").insert(battleRows);
      if (insB.error) throw new Error(`story_battles insert: ${insB.error.message}`);
    }
    const delW = await admin.from("alliance_war").delete().eq("league_id", leagueId);
    if (delW.error) throw new Error(`alliance_war delete: ${delW.error.message}`);
    if (allianceRows.length) {
      const insW = await admin.from("alliance_war").insert(allianceRows);
      if (insW.error) throw new Error(`alliance_war insert: ${insW.error.message}`);
    }
    const delC = await admin.from("campaign_events").delete().eq("league_id", leagueId);
    if (delC.error) throw new Error(`campaign_events delete: ${delC.error.message}`);
    if (campaignEventRows.length) {
      const insC = await admin.from("campaign_events").insert(campaignEventRows);
      if (insC.error) throw new Error(`campaign_events insert: ${insC.error.message}`);
    }
    wrote = true;
  }

  return {
    leagueId,
    throughWeek,
    enabled,
    wrote,
    claimed: claimedCharIds.size,
    freeLegends: legends.filter((l) => l.is_free_legend).length,
    battles: battleRows.length,
    frontPosition: front,
    legends,
  };
}
