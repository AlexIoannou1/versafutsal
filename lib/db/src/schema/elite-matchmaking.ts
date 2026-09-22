import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bookingsTable } from "./bookings";
import { pitchesTable, venuesTable } from "./venues";
import { usersTable } from "./users";

export const squadRequestStatusEnum = pgEnum("squad_request_status", [
  "DRAFT", "PENDING", "MATCHED", "BOOKED", "CANCELLED", "EXPIRED",
]);
export const matchProposalStatusEnum = pgEnum("match_proposal_status", [
  "PENDING", "ACCEPTED", "BOOKED", "DECLINED", "CANCELLED", "EXPIRED",
]);
export const proposalResponseEnum = pgEnum("proposal_response", [
  "PENDING", "ACCEPTED", "DECLINED",
]);
export const waitlistEntryStatusEnum = pgEnum("waitlist_entry_status", [
  "WAITING", "OFFERED", "CLAIMED", "LEFT", "EXPIRED", "CANCELLED",
]);
export const waitlistClaimStatusEnum = pgEnum("waitlist_claim_status", [
  "ACTIVE", "CLAIMED", "EXPIRED", "REJECTED", "CANCELLED",
]);

export const squadRequestsTable = pgTable("squad_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  captainId: uuid("captain_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  venueId: uuid("venue_id").notNull().references(() => venuesTable.id, { onDelete: "restrict" }),
  skillMin: integer("skill_min").notNull(),
  skillMax: integer("skill_max").notNull(),
  status: squadRequestStatusEnum("status").notNull().default("DRAFT"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("squad_requests_skill_range_check", sql`${table.skillMin} BETWEEN 1 AND 10 AND ${table.skillMax} BETWEEN ${table.skillMin} AND 10`),
  check("squad_requests_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  index("squad_requests_match_idx").on(table.venueId, table.status, table.expiresAt),
  uniqueIndex("squad_requests_one_pending_captain_venue").on(table.captainId, table.venueId)
    .where(sql`status IN ('DRAFT','PENDING','MATCHED')`),
]);

export const squadRequestMembersTable = pgTable("squad_request_members", {
  requestId: uuid("request_id").notNull().references(() => squadRequestsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.requestId, table.userId] }),
  uniqueIndex("squad_request_members_position_unique").on(table.requestId, table.position),
  check("squad_request_members_position_check", sql`${table.position} BETWEEN 1 AND 5`),
]);

export const squadAvailabilityTable = pgTable("squad_availability", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull().references(() => squadRequestsTable.id, { onDelete: "cascade" }),
  pitchId: uuid("pitch_id").references(() => pitchesTable.id, { onDelete: "cascade" }),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  isExactSlot: integer("is_exact_slot").notNull().default(0),
}, (table) => [
  check("squad_availability_range_check", sql`${table.endAt} > ${table.startAt}`),
  check("squad_availability_exact_check", sql`${table.isExactSlot} IN (0,1)`),
  uniqueIndex("squad_availability_unique").on(table.requestId, table.pitchId, table.startAt, table.endAt),
  index("squad_availability_match_idx").on(table.startAt, table.endAt),
]);

export const matchProposalsTable = pgTable("match_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venuesTable.id, { onDelete: "restrict" }),
  squadAId: uuid("squad_a_id").notNull().references(() => squadRequestsTable.id, { onDelete: "restrict" }),
  squadBId: uuid("squad_b_id").notNull().references(() => squadRequestsTable.id, { onDelete: "restrict" }),
  bookingId: uuid("booking_id").notNull().references(() => bookingsTable.id, { onDelete: "restrict" }),
  squadAResponse: proposalResponseEnum("squad_a_response").notNull().default("PENDING"),
  squadBResponse: proposalResponseEnum("squad_b_response").notNull().default("PENDING"),
  status: matchProposalStatusEnum("status").notNull().default("PENDING"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("match_proposals_distinct_squads_check", sql`${table.squadAId} <> ${table.squadBId}`),
  uniqueIndex("match_proposals_booking_unique").on(table.bookingId),
  uniqueIndex("match_proposals_active_squad_a").on(table.squadAId).where(sql`status IN ('PENDING','ACCEPTED')`),
  uniqueIndex("match_proposals_active_squad_b").on(table.squadBId).where(sql`status IN ('PENDING','ACCEPTED')`),
  index("match_proposals_recovery_idx").on(table.status, table.expiresAt),
]);

export const waitlistEntriesTable = pgTable("waitlist_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venuesTable.id, { onDelete: "restrict" }),
  pitchId: uuid("pitch_id").notNull().references(() => pitchesTable.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  position: bigint("position", { mode: "number" }).generatedAlwaysAsIdentity(),
  status: waitlistEntryStatusEnum("status").notNull().default("WAITING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("waitlist_entries_range_check", sql`${table.endAt} > ${table.startAt}`),
  uniqueIndex("waitlist_entries_active_user_slot").on(table.pitchId, table.startAt, table.userId)
    .where(sql`status IN ('WAITING','OFFERED')`),
  index("waitlist_entries_order_idx").on(table.pitchId, table.startAt, table.status, table.position),
]);

export const waitlistClaimsTable = pgTable("waitlist_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => waitlistEntriesTable.id, { onDelete: "restrict" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  pitchId: uuid("pitch_id").notNull().references(() => pitchesTable.id, { onDelete: "restrict" }),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: waitlistClaimStatusEnum("status").notNull().default("ACTIVE"),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("waitlist_claims_active_slot").on(table.pitchId, table.startAt).where(sql`status = 'ACTIVE'`),
  uniqueIndex("waitlist_claims_active_user").on(table.userId).where(sql`status = 'ACTIVE'`),
  uniqueIndex("waitlist_claims_entry_unique").on(table.entryId),
  check("waitlist_claims_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  index("waitlist_claims_recovery_idx").on(table.status, table.expiresAt),
]);

export const eliteMutationBucketsTable = pgTable("elite_mutation_buckets", {
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  count: integer("count").notNull().default(1),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.action] }),
  check("elite_mutation_buckets_count_check", sql`${table.count} > 0`),
]);

export const squadRequestsRelations = relations(squadRequestsTable, ({ one, many }) => ({
  captain: one(usersTable, { fields: [squadRequestsTable.captainId], references: [usersTable.id] }),
  venue: one(venuesTable, { fields: [squadRequestsTable.venueId], references: [venuesTable.id] }),
  members: many(squadRequestMembersTable),
  availability: many(squadAvailabilityTable),
}));

export const insertSquadRequestSchema = createInsertSchema(squadRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWaitlistEntrySchema = createInsertSchema(waitlistEntriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSquadRequest = z.infer<typeof insertSquadRequestSchema>;
export type SquadRequest = typeof squadRequestsTable.$inferSelect;
export type MatchProposal = typeof matchProposalsTable.$inferSelect;
export type WaitlistEntry = typeof waitlistEntriesTable.$inferSelect;
export type WaitlistClaim = typeof waitlistClaimsTable.$inferSelect;