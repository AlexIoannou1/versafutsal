DO $$ BEGIN
  CREATE TYPE "subscription_plan" AS ENUM ('FREE', 'PRO', 'ELITE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "subscription_status" AS ENUM ('NONE', 'INCOMPLETE', 'ACTIVE', 'PAST_DUE', 'UNPAID', 'CANCELED', 'PAUSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "owner_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "plan" "subscription_plan" DEFAULT 'FREE' NOT NULL,
  "status" "subscription_status" DEFAULT 'NONE' NOT NULL,
  "provider" text,
  "provider_customer_id" text,
  "provider_subscription_id" text,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "canceled_at" timestamp with time zone,
  "override_plan" "subscription_plan",
  "override_reason" text,
  "override_starts_at" timestamp with time zone,
  "override_ends_at" timestamp with time zone,
  "override_actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "last_provider_event_created_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "owner_subscriptions_owner_unique" ON "owner_subscriptions" ("owner_id");
CREATE UNIQUE INDEX IF NOT EXISTS "owner_subscriptions_provider_subscription_unique" ON "owner_subscriptions" ("provider_subscription_id");
CREATE INDEX IF NOT EXISTS "owner_subscriptions_plan_status_idx" ON "owner_subscriptions" ("plan", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "provider_event_id" text,
  "event_type" text NOT NULL,
  "previous_value" jsonb,
  "new_value" jsonb,
  "reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_events_provider_event_unique" ON "subscription_events" ("provider_event_id");
CREATE INDEX IF NOT EXISTS "subscription_events_owner_occurred_idx" ON "subscription_events" ("owner_id", "occurred_at");
--> statement-breakpoint
INSERT INTO "owner_subscriptions" ("owner_id", "plan", "status")
SELECT "id", 'FREE', 'NONE' FROM "users" WHERE "role" = 'VENUE_OWNER'
ON CONFLICT ("owner_id") DO NOTHING;