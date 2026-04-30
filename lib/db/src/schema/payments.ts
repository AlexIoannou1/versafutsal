import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  uuid,
  numeric,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bookingsTable } from "./bookings";

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);

export const refundStatusEnum = pgEnum("refund_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
]);

// ─── Payments ──────────────────────────────────────────────────────────────

export const paymentsTable = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookingsTable.id, { onDelete: "restrict" }),
  provider: text("provider").notNull().default("MOCK"), // "MOCK" | "STRIPE"
  providerPaymentId: text("provider_payment_id"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("EUR"),
  feeAmount: numeric("fee_amount", { precision: 10, scale: 2 })
    .notNull()
    .default("1.00"),
  feeWaived: boolean("fee_waived").notNull().default(false),
  status: paymentStatusEnum("status").notNull().default("PENDING"),
  paymentType: text("payment_type").notNull().default("FULL"), // "FULL" | "DEPOSIT"
  idempotencyKey: text("idempotency_key").unique(),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Refunds ───────────────────────────────────────────────────────────────

export const refundsTable = pgTable("refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => paymentsTable.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: refundStatusEnum("status").notNull().default("PENDING"),
  reason: text("reason"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Relations ─────────────────────────────────────────────────────────────

export const paymentsRelations = relations(paymentsTable, ({ one, many }) => ({
  booking: one(bookingsTable, {
    fields: [paymentsTable.bookingId],
    references: [bookingsTable.id],
  }),
  refunds: many(refundsTable),
}));

export const refundsRelations = relations(refundsTable, ({ one }) => ({
  payment: one(paymentsTable, {
    fields: [refundsTable.paymentId],
    references: [paymentsTable.id],
  }),
}));

// ─── Types ─────────────────────────────────────────────────────────────────

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
export type Refund = typeof refundsTable.$inferSelect;
