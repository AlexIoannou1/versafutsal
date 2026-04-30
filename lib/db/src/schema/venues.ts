import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  uuid,
  integer,
  jsonb,
  numeric,
  boolean,
  time,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const venueStatusEnum = pgEnum("venue_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const pitchTypeEnum = pgEnum("pitch_type", [
  "INDOOR",
  "OUTDOOR",
  "HYBRID",
]);

export const dayTypeEnum = pgEnum("day_type", ["WEEKDAY", "WEEKEND", "ALL"]);

// ─── Venues ────────────────────────────────────────────────────────────────

export const venuesTable = pgTable("venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  status: venueStatusEnum("status").notNull().default("PENDING"),
  name: text("name").notNull(),
  district: text("district").notNull(),
  address: text("address").notNull(),
  description: text("description"),
  amenities: jsonb("amenities").$type<string[]>().notNull().default([]),
  cancellationWindowHours: integer("cancellation_window_hours")
    .notNull()
    .default(24),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const venuePhotosTable = pgTable("venue_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id")
    .notNull()
    .references(() => venuesTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Pitches ───────────────────────────────────────────────────────────────

export const pitchesTable = pgTable("pitches", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id")
    .notNull()
    .references(() => venuesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  size: text("size").notNull(), // e.g. "5v5", "7v7", "Futsal"
  type: pitchTypeEnum("type").notNull().default("INDOOR"),
  slotDurationMinutes: integer("slot_duration_minutes").notNull().default(60),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Opening Hours ─────────────────────────────────────────────────────────

export const openingHoursTable = pgTable("opening_hours", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id")
    .notNull()
    .references(() => venuesTable.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sun, 1=Mon, ..., 6=Sat
  openTime: time("open_time").notNull(),
  closeTime: time("close_time").notNull(),
  isClosed: boolean("is_closed").notNull().default(false),
});

// ─── Pricing Rules ─────────────────────────────────────────────────────────

export const pricingRulesTable = pgTable("pricing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  pitchId: uuid("pitch_id")
    .notNull()
    .references(() => pitchesTable.id, { onDelete: "cascade" }),
  dayType: dayTypeEnum("day_type").notNull().default("ALL"),
  pricePerHour: numeric("price_per_hour", { precision: 10, scale: 2 }).notNull(),
  depositType: text("deposit_type").notNull().default("NONE"), // "NONE" | "FIXED" | "PERCENT"
  depositAmount: numeric("deposit_amount", { precision: 10, scale: 2 }),
});

// ─── Maintenance Blocks ────────────────────────────────────────────────────

export const maintenanceBlocksTable = pgTable("maintenance_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  pitchId: uuid("pitch_id")
    .notNull()
    .references(() => pitchesTable.id, { onDelete: "cascade" }),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Relations ─────────────────────────────────────────────────────────────

export const venuesRelations = relations(venuesTable, ({ one, many }) => ({
  owner: one(usersTable, {
    fields: [venuesTable.ownerId],
    references: [usersTable.id],
  }),
  photos: many(venuePhotosTable),
  pitches: many(pitchesTable),
  openingHours: many(openingHoursTable),
}));

export const pitchesRelations = relations(pitchesTable, ({ one, many }) => ({
  venue: one(venuesTable, {
    fields: [pitchesTable.venueId],
    references: [venuesTable.id],
  }),
  pricingRules: many(pricingRulesTable),
  maintenanceBlocks: many(maintenanceBlocksTable),
}));

// ─── Types ─────────────────────────────────────────────────────────────────

export const insertVenueSchema = createInsertSchema(venuesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertVenue = z.infer<typeof insertVenueSchema>;
export type Venue = typeof venuesTable.$inferSelect;
export type Pitch = typeof pitchesTable.$inferSelect;
export type OpeningHours = typeof openingHoursTable.$inferSelect;
export type PricingRule = typeof pricingRulesTable.$inferSelect;
