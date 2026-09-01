ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guest_name" text;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guest_phone" text;
