import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { inArray } from "drizzle-orm";

async function main(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("Leaderboard integration tests require the disposable TEST_DATABASE_URL");
  }
  (globalThis as typeof globalThis & { require: NodeJS.Require }).require = createRequire(import.meta.url);
  const [{ db, pool }, schema, { signToken }, { default: app }] = await Promise.all([
    import("@workspace/db"), import("@workspace/db/schema"), import("./middlewares/auth"), import("./app"),
  ]);
  const {
    bookingsTable, matchParticipantsTable, matchResultsTable, matchStatEventsTable,
    ownerSubscriptionsTable, pitchesTable, usersTable, venuesTable,
  } = schema;
  const ids = { users: [] as string[], venues: [] as string[], bookings: [] as string[] };
  const suffix = randomBytes(6).toString("hex");
  const user = async (name: string, role: "PLAYER" | "VENUE_OWNER" | "ADMIN", deletedAt: Date | null = null) => {
    const [row] = await db.insert(usersTable).values({
      name, role, deletedAt, passwordHash: "test", email: `${name}-${suffix}@example.invalid`,
    }).returning();
    ids.users.push(row!.id); return row!;
  };
  const owner = await user("elite-owner", "VENUE_OWNER");
  const freeOwner = await user("free-owner", "VENUE_OWNER");
  const proOwner = await user("pro-owner", "VENUE_OWNER");
  const admin = await user("leaderboard-admin", "ADMIN");
  const players = await Promise.all(["A", "B", "C", "Deleted"].map((name) => user(name, "PLAYER")));
  const shortHistoryPlayer = await user("One Match", "PLAYER");
  const venue = async (venueOwner: typeof owner, name: string, status: "APPROVED" | "DISABLED" = "APPROVED") => {
    const [v] = await db.insert(venuesTable).values({
      ownerId: venueOwner.id, name, status, district: "Nicosia", address: "private address",
      contactPhone: "private phone",
    }).returning();
    const [pitch] = await db.insert(pitchesTable).values({ venueId: v!.id, name: "Pitch", size: "5v5" }).returning();
    ids.venues.push(v!.id); return { v: v!, pitch: pitch! };
  };
  const elite = await venue(owner, "Elite");
  const free = await venue(freeOwner, "Free");
  const pro = await venue(proOwner, "Pro");
  const disabled = await venue(owner, "Disabled", "DISABLED");
  await db.insert(ownerSubscriptionsTable).values({
    ownerId: owner.id, plan: "ELITE", status: "ACTIVE", currentPeriodEnd: new Date("2099-01-01"),
  });
  await db.insert(ownerSubscriptionsTable).values({
    ownerId: proOwner.id, plan: "PRO", status: "ACTIVE", currentPeriodEnd: new Date("2099-01-01"),
  });
  const createMatch = async (index: number, homeScore: number, awayScore: number, goals: number[]) => {
    const [booking] = await db.insert(bookingsTable).values({
      venueId: elite.v.id, pitchId: elite.pitch.id, playerId: players[0]!.id,
      startAt: new Date(Date.UTC(2020, 0, index + 1, 10)), endAt: new Date(Date.UTC(2020, 0, index + 1, 11)),
      status: "CONFIRMED", policySnapshot: {},
    }).returning();
    ids.bookings.push(booking!.id);
    const [match] = await db.insert(matchResultsTable).values({
      bookingId: booking!.id, venueId: elite.v.id, homeScore, awayScore,
      createdBy: admin.id, updatedBy: admin.id,
    }).returning();
    for (let i = 0; i < players.length; i++) {
      const [participant] = await db.insert(matchParticipantsTable).values({
        matchId: match!.id, playerId: players[i]!.id, team: i % 2 === 0 ? "HOME" : "AWAY",
      }).returning();
      await db.insert(matchStatEventsTable).values({
        matchId: match!.id, participantId: participant!.id, goals: goals[i] ?? 0,
      });
    }
    return match!;
  };
  const matches = [
    await createMatch(0, 2, 1, [2, 1, 0, 0]),
    await createMatch(1, 0, 0, [0, 0, 2, 0]),
    await createMatch(2, 1, 2, [1, 2, 0, 0]),
  ];
  const [shortParticipant] = await db.insert(matchParticipantsTable).values({
    matchId: matches[0]!.id, playerId: shortHistoryPlayer.id, team: "HOME",
  }).returning();
  await db.insert(matchStatEventsTable).values({
    matchId: matches[0]!.id, participantId: shortParticipant!.id, goals: 4,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No port");
  const base = `http://127.0.0.1:${address.port}/api`;
  const token = (u: typeof admin, role: "ADMIN" | "PLAYER" | "VENUE_OWNER") =>
    signToken({ userId: u.id, email: u.email, role, sessionVersion: 0 });
  const request = async (
    path: string,
    options: { method?: "GET" | "PUT" | "DELETE"; bearer?: string; body?: Record<string, unknown> } = {},
  ) => {
    const response = await fetch(`${base}${path}`, {
      method: options.method,
      headers: {
        ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (response.status === 204) return { response, body: {} as Record<string, unknown> };
    return { response, body: await response.json() as Record<string, unknown> };
  };
  const get = (path: string, bearer?: string) => request(path, { bearer });
  try {
    assert.equal((await get(`/venues/${free.v.id}/leaderboard?metric=goals`)).response.status, 404);
    assert.equal((await get(`/venues/${pro.v.id}/leaderboard?metric=goals`)).response.status, 404);
    assert.equal((await get(`/venues/${disabled.v.id}/leaderboard?metric=goals`)).response.status, 404);
    assert.equal((await get(`/venues/${elite.v.id}/leaderboard?metric=bad`)).response.status, 400);
    assert.equal((await get(`/venues/${elite.v.id}/leaderboard?metric=goals&page=10001`)).response.status, 400);
    const goals = await get(`/venues/${elite.v.id}/leaderboard?metric=goals&page=1&limit=2`);
    assert.equal(goals.response.status, 200);
    assert.equal(goals.response.headers.get("cache-control"), "no-store");
    assert.equal(goals.body.total, 5);
    assert.equal((goals.body.entries as unknown[]).length, 2);
    assert.equal("address" in goals.body || "contactPhone" in goals.body || "bookingId" in goals.body, false);
    const winRate = await get(`/venues/${elite.v.id}/leaderboard?metric=winRate`);
    assert.equal(winRate.body.total, 4);
    const entries = winRate.body.entries as { rank: number; playerId: string; winRate: number }[];
    assert.deepEqual(entries.map((entry) => entry.rank), [1, 2, 3, 4]);
    assert.equal(entries.find((entry) => entry.playerId === players[0]!.id)!.winRate, 100 / 3);
    assert.deepEqual(
      entries.slice(0, 2).map((entry) => entry.playerId),
      [players[0]!.id, players[1]!.id].sort(),
      "equal exact win fractions, matches, and goals fall back to playerId",
    );
    await db.update(usersTable).set({ deletedAt: new Date() }).where(inArray(usersTable.id, [players[3]!.id]));
    assert.equal((await get(`/venues/${elite.v.id}/leaderboard?metric=matches`)).body.total, 4);
    assert.equal((await get(`/admin/venues/${elite.v.id}/leaderboard/players/${players[0]!.id}/sources`)).response.status, 401);
    assert.equal((await get(
      `/admin/venues/${elite.v.id}/leaderboard/players/${players[0]!.id}/sources`,
      token(players[0]!, "PLAYER"),
    )).response.status, 403);
    const sources = await get(
      `/admin/venues/${elite.v.id}/leaderboard/players/${players[0]!.id}/sources?page=1&limit=2`,
      token(admin, "ADMIN"),
    );
    assert.equal(sources.body.total, 3);
    assert.equal((sources.body.sources as unknown[]).length, 2);

    const [eligibleBooking] = await db.insert(bookingsTable).values({
      venueId: elite.v.id, pitchId: elite.pitch.id, playerId: players[1]!.id,
      startAt: new Date("2020-02-01T10:00:00Z"), endAt: new Date("2020-02-01T11:00:00Z"),
      status: "CONFIRMED", policySnapshot: {},
    }).returning();
    const [apiBooking] = await db.insert(bookingsTable).values({
      venueId: elite.v.id, pitchId: elite.pitch.id, playerId: players[0]!.id,
      startAt: new Date("2020-02-02T10:00:00Z"), endAt: new Date("2020-02-02T11:00:00Z"),
      status: "CONFIRMED", policySnapshot: {},
    }).returning();
    ids.bookings.push(eligibleBooking!.id, apiBooking!.id);
    const input = {
      homeScore: 1, awayScore: 0, expectedVersion: 0,
      participants: [
        { playerId: players[0]!.id, team: "HOME", goals: 1, assists: 0, saves: 0, yellowCards: 0, redCards: 0 },
        { playerId: players[1]!.id, team: "AWAY", goals: 0, assists: 0, saves: 0, yellowCards: 0, redCards: 0 },
      ],
    };
    const created = await request(`/owner/bookings/${apiBooking!.id}/match-statistics`, {
      method: "PUT", bearer: token(owner, "VENUE_OWNER"), body: input,
    });
    assert.equal(created.response.status, 200, "owner API creates a leaderboard source");
    const createdMatch = created.body.match as { id: string; version: number };
    assert.equal((await get(
      `/admin/venues/${elite.v.id}/leaderboard/players/${players[0]!.id}/sources`,
      token(admin, "ADMIN"),
    )).body.total, 4);
    const corrected = await request(`/admin/match-statistics/${createdMatch.id}`, {
      method: "PUT", bearer: token(admin, "ADMIN"), body: {
        ...input, expectedVersion: createdMatch.version, homeScore: 0, awayScore: 1,
        participants: [
          { ...input.participants[0], goals: 0 },
          { ...input.participants[1], goals: 1 },
        ],
        reason: "Verified score correction",
      },
    });
    assert.equal(corrected.response.status, 200, "admin API edits a leaderboard source");
    const auditAfterEdit = await get(`/admin/bookings/${apiBooking!.id}/audit`, token(admin, "ADMIN"));
    assert.ok((auditAfterEdit.body.entries as { action: string; notes: string | null }[]).some(
      (entry) => entry.action === "MATCH_STATISTICS_UPDATED" && entry.notes === "Verified score correction",
    ), "admin correction reason is retained in the audit trail");
    assert.equal((await request(`/admin/match-statistics/${createdMatch.id}`, {
      method: "DELETE", bearer: token(admin, "ADMIN"), body: { reason: "Remove invalid source" },
    })).response.status, 204, "admin API deletes a leaderboard source");
    const auditAfterDelete = await get(`/admin/bookings/${apiBooking!.id}/audit`, token(admin, "ADMIN"));
    assert.ok((auditAfterDelete.body.entries as { action: string; notes: string | null }[]).some(
      (entry) => entry.action === "MATCH_STATISTICS_DELETED" && entry.notes === "Remove invalid source",
    ), "source deletion reason is retained in the audit trail");
    assert.equal((await get(
      `/admin/venues/${elite.v.id}/leaderboard/players/${players[0]!.id}/sources`,
      token(admin, "ADMIN"),
    )).body.total, 3);

    await db.delete(matchResultsTable).where(inArray(matchResultsTable.id, matches.map((match) => match.id)));
    const empty = await get(
      `/admin/venues/${elite.v.id}/leaderboard/players/${players[0]!.id}/sources`,
      token(admin, "ADMIN"),
    );
    assert.equal(empty.body.player, null); assert.equal(empty.body.total, 0);
  } finally {
    if (ids.bookings.length) await db.delete(bookingsTable).where(inArray(bookingsTable.id, ids.bookings));
    if (ids.venues.length) await db.delete(venuesTable).where(inArray(venuesTable.id, ids.venues));
    if (ids.users.length) {
      await db.delete(ownerSubscriptionsTable).where(inArray(ownerSubscriptionsTable.ownerId, ids.users));
      await db.delete(usersTable).where(inArray(usersTable.id, ids.users));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch((error) => { console.error("leaderboard integration test failed", error); process.exitCode = 1; });