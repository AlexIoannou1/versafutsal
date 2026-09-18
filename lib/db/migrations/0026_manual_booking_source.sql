DO $$ BEGIN
  CREATE TYPE "public"."booking_source" AS ENUM ('ONLINE', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "source" "booking_source";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "offline_payment_received_at" timestamp with time zone;--> statement-breakpoint
UPDATE "bookings"
SET "source" = CASE
  WHEN "guest_name" IS NOT NULL OR "guest_phone" IS NOT NULL THEN 'MANUAL'::"booking_source"
  ELSE 'ONLINE'::"booking_source"
END
WHERE "source" IS NULL;--> statement-breakpoint
UPDATE "bookings"
SET "offline_payment_received_at" = COALESCE("updated_at", "created_at")
WHERE "source" = 'MANUAL'
  AND "status" = 'CONFIRMED'
  AND "offline_payment_received_at" IS NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "source" SET DEFAULT 'ONLINE';--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'MANUAL_BOOKING_CREATED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'BOOKING_EDITED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'OFFLINE_PAYMENT_CONFIRMED';