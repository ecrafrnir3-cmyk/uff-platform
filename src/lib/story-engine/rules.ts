/**
 * The Legend & the War — pure story-engine rules.
 * Spec: docs/legend-and-the-war.md. Deterministic, side-effect-free.
 * These numbers ARE the locked design; change them here and only here.
 */

export type Faction = "hero" | "villain";
export type DeclineState = "stable" | "faltering" | "waning" | "fallen";

export const BLOWOUT_MARGIN = 30;
export const ULTIMATE_UNLOCK_RANK = 4;

/** Legend Points earned from a single matchup result (see spec §2). */
export function lpForResult(opts: {
  won: boolean;
  lost: boolean;
  margin: number; // absolute point margin
  lossStreak: number; // consecutive losses INCLUDING this week (0 if not a loss)
  beatRival: boolean;
  upset: boolean; // beat an opponent 2+ ranks above
  feats: number; // feats earned this week (Phase 2b; 0 for now)
}): number {
  let lp = 0;
  if (opts.won) lp += opts.margin >= BLOWOUT_MARGIN ? 3 : 2;
  if (opts.lost) {
    lp -= 1;
    if (opts.lossStreak >= 3) lp -= 1; // third straight loss and each after
  }
  lp += opts.feats; // +1 each
  if (opts.won && opts.beatRival) lp += 3;
  if (opts.won && opts.upset) lp += 2;
  return lp;
}

/** Rising ladder thresholds (cumulative LP): Blooded, Named, Renowned, Ascendant, Legend. */
export const RANK_THRESHOLDS = [3, 8, 15, 24, 35];

export function rankFor(lp: number): number {
  let r = 0;
  for (const t of RANK_THRESHOLDS) if (lp >= t) r++;
  return r; // 0..5
}

export function declineFor(lp: number): DeclineState {
  if (lp <= -12) return "fallen";
  if (lp <= -6) return "waning";
  if (lp < 0) return "faltering";
  return "stable";
}

const RANK_NAMES: Record<Faction, string[]> = {
  hero: ["Unproven", "Blooded", "Named", "Renowned", "Ascendant", "Legend"],
  villain: ["Unproven", "Blooded", "Named", "Feared", "Dread", "Tyrant"],
};

export function rankName(rank: number, faction: Faction): string {
  return RANK_NAMES[faction][Math.max(0, Math.min(5, rank))];
}

/** Canon rival pairs, by character id. Symmetric. (docs/lore + powers.md.) */
export const RIVALS: Record<number, number> = {
  1: 11, 11: 1, //  Cassia Dawn ↔ Roman Slate
  2: 13, 13: 2, //  Titus Vale  ↔ Silas Vane
  4: 14, 14: 4, //  Marcus Kell ↔ Kord Malphas
  5: 20, 20: 5, //  Sana Okoye  ↔ Delphine Roe
  9: 18, 18: 9, //  Brother Amos↔ Saint Vega
  10: 17, 17: 10, // Gideon Frost↔ Countess Mave
  8: 15, 15: 8, //  Lyra Vann   ↔ Nyx Sable
  12: 16, 16: 12, // Vesper Kane ↔ Ezra Cain
};

/**
 * Free Legend "Faction-Tide" (spec §3½): a veteran floor, raised by ~75% of the
 * faction's average claimed Legend, capped just below the top claimed champion.
 */
export const FACTION_TIDE_SHARE = 0.75;
export const VETERAN_FLOOR_LP = RANK_THRESHOLDS[1]; // Named (8)

export function factionTideLp(avgClaimedLp: number, maxClaimedLp: number): number {
  let v = Math.max(VETERAN_FLOOR_LP, Math.round(FACTION_TIDE_SHARE * avgClaimedLp));
  if (maxClaimedLp > VETERAN_FLOOR_LP) v = Math.min(v, maxClaimedLp - 1);
  return v;
}

// ── Battles (spec §2.3, §3) ────────────────────────────────────────────────
export const WAR_SURGE_WEIGHT = 3; // Battle Rating = Legend + 3·surge + clash + drama
export const DRAMA_MAX = 6; // the "dice of war" — bounded upset variance (0 = pure power)

/** Battle Rating for one combatant. Clash defaults 0 (attribute rock-paper-scissors ships with feats). */
export function battleRating(legend: number, surge: number, drama: number, clash = 0): number {
  return legend + WAR_SURGE_WEIGHT * surge + clash + drama;
}

/**
 * Deterministic "drama" roll in [0, DRAMA_MAX] from a string seed (FNV-1a).
 * Deterministic so the whole story engine can be re-run idempotently — the same
 * battle always rolls the same variance.
 */
export function dramaFor(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % (DRAMA_MAX + 1);
}

// ── Campaign set-pieces (spec §3) ──────────────────────────────────────────
export const SQUAD_FIRST_CLASH = 4;
export const SQUAD_SIEGE = 6;
export const GREAT_BATTLE_WAR_SWING = 2; // war-meter swing for winning a Great Battle
export const HIGH_GROUND_PER_FRONT = 2; // Last Front combined-force bonus per unit of war lead
export const HIGH_GROUND_MAX = 40;

/** The three set-piece weeks, from the league's season structure (~⅓, ~⅔, finale). */
export function campaignSchedule(seasonWeeks: number, championshipWeek: number): {
  firstClash: number;
  siege: number;
  lastFront: number;
} {
  const firstClash = Math.max(2, Math.round(seasonWeeks / 3));
  const siege = Math.max(firstClash + 1, Math.round((2 * seasonWeeks) / 3));
  const lastFront = championshipWeek > 0 ? championshipWeek : seasonWeeks;
  return { firstClash, siege, lastFront };
}

/** High-Ground: the war-leading faction carries a bounded edge into The Last Front. */
export function highGroundBonus(frontLeadForThisFaction: number): number {
  if (frontLeadForThisFaction <= 0) return 0;
  return Math.min(HIGH_GROUND_MAX, Math.round(frontLeadForThisFaction * HIGH_GROUND_PER_FRONT));
}

// ── Ultimate (rare comeback; spec §2.3) ────────────────────────────────────
export const ULTIMATE_MAX = 60;
/** Deficit-scaling comeback bonus: 0 when ahead, grows with how far behind you are, capped. */
export function ultimateBonus(ownForce: number, oppForce: number): number {
  const deficit = oppForce - ownForce;
  if (deficit <= 0) return 0; // never pads a lead — comeback only
  return Math.min(ULTIMATE_MAX, Math.round(deficit * 1.5));
}
