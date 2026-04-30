CREATE TYPE "public"."user_role" AS ENUM('PLAYER', 'VENUE_OWNER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."day_type" AS ENUM('WEEKDAY', 'WEEKEND', 'ALL');--> statement-breakpoint
CREATE TYPE "public"."pitch_type" AS ENUM('INDOOR', 'OUTDOOR', 'HYBRID');--> statement-breakpoint
CREATE TYPE "public"."venue_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('PENDING', 'CONFIRMED', 'CANCELLED', 'REFUNDED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('BOOKING_CREATED', 'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'BOOKING_REFUNDED', 'PAYMENT_CREATED', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'REFUND_ISSUED', 'VENUE_APPROVED', 'VENUE_REJECTED', 'FEE_WAIVED', 'USER_CREATED');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'PLAYER' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "maintenance_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pitch_id" uuid NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opening_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"open_time" time NOT NULL,
	"close_time" time NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pitches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" text NOT NULL,
	"size" text NOT NULL,
	"type" "pitch_type" DEFAULT 'INDOOR' NOT NULL,
	"slot_duration_minutes" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pitch_id" uuid NOT NULL,
	"day_type" "day_type" DEFAULT 'ALL' NOT NULL,
	"price_per_hour" numeric(10, 2) NOT NULL,
	"deposit_type" text DEFAULT 'NONE' NOT NULL,
	"deposit_amount" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "venue_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" "venue_status" DEFAULT 'PENDING' NOT NULL,
	"name" text NOT NULL,
	"district" text NOT NULL,
	"address" text NOT NULL,
	"description" text,
	"amenities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cancellation_window_hours" integer DEFAULT 24 NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"pitch_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"status" "booking_status" DEFAULT 'PENDING' NOT NULL,
	"policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cancellation_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_pitch_slot" UNIQUE("pitch_id","start_at")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"provider" text DEFAULT 'MOCK' NOT NULL,
	"provider_payment_id" text,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"fee_amount" numeric(10, 2) DEFAULT '1.00' NOT NULL,
	"fee_waived" boolean DEFAULT false NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"payment_type" text DEFAULT 'FULL' NOT NULL,
	"idempotency_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"status" "refund_status" DEFAULT 'PENDING' NOT NULL,
	"reason" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fee_enabled" boolean DEFAULT true NOT NULL,
	"fee_amount" numeric(10, 2) DEFAULT '1.00' NOT NULL,
	"per_venue_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "audit_action" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_hours" ADD CONSTRAINT "opening_hours_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitches" ADD CONSTRAINT "pitches_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_photos" ADD CONSTRAINT "venue_photos_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;