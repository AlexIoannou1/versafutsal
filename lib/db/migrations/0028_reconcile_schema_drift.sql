-- Development databases created with schema push can predate tracked migrations.
-- Keep this forward migration idempotent so it repairs that state without
-- changing existing users, bookings, or match statistics.
DO $$ BEGIN
  CREATE TYPE "sms_reminder_status" AS ENUM ('SCHEDULED', 'PROCESSING', 'RETRY', 'SENT', 'CANCELLED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "sms_reminder_attempt_status" AS ENUM ('STARTED', 'SENT', 'RETRYABLE', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_reminder_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "recipient_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "recipient_phone" text,
  "scheduled_at" timestamp with time zone NOT NULL,
  "status" "sms_reminder_status" DEFAULT 'SCHEDULED' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 4 NOT NULL,
  "cost_units" integer DEFAULT 0 NOT NULL,
  "max_cost_units" integer DEFAULT 4 NOT NULL,
  "claim_token" uuid,
  "claimed_until" timestamp with time zone,
  "last_error_code" text,
  "sent_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sms_reminder_jobs_booking_unique" ON "sms_reminder_jobs" ("booking_id");
CREATE INDEX IF NOT EXISTS "sms_reminder_jobs_due_idx" ON "sms_reminder_jobs" ("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "sms_reminder_jobs_claim_idx" ON "sms_reminder_jobs" ("claimed_until");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_reminder_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "sms_reminder_jobs"("id") ON DELETE CASCADE,
  "attempt_number" integer NOT NULL,
  "provider" text NOT NULL,
  "provider_idempotency_key" text NOT NULL,
  "provider_message_id" text,
  "status" "sms_reminder_attempt_status" DEFAULT 'STARTED' NOT NULL,
  "error_code" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sms_reminder_attempts_job_number_unique" ON "sms_reminder_attempts" ("job_id", "attempt_number");
CREATE INDEX IF NOT EXISTS "sms_reminder_attempts_idempotency_idx" ON "sms_reminder_attempts" ("provider_idempotency_key");
CREATE INDEX IF NOT EXISTS "sms_reminder_attempts_job_idx" ON "sms_reminder_attempts" ("job_id");
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."booking_source" AS ENUM ('ONLINE', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "source" "booking_source";
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "offline_payment_received_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "bookings"
SET "source" = CASE
  WHEN "guest_name" IS NOT NULL OR "guest_phone" IS NOT NULL THEN 'MANUAL'::"booking_source"
  ELSE 'ONLINE'::"booking_source"
END
WHERE "source" IS NULL;
--> statement-breakpoint
UPDATE "bookings"
SET "offline_payment_received_at" = COALESCE("updated_at", "created_at")
WHERE "source" = 'MANUAL'
  AND "status" = 'CONFIRMED'
  AND "offline_payment_received_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "source" SET DEFAULT 'ONLINE';
ALTER TABLE "bookings" ALTER COLUMN "source" SET NOT NULL;
--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'MANUAL_BOOKING_CREATED';
ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'BOOKING_EDITED';
ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'OFFLINE_PAYMENT_CONFIRMED';