// The case set, as RULES. This file is committed; it names no team, member or player. Running it
// resolves the rules against tools/qa/fixtures/db.json and writes tools/qa/fixtures/cases.json
// (gitignored), the concrete cases the harness and the parity check use.
//
//   node tools/qa/cases.mjs            build fixtures/cases.json and print counts per site
//
// Teams are labelled T01..T14 in member-id order; labels, not names, are what the report uses.
// Every case says which week and phase it is about:
//   pre  = just before that week's first kickoff (records through the week before; tokens pending;
//          rosters as they stood at kickoff). Used by advice given before games.
//   post = after that week was finalized (records through that week). Used by recaps, rankings,
//          the newsletter, the assistant chat (which then says "WEEK: w+1"), and the trade tools.
// A case marked synthetic changes one thing in the real snapshot to reach an edge (a tie, an
// unloaded schedule, an empty roster, a Recon token); the change is recorded on the case.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures');

export function loadFixture() {
  const f = path.join(FIX, 'db.json');
  if (!fs.existsSync(f)) throw new Error('tools/qa/fixtures/db.json missing: run node tools/qa/capture-fixtures.mjs');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function loadCases() {
  return JSON.parse(fs.readFileSync(path.join(FIX, 'cases.json'), 'utf8'));
}

const POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
const DAY = 86400000;

// ── snapshot helpers ───────────────────────────────────────────────────────────

export function helpers(F) {
  const db = F.db;
  const league = db.uff_leagues[0];
  const members = [...db.league_members].sort((a, b) => (a.id < b.id ? -1 : 1));
  const label = Object.fromEntries(members.map((m, i) => [m.id, `T${String(i + 1).padStart(2, '0')}`]));
  const byLabel = Object.fromEntries(members.map((m) => [label[m.id], m]));
  const players = Object.fromEntries(db.players.map((p) => [p.id, p]));
  const kickoff = (w) => Math.min(...db.uff_game_schedule.filter((s) => s.week === w).map((s) => Date.parse(s.kickoff_utc)));
  const teamsPlaying = (w) => new Set(db.uff_game_schedule.filter((s) => s.week === w).map((s) => s.team));
  const ALL_TEAMS = [...new Set(db.uff_game_schedule.map((s) => s.team))].sort();
  const byeTeams = (w) => { const p = teamsPlaying(w); return p.size >= 20 ? ALL_TEAMS.filter((t) => !p.has(t)) : []; };
  // The moment a phase stands at: before the week's first kickoff, or the day before the next week's.
  const asOf = (week, phase) => (phase === 'pre' ? kickoff(week) - 1 : kickoff(week + 1) - DAY);
  const rosterAsOf = (T) => db.uff_roster_players
    .filter((r) => Date.parse(r.added_at) <= T)
    .map((r) => (r.dropped_at && Date.parse(r.dropped_at) > T ? { ...r, dropped_at: null } : r));
  const activeRoster = (memberId, T) => rosterAsOf(T).filter((r) => r.member_id === memberId && r.dropped_at === null && r.slot === 'active');
  const adp = (id) => players[id]?.adp ?? 9999;
  return { db, league, members, label, byLabel, players, kickoff, teamsPlaying, byeTeams, asOf, rosterAsOf, activeRoster, adp, ALL_TEAMS };
}

// The database as a route would see it for this case (used by the parity check's fake Supabase
// and by the harness's input assembly, so the two read the same rows).
export function caseDb(F, c) {
  const H = helpers(F);
  const { db } = H;
  const T = H.asOf(c.week, c.phase);
  const lastDone = c.phase === 'pre' ? c.week - 1 : c.week;
  const mods = new Set(c.mods || []);
  let matchups = db.uff_matchups
    .filter((m) => m.week <= lastDone || (c.phase === 'pre' && m.week === c.week))
    .map((m) => (c.phase === 'pre' && m.week === c.week ? { ...m, is_complete: false, points: 0, token_bonus: 0 } : { ...m }));
  if (c.tie) {
    // synthetic: both rows of one finished matchup get the same score
    const pair = matchups.filter((m) => m.matchup_id === c.tie.matchup_id);
    const top = Math.max(...pair.map((m) => m.points));
    matchups = matchups.map((m) => (m.matchup_id === c.tie.matchup_id ? { ...m, points: top } : m));
  }
  let tokens = db.weekly_token_assignments
    .filter((t) => t.week <= c.week)
    .map((t) => (c.phase === 'pre' && t.week === c.week ? { ...t, status: 'pending' } : { ...t }));
  if (c.reconFor) {
    // synthetic: the viewer holds Recon (token 9) this week
    tokens = tokens.filter((t) => !(t.week === c.week && t.member_id === c.reconFor));
    tokens.push({ id: 'qa-recon', league_id: H.league.id, member_id: c.reconFor, week: c.week, token_id: 9, choice: null, status: 'pending' });
  }
  let roster = H.rosterAsOf(T);
  if (mods.has('empty-roster')) roster = roster.filter((r) => r.member_id !== c.memberId);
  let lineups = db.uff_lineups.filter((l) => l.week <= c.week);
  if (mods.has('no-lineup')) lineups = lineups.filter((l) => !(l.member_id === c.memberId && l.week === c.week));
  let schedule = db.uff_game_schedule;
  if (mods.has('schedule-unloaded')) schedule = schedule.filter((s) => s.week !== c.week);
  const leagues = [{ ...H.league, ...(c.site === 'draft-advisor' ? { draft_status: 'in_progress' } : {}) }];
  const picks = c.site === 'draft-advisor' ? db.uff_draft_picks.slice(0, c.picksSoFar) : db.uff_draft_picks;
  const trades = c.trade ? [{ id: 'qa-trade', league_id: H.league.id, status: 'pending', ...c.trade }] : [];
  return {
    uff_leagues: leagues,
    league_members: db.league_members,
    uff_matchups: matchups,
    weekly_token_assignments: tokens,
    uff_roster_players: roster,
    uff_lineups: lineups,
    uff_game_schedule: schedule,
    players: db.players,
    draft_powers: db.draft_powers,
    uff_draft_picks: picks,
    uff_trades: trades,
    league_newsletters: [],
  };
}

// ── the rules ───────────────────────────────────────────────────────────────────

function build(F) {
  const H = helpers(F);
  const { db, league, members, label } = H;
  const cases = [];
  const add = (c) => cases.push({ ...c, memberLabel: c.memberId ? label[c.memberId] : null });
  const deadStarters = (memberId, w) => {
    const playing = H.teamsPlaying(w);
    return db.uff_lineups.filter((l) => l.week === w && l.member_id === memberId)
      .filter((l) => { const t = H.players[l.player_id]?.team; return !t || !playing.has(t); }).length;
  };

  // start-sit: 15. Week 8 teams with a starter who scores 0 (bye or no NFL team) first, then clean teams;
  // two each from weeks 7 and 6; two synthetic edges.
  const ss = [];
  const ranked = (w) => members.map((m) => ({ m, n: deadStarters(m.id, w) })).sort((a, b) => b.n - a.n || (label[a.m.id] < label[b.m.id] ? -1 : 1));
  const w8 = ranked(8);
  for (const { m, n } of w8.filter((x) => x.n > 0).slice(0, 7)) ss.push({ week: 8, memberId: m.id, kind: `starter-scores-zero x${n}` });
  for (const { m } of w8.filter((x) => x.n === 0).slice(0, 2)) ss.push({ week: 8, memberId: m.id, kind: 'clean lineup' });
  for (const w of [7, 6]) for (const { m, n } of ranked(w).slice(0, 2)) ss.push({ week: w, memberId: m.id, kind: `starter-scores-zero x${n}` });
  const worst8 = w8[0].m.id;
  ss.push({ week: 8, memberId: worst8, kind: 'no lineup set (synthetic)', mods: ['no-lineup'] });
  ss.push({ week: 8, memberId: w8[1].m.id, kind: 'schedule not loaded: bye data unavailable (synthetic)', mods: ['schedule-unloaded'] });
  ss.forEach((c, i) => add({ site: 'start-sit', id: `start-sit-${String(i + 1).padStart(2, '0')}`, phase: 'pre', ...c, request: { league_id: league.id } }));

  // chat: 18 questions after Week 8 was finalized (the assistant says WEEK: 9).
  const Q = [
    ['standings', 'What are the current standings?'],
    ['own record', "What's my team's record?"],
    ['start advice (no roster data)', 'Who should I start this week?'],
    ['factions', 'How are the faction standings looking?'],
    ['transactions', 'Analyze recent transactions'],
    ['top scorer PF', 'Which team has scored the most points this season?'],
    ['arithmetic gap', 'How many wins am I behind first place, and how many points behind them in PF?'],
    ['rule: Vampire Bite', 'What does Vampire Bite do?'],
    ['rule: Insurance', 'How does the Insurance token work if I win?'],
    ['rule arithmetic: Last Stand', "I'm down 18 points with Last Stand active. Do I get my bench points?"],
    ['rule: Draft Heist status', 'Can I still use Draft Heist?'],
    ['byes (not in data)', 'Which NFL teams are on bye this week?'],
    ['live score (not in data)', "What's the score of my Week 9 game right now?"],
    ['week 8 high score (partial data)', 'Who had the highest score in Week 8?'],
    ['player trade (no player data)', 'Should I trade for Justin Jefferson?'],
    ['clutch gene arithmetic', "If I'm losing 101.5 to 104 with Clutch Gene, what happens?"],
    ['multi-turn follow-up', 'And who is in last place?', [['user', 'What are the current standings?'], ['assistant', 'Here is the top of the table as of Week 8.']]],
    ['multi-turn rule follow-up', 'Does that stack with Gunslinger?', [['user', 'What does Air Raid do?'], ['assistant', 'Air Raid gives each of your starting QBs +1 point per passing TD this week.']]],
  ];
  Q.forEach(([kind, text, hist], i) => {
    const m = members[i % members.length];
    const messages = [...(hist || []).map(([role, content]) => ({ role, content })), { role: 'user', content: text }];
    add({ site: 'chat', id: `chat-${String(i + 1).padStart(2, '0')}`, phase: 'post', week: 8, memberId: m.id, kind, request: { league_id: league.id, messages }, chatWeek: 9 });
  });

  // oracle: 12 finished matchups (all seven of Week 8, the closest, widest and token games of Week 7)
  // and one synthetic tie.
  const pairs = (w) => {
    const by = {};
    for (const m of db.uff_matchups.filter((x) => x.week === w)) (by[m.matchup_id] ??= []).push(m);
    return Object.values(by).filter((p) => p.length === 2).map((p) => ({ id: p[0].matchup_id, a: p[0], b: p[1], margin: Math.abs(p[0].points - p[1].points) }));
  };
  const or = [];
  for (const p of pairs(8)) or.push({ week: 8, matchup: p.id, memberId: p.a.member_id, kind: `week 8 margin ${p.margin.toFixed(0)}` });
  const p7 = pairs(7).sort((x, y) => x.margin - y.margin);
  const tok7 = new Set(db.weekly_token_assignments.filter((t) => t.week === 7).map((t) => t.member_id));
  const pick7 = [p7[0], p7[p7.length - 1], ...p7.filter((p) => tok7.has(p.a.member_id) || tok7.has(p.b.member_id))];
  const seen7 = new Set();
  for (const p of pick7) { if (seen7.has(p.id) || seen7.size >= 4) continue; seen7.add(p.id); or.push({ week: 7, matchup: p.id, memberId: p.b.member_id, kind: p === p7[0] ? 'week 7 closest' : p === p7[p7.length - 1] ? 'week 7 blowout' : 'week 7 token game' }); }
  const closest8 = pairs(8).sort((x, y) => x.margin - y.margin)[0];
  or.push({ week: 8, matchup: closest8.id, memberId: closest8.a.member_id, kind: 'tie (synthetic): both scores equal', tie: { matchup_id: closest8.id } });
  or.forEach((c, i) => add({ site: 'oracle', id: `oracle-${String(i + 1).padStart(2, '0')}`, phase: 'post', ...c, request: { league_id: league.id, matchup_id: c.matchup } }));

  // matchup-preview: 10 pre-game previews: Week 8's seven (viewer in the matchup), one viewer outside
  // it, one synthetic Recon holder, one from Week 7.
  const pv = [];
  for (const p of pairs(8)) pv.push({ week: 8, matchup: p.id, memberId: p.a.member_id, kind: 'viewer in matchup' });
  const p8 = pairs(8);
  const outsider = members.find((m) => m.id !== p8[0].a.member_id && m.id !== p8[0].b.member_id);
  pv.push({ week: 8, matchup: p8[0].id, memberId: outsider.id, kind: 'viewer outside the matchup' });
  pv.push({ week: 8, matchup: p8[1].id, memberId: p8[1].a.member_id, kind: 'viewer holds Recon (synthetic)', reconFor: p8[1].a.member_id });
  pv.push({ week: 7, matchup: pairs(7)[0].id, memberId: pairs(7)[0].b.member_id, kind: 'week 7 viewer in matchup' });
  pv.forEach((c, i) => add({ site: 'matchup-preview', id: `preview-${String(i + 1).padStart(2, '0')}`, phase: 'pre', ...c, request: { league_id: league.id, matchup_id: c.matchup } }));

  // power-rankings: 8, after each of Weeks 1-8.
  for (let w = 1; w <= 8; w++) add({ site: 'power-rankings', id: `rankings-${String(w).padStart(2, '0')}`, phase: 'post', week: w, memberId: members[w % members.length].id, kind: `after week ${w}`, request: { league_id: league.id }, currentWeek: w + 1 });

  // draft-advisor: 10 mid-draft states replayed from the real draft (the manager on the clock at
  // pick N+1 asks). The draft room is simulated as in progress; the player pool is today's.
  const picks = db.uff_draft_picks;
  for (const [i, n] of [0, 13, 41, 70, 99, 127, 156, 185, 205, 222].entries()) {
    add({ site: 'draft-advisor', id: `draft-${String(i + 1).padStart(2, '0')}`, phase: 'post', week: 0, memberId: picks[n].member_id, kind: `before pick ${n + 1} (round ${Math.floor(n / league.max_teams) + 1})`, picksSoFar: n, request: { league_id: league.id } });
  }

  // token-advisor: 12 real tokens from Weeks 6-8, advised before kickoff (status pending).
  const toks = db.weekly_token_assignments.filter((t) => t.week >= 6 && t.week <= 8).sort((a, b) => b.week - a.week || a.token_id - b.token_id);
  const seenTok = new Set();
  const pickT = [];
  for (const t of toks) { const k = `${t.week}:${t.member_id}`; if (seenTok.has(k)) continue; seenTok.add(k); pickT.push(t); }
  pickT.slice(0, 12).forEach((t, i) => add({ site: 'token-advisor', id: `token-${String(i + 1).padStart(2, '0')}`, phase: 'pre', week: t.week, memberId: t.member_id, kind: `token ${t.token_id}, week ${t.week}${deadStarters(t.member_id, t.week) ? `, ${deadStarters(t.member_id, t.week)} starter(s) score 0` : ''}`, tokenId: t.token_id, request: { league_id: league.id, week: t.week } }));

  // Trades (the league has had none): ten proposals built from rosters after Week 8, used by
  // trade-eval, trade-veto-analysis and proposeTrade's Oracle analysis alike.
  const T8 = H.asOf(8, 'post');
  const act = (m) => H.activeRoster(m.id, T8).map((r) => ({ ...r, p: H.players[r.player_id] })).filter((r) => r.p && POS.has(r.p.position));
  const ir = (m) => H.rosterAsOf(T8).filter((r) => r.member_id === m.id && r.dropped_at === null && r.slot === 'ir');
  const best = (m, pos) => act(m).filter((r) => !pos || r.p.position === pos).sort((a, b) => H.adp(a.player_id) - H.adp(b.player_id))[0];
  const worst = (m, pos) => act(m).filter((r) => !pos || r.p.position === pos).sort((a, b) => H.adp(b.player_id) - H.adp(a.player_id))[0];
  const M = members;
  const proposals = [];
  const P = (kind, from, to, give, get) => { if (give.every(Boolean) && get.every(Boolean)) proposals.push({ kind, from, to, give: give.map((r) => r.player_id), get: get.map((r) => r.player_id) }); };
  P('lopsided: bench WR for their best player', M[0], M[1], [worst(M[0], 'WR')], [best(M[1])]);
  { // fair: the two RBs on different teams with the closest ADP among ranked RBs
    let bestPair = null;
    for (let i = 0; i < M.length; i++) for (let j = i + 1; j < M.length; j++) {
      for (const a of act(M[i]).filter((r) => r.p.position === 'RB' && r.p.adp != null)) for (const b of act(M[j]).filter((r) => r.p.position === 'RB' && r.p.adp != null)) {
        const d = Math.abs(a.p.adp - b.p.adp) + (a.p.adp + b.p.adp) / 100;
        if (!bestPair || d < bestPair.d) bestPair = { d, a, b, i, j };
      }
    }
    if (bestPair) P('fair: like-for-like RBs', M[bestPair.i], M[bestPair.j], [bestPair.a], [bestPair.b]);
  }
  { const mids = act(M[4]).filter((r) => r.p.adp != null && r.p.adp > 50).sort((a, b) => a.p.adp - b.p.adp).slice(0, 2);
    P('2-for-1: two mid players for a top WR', M[4], M[5], mids.length === 2 ? mids : [null], [best(M[5], 'WR')]); }
  { const ks = M.map((m) => worst(m, 'K')).filter(Boolean); if (ks.length >= 2) P('kicker for kicker', M.find((m) => m.id === ks[0].member_id), M.find((m) => m.id === ks[1].member_id), [ks[0]], [ks[1]]); }
  { const noDef = M.find((m) => !act(m).some((r) => r.p.position === 'DEF'));
    const hasDef = M.find((m) => m !== noDef && act(m).filter((r) => r.p.position === 'DEF').length >= 1);
    if (noDef && hasDef) P('positional need: a team with no DEF trades a backup RB for one', noDef, hasDef, [worst(noDef, 'RB')], [worst(hasDef, 'DEF')]); }
  P('QB for QB', M[6], M[7], [best(M[6], 'QB')], [worst(M[7], 'QB')]);
  { const holder = M.find((m) => ir(m).length > 0 && act(m).length > 0);
    const other = M.find((m) => m !== holder);
    if (holder) P('an injured-reserve player plus a bench piece for a healthy starter', holder, other, [{ player_id: ir(holder)[0].player_id }, worst(holder)], [best(other, 'WR') || best(other)]); }
  { const three = act(M[8]).sort((a, b) => H.adp(b.player_id) - H.adp(a.player_id)).slice(0, 3);
    P('3-for-1 lopsided: three low-value players for their best', M[8], M[9], three.length === 3 ? three : [null], [best(M[9])]); }
  P('TE for TE', M[10], M[11], [best(M[10], 'TE')], [best(M[11], 'TE')]);
  { const holder = M.find((m) => act(m).some((r) => !r.p.team));
    const other = M.find((m) => m !== holder && m !== M[0]);
    if (holder) { const nt = act(holder).find((r) => !r.p.team); P('a player with no NFL team for a like-position player', holder, other, [nt], [worst(other, nt.p.position) || worst(other)]); } }
  proposals.forEach((p, i) => {
    const n = String(i + 1).padStart(2, '0');
    const base = { phase: 'post', week: 8, kind: p.kind, proposal: { proposerId: p.from.id, receiverId: p.to.id, give: p.give, get: p.get } };
    add({ site: 'trade-eval', id: `trade-eval-${n}`, ...base, memberId: p.from.id, request: { league_id: league.id, proposer_player_ids: p.give, receiver_player_ids: p.get, partner_member_id: p.to.id } });
    add({ site: 'trade-veto', id: `trade-veto-${n}`, ...base, memberId: null, asCommissioner: true, trade: { proposer_id: p.from.id, receiver_id: p.to.id, proposer_player_ids: p.give, receiver_player_ids: p.get }, request: { league_id: league.id, trade_id: 'qa-trade' } });
    add({ site: 'trade-actions', id: `trade-oracle-${n}`, ...base, memberId: p.from.id, request: { leagueId: league.id, receiverId: p.to.id, proposerPlayer: p.give, receiverPlayer: p.get } });
  });

  // waiver-intel: 10 free agents as Week 8 kicked off.
  const T8pre = H.asOf(8, 'pre');
  const rostered = new Set(H.rosterAsOf(T8pre).filter((r) => r.dropped_at === null).map((r) => r.player_id));
  const fa = db.players.filter((p) => POS.has(p.position) && !rostered.has(p.id));
  const byAdp = (list) => [...list].sort((a, b) => (a.adp ?? 9999) - (b.adp ?? 9999) || (a.id < b.id ? -1 : 1));
  const bye8 = new Set(H.byeTeams(8));
  const act8 = (m) => H.activeRoster(m.id, T8pre).map((r) => H.players[r.player_id]).filter(Boolean);
  const count = (m, pos) => act8(m).filter((p) => p.position === pos).length;
  const W = [];
  const wv = (kind, player, member, mods) => { if (player && member) W.push({ kind, playerId: player.id, memberId: member.id, mods }); };
  // A rule that wants a particular kind of team falls back to a fixed team when none matches, and
  // the case says so.
  const want = (kind, pred, fallback) => { const m = members.find(pred); return m ? [kind, m] : [`${kind.split(' for ')[0]} (no team matched "${kind.split(' for ')[1]}")`, fallback]; };
  wv('best-ranked free agent', byAdp(fa.filter((p) => p.team))[0], members[2]);
  wv('free agent whose team is on bye this week', byAdp(fa.filter((p) => bye8.has(p.team) && p.status === 'Active'))[0], members[3]);
  wv('injured free agent', byAdp(fa.filter((p) => p.team && p.status !== 'Active' && p.status !== 'Inactive'))[0], members[4]);
  { const [k, m] = want('kicker for a team that already has two or more', (mm) => count(mm, 'K') >= 2, members[5]); wv(k, byAdp(fa.filter((p) => p.position === 'K' && p.team))[0], m); }
  { const [k, m] = want('defense for a team with none', (mm) => count(mm, 'DEF') === 0, members[6]); wv(k, byAdp(fa.filter((p) => p.position === 'DEF' && p.team))[0], m); }
  wv('player with no NFL team', byAdp(fa.filter((p) => !p.team && (p.position === 'WR' || p.position === 'K')))[0], members[7]);
  wv('deep unranked running back', fa.filter((p) => p.position === 'RB' && p.team && p.adp == null && p.status === 'Active').sort((a, b) => (a.id < b.id ? -1 : 1))[0], members[8]);
  { const [k, m] = want('tight end for a team whose starting TE is on bye', (mm) => db.uff_lineups.some((l) => l.week === 8 && l.member_id === mm.id && l.slot === 'TE' && bye8.has(H.players[l.player_id]?.team)), members[9]);
    wv(k, byAdp(fa.filter((p) => p.position === 'TE' && p.team && !bye8.has(p.team) && p.status === 'Active'))[0], m); }
  { const [k, m] = want('quarterback for a team that already has two', (mm) => count(mm, 'QB') >= 2, members[10]); wv(k, byAdp(fa.filter((p) => p.position === 'QB' && p.team && p.status === 'Active'))[0], m); }
  wv('empty roster (synthetic)', byAdp(fa.filter((p) => p.position === 'WR' && p.team && p.status === 'Active'))[0], members[11], ['empty-roster']);
  W.forEach((c, i) => add({ site: 'waiver-intel', id: `waiver-${String(i + 1).padStart(2, '0')}`, phase: 'pre', week: 8, ...c, request: { league_id: league.id, player_id: c.playerId } }));

  // newsletter: 8, the week after each of Weeks 1-8 finished.
  for (let w = 1; w <= 8; w++) add({ site: 'newsletter', id: `newsletter-${String(w).padStart(2, '0')}`, phase: 'post', week: w, memberId: null, kind: `week ${w}`, request: { week: w } });

  // Ground truth that is NOT in any prompt but matters to the reader: who is on bye in the week the
  // answer is about (start-sit is the only site told; the grader checks the others against it).
  for (const c of cases) {
    const w = c.site === 'chat' ? c.chatWeek : ['start-sit', 'token-advisor', 'waiver-intel', 'matchup-preview'].includes(c.site) ? c.week : null;
    c.byeTeams = w ? H.byeTeams(w) : null;
    c.byeWeek = w;
    if (w && c.memberId && c.site !== 'matchup-preview') {
      // The caller's own active players who score 0 that week (team on bye, or no NFL team).
      const bye = new Set(c.byeTeams);
      const T = H.asOf(c.week, c.phase);
      c.rosterZero = c.mods?.includes('empty-roster') ? [] : H.activeRoster(c.memberId, T)
        .map((r) => H.players[r.player_id]).filter((p) => p && POS.has(p.position) && (!p.team || bye.has(p.team)))
        .map((p) => `${p.full_name} (${p.position}, ${p.team ?? 'no NFL team'})`);
    }
    if (c.site === 'waiver-intel') {
      const p = H.players[c.playerId];
      c.targetZero = !p.team ? 'no NFL team' : new Set(c.byeTeams).has(p.team) ? `on bye in week ${w}` : null;
    }
  }
  return cases;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const F = loadFixture();
  const cases = build(F);
  fs.writeFileSync(path.join(FIX, 'cases.json'), JSON.stringify(cases, null, 1));
  const by = {};
  for (const c of cases) by[c.site] = (by[c.site] || 0) + 1;
  console.log(`Wrote tools/qa/fixtures/cases.json: ${cases.length} cases`);
  for (const [s, n] of Object.entries(by)) console.log(`  ${s.padEnd(16)} ${n}`);
  console.log('Kinds (no names):');
  for (const c of cases) console.log(`  ${c.id.padEnd(18)} ${c.memberLabel ?? '-'}  wk${c.week} ${c.phase}  ${c.kind}`);
}
