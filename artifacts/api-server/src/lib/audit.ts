import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { auditLogTable } from "@workspace/db/schema";

export type AuditAction =
  | "BOOKING_CREATED"
  | "BOOKING_CONFIRMED"
  | "BOOKING_ALREADY_CONFIRMED"
  | "BOOKING_CANCELLED"
  | "BOOKING_REFUNDED"
  | "BOOKING_EDITED"
  | "BOOKING_STATUS_CHANGED"
  | "PAYMENT_CREATED"
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "PAYMENT_STATUS_CHANGED"
  | "REFUND_ISSUED"
  | "ADMIN_REFUND_ISSUED"
  | "ADMIN_MODIFIED_BOOKING"
  | "VENUE_APPROVED"
  | "VENUE_REJECTED"
  | "FEE_WAIVED"
  | "USER_CREATED"
  | "MANUAL_BOOKING_CREATED"
  | "OFFLINE_PAYMENT_CONFIRMED"
  | "NOTIFICATION_SENT"
  | "MATCH_STATISTICS_CREATED"
  | "MATCH_STATISTICS_UPDATED"
  | "MATCH_STATISTICS_DELETED";

export interface LogBookingAuditParams {
  bookingId: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  action: AuditAction;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

const PRIVATE_AUDIT_KEY = /(?:guest|contact|name|phone|email)/i;

/** Removes contact/guest fields before operational data reaches the audit table. */
export function sanitizeBookingAuditData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeBookingAuditData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !PRIVATE_AUDIT_KEY.test(key))
    .map(([key, item]) => [key, sanitizeBookingAuditData(item)]));
}

export function sanitizeBookingAuditNotes(note: string | null | undefined): string | null {
  return note ? "[redacted operational note]" : null;
}

export function logBookingAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: NodePgDatabase<any>,
  params: LogBookingAuditParams,
): Promise<void> {
  return db
    .insert(auditLogTable)
    .values({
      actorUserId: params.actorUserId ?? null,
      actorRole: params.actorRole ?? null,
      entityType: "BOOKING",
      entityId: params.bookingId,
      action: params.action as typeof auditLogTable.$inferInsert["action"],
      previousValue: sanitizeBookingAuditData(params.previousValue) as Record<string, unknown> | null,
      newValue: sanitizeBookingAuditData(params.newValue) as Record<string, unknown> | null,
      notes: sanitizeBookingAuditNotes(params.notes),
      metadata: (sanitizeBookingAuditData(params.metadata) as Record<string, unknown> | null) ?? {},
    })
    .then(() => void 0);
}

export function logBookingAuditFireAndForget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: NodePgDatabase<any>,
  params: LogBookingAuditParams,
): void {
  void logBookingAudit(db, params);
}

export interface LogMatchStatisticsAuditParams
  extends Omit<LogBookingAuditParams, "bookingId"> {
  matchId: string;
  bookingId: string;
}

export function logMatchStatisticsAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: NodePgDatabase<any>,
  params: LogMatchStatisticsAuditParams,
): Promise<void> {
  return db
    .insert(auditLogTable)
    .values({
      actorUserId: params.actorUserId ?? null,
      actorRole: params.actorRole ?? null,
      entityType: "MATCH_STATISTICS",
      entityId: params.matchId,
      action: params.action as typeof auditLogTable.$inferInsert["action"],
      previousValue: params.previousValue ?? null,
      newValue: params.newValue ?? null,
      notes: params.notes ?? null,
      metadata: { ...(params.metadata ?? {}), bookingId: params.bookingId },
    })
    .then(() => void 0);
}
