ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "unique_pitch_slot";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_pitch_slot_active" ON "bookings" ("pitch_id","start_at") WHERE (status = 'PENDING' OR status = 'CONFIRMED');
