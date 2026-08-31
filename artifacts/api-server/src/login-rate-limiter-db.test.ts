import assert from "node:assert/strict";
import { db, loginRateLimitBucketsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  digestLoginIdentifier,
  LOGIN_ATTEMPT_LIMIT,
  LOGIN_RATE_LIMIT_WINDOW_MS,
} from "./lib/login-rate-limiter";
import { databaseLoginRateLimitStore } from "./lib/login-rate-limiter-store";

const secret = "database-test-only-login-rate-limit-secret";
const input = {
  accountIdentifier: "database-rate-test@example.com",
  clientAddress: "198.51.100.42",
};
const digests = [
  digestLoginIdentifier(secret, "ip", input.clientAddress),
  digestLoginIdentifier(secret, "account", input.accountIdentifier),
];
const now = new Date("2026-08-31T12:00:00.000Z");
const windowExpiresAt = new Date(now.getTime() + LOGIN_RATE_LIMIT_WINDOW_MS);

try {
  await db
    .delete(loginRateLimitBucketsTable)
    .where(inArray(loginRateLimitBucketsTable.keyDigest, digests));

  const concurrentAttempts = await Promise.all(
    Array.from({ length: LOGIN_ATTEMPT_LIMIT + 10 }, () =>
      databaseLoginRateLimitStore.recordAttempt({
        scope: "ip",
        keyDigest: digests[0],
        now,
        windowExpiresAt,
      }),
    ),
  );
  assert.equal(
    concurrentAttempts.filter((result) => result.attemptCount <= 10).length,
    LOGIN_ATTEMPT_LIMIT,
  );
  assert.equal(
    concurrentAttempts.filter((result) => result.attemptCount > 10).length,
    10,
  );

  const afterExpiry = await databaseLoginRateLimitStore.recordAttempt({
    scope: "ip",
    keyDigest: digests[0],
    now: new Date(windowExpiresAt.getTime() + 1),
    windowExpiresAt: new Date(
      windowExpiresAt.getTime() + LOGIN_RATE_LIMIT_WINDOW_MS,
    ),
  });
  assert.equal(afterExpiry.attemptCount, 1);

  console.log("database-backed login rate limiter checks passed");
} finally {
  await db
    .delete(loginRateLimitBucketsTable)
    .where(inArray(loginRateLimitBucketsTable.keyDigest, digests));
  await db.$client.end();
}