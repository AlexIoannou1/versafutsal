import { createHmac } from "node:crypto";
import net from "node:net";
import type { Request } from "express";

export const LOGIN_ATTEMPT_LIMIT = 10;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_CLEANUP_BATCH_SIZE = 100;
export const LOGIN_RATE_LIMIT_MESSAGE =
  "Too many login attempts. Please try again later.";
export const INVALID_CREDENTIALS_MESSAGE = "Invalid credentials";

export type LoginRateLimitScope = "ip" | "account";

export type RateLimitBucketResult = {
  attemptCount: number;
  expiresAt: Date;
};

export interface LoginRateLimitStore {
  recordAttempt(input: {
    scope: LoginRateLimitScope;
    keyDigest: string;
    now: Date;
    windowExpiresAt: Date;
  }): Promise<RateLimitBucketResult>;
  cleanupExpired(now: Date, limit: number): Promise<void>;
}

export type LoginRateLimitDecision = {
  allowed: boolean;
  blockedScopes: LoginRateLimitScope[];
  retryAfterSeconds: number | null;
};

export type LoginRateLimiterOptions = {
  store: LoginRateLimitStore;
  secret: string;
  clock?: () => Date;
};

/**
 * Hashes a scope and its identifier with a server-only key. Raw account
 * identifiers and client addresses must never be persisted or logged.
 */
export function digestLoginIdentifier(
  secret: string,
  scope: LoginRateLimitScope,
  identifier: string,
): string {
  return createHmac("sha256", secret)
    .update(`${scope}:${identifier}`, "utf8")
    .digest("hex");
}

export function canonicalizeAccountIdentifier(email: string): string {
  return email.normalize("NFC").trim().toLowerCase();
}

/**
 * Uses the socket peer address only. Forwarded headers are intentionally
 * ignored because they are client-controlled unless a trusted proxy policy is
 * explicitly configured at the edge.
 */
export function getCanonicalClientAddress(
  request: Pick<Request, "socket">,
): string {
  const address = request.socket?.remoteAddress;
  if (!address) return "unknown";

  const mappedIpv4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (net.isIPv4(mappedIpv4)) return mappedIpv4;
  return address.toLowerCase();
}

export function createLoginRateLimiter({
  store,
  secret,
  clock = () => new Date(),
}: LoginRateLimiterOptions) {
  if (!secret) {
    throw new Error("A server-side secret is required for login rate limiting");
  }

  return {
    async check(input: {
      accountIdentifier: string;
      clientAddress: string;
    }): Promise<LoginRateLimitDecision> {
      const now = clock();
      const windowExpiresAt = new Date(
        now.getTime() + LOGIN_RATE_LIMIT_WINDOW_MS,
      );

      // A cleanup failure is deliberately allowed to abort the request. A
      // limiter that cannot persist state must not silently become a bypass.
      await store.cleanupExpired(now, LOGIN_RATE_LIMIT_CLEANUP_BATCH_SIZE);

      const keys: Array<{
        scope: LoginRateLimitScope;
        keyDigest: string;
      }> = [
        {
          scope: "ip",
          keyDigest: digestLoginIdentifier(secret, "ip", input.clientAddress),
        },
        {
          scope: "account",
          keyDigest: digestLoginIdentifier(
            secret,
            "account",
            input.accountIdentifier,
          ),
        },
      ];

      const buckets = await Promise.all(
        keys.map(({ scope, keyDigest }) =>
          store.recordAttempt({ scope, keyDigest, now, windowExpiresAt }),
        ),
      );
      const blockedScopes = buckets
        .map((bucket, index) =>
          bucket.attemptCount > LOGIN_ATTEMPT_LIMIT ? keys[index]!.scope : null,
        )
        .filter((scope): scope is LoginRateLimitScope => scope !== null);

      if (blockedScopes.length === 0) {
        return {
          allowed: true,
          blockedScopes: [],
          retryAfterSeconds: null,
        };
      }

      const retryAt = Math.max(
        ...buckets
          .filter((_, index) => blockedScopes.includes(keys[index]!.scope))
          .map((bucket) => bucket.expiresAt.getTime()),
      );
      return {
        allowed: false,
        blockedScopes,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((retryAt - now.getTime()) / 1000),
        ),
      };
    },
  };
}