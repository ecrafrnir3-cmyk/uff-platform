-- Web Push subscriptions for the PWA notification layer (Session 36).
-- One row per subscribed device/browser. Endpoint is globally unique per the
-- Push API spec, so it is the natural conflict key for re-subscribes; a shared
-- device that changes accounts re-upserts the endpoint onto the new user
-- (handled server-side with the admin client).

CREATE TABLE IF NOT EXISTS public.uff_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uff_push_subscriptions_user
  ON public.uff_push_subscriptions (user_id);

ALTER TABLE public.uff_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- House RLS style: per-user rows keyed on auth.uid() (cf. uff_notifications).
-- Writes go through server actions using the service role; SELECT/DELETE are
-- allowed directly so a client can reconcile its own subscription state.
CREATE POLICY "users read own push subscriptions"
  ON public.uff_push_subscriptions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users delete own push subscriptions"
  ON public.uff_push_subscriptions FOR DELETE
  USING (user_id = auth.uid());
