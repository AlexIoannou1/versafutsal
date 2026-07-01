import { pgTable, text, timestamp, pgEnum, uuid } from "drizzle-orm/pg-core";
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
  stripeCustomerId: text("stripe_customer_id"), // Stripe customer ID for saved payment methods
  deletedAt: timestamp("deleted_at"), // soft-delete; null = active account
  deletedOriginalEmail: text("deleted_original_email"), // preserved for login-block lookup after anonymisation
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type UserRole = "PLAYER" | "VENUE_OWNER" | "ADMIN";
