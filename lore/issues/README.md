# The First War — issues

The story is **bound to the real games**. Every result, score, margin and feat in these issues is the record of
matches real managers actually played; nothing here is invented to make a better beat.

- `002-first-blood.md` — Week 1. Seven fronts.
- `003-the-throne-answers.md` — Week 2. The Dominion squares the war.

The arc that runs across them is `../season-1-spine.md`.

- `001-the-first-war.md` — the opening saga, six beats. Moved in from `../season-1-the-first-war.md`
  on 2026-10-05 so the Comics section in the app lists the story from the beginning.

## The rule, for whoever writes #004

1. **Pull the ground truth from the database first** — matchups, factions, feats, Legend points. Do not write from
   memory of a previous issue, and do not trust a number quoted in earlier prose.
2. **Only cross-faction matchups move the war.** A Vanguard team beating another Vanguard team is a duel; it settles
   standing, not ground. Through Week 2 the cross-faction record is **3–3 and the front has not moved.**
   ✅ The `alliance_war` table now AGREES — #65 was fixed 2026-09-24: the front is recomputed from real
   cross-faction results only, and interloper ambushes by unclaimed Free Legends no longer take ground.
   It read 3–3 / front 0 through Week 2 and −1 after Week 3. Trust the table and the matchups together;
   if they ever diverge again, the real matchups still win.
3. **No Signature Power or Ultimate has any mechanical effect this season.** Powers may loom, strain and terrify in a
   panel; they may never be shown deciding a result. `earned_epithets` is empty for all twenty characters — no title
   has been paid yet, so none may be used as though it had.
4. **Invent freely: dread, dialogue, weather, what a blow felt like.** Never invent who won, by how much, or what
   happened. That constraint is the product.
5. **Fact-check the draft against the dossier before it ships.** The first pass on #002/#003 produced 31 errors across
   three drafts — a character given another's power, a male character called "the woman who did it", "five of six were
   routs" when four clear the blowout line. Every one was caught by checking, none by re-reading.
