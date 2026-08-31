import {
  integer,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const loginRateLimitBucketsTable = pgTable(
  "login_rate_limit_buckets",
  {
    scope: text("scope").notNull(),
    keyDigest: text("key_digest").notNull(),
    attemptCount: integer("attempt_count").notNull().default(1),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.scope, table.keyDigest],
      name: "login_rate_limit_buckets_scope_key_pk",
    }),
    index("login_rate_limit_buckets_expires_at_idx").on(table.expiresAt),
    check(
      "login_rate_limit_buckets_scope_check",
      sql`${table.scope} IN ('ip', 'account')`,
    ),
  ],
);

export const insertLoginRateLimitBucketSchema = createInsertSchema(
  loginRateLimitBucketsTable,
);

export type InsertLoginRateLimitBucket = z.infer<
  typeof insertLoginRateLimitBucketSchema
>;
export type LoginRateLimitBucket =
  typeof loginRateLimitBucketsTable.$inferSelect;