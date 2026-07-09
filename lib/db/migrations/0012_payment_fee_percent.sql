ALTER TABLE "payments" ALTER COLUMN "fee_amount" SET DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "fee_percent" numeric(5, 2) NOT NULL DEFAULT '0.00';
