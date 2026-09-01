---
name: Generated Zod API export
description: Prevent stale generated API schemas from shadowing the current OpenAPI codegen output.
---

The API-Zod barrel must explicitly export the nested generated API module, not
the parent path that can resolve to an older sibling artifact.

**Why:** The code generator emits its current output inside a nested `api`
directory while an older root-level generated file can remain after regeneration.
TypeScript's extension resolution can silently select the stale file, exposing
outdated schema constraints to consumers.

**How to apply:** After changing OpenAPI contracts, regenerate and inspect the
API-Zod export path as well as the emitted schema constraints. Remove obsolete
generated siblings when they are no longer part of the configured output.