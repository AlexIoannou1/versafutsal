import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  uuid,
  boolean,
  jsonb,
  numeric,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { relations } from "drizzle-orm";

// ─── Admin Settings ────────────────────────────────────────────────────────

export const adminSettingsTable = pgTable("admin_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  feeEnabled: boolean("fee_enabled").notNull().default(true),
  // Percentage of the booking subtotal charged as a platform service fee, e.g. "6.00" = 6%
  feePercent: numeric("fee_percent", { precision: 5, scale: 2 })
    .notNull()
    .default("6.00"),
  // JSON: { [venueId: string]: boolean } — venue-level fee overrides
  perVenueOverrides: jsonb("per_venue_overrides")
    .$type<Record<string, boolean>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Audit Log ─────────────────────────────────────────────────────────────

export const auditActionEnum = pgEnum("audit_action", [
  "BOOKING_CREATED",
  "BOOKING_CONFIRMED",
  "BOOKING_ALREADY_CONFIRMED",
  "BOOKING_CANCELLED",
  "BOOKING_REFUNDED",
  "BOOKING_STATUS_CHANGED",
  "PAYMENT_CREATED",
  "PAYMENT_SUCCEEDED",
  "PAYMENT_FAILED",
  "PAYMENT_STATUS_CHANGED",
  "REFUND_ISSUED",
  "ADMIN_REFUND_ISSUED",
  "ADMIN_MODIFIED_BOOKING",
  "VENUE_APPROVED",
  "VENUE_REJECTED",
  "FEE_WAIVED",
  "USER_CREATED",
  "MANUAL_BOOKING_CREATED",
  "OFFLINE_PAYMENT_CONFIRMED",
  "BOOKING_EDITED",
  "NOTIFICATION_SENT",
  "MATCH_STATISTICS_CREATED",
  "MATCH_STATISTICS_UPDATED",
  "MATCH_STATISTICS_DELETED",
]);

export const auditLogTable = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  actorRole: text("actor_role"),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: auditActionEnum("action").notNull(),
  previousValue: jsonb("previous_value").$type<Record<string, unknown>>(),
  newValue: jsonb("new_value").$type<Record<string, unknown>>(),
  notes: text("notes"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const auditLogRelations = relations(auditLogTable, ({ one }) => ({
  actor: one(usersTable, {
    fields: [auditLogTable.actorUserId],
    references: [usersTable.id],
  }),
}));

export type AuditLog = typeof auditLogTable.$inferSelect;
export type AdminSettings = typeof adminSettingsTable.$inferSelect;
