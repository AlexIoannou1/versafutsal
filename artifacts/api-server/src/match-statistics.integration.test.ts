import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { eq, inArray } from "drizzle-orm";

type ApiResult = { status: number; data: Record<string, unknown> };

async function request(
  baseUrl: string,
  path: string,
  options: { method?: "GET" | "PUT" | "DELETE"; body?: Record<string, unknown>; token?: string } = {},
): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return {
    status: response.status,
    data: response.status === 204 ? {} : await response.json() as Record<string, unknown>,
  };
}

function totals(result: ApiResult) {
  return result.data as {
    playerId: string; venueId?: string; matchesPlayed: number; goals: number; assists: number;
  };
}

async function main(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("The match-statistics integration test must run with DATABASE_URL set to TEST_DATABASE_URL");
  }
  (globalThis as typeof globalThis & { require: NodeJS.Require }).require = createRequire(import.meta.url);
  const [{ db, pool }, schema, { signToken }, { default: app }] = await Promise.all([
    import("@workspace/db"),
    import("@workspace/db/schema"),
    import("./middlewares/auth"),
    import("./app"),
  ]);
  const {
    auditLogTable, bookingsTable, matchResultsTable, ownerSubscriptionsTable,
    pitchesTable, usersTable, venuesTable,
  } = schema;
  const server = app.listen(0);
  const address = await new Promise<{ port: number }>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      const value = server.address();
      if (!value || typeof value === "string") return reject(new Error("Test server did not expose a port"));
      resolve(value);
    });
  });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const suffix = randomBytes(8).toString("hex");
  const ids = { users: [] as string[], venues: [] as string[], pitches: [] as string[], bookings: [] as string[] };
  const pastStart = new Date("2020-01-01T10:00:00.000Z");
  const pastEnd = new Date("2020-01-01T11:00:00.000Z");

  const insertUser = async (name: string, role: "PLAYER" | "VENUE_OWNER" | "ADMIN", deleted = false) => {
    const [user] = await db.insert(usersTable).values({
      name, role, passwordHash: "integration-test-only",
      email: `${name.toLowerCase().replaceAll(" ", "-")}-${suffix}@example.invalid`,
      deletedAt: deleted ? new Date() : null,
    }).returning();
    ids.users.push(user!.id);
    return user!;
  };
  const insertVenue = async (ownerId: string, name: string) => {
    const [venue] = await db.insert(venuesTable).values({
      ownerId, name, district: "Nicosia", address: "Integration Street", status: "APPROVED",
    }).returning();
    const [pitch] = await db.insert(pitchesTable).values({ venueId: venue!.id, name: "Pitch", size: "5v5" }).returning();
    ids.venues.push(venue!.id); ids.pitches.push(pitch!.id);
    return { venue: venue!, pitch: pitch! };
  };
  const insertBooking = async (venueId: string, pitchId: string, playerId: string, startAt = pastStart) => {
    const [booking] = await db.insert(bookingsTable).values({
      venueId, pitchId, playerId, startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1000), status: "CONFIRMED", policySnapshot: {},
    }).returning();
    ids.bookings.push(booking!.id);
    return booking!;
  };

  try {
    const freeOwner = await insertUser("Free Owner", "VENUE_OWNER");
    const proOwner = await insertUser("Pro Owner", "VENUE_OWNER");
    const wrongOwner = await insertUser("Wrong Owner", "VENUE_OWNER");
    const admin = await insertUser("Stats Admin", "ADMIN");
    const playerA = await insertUser("Stats Player A", "PLAYER");
    const playerB = await insertUser("Stats Player B", "PLAYER");
    const playerOtherVenue = await insertUser("Other Venue Player", "PLAYER");
    const inactivePlayer = await insertUser("Inactive Player", "PLAYER", true);
    const free = await insertVenue(freeOwner.id, "Free Venue");
    const pro = await insertVenue(proOwner.id, "Pro Venue");
    const other = await insertVenue(wrongOwner.id, "Other Venue");
    const freeBooking = await insertBooking(free.venue.id, free.pitch.id, playerA.id);
    const proBooking = await insertBooking(pro.venue.id, pro.pitch.id, playerA.id);
    await insertBooking(pro.venue.id, pro.pitch.id, playerB.id, new Date("2020-01-02T10:00:00.000Z")); // establishes a valid same-venue participant
    await insertBooking(other.venue.id, other.pitch.id, playerOtherVenue.id); // not eligible at Pro Venue
    await db.insert(ownerSubscriptionsTable).values({
      ownerId: proOwner.id, plan: "PRO", status: "ACTIVE", currentPeriodEnd: new Date("2030-01-01T00:00:00Z"),
    });
    await db.insert(ownerSubscriptionsTable).values({
      ownerId: wrongOwner.id, plan: "PRO", status: "ACTIVE", currentPeriodEnd: new Date("2030-01-01T00:00:00Z"),
    });

    const tokens = {
      free: signToken({ userId: freeOwner.id, email: freeOwner.email, role: "VENUE_OWNER", sessionVersion: 0 }),
      pro: signToken({ userId: proOwner.id, email: proOwner.email, role: "VENUE_OWNER", sessionVersion: 0 }),
      wrong: signToken({ userId: wrongOwner.id, email: wrongOwner.email, role: "VENUE_OWNER", sessionVersion: 0 }),
      admin: signToken({ userId: admin.id, email: admin.email, role: "ADMIN", sessionVersion: 0 }),
      playerA: signToken({ userId: playerA.id, email: playerA.email, role: "PLAYER", sessionVersion: 0 }),
      playerB: signToken({ userId: playerB.id, email: playerB.email, role: "PLAYER", sessionVersion: 0 }),
    };
    const valid = {
      homeScore: 2, awayScore: 1, expectedVersion: 0,
      participants: [
        { playerId: playerA.id, team: "HOME", goals: 2, assists: 1, saves: 0, yellowCards: 0, redCards: 0 },
        { playerId: playerB.id, team: "AWAY", goals: 1, assists: 0, saves: 3, yellowCards: 0, redCards: 0 },
      ],
    };

    assert.equal((await request(baseUrl, `/api/owner/bookings/${freeBooking.id}/match-statistics`, {
      method: "PUT", token: tokens.free, body: valid,
    })).status, 403, "Free owners are gated");
    assert.equal((await request(baseUrl, `/api/owner/bookings/${proBooking.id}/match-statistics`, {
      method: "PUT", token: tokens.wrong, body: valid,
    })).status, 404, "owners cannot write another venue's booking");
    assert.equal((await request(baseUrl, `/api/owner/bookings/${proBooking.id}/match-statistics`, {
      method: "PUT", token: tokens.pro, body: { ...valid, participants: [valid.participants[0], { ...valid.participants[1], playerId: inactivePlayer.id }] },
    })).status, 400, "inactive participants are rejected");
    assert.equal((await request(baseUrl, `/api/owner/bookings/${proBooking.id}/match-statistics`, {
      method: "PUT", token: tokens.pro, body: { ...valid, participants: [valid.participants[0], { ...valid.participants[1], playerId: playerOtherVenue.id }] },
    })).status, 400, "cross-venue players are rejected");
    assert.equal((await request(baseUrl, `/api/owner/bookings/${proBooking.id}/match-statistics`, {
      method: "PUT", token: tokens.pro, body: { ...valid, awayScore: 2 },
    })).status, 400, "score must match scorer statistics");

    const created = await request(baseUrl, `/api/owner/bookings/${proBooking.id}/match-statistics`, {
      method: "PUT", token: tokens.pro, body: valid,
    });
    assert.equal(created.status, 200);
    const match = created.data.match as { id: string; version: number };
    assert.equal(typeof match.id, "string");
    assert.equal((await request(baseUrl, `/api/players/${playerA.id}/match-statistics`)).status, 401);
    assert.equal((await request(baseUrl, `/api/players/${playerA.id}/match-statistics`, {
      token: tokens.playerB,
    })).status, 403, "players cannot inspect another player's totals");
    assert.equal((await request(baseUrl, `/api/players/${playerA.id}/match-statistics`, {
      token: tokens.playerA,
    })).status, 200);
    assert.deepEqual(totals(await request(baseUrl, `/api/players/${playerA.id}/match-statistics`, {
      token: tokens.playerA,
    })).goals, 2);
    const venueSummary = await request(
      baseUrl,
      `/api/venues/${pro.venue.id}/players/${playerB.id}/match-statistics`,
      { token: tokens.playerB },
    );
    assert.equal(venueSummary.status, 200); assert.equal(totals(venueSummary).goals, 1);

    const correction = { ...valid, homeScore: 0, awayScore: 3, expectedVersion: match.version,
      participants: [{ ...valid.participants[0], goals: 0, assists: 0 }, { ...valid.participants[1], goals: 3 }] };
    assert.equal((await request(baseUrl, `/api/owner/bookings/${proBooking.id}/match-statistics`, {
      method: "PUT", token: tokens.pro, body: correction,
    })).status, 200);
    assert.equal(totals(await request(baseUrl, `/api/players/${playerA.id}/match-statistics`, {
      token: tokens.playerA,
    })).goals, 0);
    assert.equal(totals(await request(baseUrl, `/api/players/${playerB.id}/match-statistics`, {
      token: tokens.playerB,
    })).goals, 3);
    assert.equal((await request(baseUrl, `/api/owner/bookings/${proBooking.id}/match-statistics`, {
      method: "PUT", token: tokens.pro, body: correction,
    })).status, 409, "stale expectedVersion is rejected");
    const concurrent = await Promise.all([
      request(baseUrl, `/api/owner/bookings/${proBooking.id}/match-statistics`, {
        method: "PUT", token: tokens.pro, body: { ...correction, expectedVersion: 2 },
      }),
      request(baseUrl, `/api/owner/bookings/${proBooking.id}/match-statistics`, {
        method: "PUT", token: tokens.pro, body: { ...correction, expectedVersion: 2 },
      }),
    ]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409],
      "only one concurrent expectedVersion write commits");

    const inspected = await request(baseUrl, `/api/admin/match-statistics/${match.id}`, { token: tokens.admin });
    assert.equal(inspected.status, 200);
    const adminVersion = (inspected.data.match as { version: number }).version;
    assert.equal((await request(baseUrl, `/api/admin/match-statistics/${match.id}`, {
      method: "PUT", token: tokens.admin, body: { ...correction, expectedVersion: adminVersion, awayScore: 2,
        participants: [correction.participants[0], { ...correction.participants[1], goals: 2 }],
        reason: "Correcting verified source result" },
    })).status, 200, "admins can correct a result");
    assert.equal((await request(baseUrl, `/api/admin/match-statistics/${match.id}`, {
      method: "DELETE", token: tokens.admin, body: { reason: "Integration correction cleanup" },
    })).status, 204);
    const audit = await request(baseUrl, `/api/admin/bookings/${proBooking.id}/audit`, { token: tokens.admin });
    assert.equal(audit.status, 200);
    assert.ok((audit.data.entries as { action: string }[]).some((entry) => entry.action === "MATCH_STATISTICS_DELETED"));
    const zero = await request(
      baseUrl,
      `/api/venues/${pro.venue.id}/players/${playerA.id}/match-statistics`,
      { token: tokens.playerA },
    );
    assert.equal(zero.status, 200); assert.equal(totals(zero).matchesPlayed, 0); assert.equal(totals(zero).goals, 0);
    console.info("match statistics HTTP integration checks passed");
  } finally {
    if (ids.bookings.length) await db.delete(bookingsTable).where(inArray(bookingsTable.id, ids.bookings));
    if (ids.venues.length) await db.delete(venuesTable).where(inArray(venuesTable.id, ids.venues));
    if (ids.users.length) {
      await db.delete(ownerSubscriptionsTable).where(inArray(ownerSubscriptionsTable.ownerId, ids.users));
      await db.delete(auditLogTable).where(inArray(auditLogTable.actorUserId, ids.users));
      await db.delete(usersTable).where(inArray(usersTable.id, ids.users));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch((error) => {
  console.error("match statistics integration test failed", error);
  process.exitCode = 1;
});