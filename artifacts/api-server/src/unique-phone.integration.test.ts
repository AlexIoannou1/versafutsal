import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { createRequire } from "node:module";

type ApiResult = {
  status: number;
  data: Record<string, unknown>;
};

type RegisteredUser = {
  id: string;
  phoneNumber: string | null;
};

function registeredUser(result: ApiResult): RegisteredUser {
  const user = result.data.user as Partial<RegisteredUser> | undefined;
  assert.equal(typeof user?.id, "string");
  assert.equal(typeof user?.phoneNumber, "string");
  return user as RegisteredUser;
}

function token(result: ApiResult): string {
  assert.equal(typeof result.data.token, "string");
  return result.data.token as string;
}

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
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("The unique-phone integration test must run with DATABASE_URL set to TEST_DATABASE_URL");
  }

  // payment-provider.ts still uses CommonJS require for Stripe. The
  // production bundle supplies it; provide the equivalent only for this
  // unbundled ESM integration-test process.
  (globalThis as typeof globalThis & { require: NodeJS.Require }).require = createRequire(import.meta.url);
  const [{ db, pool }, { usersTable }, { default: app }] = await Promise.all([
    import("@workspace/db"),
    import("@workspace/db/schema"),
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
  const suffix = String(Date.now()).slice(-6).padStart(6, "1");
  const racePhone = `9${suffix}1`;
  const profilePhoneA = `9${suffix}2`;
  const profilePhoneB = `9${suffix}3`;
  const targetPhone = `9${suffix}4`;
  const canonicalRacePhone = `+357${racePhone}`;
  const canonicalTargetPhone = `+357${targetPhone}`;
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
    const raceSuccess = raceResults.find((result) => result.status === 201);
    assert.ok(raceSuccess);
    const raceUser = registeredUser(raceSuccess);
    assert.equal(raceUser.phoneNumber, canonicalRacePhone);
    createdUserIds.push(raceUser.id);

    const raceRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.phoneNumber, canonicalRacePhone));
    assert.equal(raceRows.length, 1);

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

    const profileAUser = registeredUser(profileA);
    const profileBUser = registeredUser(profileB);
    const profileAToken = token(profileA);
    const profileBToken = token(profileB);
    createdUserIds.push(profileAUser.id, profileBUser.id);

    const profileResults = await Promise.all([
      patchProfile(baseUrl, profileAToken, targetPhone),
      patchProfile(baseUrl, profileBToken, `+357 ${targetPhone}`),
    ]);
    assert.deepEqual(
      profileResults.map((result) => result.status).sort((a, b) => a - b),
      [200, 409],
    );
    const profileConflict = profileResults.find((result) => result.status === 409);
    assert.equal(profileConflict?.data.field, "phoneNumber");
    const profileSuccess = profileResults.find((result) => result.status === 200);
    assert.ok(profileSuccess);
    const updatedUser = registeredUser(profileSuccess);
    assert.equal(updatedUser.phoneNumber, canonicalTargetPhone);

    const targetRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.phoneNumber, canonicalTargetPhone));
    assert.equal(targetRows.length, 1);

    console.log("unique phone concurrency checks passed");
  } finally {
    if (createdUserIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch(() => {
  console.error("unique phone integration test failed");
  process.exitCode = 1;
});