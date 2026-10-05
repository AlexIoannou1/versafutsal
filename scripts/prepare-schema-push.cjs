// Ensure existing parent tables have their composite FK targets before push
// creates dependent constraints. No rows are removed or changed.
const { createRequire } = require("node:module");
const path = require("node:path");
const dbRequire = createRequire(path.resolve("lib/db/package.json"));
const { Client } = dbRequire("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      DO $$ BEGIN
        IF to_regclass('public.bookings') IS NOT NULL THEN
          CREATE UNIQUE INDEX IF NOT EXISTS bookings_id_venue_unique
            ON public.bookings (id, venue_id);
        END IF;
        IF to_regclass('public.match_participants') IS NOT NULL THEN
          CREATE UNIQUE INDEX IF NOT EXISTS match_participants_match_id_unique
            ON public.match_participants (match_id, id);
        END IF;
      END $$;
    `);
  } finally {
    await client.end();
  }
}
main().catch((error) => {
  console.error("Schema prerequisite check failed:", error.message);
  process.exitCode = 1;
});
