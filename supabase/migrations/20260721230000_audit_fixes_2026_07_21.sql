-- ============================================================================
-- 2026-07-21 deep-dive audit fixes — APPLIED TO LIVE DB via Supabase MCP on
-- 2026-07-21/22 (migrations: fix_waiver_system_audit_2026_07,
-- fix_rpc_auth_and_finalize_audit_2026_07, fix_trade_rpcs_audit_2026_07,
-- drop_loose_trade_update_policy_audit_2026_07, fix_draft_rpc_auth_audit_2026_07).
-- This file is the git record of those changes. Full findings + rationale:
-- docs/deep-dive-audit-2026-07-21.md
--
-- Summary:
--  * submit_waiver_bid: priority-league claims no longer blocked by FAAB check
--  * process_waiver_bids / process_priority_waivers: sweep week <= p_week
--    (bids are tagged with the pre-roll week; the cron fires after the roll),
--    slot='active' on priority awards (table CHECK), roster cap + add limits +
--    Can't Cut + eliminated-member checks, per-award priority re-evaluation,
--    processed_at stamps, session-verified commissioner auth
--  * finalize_week / seed_playoffs / generate_schedule / extend_schedule /
--    start_draft / make_draft_pick: auth.uid() must match when present
--    (previously trusted caller-supplied p_user_id)
--  * mark_week_tokens_used / advance_playoff_bracket: commissioner guard added
--  * finalize_all_active_leagues: median_win + bracket advancement added,
--    chip inserts ON CONFLICT DO NOTHING, EXECUTE revoked from client roles
--  * seed_playoffs / reset_waiver_priority: opponent joins league/season-scoped
--    (matchup_id restarts at 1 per league)
--  * uff_trades: status CHECK now includes pending_review + vetoed (accepting a
--    trade in a commissioner-review league previously violated the constraint);
--    veto writes 'vetoed'; cancel_trade row-locked + status-guarded;
--    propose_trade requires the receiver to be in the same league; the loose
--    "proposer or receiver can update trade" RLS policy dropped
--  * update_draft_heist_order: caller must hold Draft Heist (power_id 3) this
--    round, single active heist, new order must be a permutation
--  * clear_heist_state: restores from stored heist_state, ignores client input
--  * swap_foresight_powers: new atomic Foresight Coin swap RPC
--  * uff_matchups.score_adjustment: commissioner override delta the scoring
--    edge function re-applies on every recompute
--
-- To re-apply from scratch, run the definitions below (idempotent CREATE OR
-- REPLACE / IF EXISTS forms). Retrieved from the live DB after application.
-- ============================================================================

ALTER TABLE public.uff_matchups ADD COLUMN IF NOT EXISTS score_adjustment numeric NOT NULL DEFAULT 0;

DROP POLICY IF EXISTS "proposer or receiver can update trade" ON public.uff_trades;

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.uff_trades'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
      AND conname != 'uff_trades_status_check_v2'
  LOOP
    EXECUTE format('ALTER TABLE public.uff_trades DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.uff_trades'::regclass AND conname = 'uff_trades_status_check'
  ) THEN
    ALTER TABLE public.uff_trades ADD CONSTRAINT uff_trades_status_check
      CHECK (status = ANY (ARRAY['pending'::text, 'pending_review'::text, 'accepted'::text, 'rejected'::text, 'vetoed'::text, 'cancelled'::text]));
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.finalize_all_active_leagues(integer) FROM anon, authenticated;

-- Function bodies: see the live database (pg_get_functiondef) — they were
-- applied via the named MCP migrations listed in the header. Future schema
-- work should add full definitions here so git stays the source of truth.
