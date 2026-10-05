-- Forward migration after concurrent main-branch migrations. Safe for databases
-- that already applied the task's earlier development-only growth migrations.
DO $$ BEGIN CREATE TYPE promotion_kind AS ENUM ('PERCENTAGE', 'FIXED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE incentive_lifecycle AS ENUM ('RESERVED', 'REDEEMED', 'REVERSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE streak_reward_status AS ENUM ('AVAILABLE', 'RESERVED', 'REDEEMED', 'REVERSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'STREAK_NEAR_COMPLETION';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'STREAK_EXPIRING';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pricing_snapshot jsonb;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkout_key text;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_checkout_key_unique ON bookings (checkout_key) WHERE checkout_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_checkout_pending_idx ON bookings (id, checkout_key) WHERE status = 'PENDING';
CREATE OR REPLACE FUNCTION prevent_booking_pricing_snapshot_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.pricing_snapshot IS NOT NULL AND NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot THEN
   RAISE EXCEPTION 'booking pricing snapshot is immutable';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bookings_pricing_snapshot_immutable ON bookings;
CREATE TRIGGER bookings_pricing_snapshot_immutable BEFORE UPDATE OF pricing_snapshot ON bookings
FOR EACH ROW EXECUTE FUNCTION prevent_booking_pricing_snapshot_change();
CREATE TABLE IF NOT EXISTS promotions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE, code text NOT NULL, kind promotion_kind NOT NULL,
 value numeric(10,2) NOT NULL CHECK (value>0), enabled boolean NOT NULL DEFAULT true,
 starts_at timestamptz, ends_at timestamptz, redemption_limit integer, per_player_limit integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT promotions_percentage_max CHECK (kind<>'PERCENTAGE' OR value<=100),
 CONSTRAINT promotions_limits_positive CHECK ((redemption_limit IS NULL OR redemption_limit>0) AND per_player_limit>0),
 CONSTRAINT promotions_dates_ordered CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at>starts_at));
CREATE UNIQUE INDEX IF NOT EXISTS promotions_venue_code_unique ON promotions (venue_id,code);
CREATE INDEX IF NOT EXISTS promotions_owner_idx ON promotions (owner_id);
CREATE TABLE IF NOT EXISTS promotion_redemptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
 booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT, player_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 status incentive_lifecycle NOT NULL DEFAULT 'RESERVED', discount_amount numeric(10,2) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), redeemed_at timestamptz, reversed_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS promotion_redemptions_booking_unique ON promotion_redemptions (booking_id);
CREATE INDEX IF NOT EXISTS promotion_redemptions_limits_idx ON promotion_redemptions (promotion_id,player_id,status);
CREATE TABLE IF NOT EXISTS venue_streak_settings (venue_id uuid PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE, enabled boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS venue_streak_progress (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
 player_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, paid_weeks integer NOT NULL DEFAULT 0 CHECK (paid_weeks BETWEEN 0 AND 4),
 last_qualified_week text, expires_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS venue_streak_progress_player_venue_unique ON venue_streak_progress (venue_id,player_id);
CREATE TABLE IF NOT EXISTS venue_streak_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), progress_id uuid NOT NULL REFERENCES venue_streak_progress(id) ON DELETE CASCADE,
 booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT, week_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS venue_streak_entries_booking_unique ON venue_streak_entries (booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS venue_streak_entries_week_unique ON venue_streak_entries (progress_id,week_key);
CREATE TABLE IF NOT EXISTS venue_streak_rewards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), progress_id uuid NOT NULL REFERENCES venue_streak_progress(id) ON DELETE CASCADE,
 booking_id uuid REFERENCES bookings(id) ON DELETE RESTRICT, source_booking_id uuid REFERENCES bookings(id) ON DELETE RESTRICT, status streak_reward_status NOT NULL DEFAULT 'AVAILABLE',
 earned_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, redeemed_at timestamptz, reversed_at timestamptz,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE UNIQUE INDEX IF NOT EXISTS venue_streak_rewards_booking_unique ON venue_streak_rewards (booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS venue_streak_rewards_source_booking_unique ON venue_streak_rewards (source_booking_id);
CREATE INDEX IF NOT EXISTS venue_streak_rewards_available_idx ON venue_streak_rewards (progress_id,status,expires_at);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key text;
DROP INDEX IF EXISTS notifications_growth_unique;
CREATE UNIQUE INDEX notifications_growth_unique ON notifications (user_id,type,entity_type,entity_id,dedupe_key) WHERE entity_type = 'STREAK_PROGRESS';
-- Other features retain their global key uniqueness. Growth has distinct
-- near-completion and expiry messages for the same qualifying booking.
DROP INDEX IF EXISTS notifications_dedupe_key_unique;
CREATE UNIQUE INDEX notifications_dedupe_key_unique ON notifications (dedupe_key) WHERE entity_type IS DISTINCT FROM 'STREAK_PROGRESS';
