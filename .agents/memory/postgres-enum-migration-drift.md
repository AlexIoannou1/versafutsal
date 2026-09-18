---
name: Postgres enum migration drift
description: Safely adding enum labels when an earlier migration may already have been applied.
---

When an audit or status enum label is introduced after its original migration has already run in development, add it with an idempotent forward migration as well as ensuring the clean migration chain contains it.

**Why:** Edited historical migrations are not replayed on existing databases, which can leave runtime enum inserts failing despite a clean database working.

**How to apply:** Use a tracked, idempotent `ALTER TYPE ... ADD VALUE` migration for the current schema and verify the labels exist in the target database before relying on them in writes.

Journal ordering matters as much as the SQL itself: a migration added with an earlier timestamp than an already-applied migration can be skipped by Drizzle. Repair such drift with a new, later-dated idempotent migration; do not rewrite applied migration history.

**Why:** Development databases may have part of their schema created by `drizzle-kit push` rather than the tracked migration runner, while a subsequent rebase can introduce migrations that predate an already-applied change.

**How to apply:** Make the repair migration safe to run on both clean and drifted databases, then apply it only after confirming its DDL is additive and preserves existing application data.