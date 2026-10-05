import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  bookingsTable,
  paymentsTable,
  pitchesTable,
  venuesTable,
  usersTable,
  pricingRulesTable,
  adminSettingsTable,
  auditLogTable,
  promotionRedemptionsTable,
  venueStreakRewardsTable,
} from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { paymentProvider } from "../lib/payment-provider";
import { closeUnpaidCheckout } from "../lib/growth-checkout-cleanup";
import { repairIncompleteBookingPricing } from "../lib/growth-pricing-recovery";
import { reconcileSmsReminder } from "../lib/sms-reminders";
import { canUsePaymentProvider } from "../lib/manual-bookings";
import { logger } from "../lib/logger";
import { sendBookingConfirmedNotifications } from "../lib/notifications";
import { logBookingAudit, logBookingAuditFireAndForget } from "../lib/audit";
import { randomUUID } from "crypto";
import {
  finalizeGrowthIncentive,
  quoteFromDiscount,
  reservePromotion,
  reserveStreakReward,
  releaseGrowthReservation,
} from "../lib/growth-tools";

const router: IRouter = Router();
router.use("/bookings/:bookingId", requireAuth, async (req, res, next) => {
  const [booking] = await db.select().from(bookingsTable).where(and(
    eq(bookingsTable.id, req.params.bookingId as string),
    eq(bookingsTable.playerId, req.user!.userId),
  )).limit(1);
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (!canUsePaymentProvider(booking.source)) {
    res.status(400).json({ error: "Manual bookings must be paid offline", code: "MANUAL_BOOKING_OFFLINE_ONLY" });
    return;
  }
  if (booking.status === "PENDING" && !booking.pricingSnapshot) {
    try { await repairIncompleteBookingPricing(booking.id); }
    catch (error) {
      req.log.error({ err: error, bookingId: booking.id }, "Unable to reconcile interrupted checkout pricing");
      res.status(409).json({ error: "Payment pricing could not be safely recovered. Retry later or contact support.", code: "PRICING_RECOVERY_REQUIRED" });
      return;
    }
  }
  if (booking.status === "CONFIRMED") {
    try { await reconcileSmsReminder(booking.id); }
    catch (error) { req.log.error({ err: error }, "Unable to reconcile booking SMS reminder"); }
  }
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrSeedAdminSettings() {
  const [existing] = await db.select().from(adminSettingsTable).limit(1);
  if (existing) return existing;

  const [seeded] = await db.insert(adminSettingsTable).values({}).returning();
  return seeded!;
}

/** Format a payment record for API responses. */
function formatPayment(payment: typeof paymentsTable.$inferSelect) {
  return {
    id: payment.id,
    amount: payment.amount,
    feeAmount: payment.feeAmount,
    feePercent: payment.feePercent,
    feeWaived: payment.feeWaived,
    paymentType: payment.paymentType,
    currency: payment.currency,
    status: payment.status,
    provider: payment.provider,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

// ─── POST /bookings/:bookingId/checkout ──────────────────────────────────────
// Creates a PaymentIntent, and for mock mode immediately confirms booking.
// For Stripe mode, returns clientSecret so the mobile app can present payment sheet.

router.post<{ bookingId: string }>(
  "/bookings/:bookingId/checkout",
  requireAuth,
  requireRole("PLAYER"),
  async (req, res) => {
    let releaseUnpricedCheckout: (() => Promise<void>) | null = null;
    try {
      const { bookingId } = req.params;
      const { paymentType = "FULL", idempotencyKey, promoCode, useStreakReward = true } = req.body as {
        paymentType?: "FULL" | "DEPOSIT";
        idempotencyKey?: string;
        promoCode?: string;
        useStreakReward?: boolean;
      };

      if (paymentType !== "FULL" && paymentType !== "DEPOSIT") {
        res.status(400).json({ error: "paymentType must be FULL or DEPOSIT" });
        return;
      }
      if ((promoCode != null && (typeof promoCode !== "string" || promoCode.length > 32)) ||
          (idempotencyKey != null && (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9:_.-]{1,200}$/.test(idempotencyKey))) ||
          typeof useStreakReward !== "boolean") {
        res.status(400).json({ error: "Invalid checkout incentive or idempotency key" });
        return;
      }

      // Idempotency: if a payment already exists with this key and is SUCCEEDED, return 200
      const effectiveKey = idempotencyKey ?? `${bookingId}:${paymentType}:${req.user!.userId}`;

      // Ownership must be established before any idempotency response. A guessed
      // booking ID/key must never disclose another player's payment or secret.
      const [booking] = await db
        .select()
        .from(bookingsTable)
        .where(and(
          eq(bookingsTable.id, bookingId),
          eq(bookingsTable.playerId, req.user!.userId),
        ))
        .limit(1);
      if (!booking) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }
      if (booking.status === "CANCELLED" || booking.status === "REFUNDED") {
        res.status(409).json({ error: "This booking is closed. Please reserve again.", code: "CHECKOUT_EXPIRED" });
        return;
      }

      // Idempotency: scope the lookup to THIS booking + key to prevent cross-booking leakage
      const [existingPayment] = await db
        .select()
        .from(paymentsTable)
        .where(
          and(
            eq(paymentsTable.idempotencyKey, effectiveKey),
            eq(paymentsTable.bookingId, bookingId),
          ),
        )
        .limit(1);

      if (existingPayment) {
        if (existingPayment.status === "SUCCEEDED") {
          const [alreadyBooking] = await db
            .select()
            .from(bookingsTable)
            .where(
              and(
                eq(bookingsTable.id, bookingId),
                eq(bookingsTable.playerId, req.user!.userId),
              ),
            )
            .limit(1);

          res.json({
            alreadyProcessed: true,
            booking: alreadyBooking
              ? {
                  id: alreadyBooking.id,
                  status: alreadyBooking.status,
                  startAt: alreadyBooking.startAt.toISOString(),
                  endAt: alreadyBooking.endAt.toISOString(),
                }
              : { id: bookingId, status: "CONFIRMED" },
            payment: formatPayment(existingPayment),
          });
        } else if (existingPayment.status === "PENDING" && existingPayment.provider === "STRIPE") {
          // Stripe payment is PENDING — client may need to re-present the payment sheet.
          // Return the existing providerPaymentId so client can retrieve the client_secret if needed.
          const publishableKey = process.env.STRIPE_TEST_PK ?? null;
          let clientSecret: string | undefined;
          try {
            clientSecret = existingPayment.providerPaymentId
              ? await paymentProvider.getClientSecret(existingPayment.providerPaymentId)
              : undefined;
          } catch (error) {
            // A network error does not prove that an intent cannot charge.
            const state = existingPayment.providerPaymentId
              ? await paymentProvider.confirmPayment(existingPayment.providerPaymentId) : null;
            if (state?.terminal) {
              await closeUnpaidCheckout(bookingId, existingPayment.id);
              res.status(409).json({ error: "This payment was canceled. Please create a new booking.", code: "CHECKOUT_EXPIRED" });
              return;
            }
            res.status(503).json({ error: "Payment status is temporarily unavailable. Retry this checkout.", code: "PAYMENT_STATUS_UNAVAILABLE" });
            return;
          }
          if (!clientSecret) {
            res.status(503).json({ error: "Payment cannot currently be resumed. Retry this checkout.", code: "PAYMENT_STATUS_UNAVAILABLE" });
            return;
          }
          res.status(202).json({
            requiresClientAction: true,
            providerPaymentId: existingPayment.providerPaymentId,
            clientSecret,
            publishableKey,
            booking: { id: bookingId, status: "PENDING" },
            payment: formatPayment(existingPayment),
          });
        } else if (existingPayment.status === "PENDING" && existingPayment.provider === "INTERNAL") {
          const [freePitch] = await db.select({
            id: pitchesTable.id, name: pitchesTable.name,
            slotDurationMinutes: pitchesTable.slotDurationMinutes,
            venueId: venuesTable.id, venueName: venuesTable.name, venueOwnerId: venuesTable.ownerId,
          }).from(pitchesTable).innerJoin(venuesTable, eq(venuesTable.id, pitchesTable.venueId))
            .where(eq(pitchesTable.id, booking.pitchId)).limit(1);
          try {
            await confirmBookingAfterPayment({
              bookingId, actorUserId: req.user!.userId, providerPaymentId: existingPayment.providerPaymentId!,
              intent: { ...existingPayment, providerPaymentId: existingPayment.providerPaymentId! },
              pitchRow: freePitch ?? null, booking,
            });
          } catch (error) {
            if ((error as Error).message === "STREAK_REWARD_UNAVAILABLE") {
              await closeUnpaidCheckout(bookingId, existingPayment.id);
              res.status(409).json({ error: "This reward is no longer available. Please reserve again.", code: "CHECKOUT_EXPIRED" });
              return;
            }
            throw error;
          }
          res.json({ booking: { id: bookingId, status: "CONFIRMED" }, payment: formatPayment(existingPayment) });
        } else {
          // FAILED or other PENDING state — client must supply a fresh idempotency key to retry.
          res.status(409).json({
            error: `A payment with this idempotency key already exists with status: ${existingPayment.status}. Use a new idempotency key to retry.`,
            code: "PAYMENT_RETRY_KEY_REQUIRED",
          });
        }
        return;
      }

      if (booking.status === "CONFIRMED") {
        res.status(409).json({ error: "Booking is already confirmed" });
        return;
      }

      if (booking.status !== "PENDING") {
        res.status(400).json({ error: `Booking cannot be checked out in status: ${booking.status}`, code: "CHECKOUT_EXPIRED" });
        return;
      }
      // Claim before any incentive reservation. This prevents a losing concurrent
      // request from reserving a promotion/reward for the same booking.
      const [checkoutClaim] = await db.update(bookingsTable).set({ checkoutKey: effectiveKey, updatedAt: new Date() })
        .where(and(
          eq(bookingsTable.id, bookingId),
          eq(bookingsTable.status, "PENDING"),
          isNull(bookingsTable.checkoutKey),
        )).returning({ id: bookingsTable.id });
      if (!checkoutClaim) {
        res.status(409).json({ error: "Checkout is already in progress for this booking.", code: "CHECKOUT_IN_PROGRESS" });
        return;
      }
      releaseUnpricedCheckout = async () => {
        await db.transaction(async (tx) => {
          const [released] = await tx.update(bookingsTable).set({ checkoutKey: null }).where(and(
            eq(bookingsTable.id, bookingId),
            eq(bookingsTable.checkoutKey, effectiveKey),
            isNull(bookingsTable.pricingSnapshot),
          )).returning({ id: bookingsTable.id });
          if (released) await releaseGrowthReservation(tx, bookingId);
        });
      };

      const [pitchRow] = await db
        .select({
          id: pitchesTable.id,
          name: pitchesTable.name,
          slotDurationMinutes: pitchesTable.slotDurationMinutes,
          venueId: pitchesTable.venueId,
          venueName: venuesTable.name,
          venueOwnerId: venuesTable.ownerId,
        })
        .from(pitchesTable)
        .innerJoin(venuesTable, eq(pitchesTable.venueId, venuesTable.id))
        .where(eq(pitchesTable.id, booking.pitchId))
        .limit(1);

      if (!pitchRow) {
        await releaseUnpricedCheckout();
        res.status(404).json({ error: "Pitch not found" });
        return;
      }

      // Calculate subtotal from pricing rules
      const pricingRules = await db
        .select()
        .from(pricingRulesTable)
        .where(eq(pricingRulesTable.pitchId, booking.pitchId));

      const rule = pricingRules[0];
      const policyPricing = booking.policySnapshot as {
        pricePerHour?: string | number | null;
        slotDurationMinutes?: number;
      };
      const pricePerHour = policyPricing.pricePerHour ?? null;
      const subtotalNum =
        pricePerHour != null
          ? (parseFloat(String(pricePerHour)) * (policyPricing.slotDurationMinutes ?? pitchRow.slotDurationMinutes)) / 60
          : 0;
      const subtotal = subtotalNum.toFixed(2);

      // Reserve exactly one incentive while holding the booking row lock. The
      // unique booking redemption/reward constraints make concurrent checkout safe.
      let quote = booking.pricingSnapshot
        ? {
            currency: "EUR" as const,
            subtotal: booking.pricingSnapshot.subtotal,
            discountAmount: booking.pricingSnapshot.discountAmount,
            payableAmount: booking.pricingSnapshot.payableAmount,
            incentiveType: booking.pricingSnapshot.incentiveType,
            incentiveId: booking.pricingSnapshot.incentiveId,
          }
        : null;
      if (!quote) {
        try {
          quote = await db.transaction(async (tx) => {
            if (promoCode?.trim()) {
              return reservePromotion(tx, {
                bookingId, playerId: booking.playerId, venueId: booking.venueId,
                code: promoCode, subtotal,
              });
            }
            if (useStreakReward) {
              const reward = await reserveStreakReward(tx, {
                bookingId, playerId: booking.playerId, venueId: booking.venueId, subtotal,
              });
              if (reward) return reward;
            }
            return quoteFromDiscount(subtotal);
          }, { isolationLevel: "serializable" });
        } catch (incentiveError: any) {
          if (incentiveError?.code?.startsWith("PROMO_") || incentiveError?.code === "GROWTH_DISABLED" || incentiveError?.code === "REWARD_CONFLICT" ||
              incentiveError?.code === "23505" || incentiveError?.cause?.code === "23505") {
            await releaseUnpricedCheckout();
            res.status(409).json({ error: incentiveError.message, code: incentiveError.code ?? "INCENTIVE_CONFLICT" });
            return;
          }
          await releaseUnpricedCheckout();
          throw incentiveError;
        }
      }

      // Compute deposit amount from venue pricing rule config
      let depositAmountOverride: string | undefined;
      if (paymentType === "DEPOSIT") {
        if (!rule || rule.depositType === "NONE") {
          await releaseUnpricedCheckout();
          res.status(400).json({ error: "Deposit payments are not configured for this venue" });
          return;
        }
        if (rule.depositType === "FIXED" && rule.depositAmount) {
          depositAmountOverride = Math.min(
            parseFloat(rule.depositAmount),
            Number(quote.payableAmount),
          ).toFixed(2);
        } else if (rule.depositType === "PERCENT" && rule.depositAmount) {
          const pct = parseFloat(rule.depositAmount) / 100;
          depositAmountOverride = (Number(quote.payableAmount) * pct).toFixed(2);
        }
        if (!depositAmountOverride) {
          await releaseUnpricedCheckout();
          res.status(400).json({ error: "Invalid deposit configuration for this pitch" });
          return;
        }
      }

      // A fifth-free reward is always a full zero-cost booking; deposits are
      // meaningless and could otherwise accidentally create a positive charge.
      if (quote.payableAmount === "0.00" && paymentType === "DEPOSIT") {
        await releaseUnpricedCheckout();
        res.status(400).json({ error: "A free reward must be checked out as FULL" });
        return;
      }

      if (quote.payableAmount === "0.00") {
        const providerPaymentId = `free_${randomUUID()}`;
        try {
          await db.transaction(async (tx) => {
            await tx.insert(paymentsTable).values({
            bookingId, provider: "INTERNAL", providerPaymentId, amount: "0.00",
            feeAmount: "0.00", feePercent: "0.00", feeWaived: true,
            status: "PENDING", paymentType: "FULL", idempotencyKey: effectiveKey,
            metadata: { zeroCostReward: true },
          });
            const [snapshotted] = await tx.update(bookingsTable).set({
            pricingSnapshot: {
              ...quote!, feeAmount: "0.00", feePercent: "0.00", feeWaived: true,
              capturedAt: new Date().toISOString(),
            },
            }).where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.status, "PENDING"))).returning({
              id: bookingsTable.id,
            });
            if (!snapshotted) throw new Error("FREE_PAYMENT_SNAPSHOT_FAILED");
          });
        } catch (error) {
          await releaseUnpricedCheckout();
          throw error;
        }
        await confirmBookingAfterPayment({
          bookingId, actorUserId: req.user!.userId, providerPaymentId,
          intent: { providerPaymentId, amount: "0.00", feeAmount: "0.00", feePercent: "0.00", feeWaived: true, currency: "EUR" },
          pitchRow, booking: {
            ...booking,
            pricingSnapshot: { ...quote, feeAmount: "0.00", feePercent: "0.00", feeWaived: true },
          },
        });
        const [freePayment] = await db.select().from(paymentsTable)
          .where(eq(paymentsTable.providerPaymentId, providerPaymentId)).limit(1);
        res.json({ booking: { id: bookingId, status: "CONFIRMED" }, payment: freePayment ? formatPayment(freePayment) : null });
        return;
      }

      // Create payment intent (race-safe)
      let intent: Awaited<ReturnType<typeof paymentProvider.createPaymentIntent>>;
      try {
        intent = await paymentProvider.createPaymentIntent({
          bookingId,
          venueId: pitchRow.venueId,
          subtotalAmount: quote.payableAmount,
          paymentType,
          idempotencyKey: effectiveKey,
          depositAmountOverride,
          feePercentOverride: booking.pricingSnapshot?.feePercent,
          feeWaivedOverride: booking.pricingSnapshot?.feeWaived,
          bookingQuote: quote,
        });
      } catch (insertErr: unknown) {
        const pgCode =
          (insertErr as { cause?: { code?: string } })?.cause?.code ??
          (insertErr as { code?: string })?.code;
        if (pgCode === "23505") {
          const [racePayment] = await db
            .select()
            .from(paymentsTable)
            .where(
              and(
                eq(paymentsTable.idempotencyKey, effectiveKey),
                eq(paymentsTable.bookingId, bookingId),
              ),
            )
            .limit(1);
          if (racePayment?.status === "SUCCEEDED") {
            const [raceBooking] = await db
              .select()
              .from(bookingsTable)
              .where(
                and(
                  eq(bookingsTable.id, bookingId),
                  eq(bookingsTable.playerId, req.user!.userId),
                ),
              )
              .limit(1);
            res.json({
              alreadyProcessed: true,
              booking: raceBooking
                ? {
                    id: raceBooking.id,
                    status: raceBooking.status,
                    startAt: raceBooking.startAt.toISOString(),
                    endAt: raceBooking.endAt.toISOString(),
                  }
                : { id: bookingId, status: "CONFIRMED" },
              payment: racePayment ? formatPayment(racePayment) : null,
            });
          } else {
            res.status(409).json({
              error: racePayment
                ? `A payment with this idempotency key already exists with status: ${racePayment.status}. Use a new idempotency key to retry.`
                : "Concurrent payment conflict. Use a new idempotency key to retry.",
            });
          }
          return;
        }
        await releaseUnpricedCheckout();
        throw insertErr;
      }

      // The provider committed the payment and snapshot in one transaction.

      // ── Stripe mode: return clientSecret for client-side payment sheet ──
      if (intent.clientSecret) {
        const publishableKey = process.env.STRIPE_TEST_PK ?? null;
        res.status(202).json({
          requiresClientAction: true,
          clientSecret: intent.clientSecret,
          publishableKey,
          booking: { id: bookingId, status: "PENDING" },
          payment: {
            id: null,
            amount: intent.amount,
            feeAmount: intent.feeAmount,
            feePercent: intent.feePercent,
            feeWaived: intent.feeWaived,
            paymentType,
            currency: intent.currency,
            status: "PENDING",
            provider: "STRIPE",
          },
        });
        return;
      }

      // ── Mock mode: immediately confirm ──
      const confirmation = await paymentProvider.confirmPayment(intent.providerPaymentId);

      if (!confirmation.success) {
        if (!confirmation.terminal) {
          res.status(409).json({ error: confirmation.errorMessage ?? "Payment is still pending.", code: "PAYMENT_PENDING" });
          return;
        }
        const [failedPayment] = await db.select().from(paymentsTable)
          .where(eq(paymentsTable.providerPaymentId, intent.providerPaymentId)).limit(1);
        if (failedPayment) await closeUnpaidCheckout(bookingId, failedPayment.id);
        await db.transaction(async (tx) => {
          await tx
            .update(paymentsTable)
            .set({ status: "FAILED", updatedAt: new Date() })
            .where(eq(paymentsTable.providerPaymentId, intent.providerPaymentId));

          await tx.insert(auditLogTable).values({
            actorUserId: req.user!.userId,
            actorRole: "PLAYER",
            entityType: "PAYMENT",
            entityId: bookingId,
            action: "PAYMENT_FAILED",
            previousValue: { status: "PENDING" },
            newValue: { status: "FAILED" },
            notes: confirmation.errorMessage ?? null,
            metadata: { error: confirmation.errorMessage ?? "Unknown error" },
          });

          await logBookingAudit(tx, {
            bookingId,
            actorUserId: req.user!.userId,
            actorRole: "PLAYER",
            action: "PAYMENT_STATUS_CHANGED",
            previousValue: { paymentStatus: "PENDING" },
            newValue: { paymentStatus: "FAILED" },
            notes: confirmation.errorMessage ?? "Payment failed",
            metadata: { via: "checkout" },
          });
          await tx.update(bookingsTable).set({ checkoutKey: null }).where(eq(bookingsTable.id, bookingId));
        });

        res.status(402).json({ error: confirmation.errorMessage ?? "Payment failed", code: "CHECKOUT_EXPIRED" });
        return;
      }

      await confirmBookingAfterPayment({
        bookingId,
        actorUserId: req.user!.userId,
        providerPaymentId: intent.providerPaymentId,
        intent,
        pitchRow,
        booking: {
          ...booking,
          pricingSnapshot: {
            ...quote,
            feeAmount: intent.feeAmount,
            feePercent: intent.feePercent,
          },
        },
      });

      const [payment] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.providerPaymentId, intent.providerPaymentId))
        .limit(1);

      res.json({
        booking: { id: bookingId, status: "CONFIRMED" },
        payment: payment ? formatPayment(payment) : null,
      });
    } catch (err) {
      // Covers unexpected validation/query errors after the claim but before a
      // snapshot exists. The helper is a no-op once pricing is immutable.
      if (releaseUnpricedCheckout) {
        try {
          await releaseUnpricedCheckout();
        } catch (cleanupError) {
          req.log.error({ err: cleanupError }, "Unable to release unpriced checkout claim");
        }
      }
      console.error("POST /bookings/:bookingId/checkout error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── POST /bookings/:bookingId/capture ───────────────────────────────────────
// Called by the mobile app after the Stripe payment sheet succeeds.
// Verifies PaymentIntent status on Stripe's side, then confirms the booking.

router.post<{ bookingId: string }>(
  "/bookings/:bookingId/capture",
  requireAuth,
  requireRole("PLAYER"),
  async (req, res) => {
    try {
      const { bookingId } = req.params;

      // Verify booking belongs to this player
      const [booking] = await db
        .select()
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.id, bookingId),
            eq(bookingsTable.playerId, req.user!.userId),
          ),
        )
        .limit(1);

      if (!booking) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }

      if (booking.status === "CONFIRMED") {
        // Already confirmed (idempotent)
        res.json({ booking: { id: bookingId, status: "CONFIRMED" } });
        return;
      }

      if (booking.status !== "PENDING") {
        res.status(400).json({ error: `Booking cannot be captured in status: ${booking.status}` });
        return;
      }

      // Find the PENDING payment record for this booking
      const [payment] = await db
        .select()
        .from(paymentsTable)
        .where(
          and(
            eq(paymentsTable.bookingId, bookingId),
            eq(paymentsTable.status, "PENDING"),
          ),
        )
        .limit(1);

      if (!payment) {
        res.status(404).json({ error: "No pending payment found for this booking" });
        return;
      }

      // Verify the payment with the provider
      const confirmation = payment.provider === "INTERNAL"
        ? { success: true }
        : await paymentProvider.confirmPayment(payment.providerPaymentId!);

      if (!confirmation.success) {
        if (!confirmation.terminal) {
          res.status(409).json({ error: confirmation.errorMessage ?? "Payment is still pending.", code: "PAYMENT_PENDING" });
          return;
        }
        await closeUnpaidCheckout(bookingId, payment.id);
        // Mark payment failed
        await db.transaction(async (tx) => {
          await tx
            .update(paymentsTable)
            .set({ status: "FAILED", updatedAt: new Date() })
            .where(eq(paymentsTable.id, payment.id));

          await logBookingAudit(tx, {
            bookingId,
            actorUserId: req.user!.userId,
            actorRole: "PLAYER",
            action: "PAYMENT_STATUS_CHANGED",
            previousValue: { paymentStatus: "PENDING" },
            newValue: { paymentStatus: "FAILED" },
            notes: confirmation.errorMessage ?? "Payment verification failed",
            metadata: { via: "capture" },
          });
          await tx.update(bookingsTable).set({ checkoutKey: null }).where(eq(bookingsTable.id, bookingId));
        });

        res.status(402).json({ error: confirmation.errorMessage ?? "Payment verification failed", code: "CHECKOUT_EXPIRED" });
        return;
      }

      // Look up pitch info for notifications
      const [pitchRow] = await db
        .select({
          id: pitchesTable.id,
          name: pitchesTable.name,
          slotDurationMinutes: pitchesTable.slotDurationMinutes,
          venueId: pitchesTable.venueId,
          venueName: venuesTable.name,
          venueOwnerId: venuesTable.ownerId,
        })
        .from(pitchesTable)
        .innerJoin(venuesTable, eq(pitchesTable.venueId, venuesTable.id))
        .where(eq(pitchesTable.id, booking.pitchId))
        .limit(1);

      const intentForCapture = {
        providerPaymentId: payment.providerPaymentId!,
        amount: payment.amount,
        feeAmount: payment.feeAmount,
        feePercent: payment.feePercent,
        feeWaived: payment.feeWaived,
        currency: payment.currency,
      };

      await confirmBookingAfterPayment({
        bookingId,
        actorUserId: req.user!.userId,
        providerPaymentId: payment.providerPaymentId!,
        intent: intentForCapture,
        pitchRow: pitchRow ?? null,
        booking,
      });

      const [updatedPayment] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.id, payment.id))
        .limit(1);

      res.json({
        booking: { id: bookingId, status: "CONFIRMED" },
        payment: updatedPayment ? formatPayment(updatedPayment) : null,
      });
    } catch (err) {
      console.error("POST /bookings/:bookingId/capture error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── Shared helper: atomically confirm booking after payment success ───────────

async function confirmBookingAfterPayment(opts: {
  bookingId: string;
  actorUserId: string;
  providerPaymentId: string;
  intent: {
    providerPaymentId: string;
    amount: string;
    feeAmount: string;
    feePercent: string;
    feeWaived: boolean;
    currency: string;
  };
  pitchRow: {
    id: string;
    name: string;
    slotDurationMinutes: number;
    venueId: string;
    venueName: string;
    venueOwnerId: string;
  } | null;
  booking: {
    id: string;
    pitchId: string;
    startAt: Date;
    endAt: Date;
    playerId: string;
    venueId: string;
    pricingSnapshot?: any;
  };
}) {
  const { bookingId, actorUserId, providerPaymentId, intent, pitchRow, booking } = opts;

  let alreadyConfirmedConcurrently = false;

  await db.transaction(async (tx) => {
    const updatedBookings = await tx
      .update(bookingsTable)
      .set({ status: "CONFIRMED", updatedAt: new Date() })
      .where(
        and(
          eq(bookingsTable.id, bookingId),
          eq(bookingsTable.status, "PENDING"),
        ),
      )
      .returning();

    if (updatedBookings.length === 0) {
      const [currentBooking] = await tx
        .select({ status: bookingsTable.status })
        .from(bookingsTable)
        .where(eq(bookingsTable.id, bookingId))
        .limit(1);
      if (currentBooking?.status !== "CONFIRMED") {
        throw Object.assign(
          new Error(`Booking cannot be confirmed from ${currentBooking?.status ?? "missing"}`),
          { code: "BOOKING_NOT_CONFIRMABLE" },
        );
      }
      alreadyConfirmedConcurrently = true;
    }

    await tx
      .update(paymentsTable)
      .set({ status: "SUCCEEDED", updatedAt: new Date() })
      .where(eq(paymentsTable.providerPaymentId, providerPaymentId));

    await tx.insert(auditLogTable).values({
      actorUserId,
      actorRole: "PLAYER",
      entityType: "PAYMENT",
      entityId: bookingId,
      action: "PAYMENT_CREATED",
      previousValue: { status: "PENDING" },
      newValue: { status: "SUCCEEDED" },
      notes: null,
      metadata: {
        providerPaymentId: intent.providerPaymentId,
        amount: intent.amount,
        feeAmount: intent.feeAmount,
        feePercent: intent.feePercent,
        feeWaived: intent.feeWaived,
      },
    });

    await logBookingAudit(tx, {
      bookingId,
      actorUserId,
      actorRole: "PLAYER",
      action: "PAYMENT_STATUS_CHANGED",
      previousValue: { paymentStatus: "PENDING" },
      newValue: { paymentStatus: "SUCCEEDED" },
      notes: null,
      metadata: { via: "capture", amount: intent.amount },
    });

    if (!alreadyConfirmedConcurrently) {
      await finalizeGrowthIncentive(tx, updatedBookings[0]!);
      await logBookingAudit(tx, {
        bookingId,
        actorUserId,
        actorRole: "PLAYER",
        action: "BOOKING_STATUS_CHANGED",
        previousValue: { status: "PENDING" },
        newValue: { status: "CONFIRMED" },
        notes: null,
        metadata: { via: "capture" },
      });
    }

    await logBookingAudit(tx, {
      bookingId,
      actorUserId,
      actorRole: "PLAYER",
      action: alreadyConfirmedConcurrently ? "BOOKING_ALREADY_CONFIRMED" : "BOOKING_CONFIRMED",
      previousValue: alreadyConfirmedConcurrently ? null : { status: "PENDING" },
      newValue: alreadyConfirmedConcurrently ? null : { status: "CONFIRMED" },
      notes: alreadyConfirmedConcurrently ? "Concurrent checkout — booking already confirmed" : null,
      metadata: { via: "capture", concurrent: alreadyConfirmedConcurrently },
    });
  });

  if (!alreadyConfirmedConcurrently && pitchRow) {
    try { await reconcileSmsReminder(bookingId); }
    catch (error) { logger.error({ err: error, bookingId }, "Unable to reconcile confirmed booking SMS reminder"); }
    try {
      const [player] = await db
        .select({ id: usersTable.id, name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, actorUserId))
        .limit(1);

      await sendBookingConfirmedNotifications({
        bookingId,
        playerId: actorUserId,
        playerName: player?.name ?? "Player",
        ownerId: pitchRow.venueOwnerId,
        venueName: pitchRow.venueName,
        pitchName: pitchRow.name,
        startAt: booking.startAt,
      });
      logBookingAuditFireAndForget(db, {
        bookingId,
        actorUserId,
        actorRole: "PLAYER",
        action: "NOTIFICATION_SENT",
        notes: "Booking confirmed notifications dispatched to player and owner",
        metadata: { types: ["BOOKING_CONFIRMED", "NEW_BOOKING_OWNER"] },
      });
    } catch (notifErr) {
      console.warn("Notification dispatch failed (non-fatal):", notifErr);
    }
  }
}

// ─── GET /player/bookings/:id/payment ────────────────────────────────────────
// Fetch the payment record for a booking

router.get<{ bookingId: string }>(
  "/bookings/:bookingId/payment",
  requireAuth,
  requireRole("PLAYER"),
  async (req, res) => {
    try {
      const { bookingId } = req.params;

      const [booking] = await db
        .select({ id: bookingsTable.id, playerId: bookingsTable.playerId })
        .from(bookingsTable)
        .where(
          and(eq(bookingsTable.id, bookingId), eq(bookingsTable.playerId, req.user!.userId)),
        )
        .limit(1);

      if (!booking) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }

      const [payment] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.bookingId, bookingId))
        .limit(1);

      if (!payment) {
        res.status(404).json({ error: "No payment record for this booking" });
        return;
      }

      res.json({ payment: formatPayment(payment) });
    } catch (err) {
      console.error("GET /bookings/:bookingId/payment error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── PATCH /auth/push-token ───────────────────────────────────────────────────
// Store / update Expo push token for the authenticated user

router.patch("/auth/push-token", requireAuth, async (req, res) => {
  try {
    const { pushToken } = req.body as { pushToken?: string };

    if (!pushToken || typeof pushToken !== "string") {
      res.status(400).json({ error: "pushToken is required" });
      return;
    }

    await db
      .update(usersTable)
      .set({ pushToken, updatedAt: new Date() })
      .where(eq(usersTable.id, req.user!.userId));

    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /auth/push-token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /admin/settings ─────────────────────────────────────────────────────

router.get("/admin/settings", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  try {
    const settings = await getOrSeedAdminSettings();
    res.json({ settings });
  } catch (err) {
    console.error("GET /admin/settings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /admin/settings ───────────────────────────────────────────────────

router.patch("/admin/settings", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const { feeEnabled, feePercent } = req.body as {
      feeEnabled?: boolean;
      feePercent?: string;
    };

    const settings = await getOrSeedAdminSettings();

    const updates: Partial<typeof adminSettingsTable.$inferSelect> = {
      updatedAt: new Date(),
    };
    if (typeof feeEnabled === "boolean") updates.feeEnabled = feeEnabled;
    if (feePercent !== undefined) updates.feePercent = feePercent;

    const [updated] = await db
      .update(adminSettingsTable)
      .set(updates)
      .where(eq(adminSettingsTable.id, settings.id))
      .returning();

    res.json({ settings: updated });
  } catch (err) {
    console.error("PATCH /admin/settings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /admin/settings/venues/:venueId ───────────────────────────────────
// Set or clear per-venue fee override

router.patch<{ venueId: string }>(
  "/admin/settings/venues/:venueId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const { venueId } = req.params;
      const { feeEnabled } = req.body as { feeEnabled?: boolean | null };

      const settings = await getOrSeedAdminSettings();
      const overrides = { ...(settings.perVenueOverrides ?? {}) };

      if (feeEnabled === null || feeEnabled === undefined) {
        delete overrides[venueId];
      } else {
        overrides[venueId] = feeEnabled;
      }

      const [updated] = await db
        .update(adminSettingsTable)
        .set({ perVenueOverrides: overrides, updatedAt: new Date() })
        .where(eq(adminSettingsTable.id, settings.id))
        .returning();

      res.json({ settings: updated });
    } catch (err) {
      console.error("PATCH /admin/settings/venues/:venueId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── GET /checkout/fee ────────────────────────────────────────────────────────
// Preview: get current fee to display on checkout

router.get("/checkout/fee", requireAuth, async (req, res) => {
  try {
    const { venueId } = req.query as { venueId?: string };

    const settings = await getOrSeedAdminSettings();

    let feeEnabled = settings.feeEnabled;
    if (venueId) {
      const overrides = (settings.perVenueOverrides ?? {}) as Record<string, boolean>;
      if (Object.prototype.hasOwnProperty.call(overrides, venueId)) {
        feeEnabled = overrides[venueId];
      }
    }

    res.json({
      feeEnabled,
      feePercent: feeEnabled ? settings.feePercent : "0.00",
    });
  } catch (err) {
    console.error("GET /checkout/fee error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
