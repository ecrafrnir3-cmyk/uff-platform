-- Follow-up to audit A3-06 (migration 20260926230000). rate_limit_hit is called only by the
-- server through the service-role client (src/lib/rate-limit.ts). The A3-06 migration also
-- granted it to anon and authenticated, which let any holder of the public anon key burn any
-- caller's bucket (the key format is in the public repo) and grow rate_limits with arbitrary
-- keys. Only service_role needs it.
REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) TO service_role;
