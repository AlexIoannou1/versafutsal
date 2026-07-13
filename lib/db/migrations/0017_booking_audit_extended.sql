ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'BOOKING_STATUS_CHANGED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'PAYMENT_STATUS_CHANGED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'ADMIN_MODIFIED_BOOKING';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE IF NOT EXISTS 'NOTIFICATION_SENT';--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "actor_role" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "previous_value" jsonb;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "new_value" jsonb;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "notes" text;
