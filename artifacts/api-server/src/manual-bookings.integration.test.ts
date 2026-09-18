import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { createRequire } from "node:module";

type Result = { status: number; body: any; text: string };
const json = (base: string, path: string, token: string, body?: unknown, method = "POST") =>
  fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    .then(async (r): Promise<Result> => { const text = await r.text(); let parsed: any = {}; try { parsed = JSON.parse(text); } catch {} return { status: r.status, body: parsed, text }; });

async function main() {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("The manual booking integration test must run with DATABASE_URL set to TEST_DATABASE_URL");
  }
  (globalThis as typeof globalThis & { require: NodeJS.Require }).require = createRequire(import.meta.url);
  const [{ db, pool }, schema, { default: app }, { signToken }] = await Promise.all([
    import("@workspace/db"), import("@workspace/db/schema"), import("./app"), import("./middlewares/auth"),
  ]);
  const { usersTable, venuesTable, pitchesTable, openingHoursTable, pricingRulesTable, ownerSubscriptionsTable,
    bookingsTable, paymentsTable, refundsTable, auditLogTable } = schema;
  const server = app.listen(0);
  const port = await new Promise<number>((resolve, reject) => { server.once("error", reject); server.once("listening", () => {
    const address = server.address(); if (!address || typeof address === "string") reject(new Error("No test port")); else resolve(address.port);
  }); });
  const base = `http://127.0.0.1:${port}`;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const ids: string[] = [];
  try {
    const makeUser = async (role: "VENUE_OWNER" | "PLAYER" | "ADMIN", name: string) => {
      const [user] = await db.insert(usersTable).values({ email: `${name}-${suffix}@example.invalid`, passwordHash: "test", name, role }).returning();
      ids.push(user!.id); return user!;
    };
    const [free, pro, elite, other, player, admin] = await Promise.all([
      makeUser("VENUE_OWNER", "free"), makeUser("VENUE_OWNER", "pro"), makeUser("VENUE_OWNER", "elite"),
      makeUser("VENUE_OWNER", "other"), makeUser("PLAYER", "player"), makeUser("ADMIN", "admin"),
    ]);
    for (const [owner, plan] of [[pro, "PRO"], [elite, "ELITE"]] as const) {
      await db.insert(ownerSubscriptionsTable).values({ ownerId: owner.id, plan, status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 86400000) });
    }
    const [venue] = await db.insert(venuesTable).values({ ownerId: pro.id, status: "APPROVED", name: "Lifecycle Venue", district: "Nicosia", address: "Test" }).returning();
    const [pitch] = await db.insert(pitchesTable).values({ venueId: venue!.id, name: "Pitch", size: "5v5", slotDurationMinutes: 60 }).returning();
    const slot = new Date(Date.now() + 3 * 86400000); slot.setUTCHours(10, 0, 0, 0);
    await db.insert(openingHoursTable).values({ venueId: venue!.id, dayOfWeek: slot.getUTCDay(), openTime: "09:00", closeTime: "22:00", isClosed: false });
    await db.insert(pricingRulesTable).values({ pitchId: pitch!.id, dayType: "ALL", pricePerHour: "40.00" });
    const [eliteVenue] = await db.insert(venuesTable).values({ ownerId: elite.id, status: "APPROVED", name: "Elite Venue", district: "Nicosia", address: "Test" }).returning();
    const [elitePitch] = await db.insert(pitchesTable).values({ venueId: eliteVenue!.id, name: "Elite Pitch", size: "5v5", slotDurationMinutes: 60 }).returning();
    await db.insert(openingHoursTable).values({ venueId: eliteVenue!.id, dayOfWeek: slot.getUTCDay(), openTime: "09:00", closeTime: "22:00", isClosed: false });
    await db.insert(pricingRulesTable).values({ pitchId: elitePitch!.id, dayType: "ALL", pricePerHour: "40.00" });
    const token = (user: typeof pro) => signToken({ userId: user.id, email: user.email, role: user.role, sessionVersion: user.sessionVersion });
    const create = (auth: string, start: Date, pitchId = pitch!.id) => json(base, "/api/owner/bookings/manual", auth, { pitchId, startAt: start.toISOString(), guestName: "Private Guest", guestPhone: "+35799123456" });
    const freeResult = await create(token(free), slot);
    assert.equal(freeResult.status, 403); assert.equal(freeResult.body.code, "ENTITLEMENT_REQUIRED");
    const proResult = await create(token(pro), slot);
    assert.equal(proResult.status, 201); assert.equal(proResult.body.booking.source, "MANUAL"); assert.equal(proResult.body.booking.status, "PENDING"); assert.equal(proResult.body.booking.offlinePaymentReceivedAt, null);
    const bookingId = proResult.body.booking.id as string;
    assert.equal((await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, bookingId))).length, 0);
    const eliteSlot = new Date(slot.getTime() + 3600000);
    assert.equal((await create(token(elite), eliteSlot, elitePitch!.id)).status, 201);
    const raceSlot = new Date(slot.getTime() + 7200000);
    assert.deepEqual((await Promise.all([create(token(pro), raceSlot), create(token(pro), raceSlot)])).map(x => x.status).sort(), [201, 409]);
    assert.equal((await json(base, `/api/owner/bookings/${bookingId}/confirm-offline-payment`, token(other))).status, 404);
    const confirms = await Promise.all([json(base, `/api/owner/bookings/${bookingId}/confirm-offline-payment`, token(pro)), json(base, `/api/owner/bookings/${bookingId}/confirm-offline-payment`, token(pro))]);
    assert.deepEqual(confirms.map(x => x.status).sort(), [200, 409]);
    assert.equal((await json(base, `/api/owner/bookings/${bookingId}/confirm-offline-payment`, token(pro))).status, 409);
    const audit = await json(base, `/api/owner/bookings/${bookingId}/audit`, token(pro), undefined, "GET");
    const createdAudits = audit.body.entries.filter((entry: any) => entry.action === "MANUAL_BOOKING_CREATED");
    assert.equal(createdAudits.length, 1);
    assert.equal(createdAudits[0]!.newValue.status, "PENDING");
    assert.ok(audit.body.entries.some((entry: any) => entry.action === "OFFLINE_PAYMENT_CONFIRMED"));
    assert.doesNotMatch(JSON.stringify(audit.body.entries), /Private Guest|99123456/);
    const pendingSlot = new Date(slot.getTime() + 10800000);
    const pending = await create(token(pro), pendingSlot); assert.equal(pending.status, 201);
    const stats = await json(base, "/api/owner/stats", token(pro), undefined, "GET");
    const manual = stats.body.bySource.find((x: any) => x.source === "MANUAL"); assert.ok(manual.revenue >= 40 && manual.revenue < 80);
    await db.insert(paymentsTable).values({ bookingId: pending.body.booking.id, provider: "MOCK", providerPaymentId: `manual-${suffix}`, amount: "40", feeAmount: "6", feePercent: "15", status: "PENDING" });
    // Exercise the defense-in-depth source guard with a role-valid token whose
    // subject owns the legacy-style manual row.
    const captureToken = signToken({ userId: pro.id, email: pro.email, role: "PLAYER", sessionVersion: pro.sessionVersion });
    const capture = await json(base, `/api/bookings/${pending.body.booking.id}/capture`, captureToken);
    assert.equal(capture.status, 400); assert.equal(capture.body.code, "MANUAL_BOOKING_OFFLINE_ONLY");
    const checkout = await json(base, `/api/bookings/${pending.body.booking.id}/checkout`, captureToken, { paymentType: "FULL" });
    assert.equal(checkout.status, 400); assert.equal(checkout.body.code, "MANUAL_BOOKING_OFFLINE_ONLY");
    const paymentDetail = await json(base, `/api/bookings/${pending.body.booking.id}/payment`, captureToken, undefined, "GET");
    assert.equal(paymentDetail.status, 400); assert.equal(paymentDetail.body.code, "MANUAL_BOOKING_OFFLINE_ONLY");
    const pendingPayment = await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, pending.body.booking.id));
    assert.equal(pendingPayment[0]!.status, "PENDING");
    assert.equal((await json(base, `/api/bookings/${pending.body.booking.id}/cancel`, token(pro), { reason: "Private Guest +35799123456 guest@example.test" })).status, 200);
    assert.equal((await db.select().from(refundsTable).where(inArray(refundsTable.paymentId, pendingPayment.map(p => p.id)))).length, 0);
    const cancelledAudit = await json(base, `/api/owner/bookings/${pending.body.booking.id}/audit`, token(pro), undefined, "GET");
    assert.doesNotMatch(JSON.stringify(cancelledAudit.body.entries), /Private Guest|99123456|guest@example\.test/);
    assert.equal((await json(base, `/api/admin/bookings/${bookingId}/refund`, token(admin), { reason: "no provider" })).body.code, "MANUAL_BOOKING_OFFLINE_ONLY");
    const ownerCsv = await json(base, "/api/owner/bookings/export.csv", token(pro), undefined, "GET");
    const adminCsv = await json(base, "/api/admin/bookings/export.csv", token(admin), undefined, "GET");
    assert.match(ownerCsv.text, /MANUAL/); assert.match(adminCsv.text, /MANUAL/);
    assert.doesNotMatch(ownerCsv.text, /Private Guest|99123456/);
    const confirmedCancel = await create(token(pro), new Date(slot.getTime() + 14400000));
    await json(base, `/api/owner/bookings/${confirmedCancel.body.booking.id}/confirm-offline-payment`, token(pro));
    const [inconsistentConfirmedPayment] = await db.insert(paymentsTable).values({
      bookingId: confirmedCancel.body.booking.id, provider: "MOCK", providerPaymentId: `confirmed-manual-${suffix}`,
      amount: "40", feeAmount: "6", feePercent: "15", status: "SUCCEEDED",
    }).returning();
    assert.equal((await json(base, `/api/bookings/${confirmedCancel.body.booking.id}/cancel`, token(pro), { reason: "offline reversal" })).status, 200);
    const [untouched] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, inconsistentConfirmedPayment!.id));
    assert.equal(untouched!.status, "SUCCEEDED");
  } finally {
    const bookingIds = (await db.select({ id: bookingsTable.id }).from(bookingsTable)
      .where(inArray(bookingsTable.playerId, ids))).map((row) => row.id);
    const paymentIds = bookingIds.length ? (await db.select({ id: paymentsTable.id }).from(paymentsTable)
      .where(inArray(paymentsTable.bookingId, bookingIds))).map((row) => row.id) : [];
    if (paymentIds.length) await db.delete(refundsTable).where(inArray(refundsTable.paymentId, paymentIds));
    if (bookingIds.length) await db.delete(paymentsTable).where(inArray(paymentsTable.bookingId, bookingIds));
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorUserId, ids));
    await db.delete(bookingsTable).where(inArray(bookingsTable.playerId, ids));
    await db.delete(venuesTable).where(inArray(venuesTable.ownerId, ids));
    await db.delete(ownerSubscriptionsTable).where(inArray(ownerSubscriptionsTable.ownerId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
    await new Promise<void>(resolve => server.close(() => resolve())); await pool.end();
  }
}
void main();