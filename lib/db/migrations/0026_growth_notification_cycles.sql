ALTER TABLE notifications ADD COLUMN dedupe_key text;
--> statement-breakpoint
DROP INDEX IF EXISTS notifications_growth_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX notifications_growth_unique
ON notifications (user_id, type, entity_type, entity_id, dedupe_key)
WHERE entity_type = 'STREAK_PROGRESS';
