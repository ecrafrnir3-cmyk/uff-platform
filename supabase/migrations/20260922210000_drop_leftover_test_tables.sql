-- 2026-09-22 — Supabase flagged three public tables with RLS disabled
-- (rls_disabled_in_public, CRITICAL in the 19 Sep security email):
-- `_ci`, `_ci3` and `_swaptest`.
--
-- All three were leftover test scaffolding from an earlier session's
-- commissioner-power testing — not league data — and `anon` held full
-- SELECT/INSERT/UPDATE/DELETE/TRUNCATE on each, with RLS off and no policies.
-- They were the ONLY three tables in `public` without RLS; every real league
-- table (rosters, lineups, matchups, members, tokens) has it enabled.
-- Approved by Nate: "yes drop them".
--
-- Contents at drop time, recorded here because the tables do not survive this
-- migration (10 rows of test output in total):
--   _ci (test text, outcome text), 4 rows
--     1_vb_happy        ok: bite recorded for m_vb (round 13)
--     2_vb_noncommish   blocked: Only the commissioner can act for another manager
--     3_vb_own_player   blocked: Cannot bite your own player
--     4_foresight_happy FAILED: duplicate key on draft_power_assignments_member_id_power_id_key
--   _ci3 (test text, outcome text), 5 rows
--     5_foresight_happy      ok: round 12 now power 16, next now foresight
--     6_foresight_noncommish blocked: Only the commissioner can act for another manager
--     7_heist_noncommish     blocked: Only the commissioner can act for another manager
--     8_heist_happy          ok: blocked=false, slots swapped 3<->4
--     9_heist_shield_block   ok: blocked by Team 2, order unchanged
--   _swaptest (msg text), 1 row
--     single-CASE FAILED: duplicate key on draft_power_assignments_member_id_power_id_key
--
-- Verified before dropping: no dependent views, no foreign keys referencing them,
-- no function body mentioning them, no triggers, and no reference anywhere in
-- src/, supabase/ or scripts/.
--
-- Lesson: a scratch table created during a test inherits Supabase's default
-- anon/authenticated grants and has RLS OFF, so it is world-writable the moment
-- it exists. Drop test tables in the same session that creates them.

DROP TABLE IF EXISTS public._ci;
DROP TABLE IF EXISTS public._ci3;
DROP TABLE IF EXISTS public._swaptest;
