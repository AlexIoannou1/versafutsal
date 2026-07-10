DO $$ BEGIN
  CREATE TYPE "public"."block_type" AS ENUM('OFF_DAY', 'BANK_HOLIDAY', 'TRAINING', 'MAINTENANCE', 'PRIVATE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "availability_blocks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "venue_id" uuid REFERENCES "venues"("id") ON DELETE cascade,
        "pitch_id" uuid REFERENCES "pitches"("id") ON DELETE cascade,
        "block_type" "block_type" DEFAULT 'OFF_DAY' NOT NULL,
        "label" text,
        "start_date" text NOT NULL,
        "end_date" text NOT NULL,
        "start_time" text,
        "end_time" text,
        "recurs_weekly" boolean DEFAULT false NOT NULL,
        "day_of_week" integer,
        "created_at" timestamp DEFAULT now() NOT NULL
);
