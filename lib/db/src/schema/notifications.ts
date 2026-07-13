import {
  pgTable,
  text,
  timestamp,
  pgEnum,
  uuid,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { usersTable } from "./users";

export const notificationTypeEnum = pgEnum("notification_type", [
  "BOOKING_CONFIRMED",
  "BOOKING_CANCELLED",
  "NEW_BOOKING_OWNER",
  "BOOKING_REMINDER",
  "VENUE_APPROVED",
  "VENUE_REJECTED",
  "VENUE_DISABLED",
  "PAYMENT_FAILED",
]);

export const notificationsTable = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  entityType: text("entity_type"), // "BOOKING" | "VENUE" | etc.
  entityId: uuid("entity_id"),
  read: boolean("read").notNull().default(false),
  pushSent: boolean("push_sent").notNull().default(false),
  expoTicketId: text("expo_ticket_id"), // Expo push ticket ID; used for receipt polling
  scheduledAt: timestamp("scheduled_at"), // null = immediate
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const notificationsRelations = relations(notificationsTable, ({ one }) => ({
  user: one(usersTable, {
    fields: [notificationsTable.userId],
    references: [usersTable.id],
  }),
}));

export type Notification = typeof notificationsTable.$inferSelect;
