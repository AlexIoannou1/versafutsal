import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bookingsTable } from "./bookings";
import { usersTable } from "./users";
import { venuesTable } from "./venues";

export const matchTeamEnum = pgEnum("match_team", ["HOME", "AWAY"]);

export const matchResultsTable = pgTable(
  "match_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id").notNull(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venuesTable.id, { onDelete: "restrict" }),
    homeScore: integer("home_score").notNull(),
    awayScore: integer("away_score").notNull(),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("match_results_booking_unique").on(table.bookingId),
    index("match_results_venue_idx").on(table.venueId),
    foreignKey({
      columns: [table.bookingId, table.venueId],
      foreignColumns: [bookingsTable.id, bookingsTable.venueId],
      name: "match_results_booking_venue_fk",
    }).onDelete("cascade"),
    check("match_results_scores_nonnegative", sql`${table.homeScore} >= 0 AND ${table.awayScore} >= 0`),
    check("match_results_version_positive", sql`${table.version} > 0`),
  ],
);

export const matchParticipantsTable = pgTable(
  "match_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matchResultsTable.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    team: matchTeamEnum("team").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("match_participants_match_player_unique").on(table.matchId, table.playerId),
    // Drizzle introspects unique-constraint columns in table-column order.
    // Keep this declaration in that order to avoid recreating an FK target.
    unique("match_participants_match_id_unique").on(table.id, table.matchId),
    index("match_participants_player_idx").on(table.playerId),
  ],
);

export const matchStatEventsTable = pgTable(
  "match_stat_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id").notNull(),
    participantId: uuid("participant_id").notNull(),
    goals: integer("goals").notNull().default(0),
    assists: integer("assists").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    yellowCards: integer("yellow_cards").notNull().default(0),
    redCards: integer("red_cards").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.matchId, table.participantId],
      foreignColumns: [matchParticipantsTable.matchId, matchParticipantsTable.id],
      name: "match_stat_events_participant_match_fk",
    }).onDelete("cascade"),
    uniqueIndex("match_stat_events_participant_unique").on(table.participantId),
    index("match_stat_events_match_idx").on(table.matchId),
    check(
      "match_stat_events_nonnegative",
      sql`${table.goals} >= 0 AND ${table.assists} >= 0 AND ${table.saves} >= 0 AND ${table.yellowCards} >= 0 AND ${table.redCards} >= 0`,
    ),
  ],
);

export const matchResultsRelations = relations(matchResultsTable, ({ one, many }) => ({
  booking: one(bookingsTable, { fields: [matchResultsTable.bookingId], references: [bookingsTable.id] }),
  venue: one(venuesTable, { fields: [matchResultsTable.venueId], references: [venuesTable.id] }),
  participants: many(matchParticipantsTable),
}));

export const matchParticipantsRelations = relations(matchParticipantsTable, ({ one }) => ({
  match: one(matchResultsTable, { fields: [matchParticipantsTable.matchId], references: [matchResultsTable.id] }),
  player: one(usersTable, { fields: [matchParticipantsTable.playerId], references: [usersTable.id] }),
  statistics: one(matchStatEventsTable),
}));

export const matchStatEventsRelations = relations(matchStatEventsTable, ({ one }) => ({
  participant: one(matchParticipantsTable, {
    fields: [matchStatEventsTable.participantId],
    references: [matchParticipantsTable.id],
  }),
  match: one(matchResultsTable, { fields: [matchStatEventsTable.matchId], references: [matchResultsTable.id] }),
}));

export const insertMatchResultSchema = createInsertSchema(matchResultsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertMatchParticipantSchema = createInsertSchema(matchParticipantsTable).omit({
  id: true,
  createdAt: true,
});
export const insertMatchStatEventSchema = createInsertSchema(matchStatEventsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MatchResult = typeof matchResultsTable.$inferSelect;
export type MatchParticipant = typeof matchParticipantsTable.$inferSelect;
export type MatchStatEvent = typeof matchStatEventsTable.$inferSelect;
export type MatchTeam = "HOME" | "AWAY";