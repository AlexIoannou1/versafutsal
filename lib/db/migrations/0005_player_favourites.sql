CREATE TABLE IF NOT EXISTS "player_favourites" (
"player_id" uuid NOT NULL,
"venue_id" uuid NOT NULL,
"created_at" timestamp DEFAULT now() NOT NULL,
CONSTRAINT "player_favourites_pk" PRIMARY KEY("player_id","venue_id")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_favourites_player_id_users_id_fk') THEN
    ALTER TABLE "player_favourites" ADD CONSTRAINT "player_favourites_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_favourites_venue_id_venues_id_fk') THEN
    ALTER TABLE "player_favourites" ADD CONSTRAINT "player_favourites_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN IF NOT EXISTS "contact_phone" text;
