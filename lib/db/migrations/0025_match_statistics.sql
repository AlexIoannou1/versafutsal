CREATE TYPE "match_team" AS ENUM ('HOME', 'AWAY');
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'MATCH_STATISTICS_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'MATCH_STATISTICS_UPDATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'MATCH_STATISTICS_DELETED';
CREATE UNIQUE INDEX "bookings_id_venue_unique" ON "bookings" ("id", "venue_id");

CREATE TABLE "match_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL,
  "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE RESTRICT,
  "home_score" integer NOT NULL,
  "away_score" integer NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "match_results_booking_venue_fk" FOREIGN KEY ("booking_id", "venue_id")
    REFERENCES "bookings"("id", "venue_id") ON DELETE CASCADE,
  CONSTRAINT "match_results_scores_nonnegative" CHECK ("home_score" >= 0 AND "away_score" >= 0),
  CONSTRAINT "match_results_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "match_results_booking_unique" ON "match_results" ("booking_id");
CREATE INDEX "match_results_venue_idx" ON "match_results" ("venue_id");

CREATE TABLE "match_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "match_id" uuid NOT NULL REFERENCES "match_results"("id") ON DELETE CASCADE,
  "player_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "team" "match_team" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "match_participants_match_player_unique" ON "match_participants" ("match_id", "player_id");
CREATE UNIQUE INDEX "match_participants_match_id_unique" ON "match_participants" ("match_id", "id");
CREATE INDEX "match_participants_player_idx" ON "match_participants" ("player_id");

CREATE TABLE "match_stat_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "match_id" uuid NOT NULL,
  "participant_id" uuid NOT NULL,
  "goals" integer DEFAULT 0 NOT NULL,
  "assists" integer DEFAULT 0 NOT NULL,
  "saves" integer DEFAULT 0 NOT NULL,
  "yellow_cards" integer DEFAULT 0 NOT NULL,
  "red_cards" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "match_stat_events_participant_match_fk" FOREIGN KEY ("match_id", "participant_id")
    REFERENCES "match_participants"("match_id", "id") ON DELETE CASCADE,
  CONSTRAINT "match_stat_events_nonnegative" CHECK (
    "goals" >= 0 AND "assists" >= 0 AND "saves" >= 0 AND "yellow_cards" >= 0 AND "red_cards" >= 0
  )
);
CREATE UNIQUE INDEX "match_stat_events_participant_unique" ON "match_stat_events" ("participant_id");
CREATE INDEX "match_stat_events_match_idx" ON "match_stat_events" ("match_id");