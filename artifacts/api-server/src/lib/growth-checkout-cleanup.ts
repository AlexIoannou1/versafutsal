import { db } from "@workspace/db";
import { bookingsTable, paymentsTable } from "@workspace/db/schema";
import { and, eq, lte, sql } from "drizzle-orm";
import { paymentProvider } from "./payment-provider";
import { releaseGrowthReservation } from "./growth-tools";
import { logBookingAudit } from "./audit";
import { logger } from "./logger";

/** Preserve the immutable snapshot, but close the booking so it can never reuse a released incentive. */
export async function closeUnpaidCheckout(bookingId: string, paymentId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`);
    const [booking] = await tx.update(bookingsTable).set({ status: "CANCELLED", checkoutKey: null })
      .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.status, "PENDING"))).returning();
    if (!booking) return;
    await tx.update(paymentsTable).set({ status: "FAILED", updatedAt: new Date() })
      .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.status, "PENDING")));
    await releaseGrowthReservation(tx, bookingId);
    await logBookingAudit(tx, {
      bookingId, actorUserId: booking.playerId, actorRole: "SYSTEM",
      action: "BOOKING_CANCELLED", previousValue: { status: "PENDING" },
      newValue: { status: "CANCELLED" }, notes: "Unpaid checkout closed after provider cancellation.",
    });
  });
}

/** Bounded sweep; network uncertainty and in-flight charges always retain their reservations. */
export async function cleanupAbandonedGrowthCheckouts(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 30 * 60_000);
  const stale = await db.select({ payment: paymentsTable }).from(paymentsTable)
    .innerJoin(bookingsTable, eq(bookingsTable.id, paymentsTable.bookingId))
    .where(and(
      eq(bookingsTable.status, "PENDING"), eq(paymentsTable.status, "PENDING"),
      lte(paymentsTable.createdAt, cutoff),
      sql`(${bookingsTable.pricingSnapshot}->>'incentiveType' IN ('PROMOTION', 'STREAK_REWARD')
        OR EXISTS (SELECT 1 FROM promotion_redemptions WHERE booking_id = ${bookingsTable.id} AND status = 'RESERVED')
        OR EXISTS (SELECT 1 FROM venue_streak_rewards WHERE booking_id = ${bookingsTable.id} AND status = 'RESERVED'))`,
    )).limit(50);
  for (const { payment } of stale) {
    try {
      if (payment.provider === "INTERNAL" || payment.provider === "MOCK" ||
          (payment.provider === "STRIPE" && payment.providerPaymentId &&
          await paymentProvider.cancelUnpaidIntent(payment.providerPaymentId))) {
        await closeUnpaidCheckout(payment.bookingId, payment.id);
      }
    } catch {
      logger.warn({ paymentId: payment.id }, "Unable to reconcile abandoned incentive checkout; reservation retained");
    }
  }
  // The 30-minute claim lease also covers termination immediately after claiming,
  // before an incentive or payment exists. No client secret is exposed before
  // atomic payment/snapshot persistence. Closing under the booking lock causes
  // a late provider writer to fail its PENDING/key guard and withhold that secret.
  // Existing payments (including provider uncertainty) are never released here.
  const unpriced = await db.select({ id: bookingsTable.id }).from(bookingsTable).where(and(
    eq(bookingsTable.status, "PENDING"), lte(bookingsTable.updatedAt, cutoff),
    sql`${bookingsTable.pricingSnapshot} IS NULL`,
    sql`${bookingsTable.checkoutKey} IS NOT NULL`,
    sql`NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = ${bookingsTable.id})`,
  )).limit(50);
  for (const booking of unpriced) {
    await db.transaction(async (tx) => {
      const [closed] = await tx.update(bookingsTable).set({ status: "CANCELLED", checkoutKey: null })
        .where(and(
          eq(bookingsTable.id, booking.id), eq(bookingsTable.status, "PENDING"),
          lte(bookingsTable.updatedAt, cutoff),
          sql`NOT EXISTS (SELECT 1 FROM payments WHERE booking_id = ${bookingsTable.id})`,
        )).returning();
      if (closed) await releaseGrowthReservation(tx, booking.id);
    });
  }
}

export function startGrowthCheckoutCleanup(): NodeJS.Timeout {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try { await cleanupAbandonedGrowthCheckouts(); }
    catch { logger.warn("Growth checkout cleanup failed; will retry"); }
    finally { running = false; }
  }, 60_000);
}
