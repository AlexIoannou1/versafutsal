---
name: Drizzle migration generation is interactive
description: drizzle-kit generate can't be scripted non-interactively when renaming columns; how to work around it in this project.
---

`drizzle-kit generate` prompts interactively (create-vs-rename column) and can't be driven via bash in this environment. When a schema change involves renaming/retyping a column:

1. Hand-write the migration SQL file directly (e.g. `lib/db/migrations/NNNN_name.sql`) with explicit `ALTER TABLE ... RENAME COLUMN`, `SET DATA TYPE`, `SET DEFAULT`, and any backfill `UPDATE` statements.
2. Add the matching entry to `lib/db/migrations/meta/_journal.json` by hand (idx, tag matching filename, version, when timestamp, breakpoints: true).
3. Apply the statements to the dev DB directly via the database skill's `executeSql` (not by running the migration tool) — apply each statement separately and verify column type/default/data afterward with an information_schema query.

**Why:** No `0010_snapshot.json` exists either — this project's migrations/meta snapshots are already inconsistent, so hand-writing is an accepted convention here, not a one-off hack.

**How to apply:** Any time a schema change needs a rename or type change, skip `drizzle-kit generate` and go straight to hand-writing the SQL + journal entry + direct dev-DB application.
