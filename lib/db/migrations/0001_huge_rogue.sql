CREATE TYPE "public"."notification_type" AS ENUM('BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'NEW_BOOKING_OWNER', 'BOOKING_REMINDER', 'VENUE_APPROVED', 'VENUE_REJECTED', 'PAYMENT_FAILED');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"read" boolean DEFAULT false NOT NULL,
	"push_sent" boolean DEFAULT false NOT NULL,
	"scheduled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "push_token" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;