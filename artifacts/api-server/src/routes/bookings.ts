import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import {
  bookingsTable,
  maintenanceBlocksTable,
  venuesTable,
  pitchesTable,
  openingHoursTable,
  pricingRulesTable,
  usersTable,
  paymentsTable,
  refundsTable,
  auditLogTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, lt, gt, inArray, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { paymentProvider } from "../lib/payment-provider";

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateSlots(
  date: string,
  openTime: string,
  closeTime: string,
  slotDurationMinutes: number,
): { startAt: string; endAt: string }[] {
  const [openHour, openMin] = openTime.split(":").map(Number);
  const [closeHour, closeMin] = closeTime.split(":").map(Number);

  const slots: { startAt: string; endAt: string }[] = [];
  const current = new Date(`${date}T00:00:00.000Z`);
  current.setUTCHours(openHour!, openMin ?? 0, 0, 0);

  const end = new Date(`${date}T00:00:00.000Z`);
  end.setUTCHours(closeHour!, closeMin ?? 0, 0, 0);

  while (current.getTime() + slotDurationMinutes * 60_000 <= end.getTime()) {
    const slotStart = new Date(current.getTime());
    const slotEnd = new Date(current.getTime() + slotDurationMinutes * 60_000);
    slots.push({ startAt: slotStart.toISOString(), endAt: slotEnd.toISOString() });
    current.setTime(slotEnd.getTime());
  }

  return slots;
}

type BookingRow = {
  booking: typeof bookingsTable.$inferSelect;
  venue: { id: string; name: string; district: string; address: string };
  pitch: { id: string; name: string; type: string; size: string; slotDurationMinutes: number };
  player: { id: string; name: string; email: string };
};

function enrichBooking(row: BookingRow) {
  return {
    ...row.booking,
    startAt: row.booking.startAt.toISOString(),
    endAt: row.booking.endAt.toISOString(),
    createdAt: row.booking.createdAt.toISOString(),
    updatedAt: row.booking.updatedAt.toISOString(),
    venue: row.venue,
    pitch: row.pitch,
    player: row.player,
  };
}

async function assertOwnerOfPitch(
  pitchId: string,
  userId: string,
  res: Response,
): Promise<{ venueId: string } | null> {
  const [row] = await db
    .select({ venueId: venuesTable.id, ownerId: venuesTable.ownerId })
    .from(pitchesTable)
    .innerJoin(venuesTable, eq(pitchesTable.venueId, venuesTable.id))
    .where(eq(pitchesTable.id, pitchId))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Pitch not found" });
    return null;
  }
  if (row.ownerId !== userId) {
    res.status(403).json({ error: "Forbidden: you do not own this venue" });
    return null;
  }
  return { venueId: row.venueId };
}

// ─── Availability ─────────────────────────────────────────────────────────────

// GET /venues/:venueId/pitches/:pitchId/availability?date=YYYY-MM-DD
router.get<{ venueId: string; pitchId: string }>(
  "/venues/:venueId/pitches/:pitchId/availability",
  async (req, res) => {
    try {
      const { venueId, pitchId } = req.params;
      const { date } = req.query as { date?: string };

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
        return;
      }

      // Verify pitch belongs to this venue
      const [pitch] = await db
        .select()
        .from(pitchesTable)
        .where(and(eq(pitchesTable.id, pitchId), eq(pitchesTable.venueId, venueId)))
        .limit(1);

      if (!pitch) {
        res.status(404).json({ error: "Pitch not found" });
        return;
      }

      // Opening hours for that day of week
      const dateObj = new Date(`${date}T00:00:00.000Z`);
      const dayOfWeek = dateObj.getUTCDay();

      const [hours] = await db
        .select()
        .from(openingHoursTable)
        .where(
          and(
            eq(openingHoursTable.venueId, venueId),
            eq(openingHoursTable.dayOfWeek, dayOfWeek),
          ),
        )
        .limit(1);

      if (!hours || hours.isClosed) {
        res.json({ slots: [] });
        return;
      }

      const rawSlots = generateSlots(
        date,
        hours.openTime,
        hours.closeTime,
        pitch.slotDurationMinutes,
      );

      if (rawSlots.length === 0) {
        res.json({ slots: [] });
        return;
      }

      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const dayEnd = new Date(`${date}T23:59:59.999Z`);

      const existingBookings = await db
        .select({ startAt: bookingsTable.startAt })
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.pitchId, pitchId),
            inArray(bookingsTable.status, ["PENDING", "CONFIRMED"]),
            gte(bookingsTable.startAt, dayStart),
            lte(bookingsTable.startAt, dayEnd),
          ),
        );

      const bookedStartTimes = new Set(existingBookings.map((b) => b.startAt.toISOString()));

      const maintenanceBlocks = await db
        .select()
        .from(maintenanceBlocksTable)
        .where(
          and(
            eq(maintenanceBlocksTable.pitchId, pitchId),
            lte(maintenanceBlocksTable.startAt, dayEnd),
            gte(maintenanceBlocksTable.endAt, dayStart),
          ),
        );

      const slots = rawSlots.map((slot) => {
        const isBooked = bookedStartTimes.has(slot.startAt);
        const isBlocked = maintenanceBlocks.some((b) => {
          const bStart = b.startAt.getTime();
          const bEnd = b.endAt.getTime();
          const sStart = new Date(slot.startAt).getTime();
          const sEnd = new Date(slot.endAt).getTime();
          return bStart < sEnd && bEnd > sStart;
        });
        const available = !isBooked && !isBlocked;
        return {
          startAt: slot.startAt,
          endAt: slot.endAt,
          available,
          ...(available ? {} : { reason: isBooked ? "booked" : "maintenance" }),
        };
      });

      res.json({ slots });
    } catch (err) {
      console.error("GET /availability error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── Booking Creation ─────────────────────────────────────────────────────────

// POST /bookings (player only, concurrency-safe)
router.post("/bookings", requireAuth, requireRole("PLAYER"), async (req, res) => {
  try {
    const { pitchId, startAt } = req.body as { pitchId?: string; startAt?: string };

    if (!pitchId || !startAt) {
      res.status(400).json({ error: "pitchId and startAt are required" });
      return;
    }

    const startDate = new Date(startAt);
    if (isNaN(startDate.getTime())) {
      res.status(400).json({ error: "startAt must be a valid ISO 8601 timestamp" });
      return;
    }

    const [pitchRow] = await db
      .select({
        id: pitchesTable.id,
        venueId: pitchesTable.venueId,
        slotDurationMinutes: pitchesTable.slotDurationMinutes,
        name: pitchesTable.name,
        type: pitchesTable.type,
        size: pitchesTable.size,
        venueStatus: venuesTable.status,
        venueName: venuesTable.name,
        venueDistrict: venuesTable.district,
        venueAddress: venuesTable.address,
        venueCancellationWindowHours: venuesTable.cancellationWindowHours,
      })
      .from(pitchesTable)
      .innerJoin(venuesTable, eq(pitchesTable.venueId, venuesTable.id))
      .where(eq(pitchesTable.id, pitchId))
      .limit(1);

    if (!pitchRow) {
      res.status(404).json({ error: "Pitch not found" });
      return;
    }

    if (pitchRow.venueStatus !== "APPROVED") {
      res.status(400).json({ error: "Venue is not open for booking" });
      return;
    }

    // ── Server-side slot validation ──────────────────────────────────────────
    // Verify startAt falls exactly on a valid slot boundary for this pitch/date.
    const dateStr = startDate.toISOString().slice(0, 10); // YYYY-MM-DD
    const dayOfWeek = startDate.getUTCDay();

    const [hoursRow] = await db
      .select()
      .from(openingHoursTable)
      .where(
        and(
          eq(openingHoursTable.venueId, pitchRow.venueId),
          eq(openingHoursTable.dayOfWeek, dayOfWeek),
        ),
      )
      .limit(1);

    if (!hoursRow || hoursRow.isClosed) {
      res.status(400).json({ error: "The venue is closed on this day" });
      return;
    }

    const validSlots = generateSlots(dateStr, hoursRow.openTime, hoursRow.closeTime, pitchRow.slotDurationMinutes);
    const validStartTimes = new Set(validSlots.map((s) => s.startAt));

    if (!validStartTimes.has(startDate.toISOString())) {
      res.status(400).json({
        error: "The selected time is not a valid slot for this pitch. Please choose from the availability grid.",
      });
      return;
    }
    // ────────────────────────────────────────────────────────────────────────

    const endDate = new Date(startDate.getTime() + pitchRow.slotDurationMinutes * 60_000);

    // ── Atomic transaction: conflict check + policy snapshot + insert ─────────
    // Running these steps inside a transaction prevents a maintenance block
    // added between the check and the insert from being silently ignored.
    let booking: typeof bookingsTable.$inferSelect;
    let player: { id: string; name: string; email: string } | undefined;
    try {
      const result = await db.transaction(async (tx) => {
        // Check maintenance blocks (exclusive boundaries to avoid blocking adjacent slots)
        const conflictingBlock = await tx
          .select({ id: maintenanceBlocksTable.id })
          .from(maintenanceBlocksTable)
          .where(
            and(
              eq(maintenanceBlocksTable.pitchId, pitchId),
              lt(maintenanceBlocksTable.startAt, endDate),
              gt(maintenanceBlocksTable.endAt, startDate),
            ),
          )
          .limit(1);

        if (conflictingBlock.length > 0) {
          throw Object.assign(new Error("maintenance_blocked"), { _type: "maintenance_blocked" });
        }

        const pricingRules = await tx
          .select()
          .from(pricingRulesTable)
          .where(eq(pricingRulesTable.pitchId, pitchId));

        const policySnapshot = {
          pricePerHour: pricingRules[0]?.pricePerHour ?? null,
          cancellationWindowHours: pitchRow.venueCancellationWindowHours,
          slotDurationMinutes: pitchRow.slotDurationMinutes,
          capturedAt: new Date().toISOString(),
        };

        const [inserted] = await tx
          .insert(bookingsTable)
          .values({
            venueId: pitchRow.venueId,
            pitchId,
            playerId: req.user!.userId,
            startAt: startDate,
            endAt: endDate,
            status: "PENDING",
            policySnapshot,
          })
          .returning();

        return inserted!;
      });

      booking = result;
      [player] = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, req.user!.userId))
        .limit(1);
    } catch (err: unknown) {
      // Maintenance conflict flagged inside transaction
      if ((err as { _type?: string })?._type === "maintenance_blocked") {
        res.status(409).json({ error: "This slot is blocked for maintenance. Please choose another time." });
        return;
      }
      // PostgreSQL unique constraint violation = double-booking
      // Drizzle wraps the pg error: check both err.code and err.cause?.code
      const pgCode =
        (err as { code?: string })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === "23505") {
        res.status(409).json({ error: "This slot is no longer available. Please choose another time." });
        return;
      }
      throw err;
    }

    res.status(201).json({
      booking: {
        ...booking,
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
        createdAt: booking.createdAt.toISOString(),
        updatedAt: booking.updatedAt.toISOString(),
        venue: {
          id: pitchRow.venueId,
          name: pitchRow.venueName,
          district: pitchRow.venueDistrict,
          address: pitchRow.venueAddress,
        },
        pitch: {
          id: pitchRow.id,
          name: pitchRow.name,
          type: pitchRow.type,
          size: pitchRow.size,
          slotDurationMinutes: pitchRow.slotDurationMinutes,
        },
        player: player ?? { id: req.user!.userId, name: "", email: req.user!.email ?? "" },
      },
    });
  } catch (err) {
    console.error("POST /bookings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Player Bookings ─────────────────────────────────────────────────────────

// GET /player/bookings
router.get("/player/bookings", requireAuth, requireRole("PLAYER"), async (req, res) => {
  try {
    const { status } = req.query as { status?: string };

    const conditions: ReturnType<typeof eq>[] = [eq(bookingsTable.playerId, req.user!.userId)];
    if (status) {
      conditions.push(
        eq(
          bookingsTable.status,
          status as "PENDING" | "CONFIRMED" | "CANCELLED" | "REFUNDED" | "NO_SHOW",
        ),
      );
    }

    const rows = await db
      .select({
        booking: bookingsTable,
        venue: {
          id: venuesTable.id,
          name: venuesTable.name,
          district: venuesTable.district,
          address: venuesTable.address,
        },
        pitch: {
          id: pitchesTable.id,
          name: pitchesTable.name,
          type: pitchesTable.type,
          size: pitchesTable.size,
          slotDurationMinutes: pitchesTable.slotDurationMinutes,
        },
        player: {
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
        },
      })
      .from(bookingsTable)
      .innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
      .innerJoin(pitchesTable, eq(bookingsTable.pitchId, pitchesTable.id))
      .innerJoin(usersTable, eq(bookingsTable.playerId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(bookingsTable.startAt));

    res.json({ bookings: rows.map(enrichBooking) });
  } catch (err) {
    console.error("GET /player/bookings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /player/bookings/:id
router.get<{ id: string }>(
  "/player/bookings/:id",
  requireAuth,
  requireRole("PLAYER"),
  async (req, res) => {
    try {
      const [row] = await db
        .select({
          booking: bookingsTable,
          venue: {
            id: venuesTable.id,
            name: venuesTable.name,
            district: venuesTable.district,
            address: venuesTable.address,
          },
          pitch: {
            id: pitchesTable.id,
            name: pitchesTable.name,
            type: pitchesTable.type,
            size: pitchesTable.size,
            slotDurationMinutes: pitchesTable.slotDurationMinutes,
          },
          player: {
            id: usersTable.id,
            name: usersTable.name,
            email: usersTable.email,
          },
        })
        .from(bookingsTable)
        .innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
        .innerJoin(pitchesTable, eq(bookingsTable.pitchId, pitchesTable.id))
        .innerJoin(usersTable, eq(bookingsTable.playerId, usersTable.id))
        .where(
          and(
            eq(bookingsTable.id, req.params.id),
            eq(bookingsTable.playerId, req.user!.userId),
          ),
        )
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }

      res.json({ booking: enrichBooking(row) });
    } catch (err) {
      console.error("GET /player/bookings/:id error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── Owner Bookings ───────────────────────────────────────────────────────────

// GET /owner/bookings?status=&from=&to=&pitchId=
router.get("/owner/bookings", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const { status, from, to, pitchId } = req.query as {
      status?: string;
      from?: string;
      to?: string;
      pitchId?: string;
    };

    const ownerVenues = await db
      .select({ id: venuesTable.id })
      .from(venuesTable)
      .where(eq(venuesTable.ownerId, req.user!.userId));

    const venueIds = ownerVenues.map((v) => v.id);

    if (venueIds.length === 0) {
      res.json({ bookings: [] });
      return;
    }

    const conditions: ReturnType<typeof eq | typeof inArray | typeof gte | typeof lte>[] = [
      inArray(bookingsTable.venueId, venueIds),
    ];
    if (status) {
      conditions.push(
        eq(
          bookingsTable.status,
          status as "PENDING" | "CONFIRMED" | "CANCELLED" | "REFUNDED" | "NO_SHOW",
        ),
      );
    }
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) conditions.push(gte(bookingsTable.startAt, fromDate));
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) conditions.push(lte(bookingsTable.startAt, toDate));
    }
    if (pitchId) {
      conditions.push(eq(bookingsTable.pitchId, pitchId));
    }

    const rows = await db
      .select({
        booking: bookingsTable,
        venue: {
          id: venuesTable.id,
          name: venuesTable.name,
          district: venuesTable.district,
          address: venuesTable.address,
        },
        pitch: {
          id: pitchesTable.id,
          name: pitchesTable.name,
          type: pitchesTable.type,
          size: pitchesTable.size,
          slotDurationMinutes: pitchesTable.slotDurationMinutes,
        },
        player: {
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
        },
      })
      .from(bookingsTable)
      .innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
      .innerJoin(pitchesTable, eq(bookingsTable.pitchId, pitchesTable.id))
      .innerJoin(usersTable, eq(bookingsTable.playerId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(bookingsTable.startAt));

    res.json({ bookings: rows.map(enrichBooking) });
  } catch (err) {
    console.error("GET /owner/bookings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /owner/bookings/:id — single booking detail (owner must own the venue)
router.get<{ id: string }>(
  "/owner/bookings/:id",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const ownerVenues = await db
        .select({ id: venuesTable.id })
        .from(venuesTable)
        .where(eq(venuesTable.ownerId, req.user!.userId));

      const venueIds = ownerVenues.map((v) => v.id);

      if (venueIds.length === 0) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }

      const [row] = await db
        .select({
          booking: bookingsTable,
          venue: {
            id: venuesTable.id,
            name: venuesTable.name,
            district: venuesTable.district,
            address: venuesTable.address,
          },
          pitch: {
            id: pitchesTable.id,
            name: pitchesTable.name,
            type: pitchesTable.type,
            size: pitchesTable.size,
            slotDurationMinutes: pitchesTable.slotDurationMinutes,
          },
          player: {
            id: usersTable.id,
            name: usersTable.name,
            email: usersTable.email,
          },
        })
        .from(bookingsTable)
        .innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
        .innerJoin(pitchesTable, eq(bookingsTable.pitchId, pitchesTable.id))
        .innerJoin(usersTable, eq(bookingsTable.playerId, usersTable.id))
        .where(
          and(
            eq(bookingsTable.id, req.params.id),
            inArray(bookingsTable.venueId, venueIds),
          ),
        )
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }

      res.json({ booking: enrichBooking(row) });
    } catch (err) {
      console.error("GET /owner/bookings/:id error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── Cancellations ────────────────────────────────────────────────────────────

// POST /bookings/:id/cancel — Player (own booking) or VENUE_OWNER (their venue's booking)
router.post<{ id: string }>(
  "/bookings/:id/cancel",
  requireAuth,
  async (req, res) => {
    try {
      const bookingId = req.params.id;
      const { reason } = req.body as { reason?: string };
      const actorRole = req.user!.role;
      const actorId = req.user!.userId;

      // ── Fetch booking with venue owner info ───────────────────────────────
      const [row] = await db
        .select({
          booking: bookingsTable,
          venueOwnerId: venuesTable.ownerId,
          venueId: venuesTable.id,
        })
        .from(bookingsTable)
        .innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
        .where(eq(bookingsTable.id, bookingId))
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }

      const { booking, venueOwnerId } = row;

      // ── Authorization ─────────────────────────────────────────────────────
      if (actorRole === "PLAYER" && booking.playerId !== actorId) {
        res.status(403).json({ error: "You can only cancel your own bookings" });
        return;
      }
      if (actorRole === "VENUE_OWNER" && venueOwnerId !== actorId) {
        res.status(403).json({ error: "You can only cancel bookings at your venues" });
        return;
      }
      if (actorRole === "ADMIN") {
        res.status(403).json({ error: "Admins must use POST /admin/bookings/:id/refund" });
        return;
      }

      // Owners must provide a reason for audit quality (UI enforces this; API mirrors it)
      if (actorRole === "VENUE_OWNER" && !reason?.trim()) {
        res.status(400).json({ error: "A cancellation reason is required for owner-initiated cancellations." });
        return;
      }

      // ── Status check ──────────────────────────────────────────────────────
      // Players may only cancel CONFIRMED bookings (PENDING bookings have no payment).
      // Owners may cancel both CONFIRMED and PENDING bookings at their venue.
      const allowedStatuses =
        actorRole === "PLAYER" ? ["CONFIRMED"] : ["CONFIRMED", "PENDING"];
      if (!allowedStatuses.includes(booking.status)) {
        res.status(400).json({
          error:
            actorRole === "PLAYER"
              ? "Only confirmed bookings can be cancelled. Contact support for pending bookings."
              : `Cannot cancel a booking with status ${booking.status}`,
        });
        return;
      }

      // ── Policy check: enforce cancellation window for both players and owners ─
      const snapshot = booking.policySnapshot as {
        cancellationWindowHours?: number;
      };
      const windowHours = snapshot?.cancellationWindowHours ?? 24;
      const hoursUntilStart =
        (booking.startAt.getTime() - Date.now()) / (1000 * 60 * 60);
      const withinWindow = hoursUntilStart >= windowHours;

      if (!withinWindow) {
        // Both players and owners must cancel within the configurable window.
        // If an owner needs to cancel outside the window (e.g. emergency), admin
        // can use POST /admin/bookings/:id/refund to override.
        res.status(400).json({
          error: `Cancellation is only allowed up to ${windowHours} hours before the booking. The booking starts in ${hoursUntilStart.toFixed(1)} hours.`,
          code: "OUTSIDE_CANCELLATION_WINDOW",
        });
        return;
      }
      // Within window: refund is always issued if a payment exists
      const refundEligible = true;

      // ── Find succeeded payment (if any) ───────────────────────────────────
      const [payment] = await db
        .select()
        .from(paymentsTable)
        .where(
          and(
            eq(paymentsTable.bookingId, bookingId),
            eq(paymentsTable.status, "SUCCEEDED"),
          ),
        )
        .limit(1);

      // ── Call payment provider first (outside tx) ──────────────────────────
      // The mock provider always succeeds and does not write to DB, so calling
      // it before the transaction is safe for development. For a real provider,
      // use an idempotency key + outbox/compensation pattern to guard against
      // external-refund-success + DB-transaction-failure divergence.
      let refundId: string | null = null;
      if (payment && refundEligible) {
        const refundResult = await paymentProvider.refundPayment({
          providerPaymentId: payment.providerPaymentId!,
          amount: payment.amount,
          reason: reason,
        });
        if (!refundResult.success) {
          res.status(502).json({ error: "Refund processing failed. Please try again." });
          return;
        }
        refundId = refundResult.refundId;
      }

      // ── Atomic transaction: cancel booking + refund record + audit ─────────
      // Booking status: REFUNDED if a refund was issued, otherwise CANCELLED
      const finalStatus: "CANCELLED" | "REFUNDED" =
        payment && refundEligible ? "REFUNDED" : "CANCELLED";

      await db.transaction(async (tx) => {
        await tx
          .update(bookingsTable)
          .set({
            status: finalStatus,
            cancellationReason: reason ?? null,
            updatedAt: new Date(),
          })
          .where(eq(bookingsTable.id, bookingId));

        if (payment && refundEligible) {
          // Idempotency guard: update payment only if it is still SUCCEEDED.
          // Prevents double-refund under concurrent cancel requests.
          const [guardedPayment] = await tx
            .update(paymentsTable)
            .set({ status: "REFUNDED", updatedAt: new Date() })
            .where(and(eq(paymentsTable.id, payment.id), eq(paymentsTable.status, "SUCCEEDED")))
            .returning();
          if (!guardedPayment) {
            throw Object.assign(new Error("ALREADY_REFUNDED"), { code: "ALREADY_REFUNDED" });
          }

          // Insert refund record
          await tx.insert(refundsTable).values({
            paymentId: payment.id,
            amount: payment.amount,
            status: "SUCCEEDED",
            reason: reason ?? null,
            processedAt: new Date(),
          });

          // Audit: BOOKING_REFUNDED + REFUND_ISSUED
          await tx.insert(auditLogTable).values([
            {
              actorUserId: actorId,
              entityType: "BOOKING",
              entityId: bookingId,
              action: "BOOKING_REFUNDED",
              metadata: { reason: reason ?? null, cancelledBy: actorRole },
            },
            {
              actorUserId: actorId,
              entityType: "PAYMENT",
              entityId: payment.id,
              action: "REFUND_ISSUED",
              metadata: {
                refundId,
                amount: payment.amount,
                providerPaymentId: payment.providerPaymentId,
              },
            },
          ]);
        } else {
          // Cancelled without refund (either no payment, or outside window)
          await tx.insert(auditLogTable).values({
            actorUserId: actorId,
            entityType: "BOOKING",
            entityId: bookingId,
            action: "BOOKING_CANCELLED",
            metadata: {
              reason: reason ?? null,
              cancelledBy: actorRole,
              noRefund: !payment || !refundEligible,
              outsideWindow: !withinWindow,
            },
          });
        }
      });

      res.json({
        booking: {
          id: bookingId,
          status: finalStatus,
          cancellationReason: reason ?? null,
        },
        refund:
          payment && refundEligible
            ? {
                refundId,
                amount: payment.amount,
                currency: payment.currency,
                status: "SUCCEEDED",
              }
            : null,
        refundEligible,
        windowHours,
        hoursUntilStart: parseFloat(hoursUntilStart.toFixed(2)),
      });
    } catch (err) {
      if ((err as { code?: string }).code === "ALREADY_REFUNDED") {
        res.status(409).json({ error: "This booking was already refunded by a concurrent request." });
        return;
      }
      console.error("POST /bookings/:id/cancel error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── Maintenance Blocks ───────────────────────────────────────────────────────

// POST /owner/venues/:venueId/pitches/:pitchId/blocks
router.post<{ venueId: string; pitchId: string }>(
  "/owner/venues/:venueId/pitches/:pitchId/blocks",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const { venueId, pitchId } = req.params;

      const [venue] = await db
        .select({ ownerId: venuesTable.ownerId })
        .from(venuesTable)
        .where(eq(venuesTable.id, venueId))
        .limit(1);

      if (!venue) {
        res.status(404).json({ error: "Venue not found" });
        return;
      }
      if (venue.ownerId !== req.user!.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const [pitch] = await db
        .select({ id: pitchesTable.id })
        .from(pitchesTable)
        .where(and(eq(pitchesTable.id, pitchId), eq(pitchesTable.venueId, venueId)))
        .limit(1);

      if (!pitch) {
        res.status(404).json({ error: "Pitch not found in this venue" });
        return;
      }

      const { startAt, endAt, reason } = req.body as {
        startAt?: string;
        endAt?: string;
        reason?: string;
      };

      if (!startAt || !endAt) {
        res.status(400).json({ error: "startAt and endAt are required" });
        return;
      }

      const startDate = new Date(startAt);
      const endDate = new Date(endAt);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        res.status(400).json({ error: "Invalid startAt or endAt" });
        return;
      }
      if (endDate <= startDate) {
        res.status(400).json({ error: "endAt must be after startAt" });
        return;
      }

      const [block] = await db
        .insert(maintenanceBlocksTable)
        .values({
          pitchId,
          startAt: startDate,
          endAt: endDate,
          reason: reason ?? null,
        })
        .returning();

      res.status(201).json({
        block: {
          ...block!,
          startAt: block!.startAt.toISOString(),
          endAt: block!.endAt.toISOString(),
          createdAt: block!.createdAt.toISOString(),
        },
      });
    } catch (err) {
      console.error("POST /owner/.../blocks error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// DELETE /owner/venues/:venueId/pitches/:pitchId/blocks/:blockId
router.delete<{ venueId: string; pitchId: string; blockId: string }>(
  "/owner/venues/:venueId/pitches/:pitchId/blocks/:blockId",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const { venueId, pitchId, blockId } = req.params;

      // Verify venueId exists and belongs to this owner
      const [venue] = await db
        .select({ ownerId: venuesTable.ownerId })
        .from(venuesTable)
        .where(eq(venuesTable.id, venueId))
        .limit(1);

      if (!venue) {
        res.status(404).json({ error: "Venue not found" });
        return;
      }
      if (venue.ownerId !== req.user!.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      // Verify pitchId belongs to this venue (prevents IDOR across venues)
      const [pitch] = await db
        .select({ id: pitchesTable.id })
        .from(pitchesTable)
        .where(and(eq(pitchesTable.id, pitchId), eq(pitchesTable.venueId, venueId)))
        .limit(1);

      if (!pitch) {
        res.status(404).json({ error: "Pitch not found in this venue" });
        return;
      }

      await db
        .delete(maintenanceBlocksTable)
        .where(
          and(
            eq(maintenanceBlocksTable.id, blockId),
            eq(maintenanceBlocksTable.pitchId, pitchId),
          ),
        );

      res.status(204).send();
    } catch (err) {
      console.error("DELETE /owner/.../blocks/:blockId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
