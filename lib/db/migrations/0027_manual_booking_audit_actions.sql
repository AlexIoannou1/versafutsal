DO $$ BEGIN
  ALTER TYPE "public"."audit_action" ADD VALUE 'MANUAL_BOOKING_CREATED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."audit_action" ADD VALUE 'BOOKING_EDITED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "public"."audit_action" ADD VALUE 'OFFLINE_PAYMENT_CONFIRMED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;