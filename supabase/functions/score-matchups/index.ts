import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

const FLAG_KEYS = new Set([
  'pts_allow_0','pts_allow_1_6','pts_allow_7_13','pts_allow_14_20',
  'pts_allow_21_27','pts_allow_28_34','pts_allow_35p'
]);

function calcScore(
  stats: Record<string, number>,
  settings: Record<string, number>
): number {
  let score = 0;
  for (const [key, multiplier] of Object.entries(settings)) {
    const val = stats[key];
    if (val == null || val === 0) continue;
    score += FLAG_KEYS.has(key) ? multiplier : val * multiplier;
  }
  return Math.round(score * 100) / 100;
}

/**
 * Apply a draft power bonus. Returns ADDITIONAL points to add (0 if no effect).
 * NOT handled here: time_stone (deferred), vampire_bite (handled in second pass).
 */
function applyDraftPower(
  power: string,
  stats: Record<string, number>,
  baseScore: number,
  settings: Record<string, number>
): number {
  switch (power) {
    case 'gunslinger':            return (stats['pass_td'] ?? 0) * 1;
    case 'berserker_rage':        return (stats['rush_yd'] ?? 0) * 0.1;
    case 'reception_specialist':  return (stats['rec'] ?? 0) * 0.5;
    case 'iron_defense':          return Math.max(0, baseScore); // bonus floored at 0 so bad weeks aren't amplified
    case 'red_zone_menace':       return (stats['rec_td'] ?? 0) * 1;
    case 'goal_line_hammer':      return (stats['rush_td'] ?? 0) * 1;
    case 'seam_buster':           return (stats['rec_td'] ?? 0) * 1;
    case 'sniper':                return (stats['fgm_50p'] ?? 0) * (settings['fgm_50p'] ?? 0);
    case 'power_negation':        return -(baseScore / 2); // caller skips if restored_at is set
    default:                      return 0;
  }
}

Deno.serve(async (req) => {
  if (CRON_SECRET) {
    const auth = req.headers.get('x-cron-secret');
    if (auth !== CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
  }

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const url = new URL(req.url);
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
    .select('id, league_id, member_id')
    .eq('week', week)
    .eq('season', season)
    .eq('is_complete', false);

  if (mErr) return new Response(JSON.stringify({ error: mErr.message }), { status: 500 });
  if (!matchupRows?.length) {
    return new Response(JSON.stringify({ updated: 0, message: 'No active matchups' }), { status: 200 });
  }

  const leagueIds = [...new Set(matchupRows.map((m: any) => m.league_id))];
  const memberIds = [...new Set(matchupRows.map((m: any) => m.member_id))];

  const { data: leagues } = await supabase
    .from('uff_leagues')
    .select('id, scoring_settings')
    .in('id', leagueIds);

  const settingsMap: Record<string, Record<string, number>> = {};
  for (const lg of (leagues ?? [])) settingsMap[lg.id] = lg.scoring_settings ?? {};

  // Parallel fetch of all per-league and per-member data
  const [
    { data: powerRows },
    { data: biteRows },
    { data: rosterRows },
    { data: lineupRows },
    { data: memberFactionRows },
    { data: rosterWithTeamRows },
    { data: nflTeamRows },
  ] = await Promise.all([
    supabase.from('player_draft_powers').select('league_id, player_id, power, restored_at').in('league_id', leagueIds),
    supabase.from('vampire_bites').select('league_id, biting_member_id, target_player_id').in('league_id', leagueIds),
    supabase.from('uff_roster_players').select('member_id, player_id').in('member_id', memberIds).is('dropped_at', null).eq('slot', 'active'),
    supabase.from('uff_lineups').select('member_id, player_id').in('member_id', memberIds).eq('week', week),
    supabase.from('league_members').select('id, faction').in('id', memberIds),
    supabase.from('uff_roster_players').select('member_id, players(team)').in('member_id', memberIds).is('dropped_at', null).eq('slot', 'active'),
    supabase.from('nfl_teams').select('abbr, faction'),
  ]);

  // powerMap[leagueId][playerId] = { power, restored }
  const powerMap: Record<string, Record<string, { power: string; restored: boolean }>> = {};
  for (const row of (powerRows ?? [])) {
    if (!powerMap[row.league_id]) powerMap[row.league_id] = {};
    powerMap[row.league_id][row.player_id] = { power: row.power, restored: row.restored_at != null };
  }

  // biteMap[leagueId][targetPlayerId] = biting_member_id
  const biteMap: Record<string, Record<string, string>> = {};
  for (const row of (biteRows ?? [])) {
    if (!biteMap[row.league_id]) biteMap[row.league_id] = {};
    biteMap[row.league_id][row.target_player_id] = row.biting_member_id;
  }

  // rosterMap[memberId] = [playerId, ...]
  const rosterMap: Record<string, string[]> = {};
  for (const r of (rosterRows ?? [])) {
    if (!rosterMap[r.member_id]) rosterMap[r.member_id] = [];
    rosterMap[r.member_id].push(r.player_id);
  }

  // lineupMap[memberId] = Set<playerId>
  const lineupMap: Record<string, Set<string>> = {};
  for (const l of (lineupRows ?? [])) {
    if (!lineupMap[l.member_id]) lineupMap[l.member_id] = new Set();
    lineupMap[l.member_id].add(l.player_id);
  }

  // memberFactionMap[memberId] = faction
  const memberFactionMap: Record<string, string> = {};
  for (const m of (memberFactionRows ?? [])) {
    if (m.faction) memberFactionMap[m.id] = m.faction;
  }

  // teamFactionMap[abbr] = faction
  const teamFactionMap: Record<string, string> = {};
  for (const t of (nflTeamRows ?? [])) {
    if (t.abbr && t.faction) teamFactionMap[t.abbr] = t.faction;
  }

  // factionBonusMap[memberId] = pts (+0.5 per active player on matching-faction NFL team)
  const factionBonusMap: Record<string, number> = {};
  for (const r of (rosterWithTeamRows ?? [])) {
    const mf = memberFactionMap[r.member_id];
    const pt = (r.players as any)?.team as string | null;
    const tf = pt ? teamFactionMap[pt] : null;
    if (mf && tf && mf === tf) factionBonusMap[r.member_id] = (factionBonusMap[r.member_id] ?? 0) + 0.5;
  }

  // ── First pass: score each player ─────────────────────────────────────
  const playerScoreCache: Record<string, Record<string, { pts: number; proj: number }>> = {};

  for (const matchup of matchupRows as any[]) {
    const settings     = settingsMap[matchup.league_id] ?? {};
    const leaguePowers = powerMap[matchup.league_id]    ?? {};
    const lineupSet    = lineupMap[matchup.member_id];
    const scoringIds   = lineupSet ? [...lineupSet] : (rosterMap[matchup.member_id] ?? []);

    if (!playerScoreCache[matchup.member_id]) playerScoreCache[matchup.member_id] = {};

    for (const playerId of scoringIds) {
      const stats    = allStats[playerId] ?? {};
      const projData = allProj[playerId]  ?? {};
      const base     = calcScore(stats,    settings);
      const baseProj = calcScore(projData, settings);
      let pts  = base;
      let proj = baseProj;

      const pe = leaguePowers[playerId];
      if (pe && pe.power !== 'time_stone' && pe.power !== 'vampire_bite') {
        if (!(pe.power === 'power_negation' && pe.restored)) {
          pts  += applyDraftPower(pe.power, stats,    base,     settings);
          proj += applyDraftPower(pe.power, projData, baseProj, settings);
        }
      }
      playerScoreCache[matchup.member_id][playerId] = { pts, proj };
    }
  }

  // ── Second pass: Vampire Bite siphon ──────────────────────────────────
  const vampireSiphon: Record<string, { pts: number; proj: number }> = {};

  for (const leagueId of leagueIds) {
    for (const [targetId, biterId] of Object.entries(biteMap[leagueId] ?? {})) {
      for (const playerScores of Object.values(playerScoreCache)) {
        if (playerScores[targetId] != null) {
          if (!vampireSiphon[biterId]) vampireSiphon[biterId] = { pts: 0, proj: 0 };
          vampireSiphon[biterId].pts  += playerScores[targetId].pts  * 0.1;
          vampireSiphon[biterId].proj += playerScores[targetId].proj * 0.1;
          break;
        }
      }
    }
  }

  // ── Third pass: aggregate totals + upsert ─────────────────────────────
  const updates = (matchupRows as any[]).map(async (matchup) => {
    const scores = playerScoreCache[matchup.member_id] ?? {};
    let pts  = Object.values(scores).reduce((s, p) => s + p.pts,  0);
    let proj = Object.values(scores).reduce((s, p) => s + p.proj, 0);

    const siphon = vampireSiphon[matchup.member_id];
    if (siphon) { pts += siphon.pts; proj += siphon.proj; }

    const fb = factionBonusMap[matchup.member_id] ?? 0;
    pts  += fb;
    proj += fb;

    return supabase.from('uff_matchups').update({
      points:    Math.round(pts  * 100) / 100,
      projected: Math.round(proj * 100) / 100,
    }).eq('id', matchup.id);
  });

  await Promise.all(updates);

  return new Response(
    JSON.stringify({ updated: matchupRows.length, week, season }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
