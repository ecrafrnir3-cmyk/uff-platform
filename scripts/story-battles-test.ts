// Unit test for the real battle resolvers (Phase 3). Run: npx tsx scripts/story-battles-test.ts
import { resolveBattle, resolveInternal, type Combatant } from "../src/lib/story-engine/battles";
import {
  dramaFor,
  battleRating,
  WAR_SURGE_WEIGHT,
  DRAMA_MAX,
  ultimateBonus,
  highGroundBonus,
  campaignSchedule,
} from "../src/lib/story-engine/rules";

let pass = 0,
  fail = 0;
const ck = (n: string, cond: boolean) => (cond ? pass++ : (fail++, console.error("FAIL:", n)));

const H = (id: number, legend: number, surge: number): Combatant => ({ character_id: id, legend, surge, faction: "hero" });
const V = (id: number, legend: number, surge: number): Combatant => ({ character_id: id, legend, surge, faction: "villain" });

// determinism + bounds of the drama roll
ck("dramaFor deterministic", dramaFor("a:1") === dramaFor("a:1"));
let inRange = true;
for (let i = 0; i < 300; i++) {
  const d = dramaFor("s" + i);
  if (d < 0 || d > DRAMA_MAX) inRange = false;
}
ck("dramaFor bounded 0..DRAMA_MAX", inRange);

// rating formula
ck("battleRating = legend + 3·surge + clash + drama", battleRating(10, 2, 3, 0) === 10 + WAR_SURGE_WEIGHT * 2 + 3);

// war: higher legend wins
const o1 = resolveBattle([H(7, 30, 0)], [V(11, 10, 0)], "seed1");
ck("war: higher legend wins", o1.winner === "hero" && o1.winnerCharacterId === 7);

// surge flips the underdog: legend 10 + surge 8 (=+24) beats legend 25
const o2 = resolveBattle([H(3, 10, 8)], [V(13, 25, 0)], "seed2");
ck("war: surge flips underdog", o2.winner === "hero");

// idempotent: same seed → identical outcome
const a = resolveBattle([H(7, 30, 2)], [V(11, 28, 1)], "seedX");
const b = resolveBattle([H(7, 30, 2)], [V(11, 28, 1)], "seedX");
ck("battle idempotent (seeded)", JSON.stringify(a) === JSON.stringify(b));

// internal duel: higher rating wins, faction preserved
const oi = resolveInternal(H(7, 20, 0), H(4, 5, 0), "seedI");
ck("internal: higher rating wins", oi.winnerCharacterId === 7 && oi.faction === "hero" && oi.side.length === 2);

// group battle: combined force decides; MVP is on the winning side
const og = resolveBattle([H(1, 20, 0), H(2, 20, 0)], [V(11, 10, 0), V(12, 10, 0)], "seedG");
ck("group: combined force decides", og.winner === "hero" && (og.winnerCharacterId === 1 || og.winnerCharacterId === 2));
ck("group: forces summed", og.heroForce > og.villainForce);

// ── Phase 3b: Ultimate + High-Ground + campaign schedule ──
ck("ultimateBonus: 0 when ahead", ultimateBonus(50, 30) === 0);
ck("ultimateBonus: scales with deficit", ultimateBonus(10, 30) === 30);
ck("ultimateBonus: capped", ultimateBonus(0, 100) === 60);

// a trailing hero unleashes → flips the battle
const ou = resolveBattle([H(3, 10, 0)], [V(13, 30, 0)], "seedU", { ultimateHero: true });
ck("ultimate: flips a trailing hero", ou.winner === "hero");
// unleashing while ahead does nothing (comeback-only)
const oa = resolveBattle([H(7, 40, 0)], [V(11, 10, 0)], "seedU2", { ultimateHero: true });
ck("ultimate: no-op when ahead", oa.winner === "hero" && oa.heroForce <= 40 + DRAMA_MAX + 0.01);
// High-Ground bonus tips a near-even clash
const oh = resolveBattle([H(1, 20, 0)], [V(11, 22, 0)], "seedH", { heroBonus: highGroundBonus(5) });
ck("high-ground: tips a close battle", oh.winner === "hero");
// campaign schedule is ordered and lands the finale on championship week
const sched = campaignSchedule(14, 17);
ck("campaign schedule ordered", sched.firstClash < sched.siege && sched.siege < sched.lastFront && sched.lastFront === 17);

console.log(`Battle tests: ${pass} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
