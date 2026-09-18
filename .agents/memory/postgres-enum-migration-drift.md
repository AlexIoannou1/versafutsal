---
name: Postgres enum migration drift
description: Safely adding enum labels when an earlier migration may already have been applied.
---

When an audit or status enum label is introduced after its original migration has already run in development, add it with an idempotent forward migration as well as ensuring the clean migration chain contains it.

**Why:** Edited historical migrations are not replayed on existing databases, which can leave runtime enum inserts failing despite a clean database working.

**How to apply:** Use a tracked, idempotent `ALTER TYPE ... ADD VALUE` migration for the current schema and verify the labels exist in the target database before relying on them in writes.