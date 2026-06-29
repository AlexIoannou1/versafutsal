ALTER TABLE "bookings" DROP CONSTRAINT "unique_pitch_slot";--> statement-breakpoint
CREATE UNIQUE INDEX "unique_pitch_slot_active" ON "bookings" ("pitch_id","start_at") WHERE (status = 'PENDING' OR status = 'CONFIRMED');
