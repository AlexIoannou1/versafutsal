import { integer, pgTable, text, timestamp, pgEnum, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roleEnum = pgEnum("user_role", ["PLAYER", "VENUE_OWNER", "ADMIN"]);

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull().default("PLAYER"),
  phoneNumber: text("phone_number"),
  pushToken: text("push_token"), // Expo push token for native notifications
  avatarUrl: text("avatar_url"), // profile photo stored in Object Storage
  city: text("city"), // player's home city for venue auto-filter
  stripeCustomerId: text("stripe_customer_id"), // Stripe customer ID for saved payment methods
  stripeConnectAccountId: text("stripe_connect_account_id"), // Stripe Connect Express account for payouts
  sessionVersion: integer("session_version").notNull().default(0),
  deletedAt: timestamp("deleted_at"), // soft-delete; null = active account
  deletedOriginalEmail: text("deleted_original_email"), // preserved for login-block lookup after anonymisation
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  // NULL is intentionally allowed for legacy accounts; every new public
  // registration and every supplied profile phone is non-null and canonical.
  uniqueIndex("users_phone_number_unique").on(table.phoneNumber),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type UserRole = "PLAYER" | "VENUE_OWNER" | "ADMIN";
