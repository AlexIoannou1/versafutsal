CREATE TYPE "squad_request_status" AS ENUM ('DRAFT','PENDING','MATCHED','BOOKED','CANCELLED','EXPIRED');
CREATE TYPE "match_proposal_status" AS ENUM ('PENDING','ACCEPTED','BOOKED','DECLINED','CANCELLED','EXPIRED');
CREATE TYPE "proposal_response" AS ENUM ('PENDING','ACCEPTED','DECLINED');
CREATE TYPE "waitlist_entry_status" AS ENUM ('WAITING','OFFERED','CLAIMED','LEFT','EXPIRED','CANCELLED');
CREATE TYPE "waitlist_claim_status" AS ENUM ('ACTIVE','CLAIMED','EXPIRED','REJECTED','CANCELLED');
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'SQUAD_MATCHED';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'MATCH_EXPIRED';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'MATCH_CANCELLED';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'WAITLIST_CLAIM';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'WAITLIST_CLAIM_EXPIRED';
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;
CREATE UNIQUE INDEX "notifications_dedupe_key_unique" ON "notifications" ("dedupe_key");

CREATE TABLE "squad_requests" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "captain_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
 "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE RESTRICT, "skill_min" integer NOT NULL, "skill_max" integer NOT NULL,
 "status" "squad_request_status" NOT NULL DEFAULT 'DRAFT', "expires_at" timestamptz NOT NULL,
 "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "squad_requests_skill_range_check" CHECK (skill_min BETWEEN 1 AND 10 AND skill_max BETWEEN skill_min AND 10),
 CONSTRAINT "squad_requests_expiry_check" CHECK (expires_at > created_at)
);
CREATE INDEX "squad_requests_match_idx" ON "squad_requests" ("venue_id","status","expires_at");
CREATE UNIQUE INDEX "squad_requests_one_pending_captain_venue" ON "squad_requests" ("captain_id","venue_id") WHERE status IN ('DRAFT','PENDING','MATCHED');

CREATE TABLE "squad_request_members" (
 "request_id" uuid NOT NULL REFERENCES "squad_requests"("id") ON DELETE CASCADE,
 "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT, "position" integer NOT NULL,
 "joined_at" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY ("request_id","user_id"),
 CONSTRAINT "squad_request_members_position_check" CHECK (position BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "squad_request_members_position_unique" ON "squad_request_members" ("request_id","position");

CREATE TABLE "squad_availability" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "request_id" uuid NOT NULL REFERENCES "squad_requests"("id") ON DELETE CASCADE,
 "pitch_id" uuid REFERENCES "pitches"("id") ON DELETE CASCADE, "start_at" timestamptz NOT NULL, "end_at" timestamptz NOT NULL,
 "is_exact_slot" integer NOT NULL DEFAULT 0, CONSTRAINT "squad_availability_range_check" CHECK (end_at > start_at),
 CONSTRAINT "squad_availability_exact_check" CHECK (is_exact_slot IN (0,1))
);
CREATE UNIQUE INDEX "squad_availability_unique" ON "squad_availability" ("request_id","pitch_id","start_at","end_at");
CREATE INDEX "squad_availability_match_idx" ON "squad_availability" ("start_at","end_at");

CREATE TABLE "match_proposals" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE RESTRICT,
 "squad_a_id" uuid NOT NULL REFERENCES "squad_requests"("id") ON DELETE RESTRICT,
 "squad_b_id" uuid NOT NULL REFERENCES "squad_requests"("id") ON DELETE RESTRICT,
 "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE RESTRICT,
 "squad_a_response" "proposal_response" NOT NULL DEFAULT 'PENDING', "squad_b_response" "proposal_response" NOT NULL DEFAULT 'PENDING',
 "status" "match_proposal_status" NOT NULL DEFAULT 'PENDING', "expires_at" timestamptz NOT NULL,
 "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "match_proposals_distinct_squads_check" CHECK (squad_a_id <> squad_b_id)
);
CREATE UNIQUE INDEX "match_proposals_booking_unique" ON "match_proposals" ("booking_id");
CREATE UNIQUE INDEX "match_proposals_active_squad_a" ON "match_proposals" ("squad_a_id") WHERE status IN ('PENDING','ACCEPTED');
CREATE UNIQUE INDEX "match_proposals_active_squad_b" ON "match_proposals" ("squad_b_id") WHERE status IN ('PENDING','ACCEPTED');
CREATE INDEX "match_proposals_recovery_idx" ON "match_proposals" ("status","expires_at");

CREATE TABLE "waitlist_entries" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "venue_id" uuid NOT NULL REFERENCES "venues"("id") ON DELETE RESTRICT,
 "pitch_id" uuid NOT NULL REFERENCES "pitches"("id") ON DELETE RESTRICT, "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "start_at" timestamptz NOT NULL, "end_at" timestamptz NOT NULL, "position" bigint GENERATED ALWAYS AS IDENTITY,
 "status" "waitlist_entry_status" NOT NULL DEFAULT 'WAITING', "created_at" timestamptz NOT NULL DEFAULT now(),
 "updated_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "waitlist_entries_range_check" CHECK (end_at > start_at)
);
CREATE UNIQUE INDEX "waitlist_entries_active_user_slot" ON "waitlist_entries" ("pitch_id","start_at","user_id") WHERE status IN ('WAITING','OFFERED');
CREATE INDEX "waitlist_entries_order_idx" ON "waitlist_entries" ("pitch_id","start_at","status","position");

CREATE TABLE "waitlist_claims" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "entry_id" uuid NOT NULL REFERENCES "waitlist_entries"("id") ON DELETE RESTRICT,
 "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE, "pitch_id" uuid NOT NULL REFERENCES "pitches"("id") ON DELETE RESTRICT,
 "start_at" timestamptz NOT NULL, "expires_at" timestamptz NOT NULL, "status" "waitlist_claim_status" NOT NULL DEFAULT 'ACTIVE',
 "booking_id" uuid REFERENCES "bookings"("id") ON DELETE RESTRICT, "created_at" timestamptz NOT NULL DEFAULT now(), "resolved_at" timestamptz,
 CONSTRAINT "waitlist_claims_expiry_check" CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX "waitlist_claims_active_slot" ON "waitlist_claims" ("pitch_id","start_at") WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX "waitlist_claims_active_user" ON "waitlist_claims" ("user_id") WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX "waitlist_claims_entry_unique" ON "waitlist_claims" ("entry_id");
CREATE INDEX "waitlist_claims_recovery_idx" ON "waitlist_claims" ("status","expires_at");

CREATE TABLE "elite_mutation_buckets" (
 "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE, "action" text NOT NULL, "count" integer NOT NULL DEFAULT 1,
 "window_started_at" timestamptz NOT NULL, "expires_at" timestamptz NOT NULL, PRIMARY KEY ("user_id","action"),
 CONSTRAINT "elite_mutation_buckets_count_check" CHECK (count > 0)
);

CREATE OR REPLACE FUNCTION enforce_complete_squad() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('PENDING','MATCHED','BOOKED') AND
   (SELECT count(*) FROM squad_request_members WHERE request_id = NEW.id) <> 5 THEN
   RAISE EXCEPTION 'a submitted squad must contain exactly five unique members' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "squad_exactly_five_members" AFTER INSERT OR UPDATE OF status ON "squad_requests"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_complete_squad();

CREATE OR REPLACE FUNCTION enforce_member_change_keeps_complete_squad() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.request_id ELSE NEW.request_id END;
BEGIN
 IF EXISTS (SELECT 1 FROM squad_requests WHERE id = target_id AND status IN ('PENDING','MATCHED','BOOKED'))
   AND (SELECT count(*) FROM squad_request_members WHERE request_id = target_id) <> 5 THEN
   RAISE EXCEPTION 'a submitted squad must contain exactly five unique members' USING ERRCODE = '23514';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE CONSTRAINT TRIGGER "squad_members_keep_exactly_five" AFTER INSERT OR UPDATE OR DELETE ON "squad_request_members"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_member_change_keeps_complete_squad();