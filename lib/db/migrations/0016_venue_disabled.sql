ALTER TYPE "public"."venue_status" ADD VALUE IF NOT EXISTS 'DISABLED';--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "disabled_reason" text;--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'VENUE_DISABLED';
