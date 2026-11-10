// The twelve call sites, as the harness sees them. For each site:
//   assemble(c)  reads the case's database snapshot with the SAME query chains the route runs (through
//                the fake Supabase client, over tools/qa/fixtures) and calls the route's own exported
//                builder from src/lib/ai-prompts/, returning the exact request body the route would POST
//   shown(data)  what the route (and its page) would show for a raw API reply, using the route's own
//                exported reader: TODAY'S code (first content block only, except chat's stream)
//   format(...)  whether the reply parses the way the route and its page expect
//   limit        the length the site's own prompt asks for, in words
//   voice        the register the site's own prompt asks for (for the grader)
//   cap          the site's max_tokens in the ORIGINAL code (b01a33f, Haiku 4.5); check-parity maps the
//                harness request back to it when it compares against the original files
// shown() uses the route's own reader, so it measures whatever the code reads: first block before the
// swap commit, every text block after it.
// tools/qa/check-parity.mjs proves assemble() builds byte-for-byte what each handler sends.
import { registerLoader } from './loader/register.mjs';
import { createClient } from './fakes/supabase.mjs';
import { caseDb, helpers } from './cases.mjs';

registerLoader();
const B = {
  startSit: await import('../../src/lib/ai-prompts/start-sit.ts'),
  chat: await import('../../src/lib/ai-prompts/chat.ts'),
  oracle: await import('../../src/lib/ai-prompts/oracle.ts'),
  preview: await import('../../src/lib/ai-prompts/matchup-preview.ts'),
  rankings: await import('../../src/lib/ai-prompts/power-rankings.ts'),
  draft: await import('../../src/lib/ai-prompts/draft-advisor.ts'),
  token: await import('../../src/lib/ai-prompts/token-advisor.ts'),
  trades: await import('../../src/lib/ai-prompts/trades.ts'),
  waiver: await import('../../src/lib/ai-prompts/waiver-intel.ts'),
  newsletter: await import('../../src/lib/ai-prompts/newsletter.ts'),
};
export { B as BUILDERS };

// Point the fake Supabase at this case's snapshot, signed in as the case's caller.
export function useCase(F, c) {
  const H = helpers(F);
  const userId = c.asCommissioner ? H.league.commissioner_id : c.memberId ? H.members.find((m) => m.id === c.memberId).user_id : null;
  globalThis.__QA__ = {
    db: caseDb(F, c), user: userId ? { id: userId } : null, week: weekSeen(c),
    writes: [], emails: [], templates: [], notifications: [], anthropic: [], sleeper: [],
    sleeperData: F.sleeper[c.week]?.players ?? {},
  };
  return globalThis.__QA__;
}

// The week getCurrentNFLWeek() returns when the case's call is made.
export function weekSeen(c) {
  if (c.site === 'chat') return c.chatWeek;
  if (c.site === 'power-rankings') return c.currentWeek;
  if (c.site === 'newsletter') return c.week + 1; // Wednesday after the week: raw week already rolled
  if (c.site === 'draft-advisor') return 1;
  return c.phase === 'pre' ? c.week : c.week + 1;
}

const words = (t) => (t.match(/[A-Za-z0-9][A-Za-z0-9'’.,%$-]*/g) || []).length;

// The reply text each page shows, with today's readers.
const firstBlock = (reader) => (data) => reader(data);
// /api/chat forwards the SSE stream; ChatInterface.tsx appends parsed.delta.text ?? parsed.delta.content
// for every "data:" line. Thinking and signature deltas carry neither field, so the page shows the
// concatenation of every text delta: the same as joining every text block of the finished message.
export function chatShown(sseText) {
  let out = '';
  for (const line of sseText.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') break;
    try { const parsed = JSON.parse(data); const delta = parsed?.delta?.text ?? parsed?.delta?.content ?? ''; if (delta) out += delta; } catch { /* partial */ }
  }
  return out;
}

// What the proposed fix shows: every text block, joined.
export function joinedText(data) {
  return (data?.content ?? []).filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
}

const verdictLine = (t, re) => t.split('\n').map((l) => l.trim()).find((l) => re.test(l));

export const SITES = {
  'start-sit': {
    file: 'src/app/api/start-sit/route.ts', cap: 300, limit: 150, oracle: false,
    voice: 'Plain, direct advisor: "no fluff, just moves". Any starter marked as scoring zero is named FIRST with a specific bench replacement. No theatrics.',
    async assemble(F, c, sb, S) {
      const leagueId = c.request.league_id;
      const { data: me } = await sb.from('league_members').select('id, team_name, faction').eq('league_id', leagueId).eq('user_id', S.user.id).maybeSingle();
      const { data: league } = await sb.from('uff_leagues').select('season, lineup_slots, scoring_settings').eq('id', leagueId).maybeSingle();
      const week = S.week;
      const [{ data: rosterRows }, { data: lineupRows }, { data: scheduleRows }] = await Promise.all([
        sb.from('uff_roster_players').select('player_id, slot, players(full_name, position, team, injury_status)').eq('member_id', me.id).is('dropped_at', null),
        sb.from('uff_lineups').select('slot, player_id').eq('member_id', me.id).eq('week', week),
        sb.from('uff_game_schedule').select('team').eq('season', Number(league.season)).eq('week', week),
      ]);
      const activeRoster = B.startSit.startSitActiveRoster(rosterRows);
      if (activeRoster.length === 0) return { refused: 'No active roster found' };
      const scoringSettings = league.scoring_settings ?? {};
      const projMap = {};
      if (Object.keys(scoringSettings).length > 0) B.startSit.fillStartSitProjections(projMap, activeRoster, S.sleeperData, scoringSettings);
      const prompt = B.startSit.buildStartSitPrompt({ week, me, lineupSlots: league.lineup_slots, activeRoster, lineupRows, scheduleRows, projMap });
      return { body: B.startSit.startSitRequest(prompt) };
    },
    shown: firstBlock((d) => B.startSit.readStartSitReply(d)),
    format: (t) => (t ? null : 'empty: the page shows the error "No advice returned"'),
  },

  chat: {
    file: 'src/app/api/chat/route.ts', cap: 400, limit: 180, oracle: false, stream: true,
    voice: 'The League Assistant: knowledgeable, witty, "concise and direct", light personality ("a fantasy football war room, not a help desk"); says so honestly when it lacks the data.',
    async assemble(F, c, sb, S) {
      const leagueId = c.request.league_id;
      const { data: me } = await sb.from('league_members').select('id, team_name, faction').eq('league_id', leagueId).eq('user_id', S.user.id).maybeSingle();
      const [{ data: league }, { data: members }, { data: matchupRows }, { data: rosterRows }, { data: powerRows }] = await Promise.all([
        sb.from('uff_leagues').select('name, waiver_type, median_scoring, commissioner_id').eq('id', leagueId).maybeSingle(),
        sb.from('league_members').select('id, team_name, faction, waiver_priority').eq('league_id', leagueId),
        sb.from('uff_matchups').select('matchup_id, member_id, week, points, is_complete').eq('league_id', leagueId).order('week', { ascending: false }),
        sb.from('uff_roster_players').select('member_id, player_id, added_at, dropped_at, week_added, players(full_name)').eq('league_id', leagueId).order('added_at', { ascending: false }).limit(60),
        sb.from('draft_powers').select('name, category, description').order('id'),
      ]);
      const system = B.chat.buildChatSystemPrompt({ week: S.week, league, me, members, matchupRows, rosterRows, powerRows });
      return { body: B.chat.chatRequest(system, c.request.messages) };
    },
    shown: (data) => joinedText(data), // see chatShown(): the stream shows every text delta
    format: (t) => (t ? null : 'empty: the chat bubble stays blank'),
  },

  oracle: {
    file: 'src/app/api/oracle/route.ts', cap: 200, limit: 120, oracle: true,
    voice: 'The Oracle: a mystical, dramatic voice delivering the recap as an ancient prophecy, with gravitas and flair, referencing factions (Heroes vs Villains) and tokens; 3-4 sentences of flowing prose, no headers or bullets.',
    async assemble(F, c, sb, S) {
      const { data: rows } = await sb.from('uff_matchups').select('id, member_id, week, points, token_bonus, is_complete, oracle_recap, league_members(team_name, faction)').eq('matchup_id', c.request.matchup_id).eq('league_id', c.request.league_id);
      if (!rows || rows.length < 2) return { refused: 'Matchup not found' };
      if (!rows.every((r) => r.is_complete)) return { refused: 'Matchup not finalized yet' };
      if (rows[0].oracle_recap ?? rows[1]?.oracle_recap) return { refused: 'cached recap' };
      const [a, b] = rows;
      const { data: tokenRows } = await sb.from('weekly_token_assignments').select('member_id, token_id, status').in('member_id', [a.member_id, b.member_id]).eq('week', a.week);
      return { body: B.oracle.oracleRequest(B.oracle.buildOraclePrompt(rows, tokenRows)) };
    },
    shown: firstBlock((d) => B.oracle.readOracleReply(d)),
    format: (t) => (t ? null : 'empty: the page shows "Oracle returned no vision"'),
  },

  'matchup-preview': {
    file: 'src/app/api/matchup-preview/route.ts', cap: 200, limit: 120, oracle: true,
    voice: 'The Oracle: a prophetic pre-game preview with drama and flair; names both teams, factions, records and projections; hints at tokens without revealing a hidden one; 3-4 sentences of flowing prose.',
    async assemble(F, c, sb, S) {
      const { data: me } = await sb.from('league_members').select('id').eq('league_id', c.request.league_id).eq('user_id', S.user.id).maybeSingle();
      const { data: rows } = await sb.from('uff_matchups').select('id, member_id, week, points, projected, is_complete, league_members(team_name, faction)').eq('matchup_id', c.request.matchup_id).eq('league_id', c.request.league_id);
      if (!rows || rows.length < 2) return { refused: 'Matchup not found' };
      if (rows.every((r) => r.is_complete)) return { refused: 'Matchup already complete' };
      const [a, b] = rows;
      const { data: tokenRows } = await sb.from('weekly_token_assignments').select('member_id, token_id, status').in('member_id', [a.member_id, b.member_id]).eq('week', a.week).eq('league_id', c.request.league_id);
      const { data: allMatchups } = await sb.from('uff_matchups').select('matchup_id, member_id, points').eq('league_id', c.request.league_id).eq('is_complete', true);
      return { body: B.preview.matchupPreviewRequest(B.preview.buildMatchupPreviewPrompt({ rows, tokenRows, allMatchups, meId: me.id })) };
    },
    shown: firstBlock((d) => B.preview.readMatchupPreviewReply(d)),
    format: (t) => (t ? null : 'empty: the page shows "Oracle returned no vision"'),
  },

  'power-rankings': {
    file: 'src/app/api/power-rankings/route.ts', cap: 600, limit: null, oracle: true,
    voice: 'The Oracle as an opinionated power ranker: every team ranked, each with exactly 2 sentences (why here, what to watch); confident and pointed; no intro or outro.',
    async assemble(F, c, sb, S) {
      const { data: allRows } = await sb.from('uff_matchups').select('matchup_id, member_id, week, points, is_complete, void_result, league_members(team_name, faction)').eq('league_id', c.request.league_id).eq('is_complete', true).order('week', { ascending: true });
      const rows = allRows ?? [];
      if (rows.length < 2) return { refused: 'Not enough game data' };
      return { body: B.rankings.powerRankingsRequest(B.rankings.buildPowerRankingsPrompt(rows, S.week)), teams: new Set(rows.map((r) => r.member_id)).size };
    },
    shown: firstBlock((d) => B.rankings.readPowerRankingsReply(d)),
    // PowerRankingsCard.tsx keeps lines starting with "#", reads the rank from /^#(\d+)\./ and splits the
    // team from the analysis at the first dash; with no such line it falls back to raw text.
    format(t, meta) {
      if (!t) return 'empty: the card shows "Oracle returned no rankings"';
      const lines = t.split('\n').filter((l) => l.trim().startsWith('#'));
      const ranks = lines.map((l) => (l.match(/^#(\d+)\./) || [])[1]).filter(Boolean).map(Number);
      const n = meta?.teams ?? 14;
      if (ranks.length === 0) return 'no "#N." lines: the card falls back to raw text';
      const want = Array.from({ length: n }, (_, i) => i + 1);
      if (ranks.length !== n || want.some((r) => !ranks.includes(r))) return `ranked ${ranks.length} of ${n} teams`;
      return null;
    },
  },

  'draft-advisor': {
    file: 'src/app/api/draft-advisor/route.ts', cap: 200, limit: 90, oracle: true,
    voice: 'The Oracle Draft Advisor: concise draft advice in 2-3 sentences, no intro, then a PICK line.',
    async assemble(F, c, sb, S) {
      const leagueId = c.request.league_id;
      const { data: me } = await sb.from('league_members').select('id, team_name, faction').eq('league_id', leagueId).eq('user_id', S.user.id).maybeSingle();
      const { data: league } = await sb.from('uff_leagues').select('max_teams, draft_rounds, draft_status').eq('id', leagueId).maybeSingle();
      if (league.draft_status !== 'in_progress') return { refused: 'Draft is not in progress' };
      const { data: allPicks } = await sb.from('uff_draft_picks').select('member_id, player_id, round, pick_no, players(full_name, position, team)').eq('league_id', leagueId).order('pick_no', { ascending: true });
      const { data: allPlayers } = await sb.from('players').select('id, full_name, position, team, adp').not('position', 'is', null).order('adp', { ascending: true, nullsFirst: false }).limit(200);
      const built = B.draft.buildDraftAdvisorPrompt({ me, league, allPicks, allPlayers });
      if (built.available.length === 0) return { refused: 'No available player data found' };
      return { body: B.draft.draftAdvisorRequest(built.prompt), available: built.available.map((p) => p.full_name) };
    },
    shown: firstBlock((d) => B.draft.readDraftAdvisorReply(d)),
    // DraftRoom.tsx highlights advice.match(/PICK:\s*(.+)/i) and shows the rest as prose.
    format(t, meta) {
      if (!t) return 'empty: the room shows "Oracle returned no advice"';
      const m = t.match(/PICK:\s*(.+)/i);
      if (!m) return 'no PICK: line to highlight';
      const name = m[1].replace(/\*+/g, '').replace(/\s*\(.*$/, '').trim().toLowerCase();
      if (meta?.available && !meta.available.some((n) => n.toLowerCase() === name)) return `PICK names "${m[1].trim().slice(0, 60)}", not a player in the available list`;
      return null;
    },
  },

  'token-advisor': {
    file: 'src/app/api/token-advisor/route.ts', cap: 200, limit: 110, oracle: true,
    voice: 'The Oracle as an expert strategist: concise, actionable, specific and tactical advice in 3-4 sentences (use it or hold it; the choice it needs, if any).',
    async assemble(F, c, sb, S) {
      const leagueId = c.request.league_id, week = c.request.week;
      const { data: me } = await sb.from('league_members').select('id, team_name, faction').eq('league_id', leagueId).eq('user_id', S.user.id).maybeSingle();
      const { data: tokenRow } = await sb.from('weekly_token_assignments').select('token_id, status, choice').eq('league_id', leagueId).eq('member_id', me.id).eq('week', week).maybeSingle();
      if (!tokenRow || tokenRow.status !== 'pending') return { refused: 'No active token to advise on' };
      const tokenInfo = B.token.TOKEN_INFO[tokenRow.token_id];
      if (!tokenInfo) return { refused: 'Unknown token' };
      const { data: allMatchups } = await sb.from('uff_matchups').select('matchup_id, member_id, points').eq('league_id', leagueId).eq('is_complete', true);
      const { data: myMatchupRow } = await sb.from('uff_matchups').select('matchup_id, projected').eq('league_id', leagueId).eq('member_id', me.id).eq('week', week).maybeSingle();
      let oppRow = null;
      if (myMatchupRow) ({ data: oppRow } = await sb.from('uff_matchups').select('projected, league_members(team_name, faction)').eq('league_id', leagueId).eq('matchup_id', myMatchupRow.matchup_id).eq('week', week).neq('member_id', me.id).maybeSingle());
      const { data: rosterRaw } = await sb.from('uff_roster_players').select('player_id, players(full_name, position)').eq('member_id', me.id).eq('slot', 'active').is('dropped_at', null);
      return { body: B.token.tokenAdvisorRequest(B.token.buildTokenAdvisorPrompt({ me, tokenInfo, allMatchups, myMatchupRow, oppRow, rosterRaw })) };
    },
    shown: firstBlock((d) => B.token.readTokenAdvisorReply(d)),
    format: (t) => (t ? null : 'empty: the page shows "Oracle returned no guidance"'),
  },

  'trade-eval': {
    file: 'src/app/api/trade-eval/route.ts', cap: 250, limit: 130, oracle: true,
    voice: 'The Oracle as a precise trade analyst who "tells it straight": 3-4 sentences on who benefits and why, then the verdict line.',
    async assemble(F, c, sb, S) {
      const r = c.request;
      const { data: me } = await sb.from('league_members').select('id, team_name, faction').eq('league_id', r.league_id).eq('user_id', S.user.id).maybeSingle();
      const { data: partner } = await sb.from('league_members').select('id, team_name, faction').eq('id', r.partner_member_id).maybeSingle();
      const ids = [...new Set([...r.proposer_player_ids, ...r.receiver_player_ids])];
      const { data: playerRows } = await sb.from('players').select('id, full_name, position, team').in('id', ids);
      const { data: allMatchups } = await sb.from('uff_matchups').select('matchup_id, member_id, points').eq('league_id', r.league_id).eq('is_complete', true);
      return { body: B.trades.tradeEvalRequest(B.trades.buildTradeEvalPrompt({ me, partner, playerRows, allMatchups, proposerPlayerIds: r.proposer_player_ids, receiverPlayerIds: r.receiver_player_ids })) };
    },
    shown: firstBlock((d) => B.trades.readTradeEvalReply(d)),
    // TradeEvaluator.tsx takes the line that startsWith("VERDICT:") as the verdict (coloured green for
    // FAIR, red for AVOID, gold otherwise) and shows the other lines as the body.
    format(t) {
      if (!t) return 'empty: the page shows "Oracle returned no verdict"';
      const lines = t.split('\n');
      const v = lines.find((l) => l.startsWith('VERDICT:'));
      if (!v) return verdictLine(t, /VERDICT:/) ? 'verdict not at the start of a line (markdown bold or inline): shown uncoloured inside the body' : 'no VERDICT: line';
      if (!/FAIR|SLIGHT EDGE|AVOID/.test(v)) return `verdict line names none of FAIR / SLIGHT EDGE / AVOID: "${v.trim().slice(0, 70)}"`;
      return null;
    },
  },

  'trade-veto': {
    file: 'src/app/api/trade-veto-analysis/route.ts', cap: 250, limit: 110, oracle: false,
    voice: 'Direct and fair advice to a commissioner: 2-3 sentences, then "VERDICT: APPROVE — reason" or "VERDICT: VETO — reason" on its own line. No theatrics.',
    async assemble(F, c, sb, S) {
      const r = c.request;
      const { data: league } = await sb.from('uff_leagues').select('commissioner_id, name').eq('id', r.league_id).maybeSingle();
      if (league.commissioner_id !== S.user.id) return { refused: 'not commissioner' };
      const { data: trade } = await sb.from('uff_trades').select('proposer_id, receiver_id, proposer_player_ids, receiver_player_ids').eq('id', r.trade_id).maybeSingle();
      const ids = [...new Set([...trade.proposer_player_ids, ...trade.receiver_player_ids])];
      const [{ data: playerRows }, { data: proposerMember }, { data: receiverMember }, { data: allMatchups }] = await Promise.all([
        sb.from('players').select('id, full_name, position, team').in('id', ids),
        sb.from('league_members').select('team_name, faction').eq('id', trade.proposer_id).maybeSingle(),
        sb.from('league_members').select('team_name, faction').eq('id', trade.receiver_id).maybeSingle(),
        sb.from('uff_matchups').select('matchup_id, member_id, points').eq('league_id', r.league_id).eq('is_complete', true),
      ]);
      return { body: B.trades.tradeVetoRequest(B.trades.buildTradeVetoPrompt({ trade, playerRows, proposerMember, receiverMember, allMatchups })) };
    },
    shown: firstBlock((d) => B.trades.readTradeVetoReply(d)),
    // The route extracts /VERDICT:\s*(APPROVE|VETO)/i; VetoAnalyzer.tsx shows the text before "VERDICT:".
    format(t) {
      if (!t) return 'empty: the page shows "No analysis returned"';
      if (!B.trades.tradeVetoVerdict(t)) return 'no APPROVE/VETO verdict the route can extract';
      return null;
    },
  },

  'trade-actions': {
    file: 'src/app/dashboard/league/[id]/trade-actions.ts', cap: 200, limit: 110, oracle: true,
    voice: 'The Oracle, brief: a 2-3 sentence analysis of who benefits and why, ending with exactly one verdict line. It goes into the receiving manager\'s trade-offer email.',
    async assemble(F, c, sb, S) {
      const r = c.request;
      const { data: proposer } = await sb.from('league_members').select('id, team_name, faction').eq('league_id', r.leagueId).eq('user_id', S.user.id).maybeSingle();
      const names = async (ids) => { if (ids.length === 0) return []; const { data } = await sb.from('players').select('id, full_name').in('id', ids); const m = {}; for (const p of data ?? []) m[p.id] = p.full_name; return ids.map((id) => m[id] ?? id); };
      const [pNames, rNames] = [await names(r.proposerPlayer), await names(r.receiverPlayer)];
      const [{ data: allMatchups }, { data: receiverMember }] = await Promise.all([
        sb.from('uff_matchups').select('matchup_id, member_id, points').eq('league_id', r.leagueId).eq('is_complete', true),
        sb.from('league_members').select('team_name, faction').eq('id', r.receiverId).maybeSingle(),
      ]);
      return { body: B.trades.proposeTradeAnalysisRequest(B.trades.buildProposeTradeAnalysisPrompt({ proposer, receiverId: r.receiverId, receiverMember, allMatchups, pNames, rNames })) };
    },
    shown: firstBlock((d) => B.trades.readProposeTradeAnalysisReply(d) ?? ''),
    // Nothing parses it: the text goes into the email as it is. The prompt asks it to END with one of
    // the three verdicts, so the check is that the reply ends with a verdict.
    format(t) {
      if (!t) return 'empty: the email goes out with no Oracle analysis';
      const tail = t.replace(/[*_\s.]+$/, '');
      const at = tail.lastIndexOf('VERDICT:');
      if (at < 0) return 'no VERDICT: anywhere';
      if (tail.slice(at).includes('\n\n') || !/^VERDICT:\s*\**\s*(FAIR|SLIGHT EDGE TO|AVOID)/.test(tail.slice(at))) return `does not end with a verdict: "${tail.slice(at, at + 70)}"`;
      return null;
    },
  },

  'waiver-intel': {
    file: 'src/app/api/waiver-intel/route.ts', cap: 120, limit: 60, oracle: false,
    voice: 'A fantasy analyst: exactly 1-2 sentences, direct and specific about whether to add the player given the roster.',
    async assemble(F, c, sb, S) {
      const { data: me } = await sb.from('league_members').select('id').eq('league_id', c.request.league_id).eq('user_id', S.user.id).maybeSingle();
      const { data: player } = await sb.from('players').select('id, full_name, position, team, status').eq('id', c.request.player_id).maybeSingle();
      if (!player) return { refused: 'Player not found' };
      const { data: rosterRaw } = await sb.from('uff_roster_players').select('players(full_name, position)').eq('member_id', me.id).eq('slot', 'active').is('dropped_at', null);
      return { body: B.waiver.waiverIntelRequest(B.waiver.buildWaiverIntelPrompt(player, rosterRaw)) };
    },
    shown: firstBlock((d) => B.waiver.readWaiverIntelReply(d)),
    format: (t) => (t ? null : 'empty: the page shows "No intel returned"'),
  },

  newsletter: {
    file: 'src/app/api/cron/generate-newsletter/route.ts', cap: 1200, limit: 450, oracle: true,
    voice: 'The Oracle-Correspondent: a charismatic sports columnist with dramatic flair; bold, witty, dramatic; five paragraphs (opening, game of the week, around the league, power rankings, faction war and closing); pure prose with no headers, bullets or markdown.',
    async assemble(F, c, sb, S) {
      const H = helpers(F);
      const league = { id: H.league.id, name: H.league.name };
      const week = c.request.week;
      const { data: weekRows } = await sb.from('uff_matchups').select('matchup_id, member_id, points, token_bonus, is_complete, league_members(team_name, faction)').eq('league_id', league.id).eq('week', week);
      const weekMatchups = weekRows ?? [];
      if (!weekMatchups.some((r) => r.is_complete) || weekMatchups.length < 2) return { refused: 'No complete matchups' };
      const { data: allRows } = await sb.from('uff_matchups').select('matchup_id, member_id, points, token_bonus, is_complete, league_members(team_name, faction)').eq('league_id', league.id).eq('is_complete', true);
      const memberIds = [...new Set(weekMatchups.map((r) => r.member_id))];
      const { data: tokenRows } = await sb.from('weekly_token_assignments').select('member_id, token_id, status').eq('league_id', league.id).eq('week', week).in('member_id', memberIds);
      return { body: B.newsletter.newsletterRequest(B.newsletter.buildNewsletterPrompt({ league, week, weekMatchups, allCompleted: allRows ?? [], tokenRows })) };
    },
    shown: firstBlock((d) => B.newsletter.readNewsletterReply(d)),
    // The route refuses to store (and so to email) a reply that is empty, cut off, or unfinished.
    format: (t, meta, data) => B.newsletter.newsletterProblem(data ?? {}, t),
  },
};

export async function assemble(F, c) {
  const S = useCase(F, c);
  const site = SITES[c.site];
  const sb = createClient();
  const out = await site.assemble(F, c, sb, S);
  return { ...out, keyText: out.body ? keyTextOf(out.body) : null };
}

// What the model was given, as text: the system prompt (chat) and every message.
export function keyTextOf(body) {
  const parts = [];
  if (body.system) parts.push(`SYSTEM PROMPT:\n${body.system}`);
  for (const m of body.messages) parts.push(`${m.role.toUpperCase()}:\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`);
  return parts.join('\n\n');
}

export function lengthCheck(siteName, text, meta) {
  const site = SITES[siteName];
  const n = words(text || '');
  let limit = site.limit;
  if (siteName === 'power-rankings') limit = (meta?.teams ?? 14) * 55;
  return { words: n, limit, pass: !text ? false : n <= limit };
}

export function markdownIn(siteName, text) {
  if (!text) return false;
  const t = siteName === 'power-rankings' ? text.replace(/^#\d+\./gm, '') : text;
  return /\*\*|^#{1,6}\s|^\s*[-*]\s|^\s*\d+\.\s/m.test(t);
}
