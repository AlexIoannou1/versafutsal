---
name: Durable outbound reminder leases
description: Reliability rules for multi-process workers that send time-sensitive, billable notifications.
---

Reminder workers must reclaim expired leases from in-progress jobs, use a stable provider idempotency key across retries, and distinguish the original event-relative schedule from the next retry time.

**Why:** A crashed worker can otherwise strand a job forever. Reusing one timestamp for both the intended reminder time and retry backoff can also make a valid retry look like a stale reschedule.

**How to apply:** Include expired processing jobs in claim queries, revalidate the source record under a lock immediately before sending, guard final writes with the claim token, and keep retry timing logically separate from event-time validation.