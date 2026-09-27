-- 2026-09-27 — veto_trade fails closed, and anon loses EXECUTE (OPEN-LOOPS #79)
--
-- THE HOLE, proven on live data before this was written. The guard read:
--
--     IF v_commissioner_id != auth.uid() THEN
--       RAISE EXCEPTION 'Only the commissioner can veto trades';
--     END IF;
--
-- For an unauthenticated caller auth.uid() is NULL, so `uuid != NULL` evaluates
-- to NULL — which is not TRUE — so the RAISE never fired and execution fell
-- straight through to the UPDATE. Combined with an `anon` EXECUTE grant, the
-- anonymous public could veto any trade awaiting commissioner review.
--
-- Proof (rolled back, 2026-09-27): a fixture trade was inserted in
-- 'pending_review', `SET LOCAL ROLE anon` with request.jwt.claims cleared, then
-- veto_trade() was called. Result: NO exception, and the trade's status came back
-- 'vetoed'. auth.uid() was NULL throughout.
--
-- Not exploitable at the moment this was written only because uff_trades is
-- EMPTY (0 rows, so nothing is in pending_review). It becomes live the first
-- time anyone proposes a trade, which is why it is being closed now rather than
-- after the fact.
--
-- THE FIX is two independent layers, because either alone would have been enough
-- to stop this and neither should be relied on by itself:
--   1. Refuse an absent identity outright, before any other work.
--   2. Compare with IS DISTINCT FROM, which is NULL-safe in both directions.
-- Plus the grant: EXECUTE to authenticated only. The GRANT comes first so the
-- commissioner never loses access in the gap.
--
-- This is the same shape the 2026-09-26 audit applied to 18 other RPCs; veto_trade
-- was found at that session's close and logged rather than fixed (#79). The
-- remaining 14 anon-executable SECURITY DEFINER functions are NOT touched here:
-- each was read and they fail closed by construction (they key a lookup on
-- auth.uid(), which matches no row when it is NULL), so they are defence-in-depth
-- tidy-up rather than open doors.

CREATE OR REPLACE FUNCTION public.veto_trade(p_trade_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trade           uff_trades%ROWTYPE;
  v_commissioner_id uuid;
BEGIN
  -- Layer 1: an absent identity is refused before anything else happens.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_trade FROM uff_trades WHERE id = p_trade_id FOR UPDATE;
  IF v_trade.id IS NULL THEN RAISE EXCEPTION 'Trade not found'; END IF;
  IF v_trade.status != 'pending_review' THEN RAISE EXCEPTION 'Trade is not awaiting commissioner review'; END IF;

  SELECT commissioner_id INTO v_commissioner_id FROM uff_leagues WHERE id = v_trade.league_id;
  -- Layer 2: IS DISTINCT FROM is NULL-safe, so a NULL on either side still
  -- refuses instead of evaluating to NULL and skipping the RAISE.
  IF v_commissioner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the commissioner can veto trades';
  END IF;

  UPDATE uff_trades
     SET status = 'vetoed', veto_reason = p_reason, updated_at = now()
   WHERE id = p_trade_id;
END;
$function$;

-- Grant before revoke: the commissioner must never be locked out in between.
GRANT  EXECUTE ON FUNCTION public.veto_trade(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.veto_trade(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.veto_trade(uuid, text) FROM PUBLIC;
