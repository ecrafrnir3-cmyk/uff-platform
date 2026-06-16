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
 * Apply a tied-to-pick draft power bonus on top of a player's base score.
 * Returns the ADDITIONAL points to add (0 if no effect).
 *
 * Handled here: Gunslinger, Berserker Rage, Reception Specialist,
 * Iron Defense, Red Zone Menace, Goal Line Hammer, Seam Buster, Sniper, Power Negation.
 *
 * NOT handled here (separate systems):
 *   - Time Stone: requires injury tracking + frozen-score lookup
 *   - Vampire Bite: siphon across rosters, applied at team-score level
 */
function applyDraftPower(
  power: string,
  stats: Record<string, number>,
  baseScore: number,
  settings: Record<string, number>
): number {
  switch (power) {
    case 'gunslinger':
      // +1 pt per passing TD on top of league scoring
      return (stats['pass_td'] ?? 0) * 1;

    case 'berserker_rage':
      // +0.1 pt per rushing yard on top of league scoring
      return (stats['rush_yd'] ?? 0) * 0.1;

    case 'reception_specialist':
      // +0.5 PPR on top of existing PPR
      return (stats['rec'] ?? 0) * 0.5;

    case 'iron_defense':
      // D/ST score doubled — add baseScore again
      return baseScore;

    case 'red_zone_menace':
      // WR: +1 pt per receiving TD
      return (stats['rec_td'] ?? 0) * 1;

    case 'goal_line_hammer':
      // RB: +1 pt per rushing TD
      return (stats['rush_td'] ?? 0) * 1;

    case 'seam_buster':
      // TE: +1 pt per receiving TD
      return (stats['rec_td'] ?? 0) * 1;

    case 'sniper':
      // K: 50+ yard FGs worth double — add the league's fgm_50p value once more per make
      return (stats['fgm_50p'] ?? 0) * (settings['fgm_50p'] ?? 0);

    case 'power_negation':
      // Player's score halved — subtract half of base (net = 0.5x)
      return -(baseScore / 2);

    default:
      return 0;
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
  const allProj: Record<string, Record<string, number>> = projRes.ok ? await projRes.json() : {};

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
  const { data: leagues } = await supabase
    .from('uff_leagues')
    .select('id, scoring_settings')
    .in('id', leagueIds);

  const settingsMap: Record<string, Record<string, number>> = {};
  for (const lg of (leagues ?? [])) settingsMap[lg.id] = lg.scoring_settings ?? {};

  // Fetch all player draft powers for active leagues
  const { data: powerRows } = await supabase
    .from('player_draft_powers')
    .select('league_id, player_id, power')
    .in('league_id', leagueIds);

  // powerMap[leagueId][playerId] = power
  const powerMap: Record<string, Record<string, string>> = {};
  for (const row of (powerRows ?? [])) {
    if (!powerMap[row.league_id]) powerMap[row.league_id] = {};
    powerMap[row.league_id][row.player_id] = row.power;
  }

  const memberIds = [...new Set(matchupRows.map((m: any) => m.member_id))];

  const { data: rosterRows } = await supabase
    .from('uff_roster_players')
    .select('member_id, player_id')
    .in('member_id', memberIds)
    .is('dropped_at', null)
    .eq('slot', 'active');

  const rosterMap: Record<string, string[]> = {};
  for (const r of (rosterRows ?? [])) {
    if (!rosterMap[r.member_id]) rosterMap[r.member_id] = [];
    rosterMap[r.member_id].push(r.player_id);
  }

  const { data: lineupRows } = await supabase
    .from('uff_lineups')
    .select('member_id, player_id')
    .in('member_id', memberIds)
    .eq('week', week);

  const lineupMap: Record<string, Set<string>> = {};
  for (const l of (lineupRows ?? [])) {
    if (!lineupMap[l.member_id]) lineupMap[l.member_id] = new Set();
    lineupMap[l.member_id].add(l.player_id);
  }

  let updated = 0;
  for (const matchup of matchupRows as any[]) {
    const settings     = settingsMap[matchup.league_id] ?? {};
    const leaguePowers = powerMap[matchup.league_id]    ?? {};
    const activeIds    = rosterMap[matchup.member_id]   ?? [];
    const lineupSet    = lineupMap[matchup.member_id];
    const scoringIds   = lineupSet ? [...lineupSet] : activeIds;

    let totalPoints    = 0;
    let totalProjected = 0;

    for (const pid of scoringIds) {
      const playerStats = allStats[pid] ?? {};
      const playerProj  = allProj[pid]  ?? {};

      let pts  = Object.keys(playerStats).length ? calcScore(playerStats, settings) : 0;
      let proj = Object.keys(playerProj).length  ? calcScore(playerProj,  settings) : 0;

      // Apply tied-to-pick draft power if this player has one in this league
      const power = leaguePowers[pid];
      if (power) {
        pts  += applyDraftPower(power, playerStats, pts,  settings);
        proj += applyDraftPower(power, playerProj,  proj, settings);
      }

      totalPoints    += pts;
      totalProjected += proj;
    }

    const { data: bonus } = await supabase.rpc('calculate_faction_roster_bonus', {
      p_member_id: matchup.member_id,
    });
    totalPoints += bonus ?? 0;

    totalPoints    = Math.round(totalPoints    * 100) / 100;
    totalProjected = Math.round(totalProjected * 100) / 100;

    await supabase
      .from('uff_matchups')
      .update({ points: totalPoints, projected: totalProjected })
      .eq('id', matchup.id);

    updated++;
  }

  return new Response(
    JSON.stringify({ updated, week, season }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
