# The Legend & the War — Story Engine Spec

**Status: LOCKED — v2, 2026-08-26.** Full design for the parallel story layer of The First War. Approved by Nate: Option A power source, War Battles + Internal Duels, merit-selected Great Battles, the campaign arc, and "armies clash → retreat/interruption, only the finale is decisive."

---

## 0. Governing principle — two sealed layers
There are two games running side by side:

1. **The Fantasy League — untouched.** Real scores decide real wins, standings, playoffs, and the champion. Power and legend **never touch any of it. Zero impact.**
2. **The Story Engine — parallel.** It is **read-only** on fantasy data. It builds each character's **Power** from real results, fights a **parallel war**, and drives the living comic. Power decides the *story*, never the *games*.

The worst a bug in this system can do is tell a wrong **story** — it can never cost anyone a real fantasy game. Everything below writes only to new, isolated tables.

---

## 1. Power — how it's built (Option A)
A character's **Power** is their cumulative **Legend Points (LP)**, earned from their manager's *own* real fantasy performance each week — regardless of who they played.

### The Legend Ladder (rank tiers)
| Rank | Vanguard | Dominion |
|---|---|---|
| 0 | Unproven | Unproven |
| 1 | Blooded | Blooded |
| 2 | Named | Named |
| 3 | **Renowned** | **Feared** |
| 4 | **Ascendant** | **Dread** |
| 5 | **Legend** | **Tyrant** |

**Decline track (both):** Faltering → Waning → Fallen. A **Fallen hero** can be redeemed and climb back; a **Fallen villain** is unmasked (their borrowed power is taken back).

### Legend Points (the triggers)
| Real event | LP |
|---|---|
| Win a matchup | **+2** |
| Blowout win (margin 30+) | **+3** (replaces the +2) |
| Each Feat earned that week (§1.3) | **+1** |
| Beat your canon rival head-to-head | **+3** |
| Upset — beat an opponent 2+ ranks above you | **+2** bonus |
| Loss | **−1** |
| Third consecutive loss (and each after) | **−1** additional |

**Rising thresholds (cumulative LP):** Blooded 3 · Named 8 · Renowned/Feared 15 · Ascendant/Dread 24 · Legend/Tyrant 35.
**Decline thresholds (LP ≤):** Faltering 0 · Waning −6 · Fallen −12.

### Feats (the +1 triggers, read off real stat lines)
| Real event | Feat | Attribute it feeds |
|---|---|---|
| 3+ pass TDs, or a 30+ pt player | **Explosion** | STRIKE |
| DST/def TD, or 3+ sacks | **Stonewall** | GUARD |
| 40+ yd TD, or 150+ scrimmage yds | **Breakaway** | BURST |
| Scores in the 4th qtr of a 1-score game; all starters beat their floor | **Ice Water** | NERVE |
| Forced fumble, pick-six, or return TD | **Twist of Fate** | OMEN |

Each feat = +1 LP **and** +1 level to its attribute (attributes are used in Battle Rating, §2.3).

### Epithets that earn themselves
A character's title grows with their legend. The base epithet is kept; earned titles layer on at ranks 3/4/5, **authored per rank-up from the actual game moment** (grounded-mythic voice). On decline, the title tarnishes. Locked examples:
- **Rook Callahan, "The Undrafted"** → *"...Unbenched"* → *"...Nobody Cuts"* → **"...Who Made Them All Wrong."**
- **Titus Vale, "The Ironhide Sentinel"** → *"Ironhide, the Wall That Held"* → **"Ironhide Eternal."**
- **Brother Amos, "The Shepherd"** → on beating Angel/Saint Vega: *"The Shepherd Who Broke the Gilded."*

---

## 2. The weekly clashes
Every character builds Power from their own real game (any opponent). What the matchup *means* to the story depends on the factions involved:

### Two kinds of clash
- **Cross-faction (hero vs villain) → a War Battle.** A real front. Resolved by Battle Rating (§2.3), the winner takes the front, and **it moves the Alliance War meter** (§4).
- **Same-faction (hero vs hero, or villain vs villain) → an Internal Duel.** Politics *inside* the order — a **power struggle in the Dominion's court** (villains) or a **Trial of the Vanguard** (heroes). Still resolved by Battle Rating, still a comic beat, still builds both characters' Legend — but it does **not** move the war meter. It produces within-faction glory/standing (a light "court standing" flavor; deeper court-rank system is a future option).

### Battle Rating (decides a clash)
> **Battle Rating = Legend + (3 × this week's Legend Points) + Clash + Drama**

- **Legend** — accumulated Power (the backbone; earned legends are hard to topple).
- **Surge (3 × this week's LP)** — rewards a big week; how an underdog with a monster stat line topples an established legend.
- **Clash** (0–5) — the character's strongest attribute vs the opponent's weakest (rock-paper-scissors flavor).
- **Drama** — a bounded variance roll (tunable; 0 = pure power, higher = more upsets).

**Design note — the arc this creates:** early season, Legend is tiny so **Surge dominates → chaotic, anyone can win**. Late season, Legends are large so it takes a huge week to upset one → **the war stabilizes as true legends emerge.** The season tells its own story.

### Signature Powers & Ultimates
Every legend has two abilities, defined per character in **`lore/powers.md`**.

**Signature Power** — the character's *domain made literal*. **Always active in every battle** and drawn in every comic panel; it is their combat identity. It **amplifies as their attributes level** (a low-rank Ironhide is tough; a Legend-rank Ironhide is immovable). Mechanically it feeds the **Clash** term of Battle Rating — e.g., Dr. Orin Pyre's *Nullify* zeroes an opponent's top attribute; Countess Mave's *Bloodfeed* skims some of theirs. Rival characters carry opposing/countering powers.

**Ultimate** — a **rare, once-per-season, last-ditch comeback move.**
- **Unlocks at rank 4** (Ascendant / Dread) — you must have built real Legend to earn it. Most characters never unlock one; that rarity is the point.
- **Manager-triggered** — an "Unleash" action on the Character tab, usable **once for the entire season**, in any battle (Skirmish, Great Battle, or The Last Front).
- **Comeback-scaling** — its magnitude scales with how badly the caster's side is *losing* the battle: **weak when ahead, devastating when behind.** It can flip a battle the faction was losing — then it's spent. Always bounded (a single big swing; never unbounded, never permanent, never usable to pad a lead).
- **Gideon Frost is the exception:** his *signature* already scales with the deficit every battle ("strongest when nearly beaten"); his ultimate is that taken to its limit.

This is the drama engine you asked for: a faction that *should* win is losing a Great Battle — until a Legend spends their once-a-season ultimate and turns the field.

---

## 3. The campaign — three scales of battle
The season is a campaign that escalates from weekly skirmishes to a full-cast climax.

### Skirmishes (every week)
The 1v1 War Battles + Internal Duels of §2. The grind of the war — small meter nudges, steady Legend-building.

### The Great Battles (mid-season set-pieces)
Squad battles, **bigger than 1v1**, worth a decisive war swing + a momentum boon, drawn as major comic issues.
- **The First Clash** (~⅓ into the season): each faction fields its **top 4 by Legend**.
- **The Siege** (~⅔ in): each faction fields its **top 6 by Legend**.

**Squad selection = MERIT.** The strongest characters (by current Legend) represent their faction — the faction's champions. This creates a mid-season race: *"am I in my faction's top 4 right now?"* Weaker characters may sit out a Great Battle, but **everyone fights The Last Front.**

**Resolution = force vs force.** Sum the squad's Battle Ratings; the **stronger army wins the field.** One number per side (not a stack of 1v1s).

**Depiction = one melee, no deaths.** The comic portrays a single clash — the 4 crashing into the 4 — with individual hero-moments woven *inside* the fight, not separate duel panels. The outcome is cinematic, not a body count: **the losing side breaks and retreats, or something interrupts the bloodletting** before it's final (a storm forces the lines back; the Dominion's throne recalls its champions; the Shepherd calls the Vanguard home; nightfall; a flooding river; reinforcements on the horizon). **Nobody dies in the Great Battles** — the loser retreats to fight another day, the roster stays whole, and the war continues. Only the finale is decisive.

### The Last Front (the finale)
The season name is *The First War*; its end is **The Last Front** — every front in the war collapsing into one. **The full order marches: all 10 vs all 10** — the 7 claimed champions plus their 3 Free Legends per side, *every legend in the universe on one field*. Everyone fights: managers eliminated from the fantasy playoffs, and the Free Legends who've roamed the war all season — so the story keeps *every* legend, claimed or not, in the reckoning.
- **Resolution:** combined might vs combined might — the sum of each faction's full Battle Ratings.
- **High Ground bonus:** the faction leading the Alliance War going into The Last Front carries a **bounded combined-force bonus** (magnitude tunable) — the whole season's war *matters* by setting the terms of the climax, but The Last Front is where it's decided.
- **Because the big battles lean on accumulated Legend**, the finale rewards season-long power-building — your legend pays off.
- **The winner takes The First War** — the **story-war champion**, crowned alongside (but independent of) the fantasy champion.

### Escalation at a glance
| Scale | When | Roster | Resolution | Stakes |
|---|---|---|---|---|
| Skirmish | every week | 1 vs 1 | Battle Rating | small meter nudge |
| The First Clash | ~⅓ mark | top 4 vs top 4 (merit) | combined force | big swing + boon · retreat/interruption |
| The Siege | ~⅔ mark | top 6 vs top 6 (merit) | combined force | bigger swing · retreat/interruption |
| **The Last Front** | finale | **all 10 vs all 10** (full order, incl. Free Legends) | combined force + High Ground | **wins The First War** |

---

## 3½. The Free Legends (the Unclaimed)
The universe holds 20 legends but the league has 14 managers, so **6 legends go unclaimed** (3 per faction). They answer to no manager — but they are not benchwarmers. They are the **Free Legends**, wildcards who roam the war all season.

### How they gain power — Faction-Tide
With no manager, they earn no Legend Points of their own. Their Power is set by **Faction-Tide**:
> **Free Legend's Legend = max( veteran floor, ~75% of the average Legend of that faction's *claimed* champions ), capped just below the champions.**
- **Veteran floor = Named (rank 2)** — established legends of the order; never rookies, never weak even in Week 1.
- **Scales with the order** — when the Vanguard swells, its Free Legends swell; when it falters, they wane. They are the nameless might of the order itself.
- **Capped below the champions** — a manager's leveled character always outranks the NPCs. The stars stay the stars.

### How they show up all season
- **A power arc you watch** — their rising/falling strength shows weekly on a **Free Legends board** (`/universe`) and the Power Sheet.
- **Interloper clashes** — the engine sends a Free Legend into the war 1–3 times a week as a wildcard: an unclaimed *villain* **ambushes** a claimed hero (a nemesis-at-large strike), or an unclaimed *hero* **rides to a claimed ally's aid**. Resolved on Battle Rating, drawn as comic beats; **cross-faction interloper clashes move the war meter**, and beating your Unclaimed nemesis earns your character Legend (like beating a rival).
- **They are the "interruption."** The retreat-or-interruption that ends the Great Battles is very often **a Free Legend crashing the field** — the Rust King rolling in, the Whisper striking from nowhere. One mechanic, two jobs.
- **Nemesis threads** — each Free Legend with a canon rival stalks their claimed counterpart all season, building toward a reckoning at a Great Battle or the finale.

### The full muster
At **The Last Front** the whole order marches — the 7 claimed champions + the 3 Free Legends per side → **10 vs 10, all 20 legends on one field** — but now they arrive having been part of the story the whole way, bringing their signature powers. If Faction-Tide lifted a Free Legend to rank 4, its **ultimate becomes an engine-deployed wildcard** — an unclaimed legend rising to turn the finale.

---

## 4. The Alliance War
- The war meter is driven by **cross-faction results only** — the weekly **War Battles** and the **Great Battles**. Internal Duels build individual legend and faction politics but never move the war.
- The season-long front position feeds the **High Ground bonus** into The Last Front.
- **The Last Front decides the war champion.** The *story* war can run opposite the *fantasy* standings — heroes can be losing the league while winning the war. That divergence is the point.

---

## 5. Comic depiction rules
- **Skirmishes:** small weekly panels.
- **Rank-ups / earned epithets:** splash beats; each writes a new line into the graphify story graph (the season authoring canon).
- **Great Battles:** a unified melee splash sequence; individual hero-moments inside; **retreat-or-interruption** ending; **no deaths**.
- **The Last Front:** the full-cast finale issue; decisive.
- **Always show the fantasy result beside the story result** so no one conflates them — e.g., *"Lost the game 95–102 · Won the Battle — your legend outshone theirs."*

---

## 6. Data model (all new, all sealed off from fantasy)
Nothing here writes to `matchups` / scores / standings.

| Table | Holds |
|---|---|
| **`character_legend`** | per member/character: `legend_points`, `rank`, `decline_state`, `earned_epithets[]`, the 5 attribute levels, `week_surge`, `ultimate_unlocked` (bool), `ultimate_used_week` (int/null) |
| **`character_powers`** | the signature power + ultimate per character (name + effect), seeded from `lore/powers.md` (canon; shared across leagues) |
| **`legend_events`** | append-only log: feats earned, LP deltas, rank-ups, epithet unlocks (drives the comic + history) |
| **`story_battles`** | per week × clash: type (`war` / `internal`), participants, each side's Battle Rating, the story winner, a narration line. Group battles store the squad + combined force per side. |
| **`campaign`** | the schedule of set-pieces (First Clash / Siege / Last Front) with their week, squad size, and resolved result |
| **`alliance_war`** | per league: cumulative faction front position by week; the High Ground state at finale |

**Free Legends** get `character_legend` rows too, but their Legend is set by **Faction-Tide** each week (not earned LP); `story_battles` carries an `interloper` clash type for their wildcard strikes.

---

## 7. Weekly job & hooks
- A **post-scoring step** runs *after* `score-matchups` finalizes the week (appended to the `finalize-week` job or chained after it — exact seam per the subsystem map).
- It is **read-only** on fantasy data and **idempotent per week** (safe to re-run / backfill).
- Each week it: detects feats → awards LP → updates Power/rank/decline → resolves that week's War Battles + Internal Duels → recomputes each **Free Legend's Faction-Tide** power → schedules 1–3 **Interloper clashes** → moves the war meter → emits events (rank-ups, epithets, battle results). On a **campaign week** it instead (or additionally) runs the scheduled **Great Battle** or **The Last Front**.

---

## 8. Surfaces
- **Character tab — the "Power Sheet"** (updates weekly): Rank (+ decline), total Legend, the five attribute bars, **Signature Power + its current tier**, **Ultimate status** (locked / unlocked / spent + an **Unleash** action once unlocked), earned epithets, and Battle record (war + internal).
- **Weekly Battle Report / comic:** War Battle + Internal Duel results, rank-ups, new epithets — fantasy result shown alongside.
- **Great Battle / Last Front issues:** the set-piece melees.
- **Alliance War meter** on `/universe`.
- **Free Legends board** on `/universe`: the Unclaimed and their Faction-Tide power arc, updating weekly.
- **Push:** "⚔️ You won the Battle of Week 5 — Rook Callahan rose to *Renowned*."

---

## 9. Build order (feature-flagged; dark until validated — zero risk since it never touches fantasy)
1. **Engine core** — feats + LP + rank/decline from real results, writing to the new tables. Validate against real Week-1 data. *(no UI)*
2. **Weekly battles + war** — Battle Rating, War Battles vs Internal Duels, war meter.
3. **Campaign set-pieces** — merit squads, combined-force resolution, retreat/interruption, The Last Front + High Ground.
4. **Surfaces** — Character tab additions, Battle Report, War meter.
5. **Comic hook** — weekly events + set-pieces → panels (ties to Higgsfield when art's flowing).

---

## 10. Tunable knobs (defaults to revisit together)
- **Battle Rating weights** — Legend : Surge = **1 : 3**.
- **Drama variance** — the upset dial (default a small bounded roll; can be 0).
- **Great Battle timing** — penciled at the **⅓ and ⅔** marks; adjust to league length.
- **Squad sizes** — **4** (First Clash) and **6** (Siege).
- **High Ground bonus** — size of the war-leader's edge in The Last Front.
- **Clash** — attribute rock-paper-scissors (can ship v1 without it and add later).
- **Ultimate unlock rank** — default **rank 4** (Ascendant/Dread); raise to rank 5 for even rarer.
- **Ultimate comeback curve** — how hard the swing scales with the deficit (bounded max).
- **Faction-Tide share** — Free Legends at ~**75%** of their faction's average champion Legend (tunable).
- **Free Legend veteran floor** — starts at **Named** (rank 2).
- **Interlopers per week** — default **1–3** wildcard Free-Legend clashes.

---
*Change log: v2 LOCKED 2026-08-26 — Option A power; War Battles + Internal Duels; campaign arc (Skirmishes → First Clash 4v4 → Siege 6v6 → The Last Front 7v7); merit squads; combined-force group resolution; retreat/interruption, only the finale decisive; parallel data model, never touches fantasy. **v3 (2026-08-26)** added Signature Powers + rare comeback Ultimates (full 20-power roster in `lore/powers.md`) and the **Free Legends** (the Unclaimed) — Faction-Tide power + all-season Interloper presence, making The Last Front a full **10-on-10**. v1 was the story-side leveling ladder alone.*
