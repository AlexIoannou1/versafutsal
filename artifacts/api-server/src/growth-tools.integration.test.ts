import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, eq, inArray } from "drizzle-orm";

async function main() {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("The growth-tools integration test must run with DATABASE_URL set to TEST_DATABASE_URL");
  }
  (globalThis as typeof globalThis & { require: NodeJS.Require }).require = createRequire(import.meta.url);

  const [{ db, pool }, schema, growth, payment] = await Promise.all([
    import("@workspace/db"),
    import("@workspace/db/schema"),
    import("./lib/growth-tools"),
    import("./lib/payment-provider"),
  ]);
  const {
    usersTable, venuesTable, pitchesTable, pricingRulesTable, bookingsTable,
    ownerSubscriptionsTable, promotionsTable, promotionRedemptionsTable,
    venueStreakSettingsTable, venueStreakProgressTable, venueStreakEntriesTable,
    venueStreakRewardsTable, notificationsTable, paymentsTable, refundsTable,
    auditLogTable,
  } = schema;
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const createdBookingIds: string[] = [];
  const createdUserIds: string[] = [];
  let venueId = "";
  let pitchId = "";
  let httpServer: import("node:http").Server | undefined;

  const createBooking = async (week: number, playerId: string) => {
    const startAt = new Date(Date.UTC(2030, 0, 7 + week * 7, 10, createdBookingIds.length));
    const [row] = await db.insert(bookingsTable).values({
      venueId, pitchId, playerId, startAt,
      endAt: new Date(startAt.getTime() + 3600000),
      policySnapshot: { pricePerHour: "100.00", slotDurationMinutes: 60 },
    }).returning();
    createdBookingIds.push(row!.id);
    return row!;
  };

  try {
    const [owner] = await db.insert(usersTable).values({
      email: `growth-owner-${suffix}@example.invalid`, passwordHash: "integration-only",
      name: "Growth Test Owner", role: "VENUE_OWNER",
    }).returning();
    const [playerA] = await db.insert(usersTable).values({
      email: `growth-player-a-${suffix}@example.invalid`, passwordHash: "integration-only",
      name: "Growth Test Player A", role: "PLAYER",
    }).returning();
    const [playerB] = await db.insert(usersTable).values({
      email: `growth-player-b-${suffix}@example.invalid`, passwordHash: "integration-only",
      name: "Growth Test Player B", role: "PLAYER",
    }).returning();
    createdUserIds.push(owner!.id, playerA!.id, playerB!.id);
    await db.insert(ownerSubscriptionsTable).values({
      ownerId: owner!.id, plan: "PRO", status: "ACTIVE",
      currentPeriodEnd: new Date("2035-01-01T00:00:00Z"),
    });
    const [venue] = await db.insert(venuesTable).values({
      ownerId: owner!.id, status: "APPROVED", name: `Growth Venue ${suffix}`,
      district: "Test", address: "Integration test only",
    }).returning();
    venueId = venue!.id;
    const [pitch] = await db.insert(pitchesTable).values({
      venueId, name: "Test Pitch", size: "5v5", slotDurationMinutes: 60,
    }).returning();
    pitchId = pitch!.id;
    await db.insert(pricingRulesTable).values({
      pitchId, dayType: "ALL", pricePerHour: "100.00",
      depositType: "PERCENT", depositAmount: "30.00",
    });
    await db.insert(venueStreakSettingsTable).values({ venueId, enabled: true });

    const expiredBooking = await createBooking(0, playerA!.id);
    const [expired] = await db.insert(promotionsTable).values({
      ownerId: owner!.id, venueId, code: `EXP${suffix.slice(-6).toUpperCase()}`,
      kind: "PERCENTAGE", value: "10.00", enabled: true,
      endsAt: new Date("2020-01-01T00:00:00Z"),
    }).returning();
    await assert.rejects(
      db.transaction((tx) => growth.reservePromotion(tx, {
        bookingId: expiredBooking.id, playerId: playerA!.id, venueId,
        code: expired!.code, subtotal: "100.00",
      }), { isolationLevel: "serializable" }),
      (error: any) => error?.code === "PROMO_INACTIVE",
    );

    const [limited] = await db.insert(promotionsTable).values({
      ownerId: owner!.id, venueId, code: `LIM${suffix.slice(-6).toUpperCase()}`,
      kind: "FIXED", value: "15.00", redemptionLimit: 1, perPlayerLimit: 1,
    }).returning();
    const raceA = await createBooking(1, playerA!.id);
    const raceB = await createBooking(1, playerB!.id);
    const raceResults = await Promise.allSettled([raceA, raceB].map((booking, index) =>
      db.transaction((tx) => growth.reservePromotion(tx, {
        bookingId: booking.id, playerId: index ? playerB!.id : playerA!.id,
        venueId, code: limited!.code, subtotal: "100.00",
      }), { isolationLevel: "serializable" }),
    ));
    assert.equal(raceResults.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(raceResults.filter((result) => result.status === "rejected").length, 1);
    const winningBooking = raceResults[0]!.status === "fulfilled" ? raceA : raceB;
    await db.transaction((tx) => growth.reverseGrowthIncentive(tx, winningBooking.id));
    const replacementBooking = await createBooking(2, playerA!.id);
    await db.transaction((tx) => growth.reservePromotion(tx, {
      bookingId: replacementBooking.id, playerId: playerA!.id, venueId,
      code: limited!.code, subtotal: "100.00",
    }), { isolationLevel: "serializable" });

    const [perPlayer] = await db.insert(promotionsTable).values({
      ownerId: owner!.id, venueId, code: `PLY${suffix.slice(-6).toUpperCase()}`,
      kind: "FIXED", value: "5.00", redemptionLimit: 5, perPlayerLimit: 1,
    }).returning();
    const ppA = await createBooking(3, playerA!.id);
    await db.transaction((tx) => growth.reservePromotion(tx, {
      bookingId: ppA.id, playerId: playerA!.id, venueId, code: perPlayer!.code, subtotal: "100.00",
    }));
    const ppA2 = await createBooking(4, playerA!.id);
    await assert.rejects(db.transaction((tx) => growth.reservePromotion(tx, {
      bookingId: ppA2.id, playerId: playerA!.id, venueId, code: perPlayer!.code, subtotal: "100.00",
    })), (error: any) => error?.code === "PROMO_PLAYER_LIMIT");

    const streakBookings = [
      await createBooking(10, playerB!.id),
      await createBooking(10, playerB!.id),
      await createBooking(11, playerB!.id),
      await createBooking(12, playerB!.id),
      await createBooking(13, playerB!.id),
    ];
    await db.transaction((tx) => growth.finalizeGrowthIncentive(tx, streakBookings[0]!));
    await db.transaction((tx) => growth.finalizeGrowthIncentive(tx, streakBookings[1]!));
    let [progress] = await db.select().from(venueStreakProgressTable).where(and(
      eq(venueStreakProgressTable.venueId, venueId),
      eq(venueStreakProgressTable.playerId, playerB!.id),
    ));
    assert.equal(progress!.paidWeeks, 1, "same-week booking must not advance twice");
    for (const booking of streakBookings.slice(2)) {
      await db.transaction((tx) => growth.finalizeGrowthIncentive(tx, booking));
    }
    [progress] = await db.select().from(venueStreakProgressTable).where(eq(venueStreakProgressTable.id, progress!.id));
    assert.equal(progress!.paidWeeks, 0);
    let rewards = await db.select().from(venueStreakRewardsTable).where(and(
      eq(venueStreakRewardsTable.progressId, progress!.id),
      eq(venueStreakRewardsTable.status, "AVAILABLE"),
    ));
    assert.equal(rewards.length, 1, "four distinct paid weeks earn exactly one reward");

    const freeBooking = await createBooking(14, playerB!.id);
    const freeQuote = await db.transaction((tx) => growth.reserveStreakReward(tx, {
      bookingId: freeBooking.id, playerId: playerB!.id, venueId, subtotal: "100.00",
    }));
    assert.equal(freeQuote?.payableAmount, "0.00");
    await db.transaction((tx) => growth.finalizeGrowthIncentive(tx, {
      ...freeBooking, pricingSnapshot: freeQuote,
    }));
    await db.transaction((tx) => growth.reverseGrowthIncentive(tx, freeBooking.id));
    await db.transaction((tx) => growth.reverseGrowthIncentive(tx, freeBooking.id));
    rewards = await db.select().from(venueStreakRewardsTable).where(and(
      eq(venueStreakRewardsTable.progressId, progress!.id),
      eq(venueStreakRewardsTable.status, "AVAILABLE"),
    ));
    assert.equal(rewards.length, 1, "idempotent reversal restores exactly one reward");

    // Cancelling any paid week (not only the fourth) revokes an unused reward.
    await db.transaction((tx) => growth.reverseGrowthIncentive(tx, streakBookings[0]!.id));
    rewards = await db.select().from(venueStreakRewardsTable).where(and(
      eq(venueStreakRewardsTable.progressId, progress!.id),
      eq(venueStreakRewardsTable.status, "AVAILABLE"),
    ));
    assert.equal(rewards.length, 0, "restored rewards retain all qualifying-week dependencies");
    await db.transaction((tx) => growth.reverseGrowthIncentive(tx, freeBooking.id));
    rewards = await db.select().from(venueStreakRewardsTable).where(and(
      eq(venueStreakRewardsTable.progressId, progress!.id),
      eq(venueStreakRewardsTable.status, "AVAILABLE"),
    ));
    assert.equal(rewards.length, 0, "repeating cancellation cannot restore an invalid reward");
    await db.transaction((tx) => growth.reverseGrowthIncentive(tx, streakBookings[2]!.id));
    const [afterTwoRefunds] = await db.select().from(venueStreakProgressTable)
      .where(eq(venueStreakProgressTable.id, progress!.id));
    assert.equal(afterTwoRefunds!.paidWeeks, 2, "two refunded qualifying weeks leave exactly two credits");
    const oneMorePaid = await createBooking(14, playerB!.id);
    await db.transaction((tx) => growth.finalizeGrowthIncentive(tx, oneMorePaid));
    const [afterOneMore] = await db.select().from(venueStreakProgressTable)
      .where(eq(venueStreakProgressTable.id, progress!.id));
    assert.equal(afterOneMore!.paidWeeks, 3);
    assert.equal((await db.select().from(venueStreakRewardsTable).where(and(
      eq(venueStreakRewardsTable.progressId, progress!.id), eq(venueStreakRewardsTable.status, "AVAILABLE"),
    ))).length, 0, "one additional paid week cannot replace two refunded weeks");

    // Delivered notifications from a prior cycle must not suppress later cycles.
    await db.insert(notificationsTable).values({
      userId: playerB!.id, type: "STREAK_NEAR_COMPLETION",
      title: "Prior cycle", body: "Delivered test notification", pushSent: true,
      entityType: "STREAK_PROGRESS", entityId: progress!.id, dedupeKey: streakBookings[3]!.id,
    }).onConflictDoNothing();
    await db.update(notificationsTable).set({ pushSent: true })
      .where(eq(notificationsTable.entityId, progress!.id));
    await db.update(venueStreakProgressTable).set({ paidWeeks: 0, expiresAt: null })
      .where(eq(venueStreakProgressTable.id, progress!.id));
    const beforeNextCycle = await db.select().from(notificationsTable).where(and(
      eq(notificationsTable.entityId, progress!.id), eq(notificationsTable.type, "STREAK_NEAR_COMPLETION"),
    ));
    for (let week = 21; week <= 23; week++) {
      const nextCycleBooking = await createBooking(week, playerB!.id);
      await db.transaction((tx) => growth.finalizeGrowthIncentive(tx, nextCycleBooking));
    }
    const nearNotifications = await db.select().from(notificationsTable).where(and(
      eq(notificationsTable.entityId, progress!.id), eq(notificationsTable.type, "STREAK_NEAR_COMPLETION"),
    ));
    assert.equal(nearNotifications.length, beforeNextCycle.length + 1, "each streak cycle gets a near-completion notification");
    await db.transaction((tx) => growth.reverseGrowthIncentive(tx, streakBookings[3]!.id));
    const [afterOlderRefund] = await db.select().from(venueStreakProgressTable)
      .where(eq(venueStreakProgressTable.id, progress!.id));
    assert.equal(afterOlderRefund!.paidWeeks, 3, "an older cycle refund does not subtract current-cycle credits");

    const [freePromo] = await db.insert(promotionsTable).values({
      ownerId: owner!.id, venueId, code: `FREE${suffix.slice(-6).toUpperCase()}`,
      kind: "PERCENTAGE", value: "100.00", perPlayerLimit: 1,
    }).returning();
    const promoFreeBooking = await createBooking(20, playerA!.id);
    const promoFreeQuote = await db.transaction((tx) => growth.reservePromotion(tx, {
      bookingId: promoFreeBooking.id, playerId: playerA!.id, venueId,
      code: freePromo!.code, subtotal: "100.00",
    }));
    await db.transaction((tx) => growth.finalizeGrowthIncentive(tx, {
      ...promoFreeBooking, pricingSnapshot: promoFreeQuote,
    }));
    const [promoRedemption] = await db.select().from(promotionRedemptionsTable)
      .where(eq(promotionRedemptionsTable.bookingId, promoFreeBooking.id));
    assert.equal(promoRedemption!.status, "REDEEMED");
    const [playerAProgress] = await db.select().from(venueStreakProgressTable).where(and(
      eq(venueStreakProgressTable.venueId, venueId),
      eq(venueStreakProgressTable.playerId, playerA!.id),
    ));
    assert.equal(playerAProgress, undefined, "100%-off promotion is not paid streak progress");

    const provider = new payment.MockPaymentProvider();
    const discounted = await createBooking(30, playerA!.id);
    const fullIntent = await provider.createPaymentIntent({
      bookingId: discounted.id, venueId, subtotalAmount: "80.00", paymentType: "FULL",
      idempotencyKey: `growth-full-${suffix}`, feePercentOverride: "6.00", feeWaivedOverride: false,
    });
    assert.equal(fullIntent.feeAmount, "4.80");
    assert.equal(fullIntent.amount, "84.80");
    const deposit = await createBooking(31, playerA!.id);
    const depositIntent = await provider.createPaymentIntent({
      bookingId: deposit.id, venueId, subtotalAmount: "80.00", paymentType: "DEPOSIT",
      depositAmountOverride: "24.00", idempotencyKey: `growth-deposit-${suffix}`,
      feePercentOverride: "6.00", feeWaivedOverride: false,
    });
    assert.equal(depositIntent.feeAmount, "1.44");
    assert.equal(depositIntent.amount, "25.44");
    const atomicBooking = await createBooking(32, playerA!.id);
    const atomicKey = `growth-atomic-${suffix}`;
    await db.update(bookingsTable).set({ status: "CANCELLED", checkoutKey: atomicKey }).where(eq(bookingsTable.id, atomicBooking.id));
    const atomicOptions = { bookingId: atomicBooking.id, venueId, subtotalAmount: "100.00",
      paymentType: "FULL" as const, idempotencyKey: atomicKey, feePercentOverride: "6.00",
      feeWaivedOverride: false, bookingQuote: growth.quoteFromDiscount("100.00") };
    await assert.rejects(provider.createPaymentIntent(atomicOptions), /checkout changed/);
    assert.equal((await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, atomicBooking.id))).length, 0,
      "failure after payment insert rolls back the payment together with the snapshot");
    await db.update(bookingsTable).set({ status: "PENDING" }).where(eq(bookingsTable.id, atomicBooking.id));
    await provider.createPaymentIntent(atomicOptions);
    const [atomicSaved] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, atomicBooking.id));
    assert.equal(atomicSaved!.pricingSnapshot!.feeAmount, "6.00");
    assert.equal(atomicSaved!.pricingSnapshot!.payableAmount, "100.00");
    const orphanClaim = await createBooking(33, playerA!.id);
    const orphanKey = `growth-orphan-${suffix}`;
    const freshClaim = await createBooking(34, playerA!.id);
    await db.update(bookingsTable).set({
      checkoutKey: orphanKey, updatedAt: new Date(Date.now() - 31 * 60000),
    }).where(eq(bookingsTable.id, orphanClaim.id));
    await db.update(bookingsTable).set({ checkoutKey: `growth-fresh-${suffix}` })
      .where(eq(bookingsTable.id, freshClaim.id));
    const { cleanupAbandonedGrowthCheckouts } = await import("./lib/growth-checkout-cleanup");
    await cleanupAbandonedGrowthCheckouts();
    const [expiredClaim] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, orphanClaim.id));
    const [activeClaim] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, freshClaim.id));
    assert.equal(expiredClaim!.status, "CANCELLED", "a stale claim with no payment or incentive releases its slot");
    assert.equal(expiredClaim!.checkoutKey, null);
    assert.equal(activeClaim!.status, "PENDING", "an active claim retains its lease");
    await assert.rejects(provider.createPaymentIntent({
      ...atomicOptions, bookingId: orphanClaim.id, idempotencyKey: orphanKey,
    }), /checkout changed/);
    assert.equal((await db.select().from(paymentsTable).where(eq(paymentsTable.bookingId, orphanClaim.id))).length, 0,
      "a late provider writer cannot commit or expose a secret after the claim is closed");
    const [rebookedClaimSlot] = await db.insert(bookingsTable).values({
      venueId, pitchId, playerId: playerA!.id, startAt: orphanClaim.startAt, endAt: orphanClaim.endAt,
      policySnapshot: orphanClaim.policySnapshot,
    }).returning();
    createdBookingIds.push(rebookedClaimSlot!.id);
    assert.equal(rebookedClaimSlot!.status, "PENDING", "the abandoned slot can immediately be booked again");

    const abandoned = await createBooking(35, playerA!.id);
    // Use an independent code so another active test redemption cannot mask release.
    const [abandonedPromo] = await db.insert(promotionsTable).values({
      ownerId: owner!.id, venueId, code: `ABN${suffix.slice(-6).toUpperCase()}`,
      kind: "FIXED", value: "10.00", redemptionLimit: 1, perPlayerLimit: 1,
    }).returning();
    const reservedQuote = await db.transaction((tx) => growth.reservePromotion(tx, {
      bookingId: abandoned.id, playerId: playerA!.id, venueId, code: abandonedPromo!.code, subtotal: "100.00",
    }));
    const abandonedSnapshot = { ...reservedQuote, feeAmount: "5.40", feePercent: "6.00", feeWaived: false, capturedAt: new Date().toISOString() };
    await db.update(bookingsTable).set({
      pricingSnapshot: abandonedSnapshot,
      checkoutKey: `abandoned-${suffix}`,
    }).where(eq(bookingsTable.id, abandoned.id));
    const abandonedIntent = await provider.createPaymentIntent({
      bookingId: abandoned.id, venueId, subtotalAmount: "90.00", paymentType: "FULL",
      idempotencyKey: `abandoned-${suffix}`, feePercentOverride: "6.00", feeWaivedOverride: false,
    });
    const [abandonedPayment] = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.providerPaymentId, abandonedIntent.providerPaymentId));
    const { closeUnpaidCheckout } = await import("./lib/growth-checkout-cleanup");
    await closeUnpaidCheckout(abandoned.id, abandonedPayment!.id);
    await closeUnpaidCheckout(abandoned.id, abandonedPayment!.id);
    const [closed] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, abandoned.id));
    assert.equal(closed!.status, "CANCELLED");
    assert.deepEqual(closed!.pricingSnapshot, abandonedSnapshot);
    const releasedRows = await db.select().from(promotionRedemptionsTable)
      .where(eq(promotionRedemptionsTable.bookingId, abandoned.id));
    assert.equal(releasedRows.length, 0, "terminal checkout releases its limited redemption exactly once");

    const [{ default: app }, { signToken }] = await Promise.all([
      import("./app"), import("./middlewares/auth"),
    ]);
    httpServer = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => httpServer!.once("listening", resolve));
    const address = httpServer.address() as import("node:net").AddressInfo;
    const request = (path: string, user: typeof owner | undefined, method = "GET", body?: unknown) =>
      fetch(`http://127.0.0.1:${address.port}/api${path}`, {
        method, headers: {
          "Content-Type": "application/json",
          ...(user ? { Authorization: `Bearer ${signToken({
            userId: user.id, email: user.email, role: user.role, sessionVersion: user.sessionVersion,
          })}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    assert.equal((await request("/owner/promotions", undefined)).status, 401);
    assert.equal((await request("/owner/promotions", playerA)).status, 403);
    const createdResponse = await request("/owner/promotions", owner, "POST", {
      venueId, code: `HTTP${suffix.slice(-6).toUpperCase()}`, kind: "PERCENTAGE", value: 20,
      redemptionLimit: 2, perPlayerLimit: 1,
    });
    assert.equal(createdResponse.status, 201);
    const { promotion: httpPromotion } = await createdResponse.json() as { promotion: { id: string; code: string } };
    assert.equal((await request(`/owner/promotions/${httpPromotion.id}`, owner, "PATCH", { enabled: false })).status, 200);
    const quotedBooking = await createBooking(40, playerA!.id);
    assert.equal((await request(`/bookings/${quotedBooking.id}/quote`, playerB, "POST", { promoCode: httpPromotion.code })).status, 404);
    assert.equal((await request(`/bookings/${quotedBooking.id}/quote`, playerA, "POST", { promoCode: httpPromotion.code })).status, 400);
    assert.equal((await request(`/owner/promotions/${httpPromotion.id}`, owner, "PATCH", { enabled: true })).status, 200);
    const quoteResponse = await request(`/bookings/${quotedBooking.id}/quote`, playerA, "POST", { promoCode: httpPromotion.code });
    assert.equal(quoteResponse.status, 200);
    assert.equal((await quoteResponse.json() as { quote: { payableAmount: string } }).quote.payableAmount, "80.00");
    const bookingsBeforePreview = await db.select({ id: bookingsTable.id }).from(bookingsTable).where(eq(bookingsTable.venueId, venueId));
    const redemptionsBeforePreview = await db.select().from(promotionRedemptionsTable).where(eq(promotionRedemptionsTable.promotionId, httpPromotion.id));
    for (let visit = 0; visit < 3; visit++) {
      const preview = await request("/growth/quote", playerA, "POST", {
        pitchId, startAt: new Date(Date.UTC(2030, 11, 1, 10)).toISOString(), promoCode: httpPromotion.code,
      });
      assert.equal(preview.status, 200);
      assert.equal((await preview.json() as { quote: { payableAmount: string } }).quote.payableAmount, "80.00");
    }
    assert.equal((await db.select({ id: bookingsTable.id }).from(bookingsTable).where(eq(bookingsTable.venueId, venueId))).length,
      bookingsBeforePreview.length, "entering, leaving and revisiting preview does not claim the slot");
    assert.equal((await db.select().from(promotionRedemptionsTable).where(eq(promotionRedemptionsTable.promotionId, httpPromotion.id))).length,
      redemptionsBeforePreview.length, "applying a preview code does not reserve a redemption");
    const legacyBooking = await createBooking(45, playerA!.id);
    const legacyKey = `growth-legacy-${suffix}`;
    await db.update(bookingsTable).set({ checkoutKey: legacyKey }).where(eq(bookingsTable.id, legacyBooking.id));
    const legacyQuote = await db.transaction((tx) => growth.reservePromotion(tx, {
      bookingId: legacyBooking.id, playerId: playerA!.id, venueId,
      code: httpPromotion.code, subtotal: "100.00",
    }));
    // Simulate the old writer crashing after payment insert but before snapshot.
    const legacyIntent = await provider.createPaymentIntent({
      bookingId: legacyBooking.id, venueId, subtotalAmount: legacyQuote.payableAmount,
      paymentType: "FULL", idempotencyKey: legacyKey, feePercentOverride: "6.00", feeWaivedOverride: false,
    });
    await db.update(paymentsTable).set({ provider: "STRIPE" }).where(eq(paymentsTable.bookingId, legacyBooking.id));
    const originalSecret = payment.paymentProvider.getClientSecret;
    const originalConfirm = payment.paymentProvider.confirmPayment;
    payment.paymentProvider.getClientSecret = async (id) => {
      assert.equal(id, legacyIntent.providerPaymentId);
      return "integration-only-client-secret";
    };
    payment.paymentProvider.confirmPayment = async (id) => {
      assert.equal(id, legacyIntent.providerPaymentId);
      return { success: true };
    };
    try {
      const replay = await request(`/bookings/${legacyBooking.id}/checkout`, playerA, "POST", {
        paymentType: "FULL", idempotencyKey: legacyKey, promoCode: httpPromotion.code,
      });
      assert.equal(replay.status, 202, "same-key replay repairs missing pricing before returning a secret");
      const [repaired] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, legacyBooking.id));
      assert.equal(repaired!.pricingSnapshot!.incentiveId, httpPromotion.id);
      assert.equal(repaired!.pricingSnapshot!.feeAmount, "4.80");
      const captured = await request(`/bookings/${legacyBooking.id}/capture`, playerA, "POST", {});
      assert.equal(captured.status, 200);
      const [redeemed] = await db.select().from(promotionRedemptionsTable).where(eq(promotionRedemptionsTable.bookingId, legacyBooking.id));
      assert.equal(redeemed!.status, "REDEEMED", "capture finalizes the recovered incentive exactly once");
      const confirmationMessages = await db.select().from(notificationsTable)
        .where(eq(notificationsTable.entityId, legacyBooking.id));
      assert.equal(confirmationMessages.filter((message) => message.type === "BOOKING_CONFIRMED").length, 1);
      assert.equal(confirmationMessages.filter((message) => message.type === "NEW_BOOKING_OWNER").length, 1,
        "partial growth indexes must not prevent ordinary booking notifications");
    } finally {
      payment.paymentProvider.getClientSecret = originalSecret;
      payment.paymentProvider.confirmPayment = originalConfirm;
    }
    assert.equal((await request(`/owner/venues/${venueId}/streak`, owner, "PUT", { enabled: false })).status, 200);
    assert.equal((await request(`/owner/venues/${venueId}/streak`, owner, "PUT", { enabled: true })).status, 200);
    const [otherOwner] = await db.insert(usersTable).values({
      email: `growth-other-owner-${suffix}@example.invalid`, passwordHash: "integration-only",
      name: "Other Growth Owner", role: "VENUE_OWNER",
    }).returning();
    createdUserIds.push(otherOwner!.id);
    await db.insert(ownerSubscriptionsTable).values({
      ownerId: otherOwner!.id, plan: "PRO", status: "ACTIVE", currentPeriodEnd: new Date("2035-01-01T00:00:00Z"),
    });
    assert.equal((await request(`/owner/promotions/${httpPromotion.id}`, otherOwner, "PATCH", { enabled: false })).status, 404);
    assert.equal((await request(`/owner/venues/${venueId}/streak`, otherOwner, "PUT", { enabled: false })).status, 404);
    const zeroPromotionResponse = await request("/owner/promotions", owner, "POST", {
      venueId, code: `ZERO${suffix.slice(-6).toUpperCase()}`, kind: "FIXED", value: 100,
    });
    assert.equal(zeroPromotionResponse.status, 201);
    const zeroPromotion = await zeroPromotionResponse.json() as { promotion: { id: string; code: string } };
    const zeroBooking = await createBooking(41, playerB!.id);
    const zeroCheckout = await request(`/bookings/${zeroBooking.id}/checkout`, playerB, "POST", {
      paymentType: "FULL", promoCode: zeroPromotion.promotion.code, useStreakReward: false,
    });
    assert.equal(zeroCheckout.status, 200);
    const zeroCheckoutData = await zeroCheckout.json() as {
      booking: { status: string }; payment: { amount: string; feeAmount: string; provider: string };
    };
    assert.equal(zeroCheckoutData.booking.status, "CONFIRMED");
    assert.equal(zeroCheckoutData.payment.amount, "0.00");
    assert.equal(zeroCheckoutData.payment.feeAmount, "0.00");
    assert.equal(zeroCheckoutData.payment.provider, "INTERNAL");
    const zeroCancel = await request(`/bookings/${zeroBooking.id}/cancel`, playerB, "POST", { reason: "Integration-only zero-cost cancellation" });
    assert.equal(zeroCancel.status, 200);
    const zeroCancelData = await zeroCancel.json() as { booking: { status: string }; refund: unknown };
    assert.equal(zeroCancelData.booking.status, "CANCELLED");
    assert.equal(zeroCancelData.refund, null);
    const [zeroRedemption] = await db.select().from(promotionRedemptionsTable)
      .where(eq(promotionRedemptionsTable.bookingId, zeroBooking.id));
    assert.equal(zeroRedemption!.status, "REVERSED");
    await db.update(ownerSubscriptionsTable).set({ plan: "FREE" }).where(eq(ownerSubscriptionsTable.ownerId, owner!.id));
    assert.equal((await request("/owner/promotions", owner, "POST", {
      venueId, code: "FREEOWNER", kind: "FIXED", value: 10,
    })).status, 403);
    assert.equal((await request(`/owner/venues/${venueId}/streak`, owner, "PUT", { enabled: true })).status, 403);

    console.log("growth tools database integration checks passed");
  } finally {
    if (httpServer) await new Promise<void>((resolve, reject) => httpServer!.close((error) => error ? reject(error) : resolve()));
    if (createdBookingIds.length) {
      const paymentIds = (await db.select({ id: paymentsTable.id }).from(paymentsTable)
        .where(inArray(paymentsTable.bookingId, createdBookingIds))).map((row) => row.id);
      if (paymentIds.length) await db.delete(refundsTable).where(inArray(refundsTable.paymentId, paymentIds));
      await db.delete(notificationsTable).where(inArray(notificationsTable.entityId, createdBookingIds));
      await db.delete(auditLogTable).where(inArray(auditLogTable.entityId, createdBookingIds));
      await db.delete(venueStreakRewardsTable).where(
        venueId ? inArray(venueStreakRewardsTable.progressId,
          db.select({ id: venueStreakProgressTable.id }).from(venueStreakProgressTable)
            .where(eq(venueStreakProgressTable.venueId, venueId))) : eq(venueStreakRewardsTable.id, randomUUID()),
      );
      await db.delete(venueStreakEntriesTable).where(inArray(venueStreakEntriesTable.bookingId, createdBookingIds));
      await db.delete(promotionRedemptionsTable).where(inArray(promotionRedemptionsTable.bookingId, createdBookingIds));
      await db.delete(paymentsTable).where(inArray(paymentsTable.bookingId, createdBookingIds));
      await db.delete(bookingsTable).where(inArray(bookingsTable.id, createdBookingIds));
    }
    if (venueId) {
      await db.delete(notificationsTable).where(inArray(notificationsTable.entityId,
        db.select({ id: venueStreakProgressTable.id }).from(venueStreakProgressTable)
          .where(eq(venueStreakProgressTable.venueId, venueId))));
      await db.delete(venueStreakProgressTable).where(eq(venueStreakProgressTable.venueId, venueId));
      await db.delete(promotionsTable).where(eq(promotionsTable.venueId, venueId));
      await db.delete(pricingRulesTable).where(eq(pricingRulesTable.pitchId, pitchId));
      await db.delete(pitchesTable).where(eq(pitchesTable.venueId, venueId));
      await db.delete(venueStreakSettingsTable).where(eq(venueStreakSettingsTable.venueId, venueId));
      await db.delete(venuesTable).where(eq(venuesTable.id, venueId));
    }
    if (createdUserIds.length) {
      await db.delete(ownerSubscriptionsTable).where(inArray(ownerSubscriptionsTable.ownerId, createdUserIds));
      await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error("growth tools integration test failed", error);
  process.exitCode = 1;
});