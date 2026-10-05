CREATE TYPE "tournament_status" AS ENUM ('DRAFT','PUBLISHED','REGISTRATION_CLOSED','IN_PROGRESS','COMPLETED','CANCELLED');
CREATE TYPE "tournament_format" AS ENUM ('SINGLE_ELIMINATION');
CREATE TYPE "tournament_entry_type" AS ENUM ('PLAYER','TEAM');
CREATE TYPE "tournament_registration_status" AS ENUM ('PAYMENT_PENDING','CONFIRMED','PAYMENT_FAILED','CANCELLED','REFUNDED');
CREATE TYPE "tournament_payment_status" AS ENUM ('PENDING','SUCCEEDED','FAILED','REFUND_PENDING','REFUNDED');
CREATE TYPE "tournament_match_status" AS ENUM ('PENDING','READY','COMPLETED','CANCELLED');

CREATE TABLE "tournaments" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
 "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE restrict, "pitch_id" uuid NOT NULL REFERENCES "pitches"("id") ON DELETE restrict,
 "name" text NOT NULL, "description" text, "status" tournament_status NOT NULL DEFAULT 'DRAFT',
 "format" tournament_format NOT NULL DEFAULT 'SINGLE_ELIMINATION', "entry_type" tournament_entry_type NOT NULL,
 "capacity" integer NOT NULL CHECK (capacity >= 2), "registration_deadline" timestamptz NOT NULL,
 "starts_at" timestamptz NOT NULL, "ends_at" timestamptz NOT NULL, "entry_fee_amount" numeric(12,2) NOT NULL,
 "prize_pool_amount" numeric(12,2) NOT NULL, "currency" text NOT NULL DEFAULT 'EUR', "bracket_generated_at" timestamptz,
 "cancellation_reason" text, "published_at" timestamptz, "closed_at" timestamptz, "cancelled_at" timestamptz,
 "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT tournaments_times_check CHECK (ends_at > starts_at), CONSTRAINT tournaments_money_check CHECK (entry_fee_amount >= 0 AND prize_pool_amount >= 0)
);
CREATE INDEX tournaments_public_idx ON tournaments(status, starts_at); CREATE INDEX tournaments_owner_idx ON tournaments(owner_id, created_at);
CREATE TABLE "tournament_teams" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tournament_id" uuid NOT NULL REFERENCES tournaments(id) ON DELETE cascade, "captain_id" uuid NOT NULL REFERENCES users(id) ON DELETE restrict, "name" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(), UNIQUE(tournament_id,name));
CREATE TABLE "tournament_team_members" ("team_id" uuid NOT NULL REFERENCES tournament_teams(id) ON DELETE cascade, "player_id" uuid NOT NULL REFERENCES users(id) ON DELETE restrict, "created_at" timestamptz NOT NULL DEFAULT now(), UNIQUE(team_id,player_id));
CREATE TABLE "tournament_registrations" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tournament_id" uuid NOT NULL REFERENCES tournaments(id) ON DELETE restrict,
 "registrant_id" uuid NOT NULL REFERENCES users(id) ON DELETE restrict, "team_id" uuid REFERENCES tournament_teams(id) ON DELETE restrict,
 "status" tournament_registration_status NOT NULL DEFAULT 'PAYMENT_PENDING', "amount_snapshot" numeric(12,2) NOT NULL,
 "prize_contribution_snapshot" numeric(12,2) NOT NULL, "currency_snapshot" text NOT NULL, "confirmed_at" timestamptz,
 "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tournament_id,registrant_id), UNIQUE(tournament_id,team_id)
);
CREATE INDEX tournament_registration_status_idx ON tournament_registrations(tournament_id,status);
CREATE TABLE "tournament_payments" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "registration_id" uuid NOT NULL REFERENCES tournament_registrations(id) ON DELETE restrict, "provider" text NOT NULL, "provider_payment_id" text NOT NULL UNIQUE, "idempotency_key" text NOT NULL, "status" tournament_payment_status NOT NULL DEFAULT 'PENDING', "amount_snapshot" numeric(12,2) NOT NULL, "currency_snapshot" text NOT NULL, "refund_id" text, "refunded_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), UNIQUE(registration_id,idempotency_key));
CREATE TABLE "tournament_matches" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tournament_id" uuid NOT NULL REFERENCES tournaments(id) ON DELETE cascade, "round_number" integer NOT NULL, "match_number" integer NOT NULL, "participant_one_registration_id" uuid REFERENCES tournament_registrations(id) ON DELETE restrict, "participant_two_registration_id" uuid REFERENCES tournament_registrations(id) ON DELETE restrict, "winner_registration_id" uuid REFERENCES tournament_registrations(id) ON DELETE restrict, "next_match_id" uuid, "next_match_slot" integer CHECK(next_match_slot IS NULL OR next_match_slot IN(1,2)), "start_at" timestamptz, "end_at" timestamptz, "status" tournament_match_status NOT NULL DEFAULT 'PENDING', "score" jsonb, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), UNIQUE(tournament_id,round_number,match_number), CHECK(end_at IS NULL OR start_at IS NOT NULL AND end_at > start_at));
ALTER TABLE tournament_matches ADD CONSTRAINT tournament_matches_next_fk FOREIGN KEY(next_match_id) REFERENCES tournament_matches(id) ON DELETE restrict;
CREATE TABLE "tournament_audit" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tournament_id" uuid NOT NULL REFERENCES tournaments(id) ON DELETE cascade, "actor_user_id" uuid REFERENCES users(id) ON DELETE set null, "action" text NOT NULL, "previous_value" jsonb, "new_value" jsonb, "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" timestamptz NOT NULL DEFAULT now());
CREATE INDEX tournament_audit_tournament_idx ON tournament_audit(tournament_id,created_at);