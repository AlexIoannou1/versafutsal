---
name: Recurring checkout recovery
description: Safety invariant for preventing duplicate recurring charges across retries and delayed provider webhooks.
---

Do not treat a checkout session expiry or a local lease timeout as proof that no subscription was created. Before issuing a new recurring checkout, reconcile the known checkout session and the customer's provider-side subscriptions.

**Why:** A checkout can complete just before expiry while its webhook is delayed. Creating a replacement from local state alone can leave two live subscriptions and duplicate charges.

**How to apply:** Persist a provider customer before checkout, keep one owner-scoped pending attempt, reuse its idempotency identity on retries, and consult provider truth before replacing it. Serialize webhook reconciliation per owner.