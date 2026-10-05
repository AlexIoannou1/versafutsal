import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bookingsTable } from "./bookings";
import { usersTable } from "./users";
import { venuesTable } from "./venues";

export const promotionKindEnum = pgEnum("promotion_kind", ["PERCENTAGE", "FIXED"]);
export const incentiveLifecycleEnum = pgEnum("incentive_lifecycle", [
  "RESERVED",
  "REDEEMED",
  "REVERSED",
]);
export const streakRewardStatusEnum = pgEnum("streak_reward_status", [
  "AVAILABLE",
  "RESERVED",
  "REDEEMED",
  "REVERSED",
]);

export const promotionsTable = pgTable("promotions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  venueId: uuid("venue_id").notNull().references(() => venuesTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  kind: promotionKindEnum("kind").notNull(),
  value: numeric("value", { precision: 10, scale: 2 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  redemptionLimit: integer("redemption_limit"),
  perPlayerLimit: integer("per_player_limit").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("promotions_venue_code_unique").on(table.venueId, table.code),
  index("promotions_owner_idx").on(table.ownerId),
  check("promotions_value_positive", sql`${table.value} > 0`),
  check("promotions_percentage_max", sql`${table.kind} <> 'PERCENTAGE' OR ${table.value} <= 100`),
  check("promotions_limits_positive", sql`(${table.redemptionLimit} IS NULL OR ${table.redemptionLimit} > 0) AND ${table.perPlayerLimit} > 0`),
  check("promotions_dates_ordered", sql`${table.endsAt} IS NULL OR ${table.startsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`),
]);

export const promotionRedemptionsTable = pgTable("promotion_redemptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  promotionId: uuid("promotion_id").notNull().references(() => promotionsTable.id, { onDelete: "restrict" }),
  bookingId: uuid("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "restrict" }),
  playerId: uuid("player_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  status: incentiveLifecycleEnum("status").notNull().default("RESERVED"),
  discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("promotion_redemptions_booking_unique").on(table.bookingId),
  index("promotion_redemptions_limits_idx").on(table.promotionId, table.playerId, table.status),
]);

export const venueStreakSettingsTable = pgTable("venue_streak_settings", {
  venueId: uuid("venue_id").primaryKey().references(() => venuesTable.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const venueStreakProgressTable = pgTable("venue_streak_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venuesTable.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  paidWeeks: integer("paid_weeks").notNull().default(0),
  lastQualifiedWeek: text("last_qualified_week"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("venue_streak_progress_player_venue_unique").on(table.venueId, table.playerId),
  check("venue_streak_paid_weeks_range", sql`${table.paidWeeks} >= 0 AND ${table.paidWeeks} <= 4`),
]);

export const venueStreakEntriesTable = pgTable("venue_streak_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  progressId: uuid("progress_id").notNull().references(() => venueStreakProgressTable.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "restrict" }),
  weekKey: text("week_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("venue_streak_entries_booking_unique").on(table.bookingId),
  uniqueIndex("venue_streak_entries_week_unique").on(table.progressId, table.weekKey),
]);

export const venueStreakRewardsTable = pgTable("venue_streak_rewards", {
  id: uuid("id").primaryKey().defaultRandom(),
  progressId: uuid("progress_id").notNull().references(() => venueStreakProgressTable.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "restrict" }),
  sourceBookingId: uuid("source_booking_id").references(() => bookingsTable.id, { onDelete: "restrict" }),
  status: streakRewardStatusEnum("status").notNull().default("AVAILABLE"),
  earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  uniqueIndex("venue_streak_rewards_booking_unique").on(table.bookingId),
  uniqueIndex("venue_streak_rewards_source_booking_unique").on(table.sourceBookingId),
  index("venue_streak_rewards_available_idx").on(table.progressId, table.status, table.expiresAt),
]);

export type Promotion = typeof promotionsTable.$inferSelect;
export type VenueStreakProgress = typeof venueStreakProgressTable.$inferSelect;