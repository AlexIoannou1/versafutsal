import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { usersTable } from "./users";

export const subscriptionPlanEnum = pgEnum("subscription_plan", ["FREE", "PRO", "ELITE"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "NONE",
  "INCOMPLETE",
  "ACTIVE",
  "PAST_DUE",
  "UNPAID",
  "CANCELED",
  "PAUSED",
]);

export const ownerSubscriptionsTable = pgTable("owner_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  plan: subscriptionPlanEnum("plan").notNull().default("FREE"),
  status: subscriptionStatusEnum("status").notNull().default("NONE"),
  provider: text("provider"),
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  pendingCheckoutSessionId: text("pending_checkout_session_id"),
  pendingCheckoutPlan: subscriptionPlanEnum("pending_checkout_plan"),
  pendingCheckoutExpiresAt: timestamp("pending_checkout_expires_at", { withTimezone: true }),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  overridePlan: subscriptionPlanEnum("override_plan"),
  overrideReason: text("override_reason"),
  overrideStartsAt: timestamp("override_starts_at", { withTimezone: true }),
  overrideEndsAt: timestamp("override_ends_at", { withTimezone: true }),
  overrideActorId: uuid("override_actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  lastProviderEventCreatedAt: timestamp("last_provider_event_created_at", { withTimezone: true }),
  lastProviderEventId: text("last_provider_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("owner_subscriptions_owner_unique").on(table.ownerId),
  uniqueIndex("owner_subscriptions_provider_subscription_unique").on(table.providerSubscriptionId),
  index("owner_subscriptions_plan_status_idx").on(table.plan, table.status),
]);

export const subscriptionEventsTable = pgTable("subscription_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  providerEventId: text("provider_event_id"),
  eventType: text("event_type").notNull(),
  previousValue: jsonb("previous_value").$type<Record<string, unknown>>(),
  newValue: jsonb("new_value").$type<Record<string, unknown>>(),
  reason: text("reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("subscription_events_provider_event_unique").on(table.providerEventId),
  index("subscription_events_owner_occurred_idx").on(table.ownerId, table.occurredAt),
]);

export const ownerSubscriptionsRelations = relations(ownerSubscriptionsTable, ({ one, many }) => ({
  owner: one(usersTable, { fields: [ownerSubscriptionsTable.ownerId], references: [usersTable.id] }),
  overrideActor: one(usersTable, { fields: [ownerSubscriptionsTable.overrideActorId], references: [usersTable.id] }),
  events: many(subscriptionEventsTable),
}));

export type SubscriptionPlan = "FREE" | "PRO" | "ELITE";
export type SubscriptionStatus = "NONE" | "INCOMPLETE" | "ACTIVE" | "PAST_DUE" | "UNPAID" | "CANCELED" | "PAUSED";
export type OwnerSubscription = typeof ownerSubscriptionsTable.$inferSelect;
export type SubscriptionEvent = typeof subscriptionEventsTable.$inferSelect;