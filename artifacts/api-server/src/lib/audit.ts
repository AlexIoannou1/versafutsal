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
  | "NOTIFICATION_SENT";

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
      previousValue: params.previousValue ?? null,
      newValue: params.newValue ?? null,
      notes: params.notes ?? null,
      metadata: params.metadata ?? {},
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
