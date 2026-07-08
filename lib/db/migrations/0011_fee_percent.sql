ALTER TABLE "admin_settings" RENAME COLUMN "fee_amount" TO "fee_percent";--> statement-breakpoint
ALTER TABLE "admin_settings" ALTER COLUMN "fee_percent" SET DATA TYPE numeric(5, 2);--> statement-breakpoint
ALTER TABLE "admin_settings" ALTER COLUMN "fee_percent" SET DEFAULT '6.00';--> statement-breakpoint
UPDATE "admin_settings" SET "fee_percent" = '6.00';
