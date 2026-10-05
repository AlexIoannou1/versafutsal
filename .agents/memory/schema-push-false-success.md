---
name: Schema push false success
description: Post-merge reconciliation can silently fail despite a successful exit code.
---
Treat Drizzle schema-push output containing database errors as a failed setup, even when the command exits zero.

**Why:** During post-merge reconciliation, Drizzle attempted a composite foreign key before its referenced unique index existed. PostgreSQL rejected it, but the tool exited zero and the managed setup reported success.

**How to apply:** Check both exit status and error output when verifying schema reconciliation. Preserve existing data; establish missing composite-key prerequisites on existing tables before retrying. Do not assume the managed success flag proves schema changes applied.
