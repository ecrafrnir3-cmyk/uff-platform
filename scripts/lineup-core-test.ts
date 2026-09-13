// Tests for the effective-lineup core of supabase/functions/score-matchups.
//
//   npx -y tsx@4 scripts/lineup-core-test.ts                 unit tests
//   npx -y tsx@4 scripts/lineup-core-test.ts --live          + read-only dry run against the live DB
//   npx -y tsx@4 scripts/lineup-core-test.ts --live --week=2
//
// The core is EXTRACTED from the edge function source (between the
// `// @lineup-core:begin` / `// @lineup-core:end` markers), so these tests exercise
// the code that actually ships, not a copy of it. OPEN-LOOPS #33.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Slot = { slot: string; player_id: string };
type Plan = { starters: string[]; persist: null | { source: string; slots: Slot[] } };
type Core = {
  expandSlotKeys: (t: Record<string, number>) => string[];
  planEffectiveLineup: (i: any) => Plan;
  powerAdjustedProjection: (s: Record<string, number> | undefined, st: Record<string, number>, pe?: { power: string; restored: boolean }) => number;
};

async function loadCore(): Promise<Core> {
  const src = readFileSync("supabase/functions/score-matchups/index.ts", "utf8");
  const regions = [...src.matchAll(/\/\/ @lineup-core:begin\r?\n([\s\S]*?)\/\/ @lineup-core:end/g)].map((m) => m[1]);
  if (regions.length !== 2) throw new Error(`expected 2 @lineup-core regions, found ${regions.length}`);
  const file = join(mkdtempSync(join(tmpdir(), "lineup-core-")), "core.ts");
  writeFileSync(file, regions.join("\n") + "\nexport { expandSlotKeys, planEffectiveLineup, powerAdjustedProjection };\n");
  return (await import(pathToFileURL(file).href)) as Core;
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `   →  ${detail}` : ""}`); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const bySlot = (slots: Slot[] | undefined) => Object.fromEntries((slots ?? []).map((s) => [s.slot, s.player_id]));

function unit(core: Core) {
  console.log("slot keys");
  const KEYS = core.expandSlotKeys({ K: 1, QB: 1, RB: 2, TE: 1, WR: 2, DEF: 1, FLEX: 1 });
  check("match the roster page and the live DB", same(KEYS, ["QB", "RB_1", "RB_2", "WR_1", "WR_2", "TE", "FLEX", "K", "DEF"]), JSON.stringify(KEYS));

  console.log("power-adjusted projection");
  const S = { rec: 1, rush_yd: 0.1 };
  check("no power = base", core.powerAdjustedProjection({ rec: 10 }, S) === 10);
  check("Power Negation halves", core.powerAdjustedProjection({ rec: 10 }, S, { power: "power_negation", restored: false }) === 5);
  check("a restored Power Negation does not", core.powerAdjustedProjection({ rec: 10 }, S, { power: "power_negation", restored: true }) === 10);
  check("Berserker Rage adds its rush bonus", core.powerAdjustedProjection({ rush_yd: 100 }, S, { power: "berserker_rage", restored: false }) === 20);
  check("Time Stone does not change a projection", core.powerAdjustedProjection({ rec: 10 }, S, { power: "time_stone", restored: false }) === 10);
  check("no stats = 0", core.powerAdjustedProjection(undefined, S) === 0);

  const pos: Record<string, string> = { qb1: "QB", qb2: "QB", rb1: "RB", rb2: "RB", rb3: "RB", wr1: "WR", wr2: "WR", wr3: "WR", te1: "TE", te2: "TE", k1: "K", k2: "K", def1: "DEF" };
  const roster = Object.keys(pos);
  const posOf = (p: string) => pos[p];

  console.log("1) a manager's own lineup");
  const manual = [{ slot: "QB", player_id: "qb2", source: "manual" }, { slot: "RB_1", player_id: "rb3", source: "manual" }];
  let plan = core.planEffectiveLineup({ slotKeys: KEYS, roster, posOf, isKickedOff: () => false, thisWeek: manual, priorCarry: null, rankValue: () => 999 });
  check("is played exactly as saved", same(plan.starters, ["qb2", "rb3"]));
  check("is never written over", plan.persist === null);
  plan = core.planEffectiveLineup({ slotKeys: KEYS, roster, posOf, isKickedOff: () => false, thisWeek: manual.map((r) => ({ ...r, source: "carried" })), priorCarry: null, rankValue: () => 999 });
  check("a lineup already carried from one is also played as saved", same(plan.starters, ["qb2", "rb3"]) && plan.persist === null);

  console.log("3) carry forward");
  plan = core.planEffectiveLineup({
    slotKeys: KEYS, roster, posOf, isKickedOff: () => false, thisWeek: [], rankValue: () => 0,
    priorCarry: [{ slot: "QB", player_id: "qb1" }, { slot: "WR_1", player_id: "DROPPED" }, { slot: "TE", player_id: "te2" }],
  });
  check("keeps last week's slots for players still rostered", same(plan.persist?.slots, [{ slot: "QB", player_id: "qb1" }, { slot: "TE", player_id: "te2" }]), JSON.stringify(plan.persist));
  check("is saved as 'carried'", plan.persist?.source === "carried");

  console.log("4) never set a lineup — a fresh auto pick");
  const S2 = { rec: 1 };
  const stats: Record<string, Record<string, number>> = {
    qb1: { rec: 20 }, qb2: { rec: 15 }, rb1: { rec: 14 }, rb2: { rec: 12 }, rb3: { rec: 7 },
    wr1: { rec: 12 }, wr2: { rec: 10 }, wr3: { rec: 9 }, te1: { rec: 8 }, te2: { rec: 3 }, k1: { rec: 7 }, k2: { rec: 6 }, def1: { rec: 5 },
  };
  const powers: Record<string, { power: string; restored: boolean }> = { wr1: { power: "power_negation", restored: false } };
  const rv = (p: string) => core.powerAdjustedProjection(stats[p], S2, powers[p]);
  plan = core.planEffectiveLineup({ slotKeys: KEYS, roster, posOf, isKickedOff: () => false, thisWeek: [], priorCarry: null, rankValue: (p: string) => rv(p) });
  const f = bySlot(plan.persist?.slots);
  check("fills all 9 slots", plan.persist?.slots.length === 9, JSON.stringify(f));
  check("is saved as 'auto'", plan.persist?.source === "auto");
  check("takes the best QB, RBs, TE, K and DEF", f.QB === "qb1" && f.RB_1 === "rb1" && f.RB_2 === "rb2" && f.TE === "te1" && f.K === "k1" && f.DEF === "def1", JSON.stringify(f));
  check("ranks a Power-Negated player at half — the best WR on paper sits", !plan.starters.includes("wr1"), JSON.stringify(f));
  check("starts the next-best WRs at full value", f.WR_1 === "wr2" && f.WR_2 === "wr3", JSON.stringify(f));
  check("gives FLEX to the best leftover RB/WR/TE", f.FLEX === "rb3", JSON.stringify(f));
  const hindsight = core.planEffectiveLineup({
    slotKeys: KEYS, roster, posOf, isKickedOff: () => true, thisWeek: [], priorCarry: null,
    rankValue: (p: string, basis: string) => (basis === "stored" ? rv(p) : p === "qb2" ? 999 : 0),
  });
  check("ranks on the PRE-KICKOFF projection, not a live one", bySlot(hindsight.persist?.slots).QB === "qb1", JSON.stringify(bySlot(hindsight.persist?.slots)));

  console.log("2) an auto lineup already saved — kickoff locks");
  const saved = [
    ["QB", "qb1"], ["RB_1", "rb1"], ["RB_2", "rb2"], ["WR_1", "wr2"], ["WR_2", "wr3"],
    ["TE", "te1"], ["FLEX", "rb3"], ["K", "k1"], ["DEF", "def1"],
  ].map(([slot, player_id]) => ({ slot, player_id, source: "auto" }));
  const kicked = new Set(["qb1", "rb1", "wr2", "wr1", "k1"]); // wr1: a BENCHED player whose game already started
  const live: Record<string, number> = { qb2: 50, wr1: 99, te2: 30, te1: 8, rb2: 12, wr3: 9, rb3: 7, k2: 6, def1: 5 };
  const liveRank = (p: string, basis: string) => (basis === "live" ? live[p] ?? 0 : 0);
  plan = core.planEffectiveLineup({ slotKeys: KEYS, roster, posOf, isKickedOff: (p: string) => kicked.has(p), thisWeek: saved, priorCarry: null, rankValue: liveRank });
  const a = bySlot(plan.persist?.slots ?? saved);
  check("a starter whose game started stays — even with a better QB available", a.QB === "qb1" && a.RB_1 === "rb1" && a.WR_1 === "wr2" && a.K === "k1", JSON.stringify(a));
  check("a benched player whose game started is never slotted in", !plan.starters.includes("wr1"), JSON.stringify(a));
  check("an open slot is re-picked from players who haven't played", a.TE === "te2", JSON.stringify(a));
  check("the change is saved", plan.persist?.source === "auto");
  const again = core.planEffectiveLineup({ slotKeys: KEYS, roster, posOf, isKickedOff: (p: string) => kicked.has(p), thisWeek: (plan.persist?.slots ?? []).map((s) => ({ ...s, source: "auto" })), priorCarry: null, rankValue: liveRank });
  check("re-running with nothing new writes nothing", again.persist === null);

  console.log("edge cases");
  const empty = core.planEffectiveLineup({ slotKeys: KEYS, roster: [], posOf, isKickedOff: () => false, thisWeek: [], priorCarry: null, rankValue: () => 0 });
  check("an empty roster writes nothing", empty.persist === null && empty.starters.length === 0);
}

async function liveDryRun(core: Core) {
  const LEAGUE = "b6a07bce-bc03-49cc-b856-01f6e96a53b1";
  const weekArg = process.argv.find((x) => x.startsWith("--week="));
  const week = weekArg ? Number(weekArg.split("=")[1]) : 1;
  const season = 2026;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
  const { createClient } = await import("@supabase/supabase-js");
  const sb: any = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://synfuvgdamhjboobjmls.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } });

  const [{ data: league }, { data: members }, { data: rosterRows }, { data: pdp }, { data: sched }] = await Promise.all([
    sb.from("uff_leagues").select("scoring_settings, lineup_slots").eq("id", LEAGUE).single(),
    sb.from("league_members").select("id, team_name").eq("league_id", LEAGUE),
    sb.from("uff_roster_players").select("member_id, player_id, players(full_name, position, team)").eq("league_id", LEAGUE).is("dropped_at", null).eq("slot", "active"),
    sb.from("player_draft_powers").select("player_id, power, restored_at").eq("league_id", LEAGUE),
    sb.from("uff_game_schedule").select("team, kickoff_utc").eq("season", season).eq("week", week),
  ]);
  const memberIds = (members ?? []).map((m: any) => m.id);
  // lineup_source exists only once the migration is applied; fall back without it.
  async function lineups(apply: (q: any) => any) {
    let r = await apply(sb.from("uff_lineups").select("member_id, player_id, slot, week, lineup_source"));
    if (r.error) r = await apply(sb.from("uff_lineups").select("member_id, player_id, slot, week"));
    return (r.data ?? []) as { member_id: string; player_id: string; slot: string; week: number; lineup_source?: string }[];
  }
  const thisWeek = await lineups((q) => q.in("member_id", memberIds).eq("week", week));
  const priorRows = await lineups((q) => q.in("member_id", memberIds).lt("week", week));

  const rosterIds = [...new Set((rosterRows ?? []).map((r: any) => r.player_id))];
  const { data: sp } = await sb.from("player_projections").select("player_id, stats").eq("season", season).eq("week", week).in("player_id", rosterIds);
  const stored: Record<string, Record<string, number>> = Object.fromEntries((sp ?? []).map((r: any) => [r.player_id, r.stats]));
  const qs = "season_type=regular&order_by=pts_ppr&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF";
  const liveArr = await (await fetch(`https://api.sleeper.app/projections/nfl/${season}/${week}?${qs}`)).json();
  const liveProj: Record<string, Record<string, number>> = {};
  for (const r of liveArr) if (r?.player_id != null && r?.stats) liveProj[String(r.player_id)] = r.stats;

  const settings = league.scoring_settings as Record<string, number>;
  const KEYS = core.expandSlotKeys((league.lineup_slots as Record<string, number>) ?? {});
  const kickoff: Record<string, number> = Object.fromEntries((sched ?? []).map((g: any) => [g.team, Date.parse(g.kickoff_utc)]));
  const info: Record<string, { name: string; pos: string; team: string }> = {};
  const rosterBy: Record<string, string[]> = {};
  for (const r of rosterRows ?? []) {
    info[r.player_id] = { name: r.players?.full_name ?? r.player_id, pos: r.players?.position ?? "", team: r.players?.team ?? "" };
    (rosterBy[r.member_id] ??= []).push(r.player_id);
  }
  const power: Record<string, { power: string; restored: boolean }> = Object.fromEntries((pdp ?? []).map((r: any) => [r.player_id, { power: r.power, restored: r.restored_at != null }]));
  const now = Date.now();
  const kicked = (pid: string) => { const k = kickoff[info[pid]?.team ?? ""]; return k !== undefined && now >= k; };

  console.log(`\nLIVE DRY RUN — week ${week}, ${new Date(now).toISOString()} — read-only, nothing is written`);
  let untouched = 0;
  for (const m of [...(members ?? [])].sort((x: any, y: any) => x.team_name.localeCompare(y.team_name))) {
    const tw = thisWeek.filter((r) => r.member_id === m.id).map((r) => ({ player_id: r.player_id, slot: r.slot, source: r.lineup_source ?? "manual" }));
    const pr = priorRows.filter((r) => r.member_id === m.id && (r.lineup_source ?? "manual") !== "auto");
    const lw = pr.reduce((w, r) => Math.max(w, r.week), -1);
    const priorCarry = lw < 0 ? null : pr.filter((r) => r.week === lw).map((r) => ({ slot: r.slot, player_id: r.player_id }));
    const path = tw.some((r) => r.source !== "auto") ? "manager's lineup" : tw.length ? "auto — kickoff-locked refresh" : priorCarry?.length ? "carried forward" : "FRESH AUTO PICK";
    const rank = (pid: string, basis: string) => core.powerAdjustedProjection(basis === "stored" ? (stored[pid] ?? liveProj[pid]) : (liveProj[pid] ?? stored[pid]), settings, power[pid]);
    const plan = core.planEffectiveLineup({ slotKeys: KEYS, roster: rosterBy[m.id] ?? [], posOf: (p: string) => info[p]?.pos ?? "", isKickedOff: kicked, thisWeek: tw, priorCarry, rankValue: rank });
    if (!plan.persist && path === "manager's lineup") { untouched++; continue; }
    console.log(`\n${m.team_name} — ${path}${plan.persist ? `  → would save as '${plan.persist.source}'` : "  → nothing to write"}`);
    let total = 0;
    for (const s of plan.persist?.slots ?? []) {
      const i = info[s.player_id];
      const pw = power[s.player_id]?.power;
      const pre = rank(s.player_id, "stored");
      total += pre;
      console.log(`   ${s.slot.padEnd(5)} ${i.name.padEnd(22)} ${i.pos.padEnd(4)} ${i.team.padEnd(4)} pre-kickoff ${pre.toFixed(2).padStart(6)}   live ${rank(s.player_id, "live").toFixed(2).padStart(6)}${kicked(s.player_id) ? "   🔒 kicked off" : ""}${pw ? `   [${pw}]` : ""}`);
    }
    if (plan.persist) console.log(`   ${"".padEnd(34)}pre-kickoff total ${total.toFixed(2)}`);
    const neg = (rosterBy[m.id] ?? []).filter((p) => !plan.starters.includes(p) && power[p]?.power === "power_negation" && !power[p].restored);
    if (neg.length) console.log(`   benched, Power-Negated: ${neg.map((p) => info[p].name).join(", ")}`);
  }
  console.log(`\n${untouched} team(s) with their own lineup — untouched.`);
}

(async () => {
  const core = await loadCore();
  unit(core);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (process.argv.includes("--live")) await liveDryRun(core);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
