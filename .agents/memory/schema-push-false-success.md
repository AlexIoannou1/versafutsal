---
name: Schema push false success
description: Post-merge reconciliation can silently fail despite a successful exit code.
---
Treat Drizzle schema-push output containing database errors as a failed setup, even when the command exits zero.

**Why:** During post-merge reconciliation, Drizzle attempted a composite foreign key before its referenced unique index existed. PostgreSQL rejected it, but the tool exited zero and the managed setup reported success.

**How to apply:** Check both exit status and error output when verifying schema reconciliation. Preserve existing data; establish missing composite-key prerequisites on existing tables before retrying. Do not assume the managed success flag proves schema changes applied.

For composite foreign-key targets, prefer explicit unique constraints over standalone unique indexes. Reuse existing indexes with `UNIQUE USING INDEX` rather than dropping them or dependent foreign keys.

**Why:** Drizzle Kit 0.31.9 excludes indexes referenced by foreign keys from its index inventory, misclassifying them as constraint-generated. A subsequent push then tries to recreate the same index. Its unique-constraint introspection also returns columns in table-column order, not necessarily index order, which can cause unnecessary constraint replacement.

**How to apply:** Match the unique-constraint declaration to introspected table-column order (uniqueness is unchanged by column order). Verify a second reconciliation run, not just the first successful run, to catch this recurrence.
