CREATE TABLE IF NOT EXISTS "login_rate_limit_buckets" (
  "scope" text NOT NULL,
  "key_digest" text NOT NULL,
  "attempt_count" integer DEFAULT 1 NOT NULL,
  "window_started_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "login_rate_limit_buckets_scope_key_pk" PRIMARY KEY("scope", "key_digest"),
  CONSTRAINT "login_rate_limit_buckets_scope_check" CHECK ("scope" IN ('ip', 'account'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_rate_limit_buckets_expires_at_idx"
  ON "login_rate_limit_buckets" ("expires_at");