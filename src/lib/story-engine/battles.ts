/**
 * Story-engine battle resolution (Phase 3). Pure + deterministic.
 * One resolver scales from a 1v1 skirmish (one combatant per side) to a
 * force-vs-force Great Battle (a whole squad per side). Spec: docs/legend-and-the-war.md §2–§3.
 */
import { battleRating, dramaFor, ultimateBonus, type Faction } from "./rules";

export interface Combatant {
  character_id: number;
  legend: number;
  surge: number;
  faction: Faction;
}
export interface SidePart {
  character_id: number;
  rating: number;
}
export interface BattleOutcome {
  heroSide: SidePart[];
  villainSide: SidePart[];
  heroForce: number;
  villainForce: number;
  winner: "hero" | "villain" | "draw";
  /** Top-rated combatant on the winning side (the "player of the battle"). */
  winnerCharacterId: number | null;
}
export interface InternalOutcome {
  faction: Faction;
  side: SidePart[]; // both duelists, same faction
  winnerCharacterId: number | null;
  draw: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function combatantRating(c: Combatant, seed: string): number {
  return round2(battleRating(c.legend, c.surge, dramaFor(`${seed}:${c.character_id}`)));
}

export interface BattleOpts {
  /** Flat combined-force bonuses (e.g., The Last Front High-Ground). */
  heroBonus?: number;
  villainBonus?: number;
  /** Unleash a side's Ultimate — a deficit-scaling comeback, applied only if that side trails. */
  ultimateHero?: boolean;
  ultimateVillain?: boolean;
}

/** Cross-faction battle (war / interloper / group). Combined force decides it; MVP = top on the winning side. */
export function resolveBattle(
  hero: Combatant[],
  villain: Combatant[],
  seed: string,
  opts: BattleOpts = {},
): BattleOutcome {
  const h = hero.map((c) => ({ character_id: c.character_id, rating: combatantRating(c, seed) }));
  const v = villain.map((c) => ({ character_id: c.character_id, rating: combatantRating(c, seed) }));
  let heroForce = round2(h.reduce((s, x) => s + x.rating, 0) + (opts.heroBonus ?? 0));
  let villainForce = round2(v.reduce((s, x) => s + x.rating, 0) + (opts.villainBonus ?? 0));
  // Ultimates: comeback only — fire for the trailing side (order fixed for determinism).
  if (opts.ultimateHero && heroForce < villainForce) heroForce = round2(heroForce + ultimateBonus(heroForce, villainForce));
  if (opts.ultimateVillain && villainForce < heroForce) villainForce = round2(villainForce + ultimateBonus(villainForce, heroForce));
  const winner = heroForce > villainForce ? "hero" : villainForce > heroForce ? "villain" : "draw";
  const pool = winner === "hero" ? h : winner === "villain" ? v : [];
  const mvp = pool.length ? pool.reduce((a, b) => (b.rating > a.rating ? b : a)) : null;
  return { heroSide: h, villainSide: v, heroForce, villainForce, winner, winnerCharacterId: mvp?.character_id ?? null };
}

/** Same-faction Internal Duel — the higher rating takes within-faction glory; never moves the war. */
export function resolveInternal(a: Combatant, b: Combatant, seed: string): InternalOutcome {
  const ra = combatantRating(a, seed);
  const rb = combatantRating(b, seed);
  const side: SidePart[] = [
    { character_id: a.character_id, rating: ra },
    { character_id: b.character_id, rating: rb },
  ];
  const draw = ra === rb;
  return {
    faction: a.faction,
    side,
    winnerCharacterId: draw ? null : ra > rb ? a.character_id : b.character_id,
    draw,
  };
}
