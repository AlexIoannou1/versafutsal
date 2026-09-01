import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";

type ApiResult = {
  status: number;
  data: Record<string, unknown>;
};

type ResetEmail = {
  resetUrl: string;
  subject: string;
};

async function apiRequest(
  baseUrl: string,
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    token?: string;
  } = {},
): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "POST",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return { status: response.status, data: (await response.json()) as Record<string, unknown> };
}

async function waitForOutboxEntry(outbox: ResetEmail[], count: number): Promise<ResetEmail> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const entry = outbox[count - 1];
    if (entry) return entry;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Password reset email was not added to the test outbox");
}

function responseToken(result: ApiResult): string {
  assert.equal(typeof result.data.token, "string");
  return result.data.token as string;
}

async function main(): Promise<void> {
  if (
    !process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
  ) {
    throw new Error(
      "The password-reset integration test must run with DATABASE_URL set to TEST_DATABASE_URL",
    );
  }

  (globalThis as typeof globalThis & { require: NodeJS.Require }).require =
    createRequire(import.meta.url);

  const [
    { db, pool },
    { passwordResetTokensTable, usersTable },
    { hashPasswordResetToken },
    {
      clearPasswordResetEmailOutboxForTests,
      usePasswordResetEmailOutboxForTests,
    },
  ] = await Promise.all([
    import("@workspace/db"),
    import("@workspace/db/schema"),
    import("./lib/passwords"),
    import("./lib/password-reset-email"),
  ]);
  const outbox = usePasswordResetEmailOutboxForTests() as ResetEmail[];
  const { default: app } = await import("./app");
  const server = app.listen(0);
  const address = await new Promise<{ port: number }>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      const value = server.address();
      if (!value || typeof value === "string") {
        reject(new Error("Test server did not expose a port"));
        return;
      }
      resolve(value);
    });
  });

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const suffix = randomBytes(6).toString("hex");
  const email = `password-reset-${suffix}@example.invalid`;
  const originalPassword = "Original reset password 2026!";
  const replacementPassword = "Replacement reset password 2026!";
  let userId: string | undefined;

  try {
    const registration = await apiRequest(baseUrl, "/api/auth/register", {
      body: {
        name: "Password Reset",
        email,
        phoneNumber: `98${String(Date.now()).slice(-6)}`,
        password: originalPassword,
        role: "PLAYER",
      },
    });
    assert.equal(registration.status, 201);
    const sessionBeforeReset = responseToken(registration);
    const user = registration.data.user as { id?: string };
    if (typeof user.id !== "string") {
      throw new Error("Registration response did not contain a user id");
    }
    const registeredUserId = user.id;
    userId = registeredUserId;

    const existingRequest = await apiRequest(baseUrl, "/api/auth/password-reset/request", {
      body: { email },
    });
    const missingRequest = await apiRequest(baseUrl, "/api/auth/password-reset/request", {
      body: { email: `missing-${suffix}@example.invalid` },
    });
    assert.equal(existingRequest.status, 200);
    assert.deepEqual(existingRequest.data, missingRequest.data);

    const firstEmail = await waitForOutboxEntry(outbox, 1);
    assert.equal(firstEmail.subject, "Reset your Versa password");
    const firstUrl = new URL(firstEmail.resetUrl);
    assert.equal(firstUrl.protocol, "https:");
    assert.equal(firstUrl.origin, "https://versa.example");
    assert.equal(firstUrl.pathname, "/reset-password");
    const firstResetToken = firstUrl.searchParams.get("token");
    assert.match(firstResetToken ?? "", /^[A-Za-z0-9_-]{40,60}$/);

    process.env.PASSWORD_RESET_APP_URL = "https://not-a-versa-app.example/reset-password";
    const malformedAppDestination = await apiRequest(baseUrl, "/api/auth/password-reset/request", {
      body: { email },
    });
    assert.deepEqual(malformedAppDestination.data, existingRequest.data);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const tokensAfterMalformedAppDestination = await db
      .select()
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.userId, registeredUserId));
    assert.equal(tokensAfterMalformedAppDestination.length, 1);
    assert.equal(tokensAfterMalformedAppDestination[0]?.tokenHash, hashPasswordResetToken(firstResetToken!));
    assert.equal(tokensAfterMalformedAppDestination[0]?.usedAt, null);
    assert.equal(outbox.length, 1);
    delete process.env.PASSWORD_RESET_APP_URL;

    const replacementRequest = await apiRequest(baseUrl, "/api/auth/password-reset/request", {
      body: { email },
    });
    assert.deepEqual(replacementRequest.data, existingRequest.data);
    const replacementEmail = await waitForOutboxEntry(outbox, 2);
    const replacementToken = new URL(replacementEmail.resetUrl).searchParams.get("token");
    assert.match(replacementToken ?? "", /^[A-Za-z0-9_-]{40,60}$/);
    assert.notEqual(replacementToken, firstResetToken);

    const superseded = await apiRequest(baseUrl, "/api/auth/password-reset/confirm", {
      body: { token: firstResetToken, newPassword: replacementPassword },
    });
    assert.equal(superseded.status, 400);

    const confirmed = await apiRequest(baseUrl, "/api/auth/password-reset/confirm", {
      body: { token: replacementToken, newPassword: replacementPassword },
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.data.ok, true);

    const revokedSession = await apiRequest(baseUrl, "/api/auth/me", {
      method: "GET",
      token: sessionBeforeReset,
    });
    assert.equal(revokedSession.status, 401);

    const oldPasswordLogin = await apiRequest(baseUrl, "/api/auth/login", {
      body: { email, password: originalPassword },
    });
    assert.equal(oldPasswordLogin.status, 401);
    const newPasswordLogin = await apiRequest(baseUrl, "/api/auth/login", {
      body: { email, password: replacementPassword },
    });
    assert.equal(newPasswordLogin.status, 200);

    const replayed = await apiRequest(baseUrl, "/api/auth/password-reset/confirm", {
      body: { token: replacementToken, newPassword: "Another reset password 2026!" },
    });
    assert.equal(replayed.status, 400);

    const expiredToken = randomBytes(32).toString("base64url");
    await db.insert(passwordResetTokensTable).values({
      tokenHash: hashPasswordResetToken(expiredToken),
      userId: registeredUserId,
      expiresAt: new Date(Date.now() - 1_000),
    });
    const expired = await apiRequest(baseUrl, "/api/auth/password-reset/confirm", {
      body: { token: expiredToken, newPassword: "Another reset password 2026!" },
    });
    assert.equal(expired.status, 400);

    console.log("password reset request and confirmation lifecycle checks passed");
  } finally {
    delete process.env.PASSWORD_RESET_APP_URL;
    clearPasswordResetEmailOutboxForTests();
    if (userId) {
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch(() => {
  console.error("password reset integration test failed");
  process.exitCode = 1;
});