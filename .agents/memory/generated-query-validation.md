---
name: Generated query validation
description: OpenAPI query defaults and integer constraints need runtime verification after Orval generation.
---

Check generated query validation rather than assuming OpenAPI constraints survive generation. Add explicit route-boundary checks when generation drops integer validation or a referenced enum's default.

**Why:** The current generator emitted coerced numbers without integer checks for pagination and omitted the default for a referenced metric enum. Typechecking passed, but an omitted metric returned 400 and fractional pagination could reach SQL.

**How to apply:** For new paginated routes, exercise omitted parameters, fractions, zero, empty strings, and upper bounds against the runtime schema. Keep fixes in source validation or generator configuration, not hand-edited generated output.