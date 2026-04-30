import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  uuid,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
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
    policySnapshot: jsonb("policy_snapshot").notNull().default({}),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    // Prevent double booking — same pitch cannot have two bookings with same startAt
    uniquePitchSlot: unique("unique_pitch_slot").on(table.pitchId, table.startAt),
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
export type MaintenanceBlock = typeof maintenanceBlocksTable.$inferSelect;
