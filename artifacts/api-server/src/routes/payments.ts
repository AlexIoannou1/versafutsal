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
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { paymentProvider } from "../lib/payment-provider";
import { sendBookingConfirmedNotifications } from "../lib/notifications";
import { logBookingAudit, logBookingAuditFireAndForget } from "../lib/audit";
import { randomUUID } from "crypto";
import type { Logger } from "pino";
import { reconcileSmsReminder } from "../lib/sms-reminders";

const router: IRouter = Router();

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
    try {
      const { bookingId } = req.params;
      const { paymentType = "FULL", idempotencyKey } = req.body as {
        paymentType?: "FULL" | "DEPOSIT";
        idempotencyKey?: string;
      };

      if (paymentType !== "FULL" && paymentType !== "DEPOSIT") {
        res.status(400).json({ error: "paymentType must be FULL or DEPOSIT" });
        return;
      }

      // Idempotency: if a payment already exists with this key and is SUCCEEDED, return 200
      const effectiveKey = idempotencyKey ?? `${bookingId}:${paymentType}:${req.user!.userId}`;

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

          if (alreadyBooking?.status === "CONFIRMED") {
            try {
              await reconcileSmsReminder(bookingId);
            } catch (error) {
              req.log.error({ err: error, event: "sms.reminder.reconcile_failed", bookingId }, "SMS reminder reconciliation failed");
            }
          }

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
          res.status(202).json({
            requiresClientAction: true,
            providerPaymentId: existingPayment.providerPaymentId,
            publishableKey,
            booking: { id: bookingId, status: "PENDING" },
            payment: formatPayment(existingPayment),
          });
        } else {
          // FAILED or other PENDING state — client must supply a fresh idempotency key to retry.
          res.status(409).json({
            error: `A payment with this idempotency key already exists with status: ${existingPayment.status}. Use a new idempotency key to retry.`,
          });
        }
        return;
      }

      // Fetch booking + pitch + venue
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
        res.status(409).json({ error: "Booking is already confirmed" });
        return;
      }

      if (booking.status !== "PENDING") {
        res.status(400).json({ error: `Booking cannot be checked out in status: ${booking.status}` });
        return;
      }

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
        res.status(404).json({ error: "Pitch not found" });
        return;
      }

      // Calculate subtotal from pricing rules
      const pricingRules = await db
        .select()
        .from(pricingRulesTable)
        .where(eq(pricingRulesTable.pitchId, booking.pitchId));

      const rule = pricingRules[0];
      const pricePerHour = rule?.pricePerHour ?? null;
      const subtotalNum =
        pricePerHour != null
          ? (parseFloat(pricePerHour) * pitchRow.slotDurationMinutes) / 60
          : 0;
      const subtotal = subtotalNum.toFixed(2);

      // Compute deposit amount from venue pricing rule config
      let depositAmountOverride: string | undefined;
      if (paymentType === "DEPOSIT") {
        if (!rule || rule.depositType === "NONE") {
          res.status(400).json({ error: "Deposit payments are not configured for this venue" });
          return;
        }
        if (rule.depositType === "FIXED" && rule.depositAmount) {
          depositAmountOverride = parseFloat(rule.depositAmount).toFixed(2);
        } else if (rule.depositType === "PERCENT" && rule.depositAmount) {
          const pct = parseFloat(rule.depositAmount) / 100;
          depositAmountOverride = (subtotalNum * pct).toFixed(2);
        }
        if (!depositAmountOverride) {
          res.status(400).json({ error: "Invalid deposit configuration for this pitch" });
          return;
        }
      }

      // Create payment intent (race-safe)
      let intent: Awaited<ReturnType<typeof paymentProvider.createPaymentIntent>>;
      try {
        intent = await paymentProvider.createPaymentIntent({
          bookingId,
          venueId: pitchRow.venueId,
          subtotalAmount: subtotal,
          paymentType,
          idempotencyKey: effectiveKey,
          depositAmountOverride,
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
        throw insertErr;
      }

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
        });

        res.status(402).json({ error: confirmation.errorMessage ?? "Payment failed" });
        return;
      }

      await confirmBookingAfterPayment({
        bookingId,
        actorUserId: req.user!.userId,
        providerPaymentId: intent.providerPaymentId,
        intent,
        pitchRow,
        booking,
        log: req.log,
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
        try {
          await reconcileSmsReminder(bookingId);
        } catch (error) {
          req.log.error({ err: error, event: "sms.reminder.reconcile_failed", bookingId }, "SMS reminder reconciliation failed");
        }
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
      const confirmation = await paymentProvider.confirmPayment(payment.providerPaymentId!);

      if (!confirmation.success) {
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
        });

        res.status(402).json({ error: confirmation.errorMessage ?? "Payment verification failed" });
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
        log: req.log,
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
  };
  log: Logger;
}) {
  const { bookingId, actorUserId, providerPaymentId, intent, pitchRow, booking, log } = opts;

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
      .returning({ id: bookingsTable.id });

    if (updatedBookings.length === 0) {
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

  if (!alreadyConfirmedConcurrently) {
    try {
      await reconcileSmsReminder(bookingId);
    } catch (error) {
      log.error({ err: error, event: "sms.reminder.reconcile_failed", bookingId }, "SMS reminder reconciliation failed");
    }
  }

  if (!alreadyConfirmedConcurrently && pitchRow) {
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
