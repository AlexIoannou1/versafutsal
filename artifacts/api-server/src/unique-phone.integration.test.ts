import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { createRequire } from "node:module";
import { db, pool } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";

type ApiResult = {
  status: number;
  data: Record<string, unknown>;
};

async function request(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    data: (await response.json()) as Record<string, unknown>,
  };
}

async function patchProfile(
  baseUrl: string,
  token: string,
  phoneNumber: string,
): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}/api/auth/profile`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ phoneNumber }),
  });
  return {
    status: response.status,
    data: (await response.json()) as Record<string, unknown>,
  };
}

async function main() {
  // payment-provider.ts still uses CommonJS require for Stripe. The
  // production bundle supplies it; provide the equivalent only for this
  // unbundled ESM integration-test process.
  (globalThis as typeof globalThis & { require: NodeJS.Require }).require = createRequire(import.meta.url);
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
  const suffix = String(Date.now()).slice(-6).padStart(6, "1");
  const racePhone = `9${suffix}1`;
  const profilePhoneA = `9${suffix}2`;
  const profilePhoneB = `9${suffix}3`;
  const targetPhone = `9${suffix}4`;
  const createdUserIds: string[] = [];

  try {
    const raceResults = await Promise.all([
      request(baseUrl, "/api/auth/register", {
        name: "Phone Race A",
        email: `phone-race-a-${suffix}@example.invalid`,
        password: "Probe123!",
        phoneNumber: racePhone,
      }),
      request(baseUrl, "/api/auth/register", {
        name: "Phone Race B",
        email: `phone-race-b-${suffix}@example.invalid`,
        password: "Probe123!",
        phoneNumber: `+357 ${racePhone}`,
      }),
    ]);

    assert.deepEqual(
      raceResults.map((result) => result.status).sort((a, b) => a - b),
      [201, 409],
    );
    const raceConflict = raceResults.find((result) => result.status === 409);
    assert.equal(raceConflict?.data.field, "phoneNumber");
    for (const result of raceResults) {
      const user = result.data.user as { id?: string } | undefined;
      if (user?.id) createdUserIds.push(user.id);
    }

    const [profileA, profileB] = await Promise.all([
      request(baseUrl, "/api/auth/register", {
        name: "Profile Race A",
        email: `profile-race-a-${suffix}@example.invalid`,
        password: "Probe123!",
        phoneNumber: profilePhoneA,
      }),
      request(baseUrl, "/api/auth/register", {
        name: "Profile Race B",
        email: `profile-race-b-${suffix}@example.invalid`,
        password: "Probe123!",
        phoneNumber: profilePhoneB,
      }),
    ]);
    assert.equal(profileA.status, 201);
    assert.equal(profileB.status, 201);

    const profileAUser = profileA.data.user as { id: string };
    const profileBUser = profileB.data.user as { id: string };
    const profileAToken = profileA.data.token as string;
    const profileBToken = profileB.data.token as string;
    createdUserIds.push(profileAUser.id, profileBUser.id);

    const profileResults = await Promise.all([
      patchProfile(baseUrl, profileAToken, `+357 ${targetPhone}`),
      patchProfile(baseUrl, profileBToken, `00357 ${targetPhone}`),
    ]);
    assert.deepEqual(
      profileResults.map((result) => result.status).sort((a, b) => a - b),
      [200, 409],
    );
    const profileConflict = profileResults.find((result) => result.status === 409);
    assert.equal(profileConflict?.data.field, "phoneNumber");

    console.log("unique phone concurrency checks passed");
  } finally {
    if (createdUserIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch((error) => {
  console.error("unique phone integration test failed", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});