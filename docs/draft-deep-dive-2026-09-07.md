# UFF Draft Deep Dive — "The First War", 2026-09-07
### What happened, what it proved, and the build plan for next season

**Verdict: the draft was a success and the engine is sound.** 224/224 picks, **zero duplicate players, zero skipped picks, zero doubled picks**, all 14 rosters exactly 16 deep, schedule generated. The failure that killed the 2026-09-02 attempt did not recur. Average pace was 35 seconds per pick.

Everything below is a **product** problem, not an engine problem — and almost all of it traces to **one component: autodraft.**

Evidence sources: the live database after completion, the Resend send log, and the managers' own group chat during the draft (quoted throughout — it is the most valuable artifact of the night).

---

## 🔴 URGENT — before Week 1 kickoff (Thursday)

**Four teams cannot field a legal starting lineup.** Lineup requires QB1 / RB2 / WR2 / TE1 / K1 / DEF1 / FLEX1.

| Team | Missing | Roster |
|---|---|---|
| **Reveille** (Nate) | **K, DEF** | 1QB 7RB 6WR 2TE 0K 0DEF |
| **Blake's Bad Boys** | **K** | 3QB 5RB 6WR 1TE 0K 1DEF |
| **The Fratelli's** | **DEF** | 2QB 5RB 6WR 1TE 2K 0DEF |
| **Bengals Heroes** | **TE** | 1QB 3RB 9WR 0TE 1K 2DEF |

Meanwhile **Thanos and Tittie Twisters each drafted FOUR kickers**, Pillars of Light took four QBs, and Bengals Heroes took nine WRs. Fix via free agency — most defenses went undrafted (only 12 of 32 were taken) — or trade into the kicker surplus.

---

## The measured facts

| Metric | Value |
|---|---|
| Picks / duplicates / skips-or-doubles | 224 / **0** / **0** |
| Average seconds per pick | 35 |
| Picks that ran past 100s (autopick waits) | **19** |
| **Wall-clock lost to autopick waits** | **~34 minutes** |
| Emails sent (all "on the clock") | **197** vs a 100/day free limit (**197%**) |
| Vampire Bites actually used during the draft | **2 of 14** |
| Rounds per manager with a dead power | **2 of 16** (Draft Heist + Hero's Shield) |

---

## Finding 1 — 🥇 AUTODRAFT IS THE WHOLE PROBLEM (fix this first)

The group named it in real time: *"R we really auto drafting guys"*, *"Auto needs to grab and go"*, *"It won't tho. It will wait every second."*, *"Except auto draft sucks I got 6 wr and 1 rb"*, *"Auto drafted another kicker"*, *"I already have 2 kickers for some reason"*.

They were right on both counts, and these are two separate defects.

### 1a. It waits the full clock, every time
An absent manager burns 90s + a 15s grace before the safety net fires. **19 picks × ~105s = 34 minutes of dead air** in a ~2.5 hour draft. There is no way for a manager to say "I'm not here, just pick for me."

**Fix — two parts:**
- **An explicit per-manager auto mode.** A toggle ("Auto-draft my picks") that makes the server pick **immediately** on their turn, no clock. This is the single biggest time win available and the group asked for it directly (*"Need to add a switch for those that want to auto pick. 30 second and then picks"*).
- **Shorten the unattended path.** When a manager has never loaded the draft room, or has been idle > N minutes, drop their clock to ~30s instead of the full 90.

### 1b. It is roster-blind — and it structurally CANNOT draft a defense
Autodraft takes the manager's queue, and when that's empty falls back to **best available by ADP** (`players ... WHERE adp IS NOT NULL ORDER BY adp`). Two consequences, both confirmed in the final rosters:

- **Every NFL defense has a NULL ADP in our data (all 32).** So the ADP fallback **can never select a D/ST**. That is precisely why the heaviest autodraft user — Reveille — finished with **zero defenses**. This is not bad luck; it is arithmetic.
- **Kickers DO carry an ADP (45 ranked)**, so once the skill players thin out, the ADP list happily serves kicker after kicker. Hence **four kickers on two different teams**, and *"Damn it auto picked a kicker for me and that isn't until next round."*

**Fix — make autodraft roster-aware.** Before falling back to ADP:
1. Compute the manager's unfilled **required starter slots** (QB/RB/WR/TE/K/DEF/FLEX).
2. Draft the best available player **at a position they still need**, not the best player overall.
3. Enforce **position caps** (never a 2nd K or 2nd DEF while any starter slot is empty; cap QB at 2, K at 1, DEF at 1 until the roster is otherwise full).
4. Handle DEF explicitly, since ADP can't rank them — use a defense ranking (or simply "best undrafted DEF by prior-season points") when the DEF slot is empty and the round is late.
5. Apply the identical logic to **all three** autopick paths so they can't drift: the client self-autodraft, the peer `force_autopick` RPC, and the commissioner proxy.

**This one change eliminates the four broken rosters, the kicker pileups, and most of the 34 lost minutes.**

---

## Finding 2 — Draft powers cluster into the same round for everyone

`start_draft` ranks powers by weight + `random()*3`, but the weight tiers sit only ~1 apart, so the ordering is nearly deterministic. Measured live:

| Round | What almost everyone got |
|---|---|
| 1 | **Gunslinger ×11 of 14** (weight 2 — the lowest of all 16) → a forced QB run |
| 13 | Vampire Bite ×9 |
| 14 | **Hero's Shield ×11** — a dead round, Heist is disabled |
| 15 / 16 | Iron Defense / Sniper split |

**Fix — already written, staged, and unapplied**: `supabase/migrations/20260907210000_pin_draft_power_rounds.sql` pins Gunslinger 4-9, Vampire Bite 8-13, Hero's Shield 8-12, and Iron Defense/Sniper to 15/16 one each — using the same pattern Shadow Guard (1-5) and Power Negation (3-7) already use. Seven pins + nine ranked = 16. **Still to do: apply, re-run the 10-draft sim, mirror into the schema snapshot, push.**

Deeper fix for next year: widen the jitter or draw rounds from a shuffled deck so no power can dominate a round across the whole league.

---

## Finding 3 — Two of every manager's sixteen rounds were dead

Draft Heist is disabled (correctly — its cross-client swap/restore race skipped a pick on 09-02), **but it is still dealt to all 14 managers**, as is Hero's Shield, whose only function is to block a Heist. So every manager had **two rounds where their power card did nothing at all**. Managers noticed and misread it — *"I got slipped once too but I figured someone picked me to swap places with"* (nobody heisted anyone; Heist never fired once).

**Decide one:**
- **(A) Fix Heist properly** — move the swap+restore fully server-side and atomic: a `_uff_restore_expired_heist(league)` helper called at the top of `make_draft_pick` / `force_autopick` / `commissioner_draft_pick`, restoring `draft_order` from `heist_state.originalOrder` when its round has passed, and **delete the client restore effect entirely**. Then both cards are live again. Test round-boundary, two-heists-same-round, and snake-turn cases in the isolated sim.
- **(B) Remove both from the dealing pool** while Heist is off, and let two rounds honestly carry no power.

Recommendation: **(A)**. Heist is the most talked-about power in the game and the fix is well understood.

---

## Finding 4 — Interactive powers are forfeit traps

Vampire Bite only fired if you picked **manually**, in **the exact round** you held it, and answered the modal **in time**. Result: **only 2 of 14 managers used it.** Anyone auto-picked, anyone using their queue, anyone who blinked, lost it silently.

Worse, a **rejected** target (already bitten / Shadow-Guarded / your own player) closed the modal permanently even though nothing was saved — it cost a real bite live during the draft, and the error text rendered *behind* the full-screen overlay where nobody could see it.

**Shipped tonight:** the modal now only closes on success and shows the rejection inside itself; a **post-draft bite window** open until Week 1 kickoff; a **blocking gate on the roster page** so managers who closed the draft room can't miss it; targets **ranked by ADP** with already-bitten players removed so every listed target is legal.

**Generalize for next year:** *every* interactive power should have a decision window that outlives its round. A power you were dealt should never be lost because of when you happened to be looking at your phone.

---

## Finding 5 — Foresight Coin is backwards

It fires **after** your pick and only offers a swap with the **next two rounds**. A power meant to help you *plan* arrives after the decision it was supposed to inform. Nate's verdict: *"the swapping powers is garbage."*

**Redesign:** show it **before** the pick, display the manager's **entire remaining power schedule**, and let them move one power to any future round (or pull any future power to now). Same server-side swap RPC, which is already atomic and correct.

---

## Finding 6 — Power Negation is a self-inflicted wound nobody understood

*"Im confused on the power negation power??"* → *"On my own.team??"* → **"Ive screwed my whole.draft up"**.

Power Negation halves your own pick's score for the season unless you later earn a Power Restore Chip (one per week, to the top scorer only — so most of the league will never get one). The warning exists as a small grey hint in the powers panel and is easy to miss until the pick is spent.

**Fix:** a **blocking confirmation before the pick lands** — "⚠️ This halves [player]'s score all season. Most managers never earn a Restore Chip. Draft a bench player." Plus a visible chip counter, and a note that chips are tradeable.

*(Verified working end-to-end this session: the scoring engine halves via `power_negation`, the chip stamps `restored_at`, and score-matchups correctly reads `restored: row.restored_at != null` and skips the halving. The mechanic is sound — only its communication failed.)*

---

## Finding 7 — Nobody could tell who anyone was

*"I don't know who anyone is. So I can't tell who is doing it."*

The board, the order list, and the turn banner all show **team names only**. In a 14-team family league with names like "Creedontop" and "Tittie twisters", that's a real barrier.

**Fix:** show the manager's display name alongside the team name everywhere — board column headers, the round order list, the turn banner, and the pick feed.

---

## Finding 8 — The draft room is unusable-adjacent on a phone

Confirmed live by Nate: *"I see it now that I scrolled down."* The room is a two-column grid that stacks on mobile, so the sidebar — **My Team, My Powers, the round order** — sits *below* the Available Players list, which is itself a 520px scrolling box. On a phone you scroll an entire inner list before reaching any of it.

This is very likely a hidden contributor to *"I had to keep refreshing to find out what pick we were on"* — the information was on screen the whole time, just unreachable.

**Fix:** on small screens put **My Team + the round order above** the player list, and drop the player list's fixed height. Verify at 375px.

---

## Finding 9 — One email per pick blew the sending quota

**197 emails in one evening against a 100/day free tier (~197%)** — every one of them "⏰ You're on the clock." All delivered, none bounced. Duplicates were observed (Elijah received the same notice twice, 0.77s apart), so something notifies more than once per pick.

**The real risk isn't the draft mail — Supabase auth SMTP shares this Resend account.** A hard rate-limit shows up as a manager unable to reset their password, not a missing pick alert.

**Fix:** PWA push is already built and live and is the correct channel for "you're on the clock." Send **email only as a fallback** when the on-clock manager hasn't had the draft room open recently. That drops draft-night volume by roughly 90% and costs nothing. Also de-duplicate the notify call. Resend paid is $20/mo for 50k if ever needed — not needed yet.

---

## Finding 10 — The architectural lesson worth keeping

Every pre-draft bug this cycle had the same shape: **state that only exists after `start_draft` runs, read from a server prop rendered before it ran.** The lobby→live transition happens through the poll with no page reload, so those props never refresh. That produced the empty powers list (which silently forfeited every round-1 power), and the dead pick-#1 clock (no countdown, no self-autodraft, no force-autopick net).

**Rule for next year:** nothing created by `start_draft` — powers, draft order, `draft_started_at` — may be read from a page-load prop. Fetch it live, or sync it in `fetchPicks`.

---

## The build plan, in order

**Tier 1 — do these or next year repeats this year**
1. **Roster-aware autodraft** + a real per-manager auto mode (Finding 1). Biggest single win: fixes broken rosters *and* ~34 minutes of dead time.
2. **Apply the power-pinning migration** + sim (Finding 2). Already written.
3. **Decide Heist**: fix server-side, or pull both cards (Finding 3).

**Tier 2 — power design**
4. Post-draft decision windows for **all** interactive powers (Finding 4).
5. Foresight redesign — before the pick, whole schedule (Finding 5).
6. Power Negation blocking confirmation (Finding 6).

**Tier 3 — quality of life**
7. Manager names everywhere (Finding 7).
8. Mobile layout: sidebar above the player list (Finding 8).
9. Push-first notifications, email as fallback, de-duplicated (Finding 9).

**Tier 4 — before the next draft, non-negotiable**
10. **A multi-human rehearsal on real phones.** Every single defect found on 09-02 and 09-07 was invisible to single-user testing and to a 224-pick simulation. The sim proves the engine; only people prove the product.

---

## What to keep — this worked

- The engine: 224 picks, zero integrity defects, under real 14-client load.
- Realtime board updates (the 09-02 refresh complaint did not recur).
- The commissioner proxy — Nate drafted for absent managers all night, including interactive powers.
- The 90s clock and 30s round buffer felt right at a 35s average pace.
- Live fixes shipped mid-cycle held up: powers loaded, the player list never ran dry, the pick-#1 clock worked.
- The room stayed *fun*: *"This is running so smooth though I'm super proud of Claude and myself"* · *"Next year will be fire."*
