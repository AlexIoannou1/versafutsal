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
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./users";
import { venuesTable, pitchesTable } from "./venues";

export const tournamentStatusEnum = pgEnum("tournament_status", [
  "DRAFT", "PUBLISHED", "REGISTRATION_CLOSED", "IN_PROGRESS", "COMPLETED", "CANCELLED",
]);
export const tournamentFormatEnum = pgEnum("tournament_format", ["SINGLE_ELIMINATION"]);
export const tournamentEntryTypeEnum = pgEnum("tournament_entry_type", ["PLAYER", "TEAM"]);
export const tournamentRegistrationStatusEnum = pgEnum("tournament_registration_status", [
  "PAYMENT_PENDING", "CONFIRMED", "PAYMENT_FAILED", "CANCELLED", "REFUNDED",
]);
export const tournamentPaymentStatusEnum = pgEnum("tournament_payment_status", [
  "PENDING", "SUCCEEDED", "FAILED", "REFUND_PENDING", "REFUNDED",
]);
export const tournamentMatchStatusEnum = pgEnum("tournament_match_status", [
  "PENDING", "READY", "COMPLETED", "CANCELLED",
]);

export const tournamentsTable = pgTable("tournaments", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  venueId: uuid("venue_id").notNull().references(() => venuesTable.id, { onDelete: "restrict" }),
  pitchId: uuid("pitch_id").notNull().references(() => pitchesTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description"),
  status: tournamentStatusEnum("status").notNull().default("DRAFT"),
  format: tournamentFormatEnum("format").notNull().default("SINGLE_ELIMINATION"),
  entryType: tournamentEntryTypeEnum("entry_type").notNull(),
  capacity: integer("capacity").notNull(),
  registrationDeadline: timestamp("registration_deadline", { withTimezone: true }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  entryFeeAmount: numeric("entry_fee_amount", { precision: 12, scale: 2 }).notNull(),
  prizePoolAmount: numeric("prize_pool_amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("EUR"),
  bracketGeneratedAt: timestamp("bracket_generated_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("tournaments_capacity_check", sql`${t.capacity} >= 2`),
  check("tournaments_times_check", sql`${t.endsAt} > ${t.startsAt}`),
  check("tournaments_money_check", sql`${t.entryFeeAmount} >= 0 AND ${t.prizePoolAmount} >= 0`),
  index("tournaments_public_idx").on(t.status, t.startsAt),
  index("tournaments_owner_idx").on(t.ownerId, t.createdAt),
]);

export const tournamentTeamsTable = pgTable("tournament_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  captainId: uuid("captain_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tournament_team_name_unique").on(t.tournamentId, t.name),
]);

export const tournamentTeamMembersTable = pgTable("tournament_team_members", {
  teamId: uuid("team_id").notNull().references(() => tournamentTeamsTable.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tournament_team_member_unique").on(t.teamId, t.playerId),
]);

export const tournamentRegistrationsTable = pgTable("tournament_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "restrict" }),
  registrantId: uuid("registrant_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  teamId: uuid("team_id").references(() => tournamentTeamsTable.id, { onDelete: "restrict" }),
  status: tournamentRegistrationStatusEnum("status").notNull().default("PAYMENT_PENDING"),
  amountSnapshot: numeric("amount_snapshot", { precision: 12, scale: 2 }).notNull(),
  prizeContributionSnapshot: numeric("prize_contribution_snapshot", { precision: 12, scale: 2 }).notNull(),
  currencySnapshot: text("currency_snapshot").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tournament_registrant_unique").on(t.tournamentId, t.registrantId),
  uniqueIndex("tournament_team_registration_unique").on(t.tournamentId, t.teamId),
  index("tournament_registration_status_idx").on(t.tournamentId, t.status),
]);

export const tournamentPaymentsTable = pgTable("tournament_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  registrationId: uuid("registration_id").notNull().references(() => tournamentRegistrationsTable.id, { onDelete: "restrict" }),
  provider: text("provider").notNull(),
  providerPaymentId: text("provider_payment_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: tournamentPaymentStatusEnum("status").notNull().default("PENDING"),
  amountSnapshot: numeric("amount_snapshot", { precision: 12, scale: 2 }).notNull(),
  currencySnapshot: text("currency_snapshot").notNull(),
  refundId: text("refund_id"),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tournament_payment_idempotency_unique").on(t.registrationId, t.idempotencyKey),
  uniqueIndex("tournament_provider_payment_unique").on(t.providerPaymentId),
  uniqueIndex("tournament_payment_active_attempt_unique").on(t.registrationId)
    .where(sql`status IN ('PENDING', 'SUCCEEDED', 'REFUND_PENDING', 'REFUNDED')`),
]);

export const tournamentMatchesTable = pgTable("tournament_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  roundNumber: integer("round_number").notNull(),
  matchNumber: integer("match_number").notNull(),
  participantOneRegistrationId: uuid("participant_one_registration_id").references(() => tournamentRegistrationsTable.id, { onDelete: "restrict" }),
  participantTwoRegistrationId: uuid("participant_two_registration_id").references(() => tournamentRegistrationsTable.id, { onDelete: "restrict" }),
  winnerRegistrationId: uuid("winner_registration_id").references(() => tournamentRegistrationsTable.id, { onDelete: "restrict" }),
  nextMatchId: uuid("next_match_id"),
  nextMatchSlot: integer("next_match_slot"),
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  status: tournamentMatchStatusEnum("status").notNull().default("PENDING"),
  score: jsonb("score").$type<Record<string, number>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tournament_round_match_unique").on(t.tournamentId, t.roundNumber, t.matchNumber),
  check("tournament_match_slot_check", sql`${t.nextMatchSlot} IS NULL OR ${t.nextMatchSlot} IN (1, 2)`),
  check("tournament_match_times_check", sql`${t.endAt} IS NULL OR ${t.startAt} IS NOT NULL AND ${t.endAt} > ${t.startAt}`),
]);

export const tournamentAuditTable = pgTable("tournament_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  previousValue: jsonb("previous_value").$type<Record<string, unknown>>(),
  newValue: jsonb("new_value").$type<Record<string, unknown>>(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("tournament_audit_tournament_idx").on(t.tournamentId, t.createdAt)]);

export const tournamentsRelations = relations(tournamentsTable, ({ one, many }) => ({
  owner: one(usersTable, { fields: [tournamentsTable.ownerId], references: [usersTable.id] }),
  venue: one(venuesTable, { fields: [tournamentsTable.venueId], references: [venuesTable.id] }),
  pitch: one(pitchesTable, { fields: [tournamentsTable.pitchId], references: [pitchesTable.id] }),
  registrations: many(tournamentRegistrationsTable),
  matches: many(tournamentMatchesTable),
}));

export const insertTournamentSchema = createInsertSchema(tournamentsTable).omit({
  id: true, ownerId: true, status: true, bracketGeneratedAt: true, cancellationReason: true,
  publishedAt: true, closedAt: true, cancelledAt: true, createdAt: true, updatedAt: true,
});
export type Tournament = typeof tournamentsTable.$inferSelect;
export type TournamentRegistration = typeof tournamentRegistrationsTable.$inferSelect;
export type TournamentMatch = typeof tournamentMatchesTable.$inferSelect;