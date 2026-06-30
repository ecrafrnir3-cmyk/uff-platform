import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET          = Deno.env.get('CRON_SECRET') ?? '';
const SLEEPER_BASE         = 'https://api.sleeper.app/v1';

const FLAG_KEYS = new Set([
  'pts_allow_0','pts_allow_1_6','pts_allow_7_13','pts_allow_14_20',
  'pts_allow_21_27','pts_allow_28_34','pts_allow_35p',
]);

function calcScore(
  stats: Record<string, number>,
  settings: Record<string, number>,
): number {
  let score = 0;
  for (const [key, mult] of Object.entries(settings)) {
    const val = stats[key];
    if (val == null || val === 0) continue;
    score += FLAG_KEYS.has(key) ? mult : val * mult;
  }
  return Math.round(score * 100) / 100;
}

function applyDraftPower(
  power: string,
  stats: Record<string, number>,
  baseScore: number,
  settings: Record<string, number>,
): number {
  switch (power) {
    case 'gunslinger':           return (stats['pass_td'] ?? 0) * 1;
    case 'berserker_rage':       return (stats['rush_yd'] ?? 0) * 0.1;
    case 'reception_specialist': return (stats['rec']    ?? 0) * 0.5;
    case 'iron_defense':         return baseScore < 0 ? -baseScore : 0;
    case 'red_zone_menace':      return (stats['rec_td'] ?? 0) * 1;
    case 'goal_line_hammer':     return (stats['rush_td'] ?? 0) * 1;
    case 'seam_buster':          return (stats['rec_td'] ?? 0) * 1;
    case 'sniper':               return (stats['fgm_50p'] ?? 0) * (settings['fgm_50p'] ?? 0);
    case 'power_negation':       return -(baseScore / 2);
    default:                     return 0;
  }
}

// Powers counted toward Mirror Match opponent bonus (design doc spec)
const MIRROR_MATCH_POWERS = new Set([
  'gunslinger','berserker_rage','reception_specialist','iron_defense',
  'red_zone_menace','goal_line_hammer','sniper','seam_buster',
]);

// Flex-eligible positions for Mulligan replacement check
const FLEX_POSITIONS = new Set(['RB','WR','TE']);

// ── Time Stone types ──────────────────────────────────────────────────────────
interface TsData {
  frozenScore:      number | null;
  lastHealthyScore: number | null;
  prevHealthyScore: number | null;
  freezeBrokenAt:   string | null;
}
interface TsUpdate {
  leagueId:            string;
  playerId:            string;
  frozen_score?:       number | null;
  last_healthy_score?: number | null;
  prev_healthy_score?: number | null;
  freeze_broken_at?:   string | null;
}

// ── Token types ───────────────────────────────────────────────────────────────
interface TokenEffect { id: number; choice: string | null; }

function resolveToken(tokenId: number, choice: string | null): TokenEffect | null {
  // Token 18 = Second Wind: replay a past token stored as its id in `choice`
  if (tokenId === 18) {
    const past = parseInt(choice ?? '');
    return isNaN(past) ? null : { id: past, choice: null };
  }
  return { id: tokenId, choice };
}

interface PlayerScore {
  pts:       number;
  proj:      number;
  isStarter: boolean;
  position:  string;
}

type MatchupRow = { id: string; league_id: string; matchup_id: number; member_id: string };

Deno.serve(async (req) => {
  if (CRON_SECRET) {
    const auth = req.headers.get('x-cron-secret');
    if (auth !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
  }

  const body   = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const url    = new URL(req.url);
  const week   = parseInt(body.week   ?? url.searchParams.get('week')   ?? '0');
  const season = body.season ?? url.searchParams.get('season') ?? '2026';

  if (!week || week < 1 || week > 18) {
    return new Response(JSON.stringify({ error: 'Invalid or missing week (1-18)' }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const [statsRes, projRes] = await Promise.all([
    fetch(`${SLEEPER_BASE}/stats/nfl/${season}/${week}?season_type=regular`),
    fetch(`${SLEEPER_BASE}/projections/nfl/${season}/${week}?season_type=regular`),
  ]);

  if (!statsRes.ok) {
    return new Response(JSON.stringify({ error: `Sleeper stats error: ${statsRes.status}` }), { status: 502 });
  }

  const allStats: Record<string, Record<string, number>> = await statsRes.json();
  const allProj:  Record<string, Record<string, number>> = projRes.ok ? await projRes.json() : {};

  const { data: matchupRows, error: mErr } = await supabase
    .from('uff_matchups')
    .select('id, league_id, matchup_id, member_id')
    .eq('week', week)
    .eq('season', season)
    .eq('is_complete', false);

  if (mErr) return new Response(JSON.stringify({ error: mErr.message }), { status: 500 });
  if (!matchupRows?.length) {
    return new Response(JSON.stringify({ updated: 0, message: 'No active matchups' }), { status: 200 });
  }

  const typedMatchups = matchupRows as MatchupRow[];
  const leagueIds = [...new Set(typedMatchups.map(m => m.league_id))];
  const memberIds = [...new Set(typedMatchups.map(m => m.member_id))];

  const { data: leagues } = await supabase
    .from('uff_leagues')
    .select('id, scoring_settings')
    .in('id', leagueIds);

  const settingsMap: Record<string, Record<string, number>> = {};
  for (const lg of (leagues ?? [])) settingsMap[lg.id] = lg.scoring_settings ?? {};

  // ── Parallel data fetch ───────────────────────────────────────────────────
  const [
    { data: powerRows },
    { data: biteRows },
    { data: rosterRows },
    { data: lineupRows },
    { data: memberFactionRows },
    { data: nflTeamRows },
    { data: tokenRows },
    { data: winHistoryRows },
  ] = await Promise.all([
    supabase
      .from('player_draft_powers')
      .select('league_id, player_id, power, restored_at, frozen_score, last_healthy_score, prev_healthy_score, freeze_broken_at')
      .in('league_id', leagueIds),
    supabase.from('vampire_bites').select('league_id, biting_member_id, target_player_id').in('league_id', leagueIds),
    // Fetch roster with position + team in one join
    supabase.from('uff_roster_players')
      .select('member_id, player_id, players(position, team)')
      .in('member_id', memberIds)
      .is('dropped_at', null)
      .eq('slot', 'active'),
    supabase.from('uff_lineups').select('member_id, player_id').in('member_id', memberIds).eq('week', week),
    supabase.from('league_members').select('id, faction').in('id', memberIds),
    supabase.from('nfl_teams').select('abbr, faction'),
    supabase.from('weekly_token_assignments')
      .select('member_id, token_id, choice')
      .in('league_id', leagueIds)
      .eq('week', week),
    // Win history for Momentum token streak computation
    supabase.from('uff_matchups')
      .select('member_id, matchup_id, week, points, league_id')
      .in('member_id', memberIds)
      .eq('season', season)
      .lt('week', week)
      .eq('is_complete', true),
  ]);

  // ── Build core maps ───────────────────────────────────────────────────────
  const powerMap:     Record<string, Record<string, { power: string; restored: boolean }>> = {};
  const timeStoneMap: Record<string, Record<string, TsData>> = {};

  for (const row of (powerRows ?? [])) {
    if (!powerMap[row.league_id]) powerMap[row.league_id] = {};
    powerMap[row.league_id][row.player_id] = { power: row.power, restored: row.restored_at != null };
    if (row.power === 'time_stone') {
      if (!timeStoneMap[row.league_id]) timeStoneMap[row.league_id] = {};
      timeStoneMap[row.league_id][row.player_id] = {
        frozenScore:      row.frozen_score      ?? null,
        lastHealthyScore: row.last_healthy_score ?? null,
        prevHealthyScore: row.prev_healthy_score ?? null,
        freezeBrokenAt:   row.freeze_broken_at   ?? null,
      };
    }
  }

  const tsPlayerIds = [...new Set(Object.values(timeStoneMap).flatMap(m => Object.keys(m)))];
  const injuryStatusMap: Record<string, string | null> = {};
  if (tsPlayerIds.length > 0) {
    const { data: injuryData } = await supabase.from('players').select('id, injury_status').in('id', tsPlayerIds);
    for (const p of (injuryData ?? [])) injuryStatusMap[p.id] = p.injury_status ?? null;
  }

  const biteMap: Record<string, Record<string, string>> = {};
  for (const row of (biteRows ?? [])) {
    if (!biteMap[row.league_id]) biteMap[row.league_id] = {};
    biteMap[row.league_id][row.target_player_id] = row.biting_member_id;
  }

  const rosterMap:    Record<string, string[]> = {};
  const playerPosMap: Record<string, string>   = {};
  const playerTeamMap: Record<string, string>  = {};

  for (const r of (rosterRows ?? [])) {
    if (!rosterMap[r.member_id]) rosterMap[r.member_id] = [];
    rosterMap[r.member_id].push(r.player_id);
    const pl = r.players as { position?: string; team?: string } | null;
    if (pl?.position) playerPosMap[r.player_id]  = pl.position;
    if (pl?.team)     playerTeamMap[r.player_id] = pl.team;
  }

  const lineupMap: Record<string, Set<string>> = {};
  for (const l of (lineupRows ?? [])) {
    if (!lineupMap[l.member_id]) lineupMap[l.member_id] = new Set();
    lineupMap[l.member_id].add(l.player_id);
  }

  const memberFactionMap: Record<string, string> = {};
  for (const m of (memberFactionRows ?? [])) {
    if (m.faction) memberFactionMap[m.id] = m.faction;
  }

  const teamFactionMap: Record<string, string> = {};
  for (const t of (nflTeamRows ?? [])) {
    if (t.abbr && t.faction) teamFactionMap[t.abbr] = t.faction;
  }

  // Faction bonus: 0.5 per same-faction active player
  const playerMemberMap: Record<string, string> = {};
  for (const [memberId, pids] of Object.entries(rosterMap)) {
    for (const pid of pids) playerMemberMap[pid] = memberId;
  }
  const factionBonusMap: Record<string, number> = {};
  for (const [playerId, team] of Object.entries(playerTeamMap)) {
    const tf = teamFactionMap[team];
    if (!tf) continue;
    const memberId = playerMemberMap[playerId];
    if (!memberId) continue;
    const mf = memberFactionMap[memberId];
    if (mf && mf === tf) factionBonusMap[memberId] = (factionBonusMap[memberId] ?? 0) + 0.5;
  }

  // Token map: member_id → resolved effect
  const tokenMap: Record<string, TokenEffect> = {};
  for (const t of (tokenRows ?? [])) {
    const eff = resolveToken(t.token_id, t.choice);
    if (eff) tokenMap[t.member_id] = eff;
  }

  // Win streak map for Momentum token (consecutive wins before this week)
  const winStreakMap: Record<string, number> = {};
  {
    const pairBuckets: Record<string, { member_id: string; points: number; week: number }[]> = {};
    for (const row of (winHistoryRows ?? [])) {
      const key = `${row.league_id}-${row.week}-${row.matchup_id}`;
      if (!pairBuckets[key]) pairBuckets[key] = [];
      pairBuckets[key].push({ member_id: row.member_id, points: row.points ?? 0, week: row.week });
    }
    const results: Record<string, Record<number, 'W'|'L'|'T'>> = {};
    for (const sides of Object.values(pairBuckets)) {
      if (sides.length !== 2) continue;
      const [a, b] = sides;
      if (!results[a.member_id]) results[a.member_id] = {};
      if (!results[b.member_id]) results[b.member_id] = {};
      if (a.points > b.points) {
        results[a.member_id][a.week] = 'W'; results[b.member_id][b.week] = 'L';
      } else if (b.points > a.points) {
        results[b.member_id][b.week] = 'W'; results[a.member_id][a.week] = 'L';
      } else {
        results[a.member_id][a.week] = 'T'; results[b.member_id][b.week] = 'T';
      }
    }
    for (const memberId of memberIds) {
      const mr = results[memberId] ?? {};
      const weeks = Object.keys(mr).map(Number).sort((x, y) => y - x);
      let streak = 0;
      for (const w of weeks) { if (mr[w] === 'W') streak++; else break; }
      winStreakMap[memberId] = streak;
    }
  }

  // ── First pass: score ALL roster players (starters + bench) ──────────────
  // fullScoreCache[memberId][playerId] = PlayerScore
  const fullScoreCache: Record<string, Record<string, PlayerScore>> = {};
  // draftPowerBonusMap[memberId] = sum of draft power bonuses (Mirror Match source)
  const draftPowerBonusMap: Record<string, number> = {};
  const tsUpdates: TsUpdate[] = [];
  const tokenBonusMap: Record<string, number> = {};
  const now = new Date().toISOString();

  for (const matchup of typedMatchups) {
    const settings     = settingsMap[matchup.league_id] ?? {};
    const leaguePowers = powerMap[matchup.league_id]    ?? {};
    const lsTimeStone  = timeStoneMap[matchup.league_id] ?? {};
    const lineupSet    = lineupMap[matchup.member_id];
    const allPlayers   = rosterMap[matchup.member_id] ?? [];

    fullScoreCache[matchup.member_id]    = fullScoreCache[matchup.member_id]    ?? {};
    draftPowerBonusMap[matchup.member_id] = draftPowerBonusMap[matchup.member_id] ?? 0;
    tokenBonusMap[matchup.member_id]     = tokenBonusMap[matchup.member_id]     ?? 0;

    for (const playerId of allPlayers) {
      const stats    = allStats[playerId] ?? {};
      const projData = allProj[playerId]  ?? {};
      const base     = calcScore(stats, settings);
      const baseProj = calcScore(projData, settings);
      const isStarter = lineupSet ? lineupSet.has(playerId) : true;
      let pts  = base;
      let proj = baseProj;

      const pe = leaguePowers[playerId];
      if (pe) {
        if (pe.power === 'time_stone') {
          const ts      = lsTimeStone[playerId];
          const injured = (injuryStatusMap[playerId] ?? null) !== null;
          const inStart = lineupSet?.has(playerId) ?? true;
          if (ts) {
            if (ts.freezeBrokenAt) {
              if (!injured) {
                pts = base;
                tsUpdates.push({ leagueId: matchup.league_id, playerId, frozen_score: null, freeze_broken_at: null, last_healthy_score: base, prev_healthy_score: ts.lastHealthyScore });
              }
            } else if (ts.frozenScore != null) {
              if (!injured) {
                pts = base;
                tsUpdates.push({ leagueId: matchup.league_id, playerId, frozen_score: null, freeze_broken_at: null, last_healthy_score: base, prev_healthy_score: ts.lastHealthyScore });
              } else if (inStart) {
                pts = ts.frozenScore;
                // Track Time Stone bonus for Mirror Match
                const tsBonus = ts.frozenScore - base;
                if (tsBonus > 0) draftPowerBonusMap[matchup.member_id] += tsBonus;
              } else {
                pts = base;
                tsUpdates.push({ leagueId: matchup.league_id, playerId, freeze_broken_at: now });
              }
            } else if (injured) {
              const priorScore = ts.lastHealthyScore ?? 0;
              let frozenScore: number;
              if (base >= 8)      frozenScore = base;
              else if (priorScore >= 8) frozenScore = priorScore;
              else                frozenScore = Math.max(base, priorScore);
              const update: TsUpdate = { leagueId: matchup.league_id, playerId, frozen_score: frozenScore, prev_healthy_score: ts.lastHealthyScore };
              if (inStart) {
                pts = frozenScore;
                const tsBonus = frozenScore - base;
                if (tsBonus > 0) draftPowerBonusMap[matchup.member_id] += tsBonus;
              } else {
                update.freeze_broken_at = now;
                pts = base;
              }
              tsUpdates.push(update);
            } else {
              pts = base;
              tsUpdates.push({ leagueId: matchup.league_id, playerId, last_healthy_score: base, prev_healthy_score: ts.lastHealthyScore });
            }
          }
        } else if (pe.power !== 'vampire_bite') {
          if (!(pe.power === 'power_negation' && pe.restored)) {
            const bonus = applyDraftPower(pe.power, stats, base, settings);
            pts  += bonus;
            proj += applyDraftPower(pe.power, projData, baseProj, settings);
            // Accumulate for Mirror Match
            if (MIRROR_MATCH_POWERS.has(pe.power) && bonus > 0) {
              draftPowerBonusMap[matchup.member_id] += bonus;
            }
          }
        }
      }

      fullScoreCache[matchup.member_id][playerId] = {
        pts, proj, isStarter,
        position: playerPosMap[playerId] ?? '',
      };
    }
  }

  // ── Post-first-pass: per-player token effects (step 4 in pipeline) ────────
  for (const matchup of typedMatchups) {
    const token = tokenMap[matchup.member_id];
    if (!token) continue;
    const cache = fullScoreCache[matchup.member_id] ?? {};
    const starters = Object.entries(cache).filter(([, ps]) => ps.isStarter);

    switch (token.id) {
      case 2: { // Triple Threat: 3x kicker pts
        for (const [kid, ps] of starters) {
          if (ps.position === 'K') {
            const prev = ps.pts;
            cache[kid].pts = Math.round(ps.pts * 3 * 100) / 100;
            tokenBonusMap[matchup.member_id] += Math.round((cache[kid].pts - prev) * 100) / 100;
          }
        }
        break;
      }
      case 7: { // Position Power: top scorer at chosen position gets 1.5x
        const chosenPos = (token.choice ?? '').toUpperCase();
        if (chosenPos) {
          const atPos = starters.filter(([, ps]) => ps.position === chosenPos);
          if (atPos.length > 0) {
            atPos.sort(([, a], [, b]) => b.pts - a.pts);
            const [topId] = atPos[0];
            const prev = cache[topId].pts;
            cache[topId].pts = Math.round(prev * 1.5 * 100) / 100;
            tokenBonusMap[matchup.member_id] += Math.round((cache[topId].pts - prev) * 100) / 100;
          }
        }
        break;
      }
      case 8: { // Fortress: 2x D/ST score
        for (const [did, ps] of starters) {
          if (ps.position === 'DEF') {
            const prev = ps.pts;
            cache[did].pts = Math.round(ps.pts * 2 * 100) / 100;
            tokenBonusMap[matchup.member_id] += Math.round((cache[did].pts - prev) * 100) / 100;
          }
        }
        break;
      }
      case 10: { // Air Raid: QB starters get +1 per passing TD
        for (const [qid, ps] of starters) {
          if (ps.position === 'QB') {
            const passTDs = (allStats[qid] ?? {})['pass_td'] ?? 0;
            cache[qid].pts = Math.round((ps.pts + passTDs) * 100) / 100;
            tokenBonusMap[matchup.member_id] += passTDs;
          }
        }
        break;
      }
      case 16: { // Iron Will: lowest-projected starter gets 2x actual score
        if (starters.length > 0) {
          starters.sort(([, a], [, b]) => a.proj - b.proj);
          const [lowestId] = starters[0];
          const prev = cache[lowestId].pts;
          cache[lowestId].pts = Math.round(prev * 2 * 100) / 100;
          tokenBonusMap[matchup.member_id] += Math.round((cache[lowestId].pts - prev) * 100) / 100;
        }
        break;
      }
    }
  }

  // ── Vampire Bite siphon ───────────────────────────────────────────────────
  // Build a reverse map: memberId → leagueId so we can scope lookups correctly.
  const memberLeagueMap: Record<string, string> = {};
  for (const m of typedMatchups) memberLeagueMap[m.member_id] = m.league_id;

  const vampireSiphon: Record<string, number> = {};
  for (const leagueId of leagueIds) {
    // Only look at rosters that belong to this league
    const leagueMemberIds = typedMatchups.filter(m => m.league_id === leagueId).map(m => m.member_id);
    for (const [targetId, biterId] of Object.entries(biteMap[leagueId] ?? {})) {
      // Find the member within this league who owns the target player
      for (const memberId of leagueMemberIds) {
        const playerScores = fullScoreCache[memberId];
        if (playerScores && playerScores[targetId] != null) {
          vampireSiphon[biterId] = (vampireSiphon[biterId] ?? 0) + playerScores[targetId].pts * 0.1;
          // VB siphon also counts toward Mirror Match bonus
          draftPowerBonusMap[biterId] = (draftPowerBonusMap[biterId] ?? 0) + playerScores[targetId].pts * 0.1;
          break;
        }
      }
    }
  }

  // ── Third pass: aggregate + team-level tokens (step 5) ───────────────────
  const memberTotalMap: Record<string, { pts: number; proj: number }> = {};

  for (const matchup of typedMatchups) {
    const cache = fullScoreCache[matchup.member_id] ?? {};
    let pts = 0, proj = 0;
    for (const ps of Object.values(cache)) {
      if (ps.isStarter) { pts += ps.pts; proj += ps.proj; }
    }

    // Vampire siphon
    pts += vampireSiphon[matchup.member_id] ?? 0;

    const token = tokenMap[matchup.member_id];

    // Faction bonus (doubled if Faction Surge token 6)
    const baseFb = factionBonusMap[matchup.member_id] ?? 0;
    let fb = baseFb;
    if (token?.id === 6) {
      fb *= 2;
      tokenBonusMap[matchup.member_id] += baseFb; // extra from Faction Surge
    }
    pts  += fb;
    proj += fb;

    // Token 1: Power Surge
    if (token?.id === 1) { pts += 2.0; tokenBonusMap[matchup.member_id] += 2.0; }

    // Token 3: Bench Vault — add highest bench player score
    if (token?.id === 3) {
      const bench = Object.values(cache).filter(ps => !ps.isStarter);
      if (bench.length > 0) {
        const bv = Math.max(0, Math.max(...bench.map(ps => ps.pts)));
        if (bv > 0) { pts += bv; tokenBonusMap[matchup.member_id] += bv; }
      }
    }

    // Token 4: Mulligan — swap worst underperforming starter with best eligible bench player
    if (token?.id === 4) {
      const starters = Object.entries(cache).filter(([, ps]) => ps.isStarter);
      const bench    = Object.entries(cache).filter(([, ps]) => !ps.isStarter);
      let worstDelta = Infinity, worstId = '', worstPts = 0, worstPos = '';
      for (const [pid, ps] of starters) {
        const delta = ps.pts - ps.proj;
        if (delta < worstDelta) { worstDelta = delta; worstId = pid; worstPts = ps.pts; worstPos = ps.position; }
      }
      if (worstId && worstDelta < 0) {
        const eligible = bench.filter(([, ps]) =>
          ps.position === worstPos ||
          (FLEX_POSITIONS.has(worstPos) && FLEX_POSITIONS.has(ps.position))
        );
        if (eligible.length > 0) {
          eligible.sort(([, a], [, b]) => b.pts - a.pts);
          const [, best] = eligible[0];
          if (best.pts > worstPts) {
            tokenBonusMap[matchup.member_id] += Math.round((best.pts - worstPts) * 100) / 100;
            pts = pts - worstPts + best.pts;
          }
        }
      }
    }

    // Token 14: Momentum — +1.5 if 2+ consecutive win streak
    if (token?.id === 14 && (winStreakMap[matchup.member_id] ?? 0) >= 2) {
      pts += 1.5;
      tokenBonusMap[matchup.member_id] += 1.5;
    }

    memberTotalMap[matchup.member_id] = {
      pts:  Math.round(pts  * 100) / 100,
      proj: Math.round(proj * 100) / 100,
    };
  }

  // ── Fourth pass: matchup-pair-dependent tokens (Mirror Match, Last Stand, Underdog, Clutch Gene) ──
  const matchupPairs: Record<string, MatchupRow[]> = {};
  for (const m of typedMatchups) {
    const key = `${m.league_id}-${m.matchup_id}`;
    if (!matchupPairs[key]) matchupPairs[key] = [];
    matchupPairs[key].push(m);
  }

  for (const sides of Object.values(matchupPairs)) {
    if (sides.length !== 2) continue;
    const [sA, sB] = sides;
    const tA = memberTotalMap[sA.member_id];
    const tB = memberTotalMap[sB.member_id];
    if (!tA || !tB) continue;

    const tkA = tokenMap[sA.member_id];
    const tkB = tokenMap[sB.member_id];

    // Token 5: Mirror Match — bonus = opponent's draft power bonus total
    if (tkA?.id === 5) {
      const bonus = draftPowerBonusMap[sB.member_id] ?? 0;
      tA.pts = Math.round((tA.pts + bonus) * 100) / 100;
      tokenBonusMap[sA.member_id] = (tokenBonusMap[sA.member_id] ?? 0) + bonus;
    }
    if (tkB?.id === 5) {
      const bonus = draftPowerBonusMap[sA.member_id] ?? 0;
      tB.pts = Math.round((tB.pts + bonus) * 100) / 100;
      tokenBonusMap[sB.member_id] = (tokenBonusMap[sB.member_id] ?? 0) + bonus;
    }

    // Token 12: Last Stand — if trailing by 20+, add all bench pts
    if (tkA?.id === 12 && tB.pts - tA.pts >= 20) {
      const benchPts = Object.values(fullScoreCache[sA.member_id] ?? {}).filter(ps => !ps.isStarter).reduce((s, ps) => s + ps.pts, 0);
      tA.pts = Math.round((tA.pts + benchPts) * 100) / 100;
      tokenBonusMap[sA.member_id] = (tokenBonusMap[sA.member_id] ?? 0) + benchPts;
    }
    if (tkB?.id === 12 && tA.pts - tB.pts >= 20) {
      const benchPts = Object.values(fullScoreCache[sB.member_id] ?? {}).filter(ps => !ps.isStarter).reduce((s, ps) => s + ps.pts, 0);
      tB.pts = Math.round((tB.pts + benchPts) * 100) / 100;
      tokenBonusMap[sB.member_id] = (tokenBonusMap[sB.member_id] ?? 0) + benchPts;
    }

    // Token 15: Underdog — if you lost, +3 pts (consolation; does not flip result)
    if (tkA?.id === 15 && tA.pts < tB.pts) {
      tA.pts = Math.round((tA.pts + 3) * 100) / 100;
      tokenBonusMap[sA.member_id] = (tokenBonusMap[sA.member_id] ?? 0) + 3;
    }
    if (tkB?.id === 15 && tB.pts < tA.pts) {
      tB.pts = Math.round((tB.pts + 3) * 100) / 100;
      tokenBonusMap[sB.member_id] = (tokenBonusMap[sB.member_id] ?? 0) + 3;
    }

    // Token 17: Clutch Gene — if matchup within 5 pts, round losing side up by 1
    const diff = Math.abs(tA.pts - tB.pts);
    if (diff > 0 && diff <= 5) {
      if (tkA?.id === 17 && tA.pts < tB.pts) {
        tA.pts = Math.round((tA.pts + 1) * 100) / 100;
        tokenBonusMap[sA.member_id] = (tokenBonusMap[sA.member_id] ?? 0) + 1;
      }
      if (tkB?.id === 17 && tB.pts < tA.pts) {
        tB.pts = Math.round((tB.pts + 1) * 100) / 100;
        tokenBonusMap[sB.member_id] = (tokenBonusMap[sB.member_id] ?? 0) + 1;
      }
    }
  }

  // ── Write all scores to DB ────────────────────────────────────────────────
  await Promise.all(
    typedMatchups.map(m => {
      const total = memberTotalMap[m.member_id];
      return supabase.from('uff_matchups').update({
        points:      total?.pts  ?? 0,
        projected:   total?.proj ?? 0,
        token_bonus: Math.round((tokenBonusMap[m.member_id] ?? 0) * 100) / 100,
      }).eq('id', m.id);
    })
  );

  // ── Apply Time Stone DB updates ───────────────────────────────────────────
  if (tsUpdates.length > 0) {
    await Promise.all(
      tsUpdates.map(({ leagueId, playerId, ...fields }) =>
        supabase
          .from('player_draft_powers')
          .update(fields)
          .eq('league_id', leagueId)
          .eq('player_id', playerId)
          .eq('power', 'time_stone')
      )
    );
  }

  return new Response(
    JSON.stringify({ updated: typedMatchups.length, week, season, tsUpdates: tsUpdates.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
