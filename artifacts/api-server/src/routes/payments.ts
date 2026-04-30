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
import { randomUUID } from "crypto";

const router: IRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrSeedAdminSettings() {
  const [existing] = await db.select().from(adminSettingsTable).limit(1);
  if (existing) return existing;

  const [seeded] = await db.insert(adminSettingsTable).values({}).returning();
  return seeded!;
}

// ─── POST /bookings/:bookingId/checkout ──────────────────────────────────────
// Creates a MockPaymentIntent, confirms it, moves booking → CONFIRMED.

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
        // An existing payment record for this booking + key exists.
        // Return a deterministic response regardless of status to avoid
        // hitting the DB unique constraint on a second insert attempt.
        if (existingPayment.status === "SUCCEEDED") {
          // Fetch booking with player ownership check to prevent cross-user data exposure
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
            payment: {
              id: existingPayment.id,
              amount: existingPayment.amount,
              feeAmount: existingPayment.feeAmount,
              feeWaived: existingPayment.feeWaived,
              paymentType: existingPayment.paymentType,
              currency: existingPayment.currency,
              status: existingPayment.status,
              provider: existingPayment.provider,
              createdAt: existingPayment.createdAt.toISOString(),
              updatedAt: existingPayment.updatedAt.toISOString(),
            },
          });
        } else {
          // FAILED or PENDING with this key — client must supply a fresh idempotency key to retry.
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

      // Calculate subtotal from pricing rules (or policy snapshot)
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

      // Compute deposit amount from venue pricing rule config (not a hardcoded %)
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

      // Create payment intent via MockPaymentProvider (race-safe)
      // If a concurrent request inserted the same idempotency key, the unique constraint
      // will fire. Catch it, re-read the winning payment, and return a deterministic response.
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
              payment: {
                id: racePayment.id,
                amount: racePayment.amount,
                feeAmount: racePayment.feeAmount,
                feeWaived: racePayment.feeWaived,
                paymentType: racePayment.paymentType,
                currency: racePayment.currency,
                status: racePayment.status,
                provider: racePayment.provider,
                createdAt: racePayment.createdAt.toISOString(),
                updatedAt: racePayment.updatedAt.toISOString(),
              },
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

      // Check if payment provider would accept this charge (mock: checks MOCK_PAYMENT_FAIL env)
      const confirmation = await paymentProvider.confirmPayment(intent.providerPaymentId);

      if (!confirmation.success) {
        // Mark payment FAILED + write audit log atomically
        await db.transaction(async (tx) => {
          await tx
            .update(paymentsTable)
            .set({ status: "FAILED", updatedAt: new Date() })
            .where(eq(paymentsTable.providerPaymentId, intent.providerPaymentId));

          await tx.insert(auditLogTable).values({
            actorUserId: req.user!.userId,
            entityType: "PAYMENT",
            entityId: bookingId,
            action: "PAYMENT_FAILED",
            metadata: { error: confirmation.errorMessage ?? "Unknown error" },
          });
        });

        res.status(402).json({ error: confirmation.errorMessage ?? "Payment failed" });
        return;
      }

      // Atomically: mark payment SUCCEEDED + conditionally confirm booking (PENDING → CONFIRMED)
      // The conditional WHERE on booking prevents double-charge when concurrent checkouts race.
      let alreadyConfirmedConcurrently = false;
      await db.transaction(async (tx) => {
        // Confirm booking only if still PENDING — returns 0 rows if concurrent request won
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
          // A concurrent checkout already confirmed this booking. Our payment intent was
          // created but the booking is confirmed — mark payment SUCCEEDED anyway for
          // consistency and signal to the caller to return alreadyProcessed.
          alreadyConfirmedConcurrently = true;
        }

        // Mark payment as SUCCEEDED (consistent with confirmation) inside the same transaction
        await tx
          .update(paymentsTable)
          .set({ status: "SUCCEEDED", updatedAt: new Date() })
          .where(eq(paymentsTable.providerPaymentId, intent.providerPaymentId));

        await tx.insert(auditLogTable).values([
          {
            actorUserId: req.user!.userId,
            entityType: "PAYMENT",
            entityId: bookingId,
            action: "PAYMENT_CREATED",
            metadata: {
              providerPaymentId: intent.providerPaymentId,
              amount: intent.amount,
              feeAmount: intent.feeAmount,
              feeWaived: intent.feeWaived,
            },
          },
          {
            actorUserId: req.user!.userId,
            entityType: "BOOKING",
            entityId: bookingId,
            action: alreadyConfirmedConcurrently ? "BOOKING_ALREADY_CONFIRMED" : "BOOKING_CONFIRMED",
            metadata: { via: "checkout", concurrent: alreadyConfirmedConcurrently },
          },
        ]);
      });

      // Send notifications — skip if concurrent checkout already confirmed + notified
      if (!alreadyConfirmedConcurrently) {
        try {
          const [player] = await db
            .select({ id: usersTable.id, name: usersTable.name })
            .from(usersTable)
            .where(eq(usersTable.id, req.user!.userId))
            .limit(1);

          await sendBookingConfirmedNotifications({
            bookingId,
            playerId: req.user!.userId,
            playerName: player?.name ?? "Player",
            ownerId: pitchRow.venueOwnerId,
            venueName: pitchRow.venueName,
            pitchName: pitchRow.name,
            startAt: booking.startAt,
          });
        } catch (notifErr) {
          console.warn("Notification dispatch failed (non-fatal):", notifErr);
        }
      }

      // Fetch updated payment record
      const [payment] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.providerPaymentId, intent.providerPaymentId))
        .limit(1);

      res.json({
        booking: { id: bookingId, status: "CONFIRMED" },
        payment: {
          id: payment!.id,
          amount: payment!.amount,
          feeAmount: payment!.feeAmount,
          feeWaived: payment!.feeWaived,
          paymentType: payment!.paymentType,
          currency: payment!.currency,
          status: payment!.status,
          provider: payment!.provider,
          createdAt: payment!.createdAt.toISOString(),
        },
      });
    } catch (err) {
      console.error("POST /bookings/:bookingId/checkout error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

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

      res.json({
        payment: {
          id: payment.id,
          amount: payment.amount,
          feeAmount: payment.feeAmount,
          feeWaived: payment.feeWaived,
          paymentType: payment.paymentType,
          currency: payment.currency,
          status: payment.status,
          provider: payment.provider,
          createdAt: payment.createdAt.toISOString(),
        },
      });
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
    const { feeEnabled, feeAmount } = req.body as {
      feeEnabled?: boolean;
      feeAmount?: string;
    };

    const settings = await getOrSeedAdminSettings();

    const updates: Partial<typeof adminSettingsTable.$inferSelect> = {
      updatedAt: new Date(),
    };
    if (typeof feeEnabled === "boolean") updates.feeEnabled = feeEnabled;
    if (feeAmount !== undefined) updates.feeAmount = feeAmount;

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

// ─── GET /admin/notifications ─────────────────────────────────────────────────
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
      feeAmount: feeEnabled ? settings.feeAmount : "0.00",
    });
  } catch (err) {
    console.error("GET /checkout/fee error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
