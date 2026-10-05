---
name: Orval object-size validation
description: Constraint behavior to account for when relying on generated Zod request schemas.
---

Generated Zod schemas from this project's Orval configuration do not apply OpenAPI `minProperties` or `maxProperties` constraints to object request bodies.

**Why:** A contract can describe a required object size while the generated client/server validation still accepts an empty or oversized object.

**How to apply:** Keep the OpenAPI contract expressive for consumers, but add explicit server-side validation whenever an endpoint depends on an object having an exact number of entries or keys.