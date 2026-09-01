import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";

type ApiResult = {
  status: number;
  data: Record<string, unknown>;
};

async function apiRequest(
  baseUrl: string,
  path: string,
  options: {
    method?: "GET" | "PATCH" | "POST";
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
  return {
    status: response.status,
    data: (await response.json()) as Record<string, unknown>,
  };
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
      "The session-revocation integration test must run with DATABASE_URL set to TEST_DATABASE_URL",
    );
  }

  // payment-provider.ts uses CommonJS require for Stripe. The production
  // bundle supplies it; provide the equivalent for this unbundled test.
  (globalThis as typeof globalThis & { require: NodeJS.Require }).require =
    createRequire(import.meta.url);

  const [
    { db, pool },
    { passwordResetTokensTable, usersTable },
    { hashPasswordResetToken },
    { default: app },
  ] = await Promise.all([
    import("@workspace/db"),
    import("@workspace/db/schema"),
    import("./lib/passwords"),
    import("./app"),
  ]);

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
  const email = `session-revocation-${suffix}@example.invalid`;
  const passwordBeforeReset = "Original session password 2026!";
  const passwordAfterReset = "Replacement session password 2026!";
  const passwordAfterChange = "Final session password 2026!";
  let userId: string | undefined;

  try {
    const registration = await apiRequest(baseUrl, "/api/auth/register", {
      body: {
        name: "Session Revocation",
        email,
        phoneNumber: `99${String(Date.now()).slice(-6)}`,
        password: passwordBeforeReset,
        role: "PLAYER",
      },
    });
    assert.equal(registration.status, 201);
    const preResetToken = responseToken(registration);
    const user = registration.data.user as { id?: string };
    if (typeof user.id !== "string") {
      throw new Error("Registration response did not contain a user id");
    }
    const registeredUserId = user.id;
    userId = registeredUserId;

    const resetToken = randomBytes(32).toString("base64url");
    await db.insert(passwordResetTokensTable).values({
      tokenHash: hashPasswordResetToken(resetToken),
      userId: registeredUserId,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const reset = await apiRequest(baseUrl, "/api/auth/password-reset/confirm", {
      body: { token: resetToken, newPassword: passwordAfterReset },
    });
    assert.equal(reset.status, 200);

    const oldTokenAfterReset = await apiRequest(baseUrl, "/api/auth/me", {
      method: "GET",
      token: preResetToken,
    });
    assert.equal(oldTokenAfterReset.status, 401);

    const loginAfterReset = await apiRequest(baseUrl, "/api/auth/login", {
      body: { email, password: passwordAfterReset },
    });
    assert.equal(loginAfterReset.status, 200);
    const preChangeToken = responseToken(loginAfterReset);

    const change = await apiRequest(baseUrl, "/api/auth/password", {
      method: "PATCH",
      token: preChangeToken,
      body: {
        currentPassword: passwordAfterReset,
        newPassword: passwordAfterChange,
      },
    });
    assert.equal(change.status, 200);

    const oldTokenAfterChange = await apiRequest(baseUrl, "/api/auth/me", {
      method: "GET",
      token: preChangeToken,
    });
    assert.equal(oldTokenAfterChange.status, 401);

    const loginAfterChange = await apiRequest(baseUrl, "/api/auth/login", {
      body: { email, password: passwordAfterChange },
    });
    assert.equal(loginAfterChange.status, 200);
    const freshToken = responseToken(loginAfterChange);

    const freshTokenResult = await apiRequest(baseUrl, "/api/auth/me", {
      method: "GET",
      token: freshToken,
    });
    assert.equal(freshTokenResult.status, 200);

    console.log("password reset and password change session revocation checks passed");
  } finally {
    if (userId) {
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch(() => {
  console.error("session revocation integration test failed");
  process.exitCode = 1;
});