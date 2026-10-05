---
name: Growth checkout reservation safety
description: Why terminal incentive checkouts close bookings instead of retrying released immutable quotes.
---

Once an incentive-backed checkout has an immutable pricing snapshot, releasing its promotion or reward must also permanently close the unpaid booking. Recoverable retries must retain both their snapshot and reservation.

**Why:** Releasing a limited redemption while keeping the same discounted booking retryable lets another booking claim that limit and then allows the old quote to redeem it again. A provider timeout is not evidence that an intent cannot charge.

**How to apply:** Retain reservations during processing or provider uncertainty. Release only after provider-confirmed cancellation (or a genuinely zero-cost payment), then require a fresh booking. Streak notification deduplication must identify each cycle, not just the persistent player/venue progress.

Preview pricing must not claim a slot or incentive. Persist each payment and its immutable pricing together before exposing a client secret. Rebuild refunded-cycle progress from surviving qualifying weeks, not an assumed three remaining credits.

**Why:** Screen entry can otherwise strand an unpaid slot; interrupted writes can leave a resumable payment without incentive accounting; a second refund invalidates the three-credit assumption. Older settled cycles must not contribute credits to a newer cycle.

**How to apply:** Keep previews read-only, preserve atomic payment/snapshot persistence and legacy recovery, and cover multiple refunds in one cycle as well as refunds from older cycles.

Stale checkout claims require recovery even when no incentive or payment was created yet.

**Why:** A process can stop immediately after claiming a booking, leaving neither of the later records that narrower cleanup queries depend on.

**How to apply:** Treat the claim timestamp as a lease. Close expired, unpriced claims under the booking lock only when no payment exists, and require late payment writers to validate the live booking/key before exposing any secret.

Growth and other notifications use different uniqueness scopes. A bare conflict target cannot infer a partial PostgreSQL index.

**Why:** Introducing separate streak uniqueness can silently break ordinary booking notification inserts even when both indexes exist.

**How to apply:** Use conflict handling compatible with all partial indexes, and verify ordinary booking notices alongside streak deduplication.
