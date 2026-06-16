# UFF Hero vs Villain System — Design Doc v1

Status: FINALIZED, build-ready (as of 2026-06-11). Section 9 is the implementation punch list.

## 1. Faction Setup

- League must have an **even number of teams**, split equally Hero / Villain.
- At league creation, each manager picks Hero or Villain.
- Commissioner has a **"Randomize Factions"** button if managers don't care — auto-balances to an even split.

## 2. Player Faction Tags

- Every NFL player is tagged by conference: **AFC = Hero**, **NFC = Villain**.
- This is a static lookup (team → conference), refreshed if a player is traded between conferences.

## 3. Faction Roster Bonus (recurring, every week)

- Each week, a manager's score gets **+0.5 pts per rostered player matching their faction**.
- Example: Hero manager rosters 6 AFC players → **+3.0 pts** added to that week's score.
- Recalculated weekly based on current roster (so trades/waivers shift it).

## 4. Draft Superpowers (16 total — every manager gets one per round)

- **Drafts are LOCKED at 16 rounds — not configurable per league.** This is a hard platform constraint, since the entire superpower system depends on exactly 16 powers mapping 1:1 to 16 rounds.
- There are 16 powers total, matching a 16-round draft.
- **At the start of the draft, each manager is dealt their own random shuffle of all 16 powers — one power per round, in a personalized order.** By round 16, every manager has the identical set of 16 powers; only the ORDER differs per manager.
- Each power's effect is **permanent from the moment it's dealt** — must be tracked in team state immediately, since it can change that manager's strategy for their very next pick.
- "All powers must be played that round" = the system deals each manager their round-N power automatically when round N starts; no skipping.
- **Generation constraint:** Vampire Bite can never be DEALT as anyone's round-1 power (see Power #16) — it's randomly placed into rounds 2–16 only. **Exception:** Foresight Coin (Power #1) CAN pull Vampire Bite into round 1 if it's one of the two rounds being peeked. This is intentional — a late-slot drafter (e.g., pick 6) who pulls this combo gets to bite one of the picks made ahead of them in round 1. If the holder is the 1st overall pick, nothing's been drafted yet, so the bite simply whiffs that round (no target available).
- **Stat-boost powers are tied to that round's pick.** When a manager is dealt a position-specific stat-boost power (Reception Specialist, Berserker Rage, Iron Defense — see below), it attaches ONLY to the player that manager drafts in that same round. If the pick that round doesn't match the required position, **the power fizzles entirely** — wasted for the season. This creates real draft-time tension: drawing one of these powers can pressure a manager to reach for a position they weren't planning on that round.

### Powers Nate has already locked in:

1. **Foresight Coin** — Instead of taking this round's dealt power, the holder looks ahead at THEIR OWN next-two-rounds' powers (rounds N+1, N+2 in their personal order) and picks one to receive now instead. Foresight Coin is then **consumed (one-time use only)**. To maintain the 16-powers-for-16-rounds math, FC physically swaps into the vacated slot (the slot the chosen power just left), but it is flagged as spent. If FC surfaces again in that later round, it does nothing — the manager gets a null round with no power effect. **Edge cases:** At round 15, only one round ahead exists (round 16) — FC still works but the peek window is one power instead of two. At round 16, FC is fully wasted — no rounds ahead to peek at, null effect.
2. **Reception Specialist** — Tied to this round's pick: if the player drafted this round is a pass-catcher (WR, RB, or TE), that player gets +0.5 PPR on top of the league's existing PPR, season-long. If the pick is a QB, K, or D/ST, the power fizzles.
3. **Draft Heist** — Steal another manager's draft pick slot for this round only (swap positions). Confirmed scope: **just the ONE pick this round** — not any other remaining picks that manager has.
4. **Hero's Shield** *(paired with Draft Heist)* — Every time ANY manager's personal shuffle deals them Draft Heist, the system ALSO grants Hero's Shield to one random Hero manager for that same round. If that Hero is the heist target, the steal is auto-blocked. Since (in the personal-shuffle model) everyone eventually draws Draft Heist at some round, this pairing fires once per manager, at a different round each time.

### Candidate powers — for your review (status notes per Take Doctor pass):

| # | Name | Effect | Notes |
|---|------|--------|-------|
| 5 | **Iron Defense** | Tied to this round's pick: if it's a D/ST, that D/ST's scoring is doubled, season-long. Fizzles if not a D/ST. | KEPT (now tied-to-pick) |
| 6 | **Berserker Rage** | Tied to this round's pick: if it's an RB, that RB gets +0.1 pt per rushing yard, season-long. Fizzles if not an RB. | KEPT (now tied-to-pick). Still top-tier when it lands on a workhorse RB |
| ~~7~~ | ~~Extra Roster Spot~~ | ~~One additional bench slot all season~~ | CUT — every manager gets it eventually via personal shuffle, and an extra bench slot has the same value regardless of WHEN you receive it (no timing-strategy lever, unlike Berserker Rage / Reception Specialist) |
| 8 | **Telepathy** | REWORKED: When dealt, instantly reveals to the holder the power dealt to the NEXT manager to pick in the draft sequence (skipping the holder themselves if a snake-draft turn gives them back-to-back picks). Lets the holder anticipate that manager's likely pick (e.g., if they just got Berserker Rage, they may reach for an RB) and react accordingly. | KEPT (reworked). Old version (peek opponent lineup weekly) cut — too "everyone gets it, no timing edge." New version's value scales with HOW EARLY it's drawn (more rounds left to exploit the intel) |
| 9 | **Cloak** | REWORKED: When dealt, hides this manager's power from the PREVIOUS manager to pick in the draft sequence (skipping the holder themselves if a snake-draft turn gave them back-to-back picks) — i.e., if that manager has Telepathy, it reveals nothing. | KEPT (reworked). Direct counter-pick to Telepathy, mirrors the Draft Heist / Hero's Shield pairing dynamic |
| 10 | **Power Negation** | REWORKED — self-targeting "cost" power: the player THIS manager drafts in this round has their scoring HALVED, season-long, until restored via a Power Restore Chip (see below). | KEPT (reworked). Symmetric "tax" — every manager draws it once via the personal shuffle, so it's inherently fair (fits the "everyone gets the same power" goal); the Restore Chip economy gives agency to undo it through in-season performance |
| 11 | **Gunslinger** | NEW (replaces Double Down): Tied to this round's pick: if it's a QB, that QB gets +1 pt per passing TD on top of league scoring, season-long. Fizzles if not a QB. | Rounds out position coverage for tied-to-pick stat-boosts (RB = Berserker Rage, pass-catchers = Reception Specialist, D/ST = Iron Defense, now QB = Gunslinger) |
| 12 | **Sniper** | NEW (replaces Phoenix Down): Tied to this round's pick: if it's a K, that K's field goals of 50+ yards are worth double points, season-long. Fizzles if not a K. | Completes tied-to-pick position coverage: RB = Berserker Rage, pass-catchers = Reception Specialist, QB = Gunslinger, D/ST = Iron Defense, K = Sniper |
| 13 | **Red Zone Menace** | NEW (replaces Mind Control): Tied to this round's pick: if it's a WR, that WR gets +1 pt per receiving TD on top of league scoring, season-long. Fizzles if not a WR. | Different draft incentive than Reception Specialist (TDs/red-zone threat vs. PPR/volume) |
| 14 | **Time Stone** | REWORKED: Tied to this round's pick (any position, no fizzle): if that player gets injured and the manager KEEPS them in the starting lineup, the player continues scoring whatever they scored in their LAST HEALTHY game, every week, until they return to game action. If the manager ever benches them while injured, the freeze is permanently broken — normal (zero) scoring resumes for as long as they're out. | KEPT (reworked). Universal injury-insurance power — real risk/reward each week (ride the frozen score vs. bench and lose it forever) |
| 15 | **Goal Line Hammer** | NEW (replaces Overtime Surge): Tied to this round's pick: if it's an RB, that RB gets +1 pt per rushing TD on top of league scoring, season-long. Fizzles if not an RB. | Pairs with Berserker Rage (yardage) for a second RB-tied power, mirrors the TD-bonus pattern (Gunslinger/Red Zone Menace) |
| 16 | **Vampire Bite** | REWORKED: When dealt, the holder picks any player already drafted by ANY manager (including themselves) who hasn't been bitten yet. Each week for the rest of the season, 10% of that player's fantasy score is added to the holder's score on top of their own. Each player can only be bitten once (first come, first served). | KEPT (reworked, 10% rate). **Special rule: Vampire Bite can never be dealt as anyone's ROUND 1 power** — at round 1, all managers' powers are dealt before any picks happen, so there'd be nothing to bite yet. Excluded from round-1 slots in every manager's personal shuffle (placed only in rounds 2–16). **Collision rule:** if two+ managers draw Vampire Bite the same round and target the same player, whoever sits HIGHER in that round's draft order (picks earlier) gets the bite; the other(s) pick their next-best target. |
| 17 | **Seam Buster** | NEW (fills the #7 gap): Tied to this round's pick: if it's a TE, that TE gets +1 pt per receiving TD on top of league scoring, season-long. Fizzles if not a TE. | KEPT. Mirrors Red Zone Menace but for TE — completes full position coverage (RB x2, WR, TE, QB, K, D/ST, pass-catcher generic, any-position). |

*Pool is now 16 powers (numbered 1–6, 8–17, with #7 retired/cut) — matches the 16-round draft 1:1.*

### Power Restore Chips (new economy, tied to Power Negation)

- Each week, the **single highest-scoring team league-wide** earns one Power Restore Chip.
- A manager holding a player negated by Power Negation can spend a chip to **fully restore that player's scoring to normal for the rest of the season**.
- If the chip-winner has no negated player, they bank the chip — banked chips can be **traded to other managers** like currency.
- **Cap:** total chips banked/in circulation at any time can't exceed the number of rosters in the league (e.g., 12-team league = max 12 chips banked at once).

## 5. Faction Control Map

- Each week, tally **combined win-loss record + total points scored** across all Heroes vs all Villains.
- Scoring per manager toward their faction's record total: **win = +1, loss = -1, tie/no-contest = 0**.
- Whichever faction is ahead is "in control" — shown as a map/gauge (e.g. a US map split AFC-blue / NFC-red, or a simple tug-of-war bar).
- Ties: **no token awarded** that week — neither faction is "in control."

## 6. Weekly Superpower Tokens (18 total — new pool, separate from draft powers)

- The faction "in control" that week gets a token for **every manager on that side** to use the following week.
- **Each manager on the winning faction gets an INDEPENDENTLY RANDOM token** from the pool — managers on the same faction won't all get the same token.
- Tokens are single-use, single-week effects (use it or lose it).
- **Visibility rule:** Lineups are always visible to everyone, as normal. But a manager's WEEKLY TOKEN selection — including any choices that come with it (e.g., which position for Position Power) — can be made anytime before lineups lock, and stays HIDDEN from other managers until then. The moment the first player/position locks for the week (first kickoff), all token selections lock in and are revealed to everyone simultaneously.

### Candidate powers (18) — for your review:

| # | Name | Effect |
|---|------|--------|
| 1 | **Power Surge** | +2.0 flat pts to your score this week — KEPT |
| 2 | **Triple Threat** | Your kicker's points are tripled this week — KEPT |
| 3 | **Bench Vault** | Your highest-scoring bench player's points are added to your score this week (on top of starters) — KEPT |
| 4 | **Mulligan** | TIGHTENED: After the week's games finish, find the ONE starter who underperformed their pre-game projection by the LARGEST margin (actual − projected, most negative). If a position-eligible bench player (same position or flex-eligible for that slot) scored MORE than that starter, swap their scores retroactively for that one slot. If no eligible bench player outscored the underperforming starter, the token is consumed with no effect. — KEPT (tightened) |
| 5 | **Mirror Match** | REWORKED (was Reflect): When played, this manager's score gets a bonus equal to the TOTAL extra points their OPPONENT'S active tied-to-pick draft powers generated for them this week (Reception Specialist, Berserker Rage, Iron Defense, Gunslinger, Sniper, Red Zone Menace, Goal Line Hammer, Time Stone, Vampire Bite). Power Negation's penalty is NOT mirrored (it's a loss, not a gain). — KEPT (reworked) |
| 6 | **Faction Surge** | Faction Roster Bonus doubled this week (1.0/player instead of 0.5) — KEPT |
| 7 | **Position Power** | NEW (replaces Sixth Man / Roster Raid): Before lineups lock this week, choose ONE position (QB, RB, WR, TE, K, or D/ST). Your single HIGHEST-SCORING starter at that position this week gets a +50% (1.5x) boost to their points — one player only. — KEPT |
| 8 | **Fortress** | Your D/ST score doubled this week — KEPT |
| 9 | **Recon** | REWORKED: Reveals your OPPONENT'S weekly token selection (and any choice attached to it, e.g. their chosen position for Position Power) immediately when played — ahead of the normal lock-and-reveal. Lets you react with your own token pick before committing. — KEPT (reworked) |
| 10 | **Air Raid** | +1 extra point per passing TD for your QB(s) this week — KEPT. **Stacks independently with Gunslinger** (draft power): if a manager has BOTH active on the same QB in the same week, each passing TD earns +2 total (+1 from each bonus, applied separately/additively — not deduplicated). |
| 11 | **Insurance** | If you lose this week, it doesn't count toward your record (logged as a "no contest") — KEPT. For Faction Control Map purposes, a "no contest" counts as **0** (tie value), not -1, so it doesn't drag down the manager's faction that week. |
| 12 | **Last Stand** | TIGHTENED: Trigger evaluated AFTER ALL players (both teams) have finished/locked for the week — if this manager's FINAL actual score trails their opponent's FINAL actual score by 20+ points, ALL of this manager's bench points (final, locked) are retroactively added to their score. Using final results instead of pre-game projections closes the loophole where a manager could bench their studs to manufacture a fake 20+ deficit. — KEPT (tightened) |
| 13 | **Quick Feet** | Late injury swap allowed after games start this week (one player) — KEPT |
| 14 | **Momentum** | If you're on a 2+ game win streak, +1.5 pts this week — KEPT |
| 15 | **Underdog** | TIGHTENED: Trigger evaluated AFTER all players are locked and the matchup is final — if this manager LOST the matchup, +3 pts is added to their score after the fact (does not flip the result, just a consolation bonus). Final-results trigger (not pre-game projection) closes the same manipulation window as Last Stand. — KEPT (tightened) |
| 16 | **Iron Will** | TIGHTENED: Once lineups LOCK, identify the starter with the LOWEST pre-game projection at that moment (frozen — the locked lineup can't be changed afterward to game this). That player's actual points scored this week are doubled. — KEPT (tightened) |
| 17 | **Clutch Gene** | If your matchup is within 5 pts, round your score up by 1 full point — KEPT |
| 18 | **Second Wind** | Reuse any ONE weekly token you've already used earlier this season — KEPT. Second Wind itself is still use-it-or-lose-it (must be used the week it's awarded, like all tokens — no banking); it just lets that week's effect COPY a token from your history instead of being randomly assigned. |

## 7. Scoring Pipeline (Order of Operations)

With this many overlapping effects, every weekly score is computed in this fixed order — no exceptions. Each step operates on the OUTPUT of the previous step.

1. **Base stat-line score** — raw player stats run through the league's standard scoring rules (PPR, TD points, etc.).
2. **Tied-to-pick draft power bonuses** — applied per-player: Reception Specialist, Berserker Rage, Iron Defense, Gunslinger, Sniper, Red Zone Menace, Goal Line Hammer, Seam Buster, Time Stone (frozen score substitution if active).
3. **Power Negation** — if this player is the manager's negated pick (and not yet restored), halve their step-2 result.
4. **Weekly token effects on individual players** — Position Power (1.5x to chosen-position's top scorer), Iron Will (2x to the lock-time lowest-projected starter), Air Raid (+1/passing TD, additive/separate from Gunslinger), Fortress (2x D/ST), Triple Threat (3x K).
5. **Roster/team-level additions** — Faction Roster Bonus (or Faction Surge's doubled version), Bench Vault, Mulligan, Power Surge, Momentum, Mirror Match, Vampire Bite siphon, and the final-results-gated tokens (Last Stand, Underdog, Insurance).
6. **Clutch Gene rounding** — applied last, only if the matchup is within 5 pts.

**Matchup-level dependency:** Steps 1–4 must be computed for BOTH managers in a matchup before step 5 runs for either side. Several step-5 effects read the OPPONENT's step-1–4 results or the final matchup outcome:
- *Mirror Match* reads the opponent's step-2 bonus total (tied-to-pick powers only, not Power Negation).
- *Last Stand* and *Underdog* need both managers' FINAL totals to know the margin/result.
- *Insurance* needs the final result to log a "no contest."
- *Recon* reads the opponent's token selection (a separate, earlier reveal — not score-dependent).

**Vampire Bite clarification:** the "10% of that player's fantasy score" siphon is computed on the bitten player's score AFTER step 2 (i.e., including any tied-to-pick bonus that player's own manager has active on them) — the bonus is treated as part of the player's score, not a side-channel exclusive to their manager.

## 8. Open Questions for Nate

1. Any of the 12 + 18 candidate powers you want to cut, tweak, or replace outright? Anything from your own list I should fold in?

## 9. Build Sequencing (once mechanics are locked)

1. Schema: faction assignment on `league_members`, pla