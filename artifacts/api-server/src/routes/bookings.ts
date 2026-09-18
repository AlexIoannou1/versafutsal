import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import {
  bookingsTable,
  maintenanceBlocksTable,
  availabilityBlocksTable,
  venuesTable,
  pitchesTable,
  openingHoursTable,
  pricingRulesTable,
  usersTable,
  paymentsTable,
  refundsTable,
  auditLogTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, lt, gt, inArray, desc, ne, or, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  getOwnerEntitlements,
  planHasCapability,
  requireOwnerCapability,
} from "../lib/entitlements";
import { computeCollectedRevenue, computePremiumAnalytics } from "../lib/owner-analytics";
import { paymentProvider } from "../lib/payment-provider";
import { logBookingAuditFireAndForget, logBookingAudit } from "../lib/audit";
import { reconcileSmsReminder } from "../lib/sms-reminders";
import { canConfirmOfflinePayment, canUsePaymentProvider, bookingExportCsv, recognizesBookingRevenue, bookingSnapshotRevenue } from "../lib/manual-bookings";

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check whether a given UTC date string (YYYY-MM-DD) is blocked by any
 * availability_blocks rows covering that date (and optionally that pitch).
 * Returns matching block rows.
 */
async function getAvailabilityBlocksForDate(
  venueId: string,
  pitchId: string,
  date: string,
): Promise<(typeof availabilityBlocksTable.$inferSelect)[]> {
  const dateObj = new Date(`${date}T00:00:00.000Z`);
  const dayOfWeek = dateObj.getUTCDay();

  const blocks = await db
    .select()
    .from(availabilityBlocksTable)
    .where(
      and(
        eq(availabilityBlocksTable.venueId, venueId),
        or(
          isNull(availabilityBlocksTable.pitchId),
          eq(availabilityBlocksTable.pitchId, pitchId),
        ),
      ),
    );

  return blocks.filter((b) => {
    if (b.recursWeekly) {
      // Must match day-of-week AND fall within the configured date range
      return b.dayOfWeek === dayOfWeek && b.startDate <= date && b.endDate >= date;
    }
    return b.startDate <= date && b.endDate >= date;
  });
}

/**
 * Given a list of blocks for a specific date, determine whether a slot
 * (startAt/endAt as ISO strings, UTC) is blocked.
 */
function isSlotBlockedByAvailabilityBlock(
  slot: { startAt: string; endAt: string },
  blocks: (typeof availabilityBlocksTable.$inferSelect)[],
): boolean {
  for (const b of blocks) {
    if (!b.startTime || !b.endTime) {
      return true;
    }
    const datePrefix = slot.startAt.slice(0, 10);
    const blockStart = new Date(`${datePrefix}T${b.startTime}:00.000Z`).getTime();
    const blockEnd = new Date(`${datePrefix}T${b.endTime}:00.000Z`).getTime();
    const slotStart = new Date(slot.startAt).getTime();
    const slotEnd = new Date(slot.endAt).getTime();
    if (blockStart < slotEnd && blockEnd > slotStart) {
      return true;
    }
  }
  return false;
}

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
  player: { id: string; name: string; email: string; phoneNumber?: string | null };
};

function enrichBooking(row: BookingRow) {
  return {
    ...row.booking,
    startAt: row.booking.startAt.toISOString(),
    endAt: row.booking.endAt.toISOString(),
    createdAt: row.booking.createdAt.toISOString(),
    updatedAt: row.booking.updatedAt.toISOString(),
    offlinePaymentReceivedAt: row.booking.offlinePaymentReceivedAt?.toISOString() ?? null,
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

      const availabilityBlocks = await getAvailabilityBlocksForDate(venueId, pitchId, date);

      const slots = rawSlots.map((slot) => {
        const isBooked = bookedStartTimes.has(slot.startAt);
        const isLegacyBlocked = maintenanceBlocks.some((b) => {
          const bStart = b.startAt.getTime();
          const bEnd = b.endAt.getTime();
          const sStart = new Date(slot.startAt).getTime();
          const sEnd = new Date(slot.endAt).getTime();
          return bStart < sEnd && bEnd > sStart;
        });
        const isAvailabilityBlocked = isSlotBlockedByAvailabilityBlock(slot, availabilityBlocks);
        const isBlocked = isLegacyBlocked || isAvailabilityBlocked;
        const available = !isBooked && !isBlocked;
        return {
          startAt: slot.startAt,
          endAt: slot.endAt,
          available,
          ...(available ? {} : { reason: isBooked ? "booked" : "blocked" }),
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
    // All availability checks run inside the transaction so a block created
    // between the pre-check and the insert cannot slip through (TOCTOU fix).
    let booking: typeof bookingsTable.$inferSelect;
    let player: { id: string; name: string; email: string; phoneNumber?: string | null } | undefined;
    try {
      const result = await db.transaction(async (tx) => {
        // Check availability blocks (inside transaction to prevent race conditions)
        const avBlocks = await getAvailabilityBlocksForDate(pitchRow.venueId, pitchId, dateStr);
        if (
          avBlocks.length > 0 &&
          isSlotBlockedByAvailabilityBlock(
            { startAt: startDate.toISOString(), endAt: endDate.toISOString() },
            avBlocks,
          )
        ) {
          throw Object.assign(new Error("availability_blocked"), { _type: "availability_blocked" });
        }

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

        // Check for an existing active booking on this slot (PENDING or CONFIRMED).
        // This catches the common case early with a clear error; the partial unique
        // index on (pitch_id, start_at) WHERE status IN ('PENDING','CONFIRMED') acts
        // as the final safety net for true concurrent races.
        const conflictingBooking = await tx
          .select({ id: bookingsTable.id })
          .from(bookingsTable)
          .where(
            and(
              eq(bookingsTable.pitchId, pitchId),
              eq(bookingsTable.startAt, startDate),
              inArray(bookingsTable.status, ["PENDING", "CONFIRMED"]),
            ),
          )
          .limit(1);

        if (conflictingBooking.length > 0) {
          throw Object.assign(new Error("slot_taken"), { _type: "slot_taken" });
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
            source: "ONLINE",
            policySnapshot,
          })
          .returning();

        return inserted!;
      });

      booking = result;
      [player] = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, phoneNumber: usersTable.phoneNumber })
        .from(usersTable)
        .where(eq(usersTable.id, req.user!.userId))
        .limit(1);
    } catch (err: unknown) {
      // Availability block flagged inside transaction
      if ((err as { _type?: string })?._type === "availability_blocked") {
        res.status(409).json({ error: "This slot is not available. Please choose another time." });
        return;
      }
      // Maintenance conflict flagged inside transaction
      if ((err as { _type?: string })?._type === "maintenance_blocked") {
        res.status(409).json({ error: "This slot is blocked for maintenance. Please choose another time." });
        return;
      }
      // Active booking conflict detected by the SELECT check inside the transaction
      if ((err as { _type?: string })?._type === "slot_taken") {
        res.status(409).json({ error: "Slot no longer available. Please choose another time." });
        return;
      }
      // PostgreSQL partial unique index violation — true concurrent race where two
      // requests both passed the SELECT check before either committed.
      // Drizzle wraps the pg error: check both err.code and err.cause?.code
      const pgCode =
        (err as { code?: string })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === "23505") {
        res.status(409).json({ error: "Slot no longer available. Please choose another time." });
        return;
      }
      throw err;
    }

    // Fire-and-forget audit entry for booking creation
    logBookingAuditFireAndForget(db, {
      bookingId: booking.id,
      actorUserId: req.user!.userId,
      actorRole: "PLAYER",
      action: "BOOKING_CREATED",
      newValue: { status: "PENDING", pitchId, startAt: booking.startAt.toISOString() },
      metadata: { source: "ONLINE" },
    });

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
        player: player ?? { id: req.user!.userId, name: "", email: req.user!.email ?? "", phoneNumber: null },
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
          phoneNumber: usersTable.phoneNumber,
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
            phoneNumber: usersTable.phoneNumber,
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

// ─── Owner Manual Booking ─────────────────────────────────────────────────────

// POST /owner/bookings/manual — create a walk-in / phone booking (no payment)
router.post("/owner/bookings/manual", requireAuth, requireRole("VENUE_OWNER"), requireOwnerCapability("MANUAL_BOOKING"), async (req, res) => {
  try {
    const { pitchId, startAt, guestName, guestPhone } = req.body as {
      pitchId?: string;
      startAt?: string;
      guestName?: string;
      guestPhone?: string;
    };

    if (!pitchId || !startAt || !guestName?.trim() || !guestPhone?.trim()) {
      res.status(400).json({ error: "pitchId, startAt, guestName, and guestPhone are required" });
      return;
    }
    if (
      guestName.trim().length > 120 ||
      !/^\+[1-9][0-9]{7,14}$/.test(guestPhone.trim())
    ) {
      res.status(400).json({ error: "Guest details are invalid" });
      return;
    }

    const startDate = new Date(startAt);
    if (isNaN(startDate.getTime())) {
      res.status(400).json({ error: "startAt must be a valid ISO 8601 timestamp" });
      return;
    }
    if (startDate <= new Date()) {
      res.status(400).json({ error: "startAt must be in the future" });
      return;
    }

    // Verify this pitch belongs to one of the owner's venues
    const ownerCheck = await assertOwnerOfPitch(pitchId, req.user!.userId, res);
    if (!ownerCheck) return;
    const { venueId } = ownerCheck;

    // Load pitch + venue details
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

    // Validate startAt falls on a valid slot boundary
    const dateStr = startDate.toISOString().slice(0, 10);
    const dayOfWeek = startDate.getUTCDay();

    const [hoursRow] = await db
      .select()
      .from(openingHoursTable)
      .where(
        and(
          eq(openingHoursTable.venueId, venueId),
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
        error: "The selected time is not a valid slot for this pitch.",
      });
      return;
    }

    const endDate = new Date(startDate.getTime() + pitchRow.slotDurationMinutes * 60_000);

    // Atomic transaction: conflict check + insert as PENDING.
    // SERIALIZABLE isolation prevents the classic read-then-write race where two
    // concurrent requests both pass the conflict check before either commits.
    // PostgreSQL will abort one of them with error code 40001 (serialization_failure).
    let booking: typeof bookingsTable.$inferSelect;
    try {
      const result = await db.transaction(
        async (tx) => {
          const avBlocks = await getAvailabilityBlocksForDate(venueId, pitchId, dateStr);
          if (
            avBlocks.length > 0 &&
            isSlotBlockedByAvailabilityBlock(
              { startAt: startDate.toISOString(), endAt: endDate.toISOString() },
              avBlocks,
            )
          ) {
            throw Object.assign(new Error("availability_blocked"), { _type: "availability_blocked" });
          }

          // Maintenance block check
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

          // Active booking conflict check
          const conflictingBooking = await tx
            .select({ id: bookingsTable.id })
            .from(bookingsTable)
            .where(
              and(
                eq(bookingsTable.pitchId, pitchId),
                eq(bookingsTable.startAt, startDate),
                inArray(bookingsTable.status, ["PENDING", "CONFIRMED"]),
              ),
            )
            .limit(1);

          if (conflictingBooking.length > 0) {
            throw Object.assign(new Error("slot_taken"), { _type: "slot_taken" });
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
              source: "MANUAL",
              policySnapshot,
              guestName: guestName.trim(),
              guestPhone: guestPhone.trim(),
            })
            .returning();

          await logBookingAudit(tx, {
            bookingId: inserted!.id,
            actorUserId: req.user!.userId,
            actorRole: "VENUE_OWNER",
            action: "MANUAL_BOOKING_CREATED",
            newValue: {
              status: "PENDING",
              source: "MANUAL",
              pitchId,
              startAt: inserted!.startAt.toISOString(),
            },
            metadata: { source: "MANUAL" },
          });

          return inserted!;
        },
        { isolationLevel: "serializable" },
      );

      booking = result;
    } catch (err: unknown) {
      if ((err as { _type?: string })?._type === "maintenance_blocked") {
        res.status(409).json({ error: "This slot is blocked for maintenance. Please choose another time." });
        return;
      }
      if ((err as { _type?: string })?._type === "availability_blocked") {
        res.status(409).json({ error: "This slot is not available. Please choose another time." });
        return;
      }
      if ((err as { _type?: string })?._type === "slot_taken") {
        res.status(409).json({ error: "Slot no longer available. Please choose another time." });
        return;
      }
      const pgCode =
        (err as { code?: string })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;
      // 23505 = unique_violation, 40001 = serialization_failure (concurrent booking race)
      if (pgCode === "23505" || pgCode === "40001") {
        res.status(409).json({ error: "Slot no longer available. Please choose another time." });
        return;
      }
      throw err;
    }

    try {
      await reconcileSmsReminder(booking.id);
    } catch (error) {
      req.log.error({ err: error, event: "sms.reminder.reconcile_failed", bookingId: booking.id }, "SMS reminder reconciliation failed");
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
      },
    });
  } catch (err) {
    console.error("POST /owner/bookings/manual error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /owner/bookings/:id/confirm-offline-payment — owner records offline payment.
router.post<{ id: string }>(
  "/owner/bookings/:id/confirm-offline-payment",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const receivedAt = new Date();
      const updated = await db.transaction(async (tx) => {
        const [booking] = await tx
          .select({
            id: bookingsTable.id,
            venueId: bookingsTable.venueId,
            status: bookingsTable.status,
            source: bookingsTable.source,
            ownerId: venuesTable.ownerId,
          })
          .from(bookingsTable)
          .innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
          .where(eq(bookingsTable.id, req.params.id))
          .limit(1);

        if (!booking || booking.ownerId !== req.user!.userId) {
          throw Object.assign(new Error("not_found"), { _type: "not_found" });
        }
        if (!canConfirmOfflinePayment(booking.source, booking.status)) {
          throw Object.assign(new Error("invalid_transition"), {
            _type: "invalid_transition",
            status: booking.status,
            source: booking.source,
          });
        }

        const [confirmed] = await tx
          .update(bookingsTable)
          .set({
            status: "CONFIRMED",
            offlinePaymentReceivedAt: receivedAt,
            updatedAt: receivedAt,
          })
          .where(
            and(
              eq(bookingsTable.id, booking.id),
              eq(bookingsTable.source, "MANUAL"),
              eq(bookingsTable.status, "PENDING"),
            ),
          )
          .returning();
        if (!confirmed) {
          throw Object.assign(new Error("invalid_transition"), { _type: "invalid_transition" });
        }

        await logBookingAudit(tx, {
          bookingId: booking.id,
          actorUserId: req.user!.userId,
          actorRole: "VENUE_OWNER",
          action: "OFFLINE_PAYMENT_CONFIRMED",
          previousValue: { status: "PENDING", offlinePaymentReceived: false },
          newValue: { status: "CONFIRMED", offlinePaymentReceived: true },
          metadata: { source: "MANUAL" },
        });
        return confirmed;
      });

      res.json({
        booking: {
          ...updated,
          startAt: updated.startAt.toISOString(),
          endAt: updated.endAt.toISOString(),
          offlinePaymentReceivedAt: updated.offlinePaymentReceivedAt!.toISOString(),
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      });
    } catch (err) {
      if ((err as { _type?: string })?._type === "not_found") {
        res.status(404).json({ error: "Booking not found" });
        return;
      }
      if ((err as { _type?: string })?._type === "invalid_transition") {
        res.status(409).json({
          error: "Only pending manual bookings can have offline payment confirmed",
          code: "INVALID_BOOKING_TRANSITION",
        });
        return;
      }
      req.log.error({ err, bookingId: req.params.id }, "Confirm offline payment failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── Owner Stats ──────────────────────────────────────────────────────────────

// GET /owner/stats?from=&to= — aggregate booking & revenue analytics for the owner
router.get("/owner/stats", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const entitlements = await getOwnerEntitlements(req.user!.userId);
    const hasAdvancedAnalytics = planHasCapability(
      entitlements.effectivePlan,
      "ADVANCED_ANALYTICS",
    );
    const lockedAnalytics = {
      locked: true as const,
      requiredPlan: "PRO" as const,
      explanation: "Upgrade to Pro or Elite to access retention, repeat customer, cancellation trend, and revenue forecast metrics.",
    };
    const premiumAccess = {
      eligible: hasAdvancedAnalytics,
      effectivePlan: entitlements.effectivePlan,
      locked: !hasAdvancedAnalytics,
      requiredPlan: "PRO" as const,
      upgradeMessage: hasAdvancedAnalytics
        ? null
        : "Upgrade to Pro or Elite to access retention, repeat customer, cancellation trend, and revenue forecast metrics.",
    };

    const ownerVenues = await db
      .select({ id: venuesTable.id })
      .from(venuesTable)
      .where(eq(venuesTable.ownerId, req.user!.userId));

    const venueIds = ownerVenues.map((v) => v.id);

    const emptyStats = {
      totalBookings: 0,
      totalRevenue: 0,
      avgRevenue: 0,
      platformFees: 0,
      netRevenue: 0,
      byDay: [] as { date: string; count: number }[],
      byHour: [] as { hour: number; count: number }[],
      byDayOfWeek: [] as { day: number; count: number }[],
      byPitch: [] as { pitchId: string; pitchName: string; count: number; revenue: number }[],
      byStatus: [] as { status: string; count: number }[],
      effectivePlan: entitlements.effectivePlan,
      premiumAccess,
      premiumInsights: hasAdvancedAnalytics
        ? toPremiumInsights(computePremiumAnalytics([], []))
        : null,
      premiumAnalytics: hasAdvancedAnalytics
        ? { locked: false as const, metrics: computePremiumAnalytics([], []) }
        : lockedAnalytics,
    };

    if (venueIds.length === 0) {
      res.json(emptyStats);
      return;
    }

    const conditions: ReturnType<typeof eq | typeof inArray | typeof gte | typeof lte>[] = [
      inArray(bookingsTable.venueId, venueIds),
    ];
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) conditions.push(gte(bookingsTable.startAt, fromDate));
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) conditions.push(lte(bookingsTable.startAt, toDate));
    }

    const rows = await db
      .select({
        id: bookingsTable.id,
        startAt: bookingsTable.startAt,
        status: bookingsTable.status,
        playerId: bookingsTable.playerId,
        pitchId: bookingsTable.pitchId,
        policySnapshot: bookingsTable.policySnapshot,
        source: bookingsTable.source,
        offlinePaymentReceivedAt: bookingsTable.offlinePaymentReceivedAt,
        pitchName: pitchesTable.name,
      })
      .from(bookingsTable)
      .innerJoin(pitchesTable, eq(bookingsTable.pitchId, pitchesTable.id))
      .where(and(...conditions));

    if (rows.length === 0) {
      if (!hasAdvancedAnalytics) {
        res.json(emptyStats);
        return;
      }
      const historyRows = await db
        .select({
          id: bookingsTable.id,
          playerId: bookingsTable.playerId,
          guestPhone: bookingsTable.guestPhone,
          startAt: bookingsTable.startAt,
          status: bookingsTable.status,
        })
        .from(bookingsTable)
        .where(inArray(bookingsTable.venueId, venueIds));
      const metrics = await buildPremiumAnalytics(historyRows);
      res.json({
        ...emptyStats,
        premiumInsights: toPremiumInsights(metrics),
        premiumAnalytics: {
          locked: false,
          metrics,
        },
      });
      return;
    }

    // ── Financial revenue: persisted successful payments, less successful refunds ──
    const totalBookings = rows.length;
    const confirmedRows = rows.filter((r) =>
      recognizesBookingRevenue(r.source, r.status, r.offlinePaymentReceivedAt)
    );
    const bookingIds = rows.map((r) => r.id);
    const onlineBookingIds = rows.filter((r) => r.source === "ONLINE").map((r) => r.id);
    const paymentRows = bookingIds.length
      ? await db
          .select({
            id: paymentsTable.id,
            bookingId: paymentsTable.bookingId,
            amount: paymentsTable.amount,
            feeAmount: paymentsTable.feeAmount,
            status: paymentsTable.status,
          })
          .from(paymentsTable)
          .where(inArray(paymentsTable.bookingId, onlineBookingIds))
      : [];
    const paymentIds = paymentRows.map((payment) => payment.id);
    const successfulRefunds = paymentIds.length
      ? await db
          .select({ paymentId: refundsTable.paymentId, amount: refundsTable.amount })
          .from(refundsTable)
          .where(and(
            inArray(refundsTable.paymentId, paymentIds),
            eq(refundsTable.status, "SUCCEEDED"),
          ))
      : [];
    const refundedByPayment = new Map<string, number>();
    for (const refund of successfulRefunds) {
      refundedByPayment.set(
        refund.paymentId,
        (refundedByPayment.get(refund.paymentId) ?? 0) + (parseFloat(refund.amount) || 0),
      );
    }
    const financials = computeCollectedRevenue(paymentRows.map((payment) => ({
      bookingId: payment.bookingId,
      amount: parseFloat(payment.amount) || 0,
      feeAmount: parseFloat(payment.feeAmount) || 0,
      status: payment.status,
      refundedAmount: refundedByPayment.get(payment.id) ?? 0,
    })));
    const manualRevenueByBooking = new Map(
      rows
        .filter((row) => recognizesBookingRevenue(row.source, row.status, row.offlinePaymentReceivedAt))
        .filter((row) => row.source === "MANUAL")
        .map((row) => [row.id, bookingSnapshotRevenue(row.policySnapshot)]),
    );
    const manualRevenue = Array.from(manualRevenueByBooking.values()).reduce((sum, amount) => sum + amount, 0);
    const totalRevenue = financials.totalRevenue + manualRevenue;
    const { platformFees } = financials;
    const netRevenue = totalRevenue - platformFees;
    // Average remains per confirmed booking, so unpaid/manual confirmations are zero-valued.
    const avgRevenue = confirmedRows.length > 0 ? totalRevenue / confirmedRows.length : 0;

    // ── By day (YYYY-MM-DD) ──────────────────────────────────────────────────
    const dayMap = new Map<string, number>();
    for (const r of rows) {
      const date = r.startAt.toISOString().slice(0, 10);
      dayMap.set(date, (dayMap.get(date) ?? 0) + 1);
    }
    const byDay = Array.from(dayMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── By hour (0–23) ───────────────────────────────────────────────────────
    const hourMap = new Map<number, number>();
    for (const r of rows) {
      const hour = r.startAt.getUTCHours();
      hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1);
    }
    const byHour = Array.from(hourMap.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => b.count - a.count);

    // ── By day of week (0=Sun … 6=Sat) ──────────────────────────────────────
    const dowMap = new Map<number, number>();
    for (const r of rows) {
      const day = r.startAt.getUTCDay();
      dowMap.set(day, (dowMap.get(day) ?? 0) + 1);
    }
    const byDayOfWeek = Array.from(dowMap.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => b.count - a.count);

    // ── By pitch ──────────────────────────────────────────────────────────────
    const pitchMap = new Map<string, { pitchName: string; count: number; revenue: number }>();
    for (const r of rows) {
      const prev = pitchMap.get(r.pitchId) ?? { pitchName: r.pitchName, count: 0, revenue: 0 };
      pitchMap.set(r.pitchId, {
        pitchName: r.pitchName,
        count: prev.count + 1,
          revenue: prev.revenue + (financials.revenueByBooking.get(r.id) ?? manualRevenueByBooking.get(r.id) ?? 0),
      });
    }
    const byPitch = Array.from(pitchMap.entries())
      .map(([pitchId, v]) => ({ pitchId, ...v }))
      .sort((a, b) => b.count - a.count);

    // ── By status ────────────────────────────────────────────────────────────
    const statusMap = new Map<string, number>();
    for (const r of rows) {
      statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + 1);
    }
    const byStatus = Array.from(statusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    let premiumAnalytics:
      | typeof lockedAnalytics
      | { locked: false; metrics: ReturnType<typeof computePremiumAnalytics> } = lockedAnalytics;
    if (hasAdvancedAnalytics) {
      const historyRows = await db
        .select({
          id: bookingsTable.id,
          playerId: bookingsTable.playerId,
          guestPhone: bookingsTable.guestPhone,
          startAt: bookingsTable.startAt,
          status: bookingsTable.status,
        })
        .from(bookingsTable)
        .where(inArray(bookingsTable.venueId, venueIds));
      premiumAnalytics = {
        locked: false,
        metrics: await buildPremiumAnalytics(historyRows),
      };
    }
    const premiumInsights = premiumAnalytics.locked
      ? null
      : toPremiumInsights(premiumAnalytics.metrics);
    const bySource = (["ONLINE", "MANUAL"] as const).map((source) => {
      const sourceRows = rows.filter((row) => row.source === source);
      return {
        source,
        count: sourceRows.length,
        revenue: Math.round(
          sourceRows.reduce(
            (sum, row) => sum + (
              row.source === "MANUAL"
                ? manualRevenueByBooking.get(row.id) ?? 0
                : financials.revenueByBooking.get(row.id) ?? 0
            ),
            0,
          ) * 100,
        ) / 100,
      };
    });

    res.json({
      totalBookings,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgRevenue: Math.round(avgRevenue * 100) / 100,
      platformFees: Math.round(platformFees * 100) / 100,
      netRevenue: Math.round(netRevenue * 100) / 100,
      byDay,
      byHour,
      byDayOfWeek,
      byPitch,
      byStatus,
      bySource,
      effectivePlan: entitlements.effectivePlan,
      premiumAccess,
      premiumInsights,
      premiumAnalytics,
    });
  } catch (err) {
    req.log.error({ err, ownerId: req.user?.userId }, "GET /owner/stats failed");
    res.status(500).json({ error: "Internal server error" });
  }

  async function buildPremiumAnalytics(
    historyRows: {
      id: string;
      playerId: string;
      guestPhone: string | null;
      startAt: Date;
      status: string;
    }[],
  ) {
    const bookingIds = historyRows.map((row) => row.id);
    if (bookingIds.length === 0) return computePremiumAnalytics([], []);
    const historyPayments = await db
      .select({
        id: paymentsTable.id,
        bookingId: paymentsTable.bookingId,
        createdAt: paymentsTable.createdAt,
        amount: paymentsTable.amount,
        feeAmount: paymentsTable.feeAmount,
        status: paymentsTable.status,
      })
      .from(paymentsTable)
      .where(inArray(paymentsTable.bookingId, bookingIds));
    const paymentIds = historyPayments.map((payment) => payment.id);
    const successfulRefunds = paymentIds.length
      ? await db
          .select({
            paymentId: refundsTable.paymentId,
            amount: refundsTable.amount,
          })
          .from(refundsTable)
          .where(and(
            inArray(refundsTable.paymentId, paymentIds),
            eq(refundsTable.status, "SUCCEEDED"),
          ))
      : [];
    const refundedByPayment = new Map<string, number>();
    for (const refund of successfulRefunds) {
      refundedByPayment.set(
        refund.paymentId,
        (refundedByPayment.get(refund.paymentId) ?? 0) + (parseFloat(refund.amount) || 0),
      );
    }
    return computePremiumAnalytics(
      historyRows.map((row) => ({
        ...row,
        customerId: row.guestPhone
          ? `guest:${row.guestPhone.replace(/\s+/g, "")}`
          : `player:${row.playerId}`,
      })),
      historyPayments.map((payment) => ({
        ...payment,
        amount: parseFloat(payment.amount) || 0,
        feeAmount: parseFloat(payment.feeAmount) || 0,
        refundedAmount: refundedByPayment.get(payment.id) ?? 0,
      })),
    );
  }

  function toPremiumInsights(metrics: ReturnType<typeof computePremiumAnalytics>) {
    return {
      retentionRate: metrics.retention,
      repeatCustomerRate: metrics.repeatCustomers,
      cancellationTrend: metrics.cancellationTrend,
      revenueForecast: metrics.revenueForecast,
    };
  }
});

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
          phoneNumber: usersTable.phoneNumber,
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

// GET /owner/bookings/export.csv — privacy-safe source-aware owner report.
router.get("/owner/bookings/export.csv", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const { from, to, status } = req.query as { from?: string; to?: string; status?: string };
    const venues = await db.select({ id: venuesTable.id }).from(venuesTable)
      .where(eq(venuesTable.ownerId, req.user!.userId));
    if (!venues.length) {
      res.type("text/csv").attachment("bookings.csv").send(bookingExportCsv([]));
      return;
    }
    const conditions: ReturnType<typeof eq | typeof inArray | typeof gte | typeof lte>[] = [
      inArray(bookingsTable.venueId, venues.map((venue) => venue.id)),
    ];
    if (status && ["PENDING", "CONFIRMED", "CANCELLED", "REFUNDED", "NO_SHOW"].includes(status)) {
      conditions.push(eq(bookingsTable.status, status as typeof bookingsTable.$inferSelect["status"]));
    }
    if (from && !isNaN(new Date(from).getTime())) conditions.push(gte(bookingsTable.startAt, new Date(from)));
    if (to && !isNaN(new Date(to).getTime())) conditions.push(lte(bookingsTable.startAt, new Date(to)));
    const rows = await db.select({
      booking: bookingsTable, venueName: venuesTable.name, pitchName: pitchesTable.name,
    }).from(bookingsTable).innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
      .innerJoin(pitchesTable, eq(bookingsTable.pitchId, pitchesTable.id)).where(and(...conditions))
      .orderBy(desc(bookingsTable.startAt));
    const payments = rows.length ? await db.select({
      bookingId: paymentsTable.bookingId, feeAmount: paymentsTable.feeAmount, status: paymentsTable.status,
    }).from(paymentsTable).where(inArray(paymentsTable.bookingId, rows.map((row) => row.booking.id))) : [];
    const fees = new Map<string, number>();
    for (const payment of payments) if (payment.status === "SUCCEEDED" || payment.status === "PARTIALLY_REFUNDED") {
      fees.set(payment.bookingId, (fees.get(payment.bookingId) ?? 0) + (parseFloat(payment.feeAmount) || 0));
    }
    res.type("text/csv").attachment("bookings.csv").send(bookingExportCsv(rows.map((row) => ({
      ...row.booking, venueName: row.venueName, pitchName: row.pitchName, platformFee: fees.get(row.booking.id) ?? 0,
    }))));
  } catch (err) {
    req.log.error({ err }, "Owner booking export failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /owner/bookings/:id/audit — Fetch audit trail for a booking (owner must own the venue)
router.get<{ id: string }>(
  "/owner/bookings/:id/audit",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const bookingId = req.params.id;

      // Verify the booking belongs to one of the owner's venues
      const ownerVenues = await db
        .select({ id: venuesTable.id })
        .from(venuesTable)
        .where(eq(venuesTable.ownerId, req.user!.userId));

      const venueIds = ownerVenues.map((v) => v.id);
      if (venueIds.length === 0) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }

      const [bookingCheck] = await db
        .select({ id: bookingsTable.id })
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.id, bookingId),
            inArray(bookingsTable.venueId, venueIds),
          ),
        )
        .limit(1);

      if (!bookingCheck) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }

      const entries = await db
        .select({
          log: auditLogTable,
          actorName: usersTable.name,
        })
        .from(auditLogTable)
        .leftJoin(usersTable, eq(auditLogTable.actorUserId, usersTable.id))
        .where(
          and(
            or(
              eq(auditLogTable.entityType, "BOOKING"),
              eq(auditLogTable.entityType, "PAYMENT"),
            ),
            eq(auditLogTable.entityId, bookingId),
          ),
        )
        .orderBy(desc(auditLogTable.createdAt));

      res.json({
        entries: entries.map(({ log: e, actorName }) => ({
          id: e.id,
          action: e.action,
          metadata: e.metadata,
          createdAt: e.createdAt.toISOString(),
          actorUserId: e.actorUserId,
          actorRole: e.actorRole,
          actorName: actorName ?? null,
          previousValue: e.previousValue ?? null,
          newValue: e.newValue ?? null,
          notes: e.notes ?? null,
        })),
      });
    } catch (err) {
      console.error("GET /owner/bookings/:id/audit error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

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
            phoneNumber: usersTable.phoneNumber,
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

      // Include the payment record (if any) so the owner sees the price/fee breakdown
      const [payment] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.bookingId, row.booking.id))
        .limit(1);

      res.json({
        booking: {
          ...enrichBooking(row),
          payment: payment
            ? {
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
              }
            : null,
        },
      });
    } catch (err) {
      console.error("GET /owner/bookings/:id error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PUT /owner/bookings/:id — Owner edits an upcoming CONFIRMED/PENDING booking
router.put<{ id: string }>(
  "/owner/bookings/:id",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const bookingId = req.params.id;
      const { pitchId, startAt, guestName, guestPhone } = req.body as {
        pitchId?: string;
        startAt?: string;
        guestName?: string | null;
        guestPhone?: string | null;
      };

      if (!pitchId || !startAt) {
        res.status(400).json({ error: "pitchId and startAt are required" });
        return;
      }

      const newStartDate = new Date(startAt);
      if (isNaN(newStartDate.getTime())) {
        res.status(400).json({ error: "startAt must be a valid ISO 8601 timestamp" });
        return;
      }
      if (newStartDate <= new Date()) {
        res.status(400).json({ error: "Cannot reschedule a booking to a past or current time" });
        return;
      }

      // Verify the booking belongs to one of the owner's venues
      const ownerVenues = await db
        .select({ id: venuesTable.id })
        .from(venuesTable)
        .where(eq(venuesTable.ownerId, req.user!.userId));

      const ownerVenueIds = ownerVenues.map((v) => v.id);
      if (ownerVenueIds.length === 0) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }

      const [existingRow] = await db
        .select({ booking: bookingsTable })
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.id, bookingId),
            inArray(bookingsTable.venueId, ownerVenueIds),
          ),
        )
        .limit(1);

      if (!existingRow) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }

      const existing = existingRow.booking;

      if (existing.status !== "CONFIRMED" && existing.status !== "PENDING") {
        res.status(400).json({ error: "Only CONFIRMED or PENDING bookings can be edited" });
        return;
      }
      if (existing.startAt <= new Date()) {
        res.status(400).json({ error: "Cannot edit a booking that has already started or passed" });
        return;
      }

      // Verify new pitch belongs to one of the owner's venues
      const ownerCheck = await assertOwnerOfPitch(pitchId, req.user!.userId, res);
      if (!ownerCheck) return;
      const { venueId: newVenueId } = ownerCheck;

      // Load new pitch + venue details
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

      // Validate startAt falls on a valid slot boundary
      const dateStr = newStartDate.toISOString().slice(0, 10);
      const dayOfWeek = newStartDate.getUTCDay();

      const [hoursRow] = await db
        .select()
        .from(openingHoursTable)
        .where(
          and(
            eq(openingHoursTable.venueId, newVenueId),
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

      if (!validStartTimes.has(newStartDate.toISOString())) {
        res.status(400).json({ error: "The selected time is not a valid slot for this pitch." });
        return;
      }

      const newEndDate = new Date(newStartDate.getTime() + pitchRow.slotDurationMinutes * 60_000);

      // Atomic update: conflict check (excluding self) + update, serializable to prevent races
      let updated: typeof bookingsTable.$inferSelect;
      try {
        updated = await db.transaction(
          async (tx) => {
            // Maintenance block check
            const conflictingBlock = await tx
              .select({ id: maintenanceBlocksTable.id })
              .from(maintenanceBlocksTable)
              .where(
                and(
                  eq(maintenanceBlocksTable.pitchId, pitchId),
                  lt(maintenanceBlocksTable.startAt, newEndDate),
                  gt(maintenanceBlocksTable.endAt, newStartDate),
                ),
              )
              .limit(1);

            if (conflictingBlock.length > 0) {
              throw Object.assign(new Error("maintenance_blocked"), { _type: "maintenance_blocked" });
            }

            // Active booking conflict check (excluding the booking being edited)
            const conflictingBooking = await tx
              .select({ id: bookingsTable.id })
              .from(bookingsTable)
              .where(
                and(
                  eq(bookingsTable.pitchId, pitchId),
                  eq(bookingsTable.startAt, newStartDate),
                  inArray(bookingsTable.status, ["PENDING", "CONFIRMED"]),
                  ne(bookingsTable.id, bookingId),
                ),
              )
              .limit(1);

            if (conflictingBooking.length > 0) {
              throw Object.assign(new Error("slot_taken"), { _type: "slot_taken" });
            }

            const [result] = await tx
              .update(bookingsTable)
              .set({
                pitchId,
                venueId: newVenueId,
                startAt: newStartDate,
                endAt: newEndDate,
                ...(existing.source === "MANUAL"
                  ? {
                      guestName: guestName?.trim() ?? existing.guestName,
                      guestPhone: guestPhone?.trim() ?? existing.guestPhone,
                    }
                  : {}),
                updatedAt: new Date(),
              })
              .where(eq(bookingsTable.id, bookingId))
              .returning();

            const previousValue: Record<string, unknown> = {};
            const newValue: Record<string, unknown> = {};
            if (existing.pitchId !== result!.pitchId) {
              previousValue.pitchId = existing.pitchId;
              newValue.pitchId = result!.pitchId;
            }
            if (existing.startAt.toISOString() !== result!.startAt.toISOString()) {
              previousValue.startAt = existing.startAt.toISOString();
              newValue.startAt = result!.startAt.toISOString();
            }
            if (existing.guestName !== result!.guestName) newValue.guestNameChanged = true;
            if (existing.guestPhone !== result!.guestPhone) newValue.guestPhoneChanged = true;
            await logBookingAudit(tx, {
              bookingId: result!.id,
              actorUserId: req.user!.userId,
              actorRole: "VENUE_OWNER",
              action: "BOOKING_EDITED",
              previousValue: Object.keys(previousValue).length > 0 ? previousValue : null,
              newValue: Object.keys(newValue).length > 0 ? newValue : null,
              metadata: { source: result!.source },
            });

            return result!;
          },
          { isolationLevel: "serializable" },
        );
      } catch (err: unknown) {
        if ((err as { _type?: string })?._type === "maintenance_blocked") {
          res.status(409).json({ error: "This slot is blocked for maintenance. Please choose another time." });
          return;
        }
        if ((err as { _type?: string })?._type === "slot_taken") {
          res.status(409).json({ error: "Slot no longer available. Please choose another time." });
          return;
        }
        const pgCode =
          (err as { code?: string })?.code ??
          (err as { cause?: { code?: string } })?.cause?.code;
        if (pgCode === "23505" || pgCode === "40001") {
          res.status(409).json({ error: "Slot no longer available. Please choose another time." });
          return;
        }
        throw err;
      }

      // Reload the full enriched booking to return
      const [fullRow] = await db
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
            phoneNumber: usersTable.phoneNumber,
          },
        })
        .from(bookingsTable)
        .innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
        .innerJoin(pitchesTable, eq(bookingsTable.pitchId, pitchesTable.id))
        .innerJoin(usersTable, eq(bookingsTable.playerId, usersTable.id))
        .where(eq(bookingsTable.id, updated.id))
        .limit(1);

      // Write audit log entry for the edit — fire-and-forget
      const prevFields: Record<string, unknown> = {};
      const newFields: Record<string, unknown> = {};
      if (existing.pitchId !== updated.pitchId) {
        prevFields.pitchId = existing.pitchId;
        newFields.pitchId = updated.pitchId;
      }
      if (existing.startAt.toISOString() !== updated.startAt.toISOString()) {
        prevFields.startAt = existing.startAt.toISOString();
        newFields.startAt = updated.startAt.toISOString();
      }
      if (existing.guestName !== updated.guestName) {
        prevFields.guestName = existing.guestName;
        newFields.guestName = updated.guestName;
      }
      if (existing.guestPhone !== updated.guestPhone) {
        prevFields.guestPhone = existing.guestPhone;
        newFields.guestPhone = updated.guestPhone;
      }
      logBookingAuditFireAndForget(db, {
        bookingId: updated.id,
        actorUserId: req.user!.userId,
        actorRole: "VENUE_OWNER",
        action: "BOOKING_EDITED",
        previousValue: Object.keys(prevFields).length > 0 ? prevFields : null,
        newValue: Object.keys(newFields).length > 0 ? newFields : null,
        metadata: { actorEmail: req.user!.email },
      });

      try {
        await reconcileSmsReminder(updated.id);
      } catch (error) {
        req.log.error({ err: error, event: "sms.reminder.reconcile_failed", bookingId: updated.id }, "SMS reminder reconciliation failed");
      }

      res.json({ booking: enrichBooking(fullRow!) });
    } catch (err) {
      console.error("PUT /owner/bookings/:id error:", err);
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

      // Owners must provide a reason for regular bookings (audit quality).
      // Manual (walk-in) bookings are exempt — no payment was collected.
      const isManual = booking.source === "MANUAL";
      if (actorRole === "VENUE_OWNER" && !isManual && !reason?.trim()) {
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
      // Manual bookings (walk-in / phone) have no payment, so owners can cancel
      // them at any time without restriction.
      const snapshot = booking.policySnapshot as {
        cancellationWindowHours?: number;
      };
      const windowHours = snapshot?.cancellationWindowHours ?? 24;
      const hoursUntilStart =
        (booking.startAt.getTime() - Date.now()) / (1000 * 60 * 60);
      const withinWindow = hoursUntilStart >= windowHours;

      if (!withinWindow && !isManual) {
        // Both players and owners must cancel within the configurable window
        // (except manual bookings which have no payment to refund).
        // If an owner needs to cancel outside the window (e.g. emergency), admin
        // can use POST /admin/bookings/:id/refund to override.
        res.status(400).json({
          error: `Cancellation is only allowed up to ${windowHours} hours before the booking. The booking starts in ${hoursUntilStart.toFixed(1)} hours.`,
          code: "OUTSIDE_CANCELLATION_WINDOW",
        });
        return;
      }
      // Online bookings within the window may use the provider refund path.
      // Manual bookings are always settled and reversed outside the provider.
      const refundEligible = !isManual;

      // ── Find succeeded payment (if any) ───────────────────────────────────
      const [payment] = !canUsePaymentProvider(booking.source)
        ? []
        : await db
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

          // Audit: BOOKING_CANCELLED + BOOKING_STATUS_CHANGED + PAYMENT_STATUS_CHANGED + REFUND_ISSUED
          await logBookingAudit(tx, {
            bookingId,
            actorUserId: actorId,
            actorRole,
            action: "BOOKING_CANCELLED",
            previousValue: { status: booking.status },
            newValue: { status: "REFUNDED" },
            notes: reason ?? null,
            metadata: { cancelledBy: actorRole, refunded: true },
          });
          await logBookingAudit(tx, {
            bookingId,
            actorUserId: actorId,
            actorRole,
            action: "BOOKING_STATUS_CHANGED",
            previousValue: { status: booking.status },
            newValue: { status: "REFUNDED" },
            notes: reason ?? null,
            metadata: { cancelledBy: actorRole, via: "cancellation-with-refund" },
          });
          await logBookingAudit(tx, {
            bookingId,
            actorUserId: actorId,
            actorRole,
            action: "PAYMENT_STATUS_CHANGED",
            previousValue: { paymentStatus: "SUCCEEDED" },
            newValue: { paymentStatus: "REFUNDED" },
            notes: reason ?? null,
            metadata: { cancelledBy: actorRole },
          });
          await logBookingAudit(tx, {
            bookingId,
            actorUserId: actorId,
            actorRole,
            action: "REFUND_ISSUED",
            previousValue: { paymentStatus: "SUCCEEDED" },
            newValue: { paymentStatus: "REFUNDED", refundId, amount: payment.amount },
            notes: reason ?? null,
            metadata: { providerPaymentId: payment.providerPaymentId },
          });
        } else {
          // Cancelled without refund (either no payment, or outside window)
          await logBookingAudit(tx, {
            bookingId,
            actorUserId: actorId,
            actorRole,
            action: "BOOKING_CANCELLED",
            previousValue: { status: booking.status },
            newValue: { status: "CANCELLED" },
            notes: isManual ? null : reason ?? null,
            metadata: { cancelledBy: actorRole, refunded: false, source: booking.source },
          });
          await logBookingAudit(tx, {
            bookingId,
            actorUserId: actorId,
            actorRole,
            action: "BOOKING_STATUS_CHANGED",
            previousValue: { status: booking.status },
            newValue: { status: "CANCELLED" },
            notes: isManual ? null : reason ?? null,
            metadata: {
              cancelledBy: actorRole,
              noRefund: !payment || !refundEligible,
              outsideWindow: !withinWindow,
            },
          });
        }
      });

      try {
        await reconcileSmsReminder(bookingId);
      } catch (error) {
        req.log.error({ err: error, event: "sms.reminder.reconcile_failed", bookingId }, "SMS reminder reconciliation failed");
      }

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
