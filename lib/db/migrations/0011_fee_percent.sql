DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'admin_settings' AND column_name = 'fee_amount'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'admin_settings' AND column_name = 'fee_percent'
  ) THEN
    ALTER TABLE "admin_settings" RENAME COLUMN "fee_amount" TO "fee_percent";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "admin_settings" ALTER COLUMN "fee_percent" SET DATA TYPE numeric(5, 2);--> statement-breakpoint
ALTER TABLE "admin_settings" ALTER COLUMN "fee_percent" SET DEFAULT '6.00';--> statement-breakpoint
UPDATE "admin_settings" SET "fee_percent" = '6.00';
