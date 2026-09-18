import assert from "node:assert/strict";
import { createSmsProvider, normalizeSmsPhone } from "./lib/sms-provider";
import {
  claimStillOwned,
  isClaimableReminderJob,
  reminderScheduleDecision,
  retryDecision,
  smsProviderIdempotencyKey,
} from "./lib/sms-reminders";

assert.equal(normalizeSmsPhone("+357 99 123456"), "+35799123456");
assert.equal(normalizeSmsPhone("99123456"), "+35799123456");
assert.throws(() => normalizeSmsPhone("+357123"));
assert.throws(() => normalizeSmsPhone("not-a-phone"));

const disabled = createSmsProvider({});
assert.equal(disabled.enabled, false);
assert.equal((await disabled.send({ to: "+35799123456", body: "x", idempotencyKey: "job:1" })).outcome, "disabled");

const now = new Date("2026-02-01T12:00:00.000Z");
const eligible = reminderScheduleDecision({
  status: "CONFIRMED",
  effectivePlan: "PRO",
  startAt: new Date("2026-02-03T12:00:00.000Z"),
  now,
  hasRecipient: true,
});
assert.equal(eligible.schedule, true);
assert.equal(eligible.scheduledAt?.toISOString(), "2026-02-02T12:00:00.000Z");
assert.equal(reminderScheduleDecision({
  status: "CANCELLED", effectivePlan: "ELITE",
  startAt: new Date("2026-02-03T12:00:00.000Z"), now, hasRecipient: true,
}).schedule, false);
assert.equal(reminderScheduleDecision({
  status: "CONFIRMED", effectivePlan: "FREE",
  startAt: new Date("2026-02-03T12:00:00.000Z"), now, hasRecipient: true,
}).reason, "not_entitled");
assert.equal(reminderScheduleDecision({
  status: "CONFIRMED", effectivePlan: "PRO",
  startAt: new Date("2026-02-02T11:59:00.000Z"), now, hasRecipient: true,
}).reason, "inside_lead_window");

const retryable = { outcome: "retryable", provider: "test", errorCode: "HTTP_429" } as const;
assert.deepEqual(retryDecision({
  result: retryable, attemptCount: 1, maxAttempts: 4, costUnits: 1, maxCostUnits: 4,
}), { retry: true, terminalStatus: null, delayMs: 30_000 });
assert.equal(retryDecision({
  result: retryable, attemptCount: 4, maxAttempts: 4, costUnits: 4, maxCostUnits: 4,
}).terminalStatus, "FAILED");
assert.equal(retryDecision({
  result: { outcome: "sent", provider: "test", messageId: "same-provider-id" },
  attemptCount: 2, maxAttempts: 4, costUnits: 2, maxCostUnits: 4,
}).terminalStatus, "SENT");

// A stable per-job provider key is the mechanism that makes lease-expiry races safe:
// every retry of a claimed job addresses the same provider idempotency operation.
assert.equal(smsProviderIdempotencyKey("job-1"), smsProviderIdempotencyKey("job-1"));
assert.notEqual(smsProviderIdempotencyKey("job-1"), smsProviderIdempotencyKey("job-2"));
assert.equal(claimStillOwned("worker-a", "worker-a"), true);
assert.equal(claimStillOwned("worker-a", "worker-b"), false, "an expired claim cannot finalize another worker's job");
assert.equal(isClaimableReminderJob("PROCESSING", now, new Date(now.getTime() - 1), now), true);
assert.equal(isClaimableReminderJob("PROCESSING", now, new Date(now.getTime() + 1), now), false);

console.info("SMS reminder tests passed");