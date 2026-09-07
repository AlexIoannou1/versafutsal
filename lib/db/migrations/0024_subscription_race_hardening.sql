ALTER TABLE "owner_subscriptions"
  ADD COLUMN IF NOT EXISTS "pending_checkout_session_id" text,
  ADD COLUMN IF NOT EXISTS "pending_checkout_plan" "subscription_plan",
  ADD COLUMN IF NOT EXISTS "pending_checkout_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_provider_event_id" text;