import { db } from "@workspace/db";
import { bookingsTable, paymentsTable, promotionRedemptionsTable, venueStreakRewardsTable } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { quoteFromDiscount } from "./growth-tools";

/** Repair legacy interrupted writes using persisted reservations and payment cents, never today's promo rules. */
export async function repairIncompleteBookingPricing(bookingId: string) {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId)).for("update");
    if (!booking || booking.pricingSnapshot || booking.status !== "PENDING") return booking?.pricingSnapshot;
    const [payment] = await tx.select().from(paymentsTable).where(and(
      eq(paymentsTable.bookingId, bookingId), eq(paymentsTable.status, "PENDING"),
    )).limit(1);
    if (!payment) return null;
    const [redemption] = await tx.select().from(promotionRedemptionsTable).where(and(
      eq(promotionRedemptionsTable.bookingId, bookingId),
      inArray(promotionRedemptionsTable.status, ["RESERVED", "REDEEMED"]),
    )).limit(1);
    const [reward] = await tx.select().from(venueStreakRewardsTable).where(and(
      eq(venueStreakRewardsTable.bookingId, bookingId),
      inArray(venueStreakRewardsTable.status, ["RESERVED", "REDEEMED"]),
    )).limit(1);
    if (redemption && reward) throw new Error("Conflicting incentive reservations");
    const policy = booking.policySnapshot as { pricePerHour?: string | number; slotDurationMinutes?: number };
    const duration = policy.slotDurationMinutes ?? (booking.endAt.getTime() - booking.startAt.getTime()) / 60000;
    const subtotal = (Number(policy.pricePerHour) * duration / 60).toFixed(2);
    if (!Number.isFinite(Number(subtotal)) || Number(subtotal) < 0) throw new Error("Original booking policy is unavailable");
    const quote = redemption
      ? quoteFromDiscount(subtotal, redemption.discountAmount, "PROMOTION", redemption.promotionId)
      : reward ? quoteFromDiscount(subtotal, subtotal, "STREAK_REWARD", reward.id) : quoteFromDiscount(subtotal);
    const paidBase = Math.round(Number(payment.amount) * 100) - Math.round(Number(payment.feeAmount) * 100);
    const payable = Math.round(Number(quote.payableAmount) * 100);
    const expectedFee = payment.feeWaived ? 0
      : Math.round(Number((paidBase / 100 * Number(payment.feePercent) / 100).toFixed(2)) * 100);
    if (paidBase < 0 || paidBase > payable || (payment.paymentType === "FULL" && paidBase !== payable) ||
        expectedFee !== Math.round(Number(payment.feeAmount) * 100)) {
      throw new Error("Persisted payment cannot be reconciled with its incentive");
    }
    const snapshot = { ...quote, feeAmount: payment.feeAmount, feePercent: payment.feePercent,
      feeWaived: payment.feeWaived, capturedAt: payment.createdAt.toISOString() };
    await tx.update(bookingsTable).set({ pricingSnapshot: snapshot }).where(eq(bookingsTable.id, bookingId));
    return snapshot;
  });
}
