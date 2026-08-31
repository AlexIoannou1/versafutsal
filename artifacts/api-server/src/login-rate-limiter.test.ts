import assert from "node:assert/strict";
import {
  createLoginRateLimiter,
  digestLoginIdentifier,
  LOGIN_ATTEMPT_LIMIT,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  type LoginRateLimitScope,
  type LoginRateLimitStore,
  type RateLimitBucketResult,
} from "./lib/login-rate-limiter";

type StoredBucket = RateLimitBucketResult & {
  scope: LoginRateLimitScope;
  keyDigest: string;
};

class MemoryLoginRateLimitStore implements LoginRateLimitStore {
  private readonly buckets = new Map<string, StoredBucket>();

  async recordAttempt(input: {
    scope: LoginRateLimitScope;
    keyDigest: string;
    now: Date;
    windowExpiresAt: Date;
  }): Promise<RateLimitBucketResult> {
    const key = `${input.scope}:${input.keyDigest}`;
    const existing = this.buckets.get(key);
    const expired =
      existing && existing.expiresAt.getTime() <= input.now.getTime();
    const bucket = {
      scope: input.scope,
      keyDigest: input.keyDigest,
      attemptCount: expired ? 1 : (existing?.attemptCount ?? 0) + 1,
      expiresAt: expired
        ? input.windowExpiresAt
        : (existing?.expiresAt ?? input.windowExpiresAt),
    };
    this.buckets.set(key, bucket);
    return bucket;
  }

  async cleanupExpired(now: Date, limit: number): Promise<void> {
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (removed >= limit) break;
      if (bucket.expiresAt.getTime() <= now.getTime()) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
  }

  get digests(): string[] {
    return [...this.buckets.values()].map((bucket) => bucket.keyDigest);
  }
}

const secret = "test-only-login-rate-limit-secret";
let now = new Date("2026-08-31T12:00:00.000Z");
const store = new MemoryLoginRateLimitStore();
const limiter = createLoginRateLimiter({
  store,
  secret,
  clock: () => now,
});

const input = {
  accountIdentifier: "player@example.com",
  clientAddress: "192.0.2.10",
};

const firstTen = await Promise.all(
  Array.from({ length: LOGIN_ATTEMPT_LIMIT }, () => limiter.check(input)),
);
assert.equal(
  firstTen.filter((result) => result.allowed).length,
  LOGIN_ATTEMPT_LIMIT,
);
assert.equal(
  firstTen.some((result) => result.retryAfterSeconds !== null),
  false,
);

const blockedByBothScopes = await limiter.check(input);
assert.equal(blockedByBothScopes.allowed, false);
assert.deepEqual(blockedByBothScopes.blockedScopes.sort(), ["account", "ip"]);
assert.ok((blockedByBothScopes.retryAfterSeconds ?? 0) >= 1);

const accountScopeBlocked = await limiter.check({
  accountIdentifier: input.accountIdentifier,
  clientAddress: "192.0.2.11",
});
assert.equal(accountScopeBlocked.allowed, false);
assert.deepEqual(accountScopeBlocked.blockedScopes, ["account"]);

const ipScopeAllowed = await limiter.check({
  accountIdentifier: "another@example.com",
  clientAddress: "192.0.2.11",
});
assert.equal(ipScopeAllowed.allowed, true);

now = new Date(now.getTime() + LOGIN_RATE_LIMIT_WINDOW_MS + 1);
const afterExpiry = await limiter.check(input);
assert.equal(afterExpiry.allowed, true);
assert.deepEqual(afterExpiry.blockedScopes, []);

const digest = digestLoginIdentifier(
  secret,
  "account",
  input.accountIdentifier,
);
assert.match(digest, /^[a-f0-9]{64}$/);
assert.equal(
  store.digests.some((value) => value.includes(input.accountIdentifier)),
  false,
);
assert.equal(
  store.digests.some((value) => value.includes(input.clientAddress)),
  false,
);

console.log("login rate limiter regression checks passed");