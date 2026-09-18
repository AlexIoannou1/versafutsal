import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookingsTable } from "./bookings";
import { usersTable } from "./users";

export const smsReminderStatusEnum = pgEnum("sms_reminder_status", [
  "SCHEDULED",
  "PROCESSING",
  "RETRY",
  "SENT",
  "CANCELLED",
  "FAILED",
]);

export const smsReminderAttemptStatusEnum = pgEnum("sms_reminder_attempt_status", [
  "STARTED",
  "SENT",
  "RETRYABLE",
  "FAILED",
  "SKIPPED",
]);

export const smsReminderJobsTable = pgTable("sms_reminder_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "cascade" }),
  recipientUserId: uuid("recipient_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  recipientPhone: text("recipient_phone"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status: smsReminderStatusEnum("status").notNull().default("SCHEDULED"),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(4),
  costUnits: integer("cost_units").notNull().default(0),
  maxCostUnits: integer("max_cost_units").notNull().default(4),
  claimToken: uuid("claim_token"),
  claimedUntil: timestamp("claimed_until", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("sms_reminder_jobs_booking_unique").on(table.bookingId),
  index("sms_reminder_jobs_due_idx").on(table.status, table.scheduledAt),
  index("sms_reminder_jobs_claim_idx").on(table.claimedUntil),
]);

export const smsReminderAttemptsTable = pgTable("sms_reminder_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => smsReminderJobsTable.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  provider: text("provider").notNull(),
  providerIdempotencyKey: text("provider_idempotency_key").notNull(),
  providerMessageId: text("provider_message_id"),
  status: smsReminderAttemptStatusEnum("status").notNull().default("STARTED"),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("sms_reminder_attempts_job_number_unique").on(table.jobId, table.attemptNumber),
  index("sms_reminder_attempts_idempotency_idx").on(table.providerIdempotencyKey),
  index("sms_reminder_attempts_job_idx").on(table.jobId),
]);

export type SmsReminderJob = typeof smsReminderJobsTable.$inferSelect;
export type SmsReminderAttempt = typeof smsReminderAttemptsTable.$inferSelect;