import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type {
  LoginRateLimitScope,
  RateLimitBucketResult,
} from "./login-rate-limiter";

type BucketRow = {
  attempt_count: number | string;
  expires_at: Date | string;
};

export async function recordLoginAttempt(input: {
  scope: LoginRateLimitScope;
  keyDigest: string;
  now: Date;
  windowExpiresAt: Date;
}): Promise<RateLimitBucketResult> {
  const result = await db.execute(sql`
    INSERT INTO "login_rate_limit_buckets" (
      "scope",
      "key_digest",
      "attempt_count",
      "window_started_at",
      "expires_at"
    )
    VALUES (
      ${input.scope},
      ${input.keyDigest},
      1,
      ${input.now},
      ${input.windowExpiresAt}
    )
    ON CONFLICT ("scope", "key_digest")
    DO UPDATE SET
      "attempt_count" = CASE
        WHEN "login_rate_limit_buckets"."expires_at" <= ${input.now}
          THEN 1
        ELSE "login_rate_limit_buckets"."attempt_count" + 1
      END,
      "window_started_at" = CASE
        WHEN "login_rate_limit_buckets"."expires_at" <= ${input.now}
          THEN ${input.now}
        ELSE "login_rate_limit_buckets"."window_started_at"
      END,
      "expires_at" = CASE
        WHEN "login_rate_limit_buckets"."expires_at" <= ${input.now}
          THEN ${input.windowExpiresAt}
        ELSE "login_rate_limit_buckets"."expires_at"
      END
    RETURNING "attempt_count", "expires_at"
  `);

  const row = result.rows[0] as BucketRow | undefined;
  if (!row) {
    throw new Error("Login rate limiter did not return a bucket");
  }

  const expiresAt =
    row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new Error("Login rate limiter returned an invalid expiry");
  }

  return {
    attemptCount: Number(row.attempt_count),
    expiresAt,
  };
}

export async function cleanupExpiredLoginRateLimitBuckets(
  now: Date,
  limit: number,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM "login_rate_limit_buckets"
    WHERE ctid IN (
      SELECT ctid
      FROM "login_rate_limit_buckets"
      WHERE "expires_at" <= ${now}
      ORDER BY "expires_at"
      LIMIT ${limit}
    )
  `);
}

export const databaseLoginRateLimitStore = {
  recordAttempt: recordLoginAttempt,
  cleanupExpired: cleanupExpiredLoginRateLimitBuckets,
};