-- Server-enforced draft pick clock (audit U6 — offline picker froze the draft)
-- 1. draft_started_at anchors the deadline for pick #1 (later picks anchor on
--    the previous pick's picked_at).
-- 2. force_autopick lets ANY league member trigger the overdue pick once the
--    deadline (+30s round buffer for round-first picks, +15s grace) passes.
--    All timing validation is server-side; racing callers lose harmlessly.
--
-- NOTE: force_autopick's pick-insert core must mirror make_draft_pick. This
-- file is finalized against the live make_draft_pick body at apply time.

ALTER TABLE uff_leagues
  ADD COLUMN IF NOT EXISTS draft_started_at timestamptz;

-- Backfill: any in-progress draft anchors pick 1 at "now" on apply (harmless —
-- it only extends the very first deadline).
UPDATE uff_leagues
  SET draft_started_at = now()
  WHERE draft_status = 'in_progress' AND draft_started_at IS NULL;

-- start_draft must stamp the anchor; finalized against live body at apply time.
-- force_autopick created at apply time (see session notes).
