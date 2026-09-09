# 🏈 UFF Handoff Brief — Start Here (graph-driven · 2026-09-06)

> **Start every UFF session here.** Built from the UFF Brain codebase graph (`graphify-out/` — **1161 nodes · 1764 edges · 149 communities**, AST, refreshed 2026-09-09 via `python -m graphify update .` — the code-only subcommand, no LLM key needed; the doc layer is one semantic pass behind). Hold the god-node functions as the architecture, the communities as the module map, the hyperedges as the systems, and the operational state below as your marching orders.

## 🎯 The one thing to hold first
**The draft is DONE and the engine is proven under real load. The job now is to RUN THE SEASON and build next year's draft from the post-mortem — not to rebuild the engine.** The platform is a large, mature codebase (draft room, scoring pipeline, waivers, factions, Story Engine, push, AI) that has survived a ~60-defect audit sweep **and a real 14-manager draft**. Remaining work is **operational** (run the season) plus the **Tier-1 rebuild list** in the deep dive, aimed at next year's draft. If you catch yourself refactoring something the draft already proved, stop.

## 🏆 Status — THE DRAFT IS DONE (2026-09-07)
**"The First War" is drafted: 224/224 picks, 0 duplicate players, 0 skipped or doubled picks, all 14 rosters exactly 16, schedule generated.** Verified against the live DB after completion. The 2026-09-02 failure did not recur. Backend is live (`uff-platform` ACTIVE); playuff.com verified serving.

**The mission is no longer "run the draft" — it is RUN THE SEASON, and build next year's draft from the post-mortem.**

🚨 **Before anything else, know this (2026-09-08/09): a Week-1 scoring blocker was found and fixed.** The live engine was reading a Sleeper endpoint that returns **rank fields and no real stats**, so every Week-1 matchup would have finished **0-0**. Proven by replay (0 scored vs 385 on a real 2025 week), fixed in all four callers, **deployed as score-matchups v19**; a second identical trap in the projections fetch was silently misfiring the Iron Will and Mulligan tokens. **The remaining proof is the first live scoring run.** ⚠️ **Standing lesson: a 200 is not data — test the fetch, not just the math.** 🔑 **Edge functions deploy via the Supabase MCP `deploy_edge_function` tool, NOT the CLI** — `supabase login` fails in a non-TTY shell and the CLI rejects the new scoped tokens (only legacy full-account tokens work; deliberately not created).

▶️ **Read `docs/draft-deep-dive-2026-09-07.md` first.** Verdict: the engine is sound; everything remaining is product, and almost all of it is autodraft — which **can never draft a defense**, because all 32 carry a NULL `adp` and the fallback filters on `adp IS NOT NULL`.

⚠️ **Open right now:** `The Fratelli's` (0 DEF) and `Blake's Bad Boys` (0 K) cannot field a legal Week-1 lineup. Tier 1 of the plan: roster-aware autodraft + opt-in auto mode → apply the staged `20260907210000_pin_draft_power_rounds.sql` + sim → decide Draft Heist (fix server-side, or pull both it and Hero's Shield from the dealing pool, since a disabled-but-dealt Heist gives every manager 2 dead rounds).

## 🧠 The mind — the top god-nodes (the code backbone)
Betweenness/degree names the functions the whole app leans on:
1. **`createClient()`** — 150 edges (the massive hub; Supabase server auth that nearly every route/page/component calls). Bridges ~25 communities.
2. **`createAdminClient()`** — 28 (service-role client for crons/admin writes).
3. **`checkRateLimit()`** — 25 (rate-limit guard on the AI routes; was dead code, fixed in the audit).
4. **`getCurrentNFLWeek()`** — 22 (the week anchor the whole scoring/cron system pivots on).
5. **`createNotification()`** — 17 · **`sendEmail()`** — 16 (Resend) · **`getUserEmail()`** — 13.
6. **`proposeTrade()`** — 12 · **`recomputeLeagueLegends()`** — 12 (Story Engine standings).
7. `compilerOptions` (16) — tsconfig, a config hub.

**Read it this way:** everything routes through `createClient()` (auth) and pivots on `getCurrentNFLWeek()` (time). Those two are the load-bearing walls — touch them with care.

## ⚙️ The systems (graph hyperedges) — the three that matter
- **Live scoring pipeline** — {sleeper_api, score_matchups, uff_tokens, draft_powers, faction_war}. The weekly cron chain; the audit found it could silently die (fixed). ⚠️ Team-defense sync was frozen at a June backfill — verify DEF data before Week 1.
- **Anthropic-powered AI content system** — {oracle_ai, ai_draft_advisor, waiver_intel, trade_evaluator, power_rankings_ai, league_assistant_chat} behind `checkRateLimit`. Model = `claude-haiku-4-5-20251001`. **Constraint: never expose `ANTHROPIC_API_KEY`.**
- **Story Engine sealed read-only layer** — {story_engine, character_lore, "The Legend & the War" doc, finalize_week_cron}. Season-1 lore; `secret_story` is column-hidden at the DB level (revoke table SELECT, grant public cols). Feats wired to the finalize-week hook.

## 🗺️ The module map (key code communities)
Draft room & board · roster/lineup (setLineup, add/drop, IR, trade-block) · league creation & factions (createLeague, joinLeague, parseFaction) · waivers (FAAB blind-bid + priority) · scoring (calcScore, finalizeWeek, feats) · Story Engine (recomputeLeagueLegends, resolveBattle, Power Sheet, War Room) · notifications & PWA push (createNotification, sendPushToUser, host allowlist) · playoffs/brackets · records/standings · the AI routes. (Community 10 is the **audit-findings** doc — C1–C10 HIGH bugs — all since **fixed**; don't treat them as open.)

## ◉ Current operational state (2026-09-09)
- **Inaugural league "The First War"** — 14/14 managers, join code **`5DXXWP`**, Nate = commissioner ("**Reveille**").
- **✅ DRAFTED 2026-09-07** — 224/224 picks, 0 duplicates, 0 skips, 0 doubles, 14 rosters of 16, schedule generated. **Draft Heist stayed OFF** and never fired once; it is still *dealt* though, so every manager had 2 dead rounds (it + Hero's Shield).
- **✅ Week-1 scoring blocker fixed + deployed** (score-matchups **v19**); projected points live; weekly projections cron (Wed 08:00 UTC).
- **✅ Vampire Bite rescue live** — post-draft window + blocking roster gate + ADP-ranked targets, open until Week 1 kickoff.
- **✅ Story Engine ready to fire** at the first finalize (flag on, 14/14 cast, hook inside finalize-week, try/catch-isolated).
- **✅ Push notifications live**; Supabase `uff-platform` ACTIVE; playuff.com serving.

## ▶️ What's next
1. **Two teams cannot field a legal Week-1 lineup** — `The Fratelli's` (0 DEF, 2 K) and `Blake's Bad Boys` (0 K, 1 DEF). One trade fixes both.
2. **Watch the first live scoring run.** The endpoint fix is verified by replay, not yet by production. Failure is now loud, not silent.
3. **Tier 1 of the deep dive** — roster-aware autodraft + an opt-in auto mode (it can never draft a defense today); apply the staged `20260907210000_pin_draft_power_rounds.sql` + re-run the 10-draft sim; decide Draft Heist (fix server-side vs pull both cards).
4. Push-first notifications (197 emails in one draft vs a 100/day Resend cap; **Supabase auth SMTP shares that account**).
5. **A multi-human rehearsal on real phones before any future draft** — every defect in 09-02 and 09-07 was invisible to single-user testing and to a 224-pick sim.
6. Recommend Supabase **Pro ($25/mo)** — the free tier's 2-active-project cap still forces UFF and USTP to trade places.

## 🔒 Guardrails (do not violate)
- **Don't rebuild what the draft already proved.** The engine survived 14 live clients; the open work is product (see the deep dive), not a rewrite.
- **Deploy with `git push` (Vercel auto-deploys on push to `main`) — NOT `vercel --prod`.** (Hard-won lesson.)
- **Always `git fetch` before reporting UFF status.** A prior check reported finished work as unfinished by reading a stale local clone 20 commits behind — the truth-check cuts both ways.
- **Truth-check rule:** report only verified state (this board reflects what's confirmed, not intended). Never fabricate a "done."
- SQL/migrations: **dollar-quote tags** in Postgres functions; **`count(*)` not row estimates**; ⚠️ **the local service-role key IS set** in `.env.local` (`SUPABASE_SERVICE_ROLE_KEY`) — an older note claiming it was blank was wrong, corrected 2026-09-08; scripts can use it directly.
- **Never expose `ANTHROPIC_API_KEY`.** **A 200 is not data** — the scoring engine read a Sleeper endpoint that returned ranks and no stats; validate a fetch's CONTENT, never its status code.

## 🔑 Access & Resources
- **Repo:** `C:\Users\ecraf\Claude\Projects\UFF` (Next.js + Supabase + Vercel; Sentry). Full session log in the repo `CLAUDE.md` (615 lines).
- **Supabase:** project `synfuvgdamhjboobjmls` (currently PAUSED). App: playuff.com.
- **The graph:** `graphify-out/` (`GRAPH_REPORT.md` = the mind; `graph.html` opens standalone). Re-run the graphify skill with `--update` after code changes — code-only, no LLM needed. (Currently current: git clean, graph built 2026-09-03 after the last commit.)
- **Memory:** project `[[uff-audit-fix-2026-07-21]]` (the full UFF work log + lessons) + `MEMORY.md` (auto-loads). Notion: UFF hub `37c4c2d5-7f09-810a-af45-c4865205f83a` · Platform `37c4c2d5-7f09-813e-b77b-e79b3e9f2c21` · the UFF Universe / Writers' Room.

## Resume checklist
1. Read this file + `MEMORY.md`. Internalize the gate (un-pausing UFF pauses USTP) and the guardrails.
2. Confirm with Nate that UFF should be un-paused (and ideally Supabase upgraded to Pro) before any live work.
3. `git fetch` before reporting any status. Deploy with `git push`, never `vercel --prod`.
4. The mission is the **official re-draft of The First War (Heist OFF)** + verifying DEF data — not rebuilding.
5. Before adding any feature: ask "does this get the official draft run?" If no, don't.
