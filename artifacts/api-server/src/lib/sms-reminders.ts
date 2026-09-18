import { randomUUID } from "node:crypto";
import { db, pool } from "@workspace/db";
import {
  bookingsTable,
  ownerSubscriptionsTable,
  usersTable,
  venuesTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import { resolveEffectivePlan } from "./entitlements";
import { normalizeSmsPhone, smsProvider, type SmsSendResult } from "./sms-provider";

type SmsPoolClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  release(): void;
};

export const SMS_REMINDER_LEAD_MS = 24 * 60 * 60 * 1_000;
const CLAIM_LEASE_MS = 60_000;
const BATCH_SIZE = 25;

export function smsProviderIdempotencyKey(jobId: string): string {
  return `booking-reminder:${jobId}`;
}

export function claimStillOwned(expectedToken: string, persistedToken: string | null): boolean {
  return persistedToken === expectedToken;
}

export function isClaimableReminderJob(
  status: string,
  scheduledAt: Date,
  claimedUntil: Date | null,
  now: Date,
): boolean {
  if (status === "PROCESSING") return !!claimedUntil && claimedUntil < now;
  return (status === "SCHEDULED" || status === "RETRY") &&
    scheduledAt <= now && (!claimedUntil || claimedUntil < now);
}

export function reminderScheduleDecision(input: {
  status: string;
  effectivePlan: string;
  startAt: Date;
  now: Date;
  hasRecipient: boolean;
}): { schedule: boolean; scheduledAt: Date | null; reason: string } {
  if (input.status !== "CONFIRMED") return { schedule: false, scheduledAt: null, reason: "booking_inactive" };
  if (input.effectivePlan !== "PRO" && input.effectivePlan !== "ELITE") {
    return { schedule: false, scheduledAt: null, reason: "not_entitled" };
  }
  if (!input.hasRecipient) return { schedule: false, scheduledAt: null, reason: "no_recipient" };
  const scheduledAt = new Date(input.startAt.getTime() - SMS_REMINDER_LEAD_MS);
  if (scheduledAt <= input.now) return { schedule: false, scheduledAt: null, reason: "inside_lead_window" };
  return { schedule: true, scheduledAt, reason: "eligible" };
}

export function retryDecision(input: {
  result: SmsSendResult;
  attemptCount: number;
  maxAttempts: number;
  costUnits: number;
  maxCostUnits: number;
}): { retry: boolean; terminalStatus: "SENT" | "FAILED" | "CANCELLED" | null; delayMs: number } {
  if (input.result.outcome === "sent") return { retry: false, terminalStatus: "SENT", delayMs: 0 };
  if (input.result.outcome === "disabled") return { retry: false, terminalStatus: "CANCELLED", delayMs: 0 };
  if (input.result.outcome === "failed") return { retry: false, terminalStatus: "FAILED", delayMs: 0 };
  if (input.attemptCount >= input.maxAttempts || input.costUnits >= input.maxCostUnits) {
    return { retry: false, terminalStatus: "FAILED", delayMs: 0 };
  }
  const delayMs = Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, input.attemptCount - 1));
  return { retry: true, terminalStatus: null, delayMs };
}

export async function reconcileSmsReminder(bookingId: string, now = new Date()): Promise<void> {
  const [row] = await db
    .select({
      status: bookingsTable.status,
      startAt: bookingsTable.startAt,
      playerId: bookingsTable.playerId,
      guestPhone: bookingsTable.guestPhone,
      ownerId: venuesTable.ownerId,
      phoneNumber: usersTable.phoneNumber,
    })
    .from(bookingsTable)
    .innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
    .leftJoin(usersTable, eq(bookingsTable.playerId, usersTable.id))
    .where(eq(bookingsTable.id, bookingId))
    .limit(1);

  if (!row) return;
  const [subscription] = await db
    .select()
    .from(ownerSubscriptionsTable)
    .where(eq(ownerSubscriptionsTable.ownerId, row.ownerId))
    .limit(1);
  const recipientPhone = row.guestPhone ?? row.phoneNumber;
  let normalizedRecipient: string | null = null;
  if (recipientPhone) {
    try {
      normalizedRecipient = normalizeSmsPhone(recipientPhone);
    } catch {
      normalizedRecipient = null;
    }
  }
  const decision = reminderScheduleDecision({
    status: row.status,
    effectivePlan: resolveEffectivePlan(subscription, now),
    startAt: row.startAt,
    now,
    hasRecipient: normalizedRecipient !== null,
  });

  if (!decision.schedule) {
    await pool.query(
      `UPDATE sms_reminder_jobs SET status = 'CANCELLED', cancelled_at = $2, claim_token = NULL,
       claimed_until = NULL, updated_at = $2
       WHERE booking_id = $1 AND status <> 'SENT'`,
      [bookingId, now],
    );
    return;
  }
  await pool.query(
    `INSERT INTO sms_reminder_jobs
       (booking_id, recipient_user_id, recipient_phone, scheduled_at, status, attempt_count,
        cost_units, claim_token, claimed_until, last_error_code, sent_at, cancelled_at, updated_at)
     VALUES ($1, $2, $3, $4, 'SCHEDULED', 0, 0, NULL, NULL, NULL, NULL, NULL, $5)
     ON CONFLICT (booking_id) DO UPDATE SET
       recipient_user_id = EXCLUDED.recipient_user_id, recipient_phone = EXCLUDED.recipient_phone,
       scheduled_at = EXCLUDED.scheduled_at, status = 'SCHEDULED', attempt_count = 0,
       cost_units = 0, claim_token = NULL, claimed_until = NULL, last_error_code = NULL,
       sent_at = NULL, cancelled_at = NULL, updated_at = EXCLUDED.updated_at
     WHERE sms_reminder_jobs.status <> 'SENT'`,
    [
      bookingId,
      row.guestPhone ? null : row.playerId,
      row.guestPhone ? normalizedRecipient : null,
      decision.scheduledAt,
      now,
    ],
  );
}

type ClaimedJob = {
  id: string;
  booking_id: string;
  claim_token: string;
  attempt_count: number;
  max_attempts: number;
  cost_units: number;
  max_cost_units: number;
  recipient_phone: string | null;
  recipient_user_id: string | null;
};

async function claimDueJobs(now: Date): Promise<ClaimedJob[]> {
  const claimToken = randomUUID();
  const claimedUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
  const result = await pool.query<ClaimedJob>(
    `WITH due AS (
       SELECT id FROM sms_reminder_jobs
       WHERE (
         (status IN ('SCHEDULED', 'RETRY') AND scheduled_at <= $1
           AND (claimed_until IS NULL OR claimed_until < $1))
         OR (status = 'PROCESSING' AND claimed_until < $1)
       )
       ORDER BY scheduled_at FOR UPDATE SKIP LOCKED LIMIT $2
     )
     UPDATE sms_reminder_jobs j SET status = 'PROCESSING', claim_token = $3,
       claimed_until = $4, attempt_count = attempt_count + 1, cost_units = cost_units + 1,
       updated_at = $1
     FROM due WHERE j.id = due.id
     RETURNING j.id, j.booking_id, j.claim_token, j.attempt_count, j.max_attempts,
       j.cost_units, j.max_cost_units, j.recipient_phone, j.recipient_user_id`,
    [now, BATCH_SIZE, claimToken, claimedUntil],
  );
  return result.rows;
}

async function processClaimedJob(job: ClaimedJob, log: Logger): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const validation = await client.query<{
      status: string; start_at: Date; scheduled_at: Date; venue_name: string; phone_number: string | null;
    plan: string | null; subscription_status: string | null; current_period_end: Date | null;
    override_plan: string | null; override_starts_at: Date | null; override_ends_at: Date | null;
    }>(
    `SELECT b.status, b.start_at, j.scheduled_at, v.name AS venue_name, u.phone_number,
       s.plan, s.status AS subscription_status, s.current_period_end,
       s.override_plan, s.override_starts_at, s.override_ends_at
     FROM sms_reminder_jobs j JOIN bookings b ON b.id = j.booking_id
     JOIN venues v ON v.id = b.venue_id
     LEFT JOIN users u ON u.id = $2
     LEFT JOIN owner_subscriptions s ON s.owner_id = v.owner_id
     WHERE j.id = $1 AND j.claim_token = $3 FOR UPDATE OF b, j`,
    [job.id, job.recipient_user_id, job.claim_token],
    );
    const current = validation.rows[0];
    const now = new Date();
    const entitled = current && (resolveEffectivePlan(current.plan ? {
    plan: current.plan, status: current.subscription_status, currentPeriodEnd: current.current_period_end,
    overridePlan: current.override_plan, overrideStartsAt: current.override_starts_at,
    overrideEndsAt: current.override_ends_at,
  } as never : null, now) === "PRO" || resolveEffectivePlan(current.plan ? {
    plan: current.plan, status: current.subscription_status, currentPeriodEnd: current.current_period_end,
    overridePlan: current.override_plan, overrideStartsAt: current.override_starts_at,
    overrideEndsAt: current.override_ends_at,
    } as never : null, now) === "ELITE");
    const staleInitialSchedule =
      job.attempt_count === 1 &&
      current?.scheduled_at.getTime() !== current?.start_at.getTime() - SMS_REMINDER_LEAD_MS;
    if (!current || current.status !== "CONFIRMED" || !entitled || current.start_at <= now ||
      staleInitialSchedule) {
      await finishJob(client, job, "CANCELLED", null, now);
      await client.query("COMMIT");
      log.info({ event: "sms.reminder.skipped", jobId: job.id, bookingId: job.booking_id, reason: "ineligible" }, "SMS reminder skipped");
      return;
    }
    // A prior worker can die after calling the provider but before committing.
    // Reclaim once only to terminally record the exhausted job; never call again.
    if (job.attempt_count > job.max_attempts || job.cost_units > job.max_cost_units) {
      await finishJob(client, job, "FAILED", "RETRY_BUDGET_EXHAUSTED", now);
      await client.query("COMMIT");
      return;
    }

    let to: string;
    try {
      to = normalizeSmsPhone(job.recipient_phone ?? current.phone_number ?? "");
    } catch {
      await finishJob(client, job, "FAILED", "INVALID_PHONE", now);
      await client.query("COMMIT");
      log.warn({ event: "sms.reminder.failed", jobId: job.id, bookingId: job.booking_id, errorCode: "INVALID_PHONE" }, "SMS reminder failed");
      return;
    }

  const idempotencyKey = smsProviderIdempotencyKey(job.id);
  await client.query(
    `INSERT INTO sms_reminder_attempts
       (job_id, attempt_number, provider, provider_idempotency_key, status)
     VALUES ($1, $2, $3, $4, 'STARTED')
     ON CONFLICT (job_id, attempt_number) DO NOTHING`,
    [job.id, job.attempt_count, smsProvider.name, idempotencyKey],
  );
  const result = await smsProvider.send({
    to,
    body: `Reminder: your booking at ${current.venue_name} starts in 24 hours.`,
    idempotencyKey,
  });
  const decision = retryDecision({
    result,
    attemptCount: job.attempt_count,
    maxAttempts: job.max_attempts,
    costUnits: job.cost_units,
    maxCostUnits: job.max_cost_units,
  });
  const attemptStatus = result.outcome === "sent" ? "SENT"
    : result.outcome === "retryable" ? "RETRYABLE"
    : result.outcome === "disabled" ? "SKIPPED" : "FAILED";
  const errorCode = "errorCode" in result ? result.errorCode : result.outcome === "disabled" ? "PROVIDER_DISABLED" : null;
  await client.query(
    `UPDATE sms_reminder_attempts SET status = $3, provider_message_id = $4,
       error_code = $5, finished_at = $6 WHERE job_id = $1 AND attempt_number = $2`,
    [job.id, job.attempt_count, attemptStatus, result.outcome === "sent" ? result.messageId : null, errorCode, now],
  );
  if (decision.retry) {
    await client.query(
      `UPDATE sms_reminder_jobs SET status = 'RETRY', scheduled_at = $3, claim_token = NULL,
       claimed_until = NULL, last_error_code = $4, updated_at = $5
       WHERE id = $1 AND claim_token = $2`,
      [job.id, job.claim_token, new Date(now.getTime() + decision.delayMs), errorCode, now],
    );
  } else {
    await finishJob(client, job, decision.terminalStatus!, errorCode, now);
  }
  await client.query("COMMIT");
  log.info({
    event: "sms.reminder.processed", jobId: job.id, bookingId: job.booking_id,
    outcome: result.outcome, attempt: job.attempt_count,
  }, "SMS reminder processed");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function finishJob(
  client: SmsPoolClient,
  job: ClaimedJob,
  status: "SENT" | "FAILED" | "CANCELLED",
  errorCode: string | null,
  now: Date,
) {
  await client.query(
    `UPDATE sms_reminder_jobs SET status = $3, claim_token = NULL, claimed_until = NULL,
       last_error_code = $4, sent_at = CASE WHEN $3 = 'SENT' THEN $5 ELSE sent_at END,
       cancelled_at = CASE WHEN $3 = 'CANCELLED' THEN $5 ELSE cancelled_at END, updated_at = $5
     WHERE id = $1 AND claim_token = $2`,
    [job.id, job.claim_token, status, errorCode, now],
  );
}

export async function dispatchDueSmsReminders(log: Logger): Promise<void> {
  const jobs = await claimDueJobs(new Date());
  await Promise.all(jobs.map((job) => processClaimedJob(job, log).catch((error) => {
    log.error({ event: "sms.reminder.unhandled", err: error, jobId: job.id, bookingId: job.booking_id }, "SMS reminder processing failed");
  })));
}

export function startSmsReminderDispatcher(log: Logger, intervalMs = 60_000): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    void dispatchDueSmsReminders(log).finally(() => { running = false; });
  }, intervalMs);
}