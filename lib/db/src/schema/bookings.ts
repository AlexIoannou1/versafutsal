import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  uuid,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { venuesTable, pitchesTable, maintenanceBlocksTable } from "./venues";

export { maintenanceBlocksTable };

export const bookingStatusEnum = pgEnum("booking_status", [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "REFUNDED",
  "NO_SHOW",
]);

export const bookingSourceEnum = pgEnum("booking_source", ["ONLINE", "MANUAL"]);

export const bookingsTable = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venuesTable.id, { onDelete: "restrict" }),
    pitchId: uuid("pitch_id")
      .notNull()
      .references(() => pitchesTable.id, { onDelete: "restrict" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    startAt: timestamp("start_at").notNull(),
    endAt: timestamp("end_at").notNull(),
    status: bookingStatusEnum("status").notNull().default("PENDING"),
    source: bookingSourceEnum("source").notNull().default("ONLINE"),
    offlinePaymentReceivedAt: timestamp("offline_payment_received_at", { withTimezone: true }),
    policySnapshot: jsonb("policy_snapshot").notNull().default({}),
    cancellationReason: text("cancellation_reason"),
    guestName: text("guest_name"),
    guestPhone: text("guest_phone"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    // Partial unique index — same pitch cannot have two active (PENDING/CONFIRMED) bookings at the same startAt.
    // CANCELLED, REFUNDED, and NO_SHOW rows are excluded so the slot can be rebooked after cancellation.
    uniquePitchSlotActive: uniqueIndex("unique_pitch_slot_active")
      .on(table.pitchId, table.startAt)
      .where(sql`(status = 'PENDING' OR status = 'CONFIRMED')`),
    bookingVenueUnique: uniqueIndex("bookings_id_venue_unique").on(table.id, table.venueId),
  }),
);

// ─── Relations ─────────────────────────────────────────────────────────────

export const bookingsRelations = relations(bookingsTable, ({ one }) => ({
  venue: one(venuesTable, {
    fields: [bookingsTable.venueId],
    references: [venuesTable.id],
  }),
  pitch: one(pitchesTable, {
    fields: [bookingsTable.pitchId],
    references: [pitchesTable.id],
  }),
  player: one(usersTable, {
    fields: [bookingsTable.playerId],
    references: [usersTable.id],
  }),
}));

// ─── Types ─────────────────────────────────────────────────────────────────

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
export type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "REFUNDED"
  | "NO_SHOW";
export type BookingSource = "ONLINE" | "MANUAL";
export type MaintenanceBlock = typeof maintenanceBlocksTable.$inferSelect;
