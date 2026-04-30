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
} from "@workspace/db/schema";
import { eq, and, gte, lte, inArray, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

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

    const endDate = new Date(startDate.getTime() + pitchRow.slotDurationMinutes * 60_000);

    // Check maintenance blocks
    const conflictingBlock = await db
      .select({ id: maintenanceBlocksTable.id })
      .from(maintenanceBlocksTable)
      .where(
        and(
          eq(maintenanceBlocksTable.pitchId, pitchId),
          lte(maintenanceBlocksTable.startAt, endDate),
          gte(maintenanceBlocksTable.endAt, startDate),
        ),
      )
      .limit(1);

    if (conflictingBlock.length > 0) {
      res.status(409).json({
        error: "This slot is blocked for maintenance. Please choose another time.",
      });
      return;
    }

    const pricingRules = await db
      .select()
      .from(pricingRulesTable)
      .where(eq(pricingRulesTable.pitchId, pitchId));

    const policySnapshot = {
      pricePerHour: pricingRules[0]?.pricePerHour ?? null,
      cancellationWindowHours: pitchRow.venueCancellationWindowHours,
      slotDurationMinutes: pitchRow.slotDurationMinutes,
      capturedAt: new Date().toISOString(),
    };

    try {
      const [booking] = await db
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

      const [player] = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, req.user!.userId))
        .limit(1);

      res.status(201).json({
        booking: {
          ...booking!,
          startAt: booking!.startAt.toISOString(),
          endAt: booking!.endAt.toISOString(),
          createdAt: booking!.createdAt.toISOString(),
          updatedAt: booking!.updatedAt.toISOString(),
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
    } catch (err: unknown) {
      // PostgreSQL unique constraint violation = double-booking
      // Drizzle wraps the pg error: check both err.code and err.cause?.code
      const pgCode =
        (err as { code?: string })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === "23505") {
        res
          .status(409)
          .json({ error: "This slot is no longer available. Please choose another time." });
        return;
      }
      throw err;
    }
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

// GET /owner/bookings
router.get("/owner/bookings", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const { status } = req.query as { status?: string };

    const ownerVenues = await db
      .select({ id: venuesTable.id })
      .from(venuesTable)
      .where(eq(venuesTable.ownerId, req.user!.userId));

    const venueIds = ownerVenues.map((v) => v.id);

    if (venueIds.length === 0) {
      res.json({ bookings: [] });
      return;
    }

    const conditions: ReturnType<typeof eq | typeof inArray>[] = [
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
