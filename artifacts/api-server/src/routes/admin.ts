import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  venuesTable,
  usersTable,
  pitchesTable,
  bookingsTable,
  paymentsTable,
  refundsTable,
  auditLogTable,
} from "@workspace/db/schema";
import { eq, inArray, and, gte, lte, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { paymentProvider } from "../lib/payment-provider";

const router: IRouter = Router();

// GET /admin/venues — list all venues (optionally filtered by status)
router.get("/admin/venues", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const { status } = req.query as { status?: string };

    const validStatuses = ["PENDING", "APPROVED", "REJECTED"];
    const statusFilter =
      status && validStatuses.includes(status)
        ? (status as "PENDING" | "APPROVED" | "REJECTED")
        : null;

    const venues = statusFilter
      ? await db.select().from(venuesTable).where(eq(venuesTable.status, statusFilter))
      : await db.select().from(venuesTable);

    // Enrich with owner names
    const ownerIds = [...new Set(venues.map((v) => v.ownerId))];
    const owners =
      ownerIds.length > 0
        ? await db
            .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
            .from(usersTable)
            .where(inArray(usersTable.id, ownerIds))
        : [];

    const ownerMap = new Map(owners.map((o) => [o.id, o]));

    res.json({
      venues: venues.map((v) => ({
        ...v,
        owner: ownerMap.get(v.ownerId) ?? null,
      })),
    });
  } catch (err) {
    console.error("GET /admin/venues error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/venues/:id — full venue detail for admin
router.get<{ id: string }>(
  "/admin/venues/:id",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const [venue] = await db
        .select()
        .from(venuesTable)
        .where(eq(venuesTable.id, id))
        .limit(1);

      if (!venue) {
        res.status(404).json({ error: "Venue not found" });
        return;
      }

      const [owner] = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, venue.ownerId))
        .limit(1);

      res.json({ venue: { ...venue, owner: owner ?? null } });
    } catch (err) {
      console.error("GET /admin/venues/:id error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PUT /admin/venues/:id/approve — approve a venue
router.put<{ id: string }>(
  "/admin/venues/:id/approve",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const [existing] = await db
        .select()
        .from(venuesTable)
        .where(eq(venuesTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Venue not found" });
        return;
      }

      const [updated] = await db
        .update(venuesTable)
        .set({ status: "APPROVED", rejectionReason: null, updatedAt: new Date() })
        .where(eq(venuesTable.id, id))
        .returning();

      res.json({ venue: updated });
    } catch (err) {
      console.error("PUT /admin/venues/:id/approve error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PUT /admin/venues/:id/reject — reject a venue with reason
router.put<{ id: string }>(
  "/admin/venues/:id/reject",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const [existing] = await db
        .select()
        .from(venuesTable)
        .where(eq(venuesTable.id, id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Venue not found" });
        return;
      }

      const { reason } = req.body as { reason?: string };

      const [updated] = await db
        .update(venuesTable)
        .set({
          status: "REJECTED",
          rejectionReason: reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(venuesTable.id, id))
        .returning();

      res.json({ venue: updated });
    } catch (err) {
      console.error("PUT /admin/venues/:id/reject error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── Admin Bookings ────────────────────────────────────────────────────────────

// GET /admin/bookings?from=&to=&status= — List all bookings across all venues (admin only)
router.get("/admin/bookings", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const { from, to, status } = req.query as { from?: string; to?: string; status?: string };

    const conditions: ReturnType<typeof eq>[] = [];
    if (status) conditions.push(eq(bookingsTable.status, status as never));
    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) conditions.push(gte(bookingsTable.startAt, fromDate) as never);
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) conditions.push(lte(bookingsTable.startAt, toDate) as never);
    }

    const rows = await db
      .select({
        booking: bookingsTable,
        player: { id: usersTable.id, name: usersTable.name, email: usersTable.email },
        venue: { id: venuesTable.id, name: venuesTable.name, district: venuesTable.district, address: venuesTable.address },
        pitch: {
          id: pitchesTable.id,
          name: pitchesTable.name,
          type: pitchesTable.type,
          size: pitchesTable.size,
          slotDurationMinutes: pitchesTable.slotDurationMinutes,
        },
      })
      .from(bookingsTable)
      .leftJoin(usersTable, eq(bookingsTable.playerId, usersTable.id))
      .leftJoin(pitchesTable, eq(bookingsTable.pitchId, pitchesTable.id))
      .leftJoin(venuesTable, eq(pitchesTable.venueId, venuesTable.id))
      .where(conditions.length > 0 ? and(...(conditions as Parameters<typeof and>)) : undefined)
      .orderBy(desc(bookingsTable.startAt));

    res.json({
      bookings: rows.map((r) => ({
        ...r.booking,
        startAt: r.booking.startAt.toISOString(),
        endAt: r.booking.endAt.toISOString(),
        createdAt: r.booking.createdAt.toISOString(),
        updatedAt: r.booking.updatedAt.toISOString(),
        player: r.player ?? { id: "", name: "Unknown", email: "" },
        venue: r.venue ?? { id: "", name: "Unknown", district: "", address: "" },
        pitch: r.pitch ?? { id: "", name: "Unknown", type: "OUTDOOR", size: "", slotDurationMinutes: 60 },
      })),
    });
  } catch (err) {
    console.error("GET /admin/bookings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/bookings/:id — Single booking detail for admin
router.get<{ id: string }>("/admin/bookings/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const bookingId = req.params.id;

    const [row] = await db
      .select({
        booking: bookingsTable,
        player: { id: usersTable.id, name: usersTable.name, email: usersTable.email },
        venue: { id: venuesTable.id, name: venuesTable.name, district: venuesTable.district, address: venuesTable.address },
        pitch: {
          id: pitchesTable.id,
          name: pitchesTable.name,
          type: pitchesTable.type,
          size: pitchesTable.size,
          slotDurationMinutes: pitchesTable.slotDurationMinutes,
        },
      })
      .from(bookingsTable)
      .leftJoin(usersTable, eq(bookingsTable.playerId, usersTable.id))
      .leftJoin(pitchesTable, eq(bookingsTable.pitchId, pitchesTable.id))
      .leftJoin(venuesTable, eq(pitchesTable.venueId, venuesTable.id))
      .where(eq(bookingsTable.id, bookingId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    res.json({
      booking: {
        ...row.booking,
        startAt: row.booking.startAt.toISOString(),
        endAt: row.booking.endAt.toISOString(),
        createdAt: row.booking.createdAt.toISOString(),
        updatedAt: row.booking.updatedAt.toISOString(),
        player: row.player ?? { id: "", name: "Unknown", email: "" },
        venue: row.venue ?? { id: "", name: "Unknown", district: "", address: "" },
        pitch: row.pitch ?? { id: "", name: "Unknown", type: "OUTDOOR", size: "", slotDurationMinutes: 60 },
      },
    });
  } catch (err) {
    console.error("GET /admin/bookings/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /admin/bookings/:id/refund — Force-refund any booking regardless of policy (admin only)
router.post<{ id: string }>(
  "/admin/bookings/:id/refund",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const bookingId = req.params.id;
      const { reason } = req.body as { reason?: string };

      // Fetch booking
      const [booking] = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.id, bookingId))
        .limit(1);

      if (!booking) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }

      if (booking.status === "REFUNDED" || booking.status === "CANCELLED") {
        res.status(400).json({
          error: `Booking is already ${booking.status.toLowerCase()}`,
        });
        return;
      }

      // Find succeeded payment
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

      // Call payment provider refund (outside tx — mock always succeeds)
      let refundId: string | null = null;
      if (payment) {
        const result = await paymentProvider.refundPayment({
          providerPaymentId: payment.providerPaymentId!,
          amount: payment.amount,
          reason: reason ?? "Admin force-refund",
        });
        if (!result.success) {
          res.status(502).json({ error: "Refund processing failed" });
          return;
        }
        refundId = result.refundId;
      }

      // Atomic transaction: cancel booking + refund record + audit log
      await db.transaction(async (tx) => {
        await tx
          .update(bookingsTable)
          .set({
            status: "CANCELLED",
            cancellationReason: reason ?? "Admin force-refund",
            updatedAt: new Date(),
          })
          .where(eq(bookingsTable.id, bookingId));

        if (payment) {
          await tx.insert(refundsTable).values({
            paymentId: payment.id,
            amount: payment.amount,
            status: "SUCCEEDED",
            reason: reason ?? "Admin force-refund",
            processedAt: new Date(),
          });

          await tx.insert(auditLogTable).values([
            {
              actorUserId: req.user!.userId,
              entityType: "BOOKING",
              entityId: bookingId,
              action: "BOOKING_CANCELLED",
              metadata: { reason: reason ?? "Admin force-refund", cancelledBy: "ADMIN" },
            },
            {
              actorUserId: req.user!.userId,
              entityType: "PAYMENT",
              entityId: payment.id,
              action: "ADMIN_REFUND_ISSUED",
              metadata: {
                refundId,
                amount: payment.amount,
                providerPaymentId: payment.providerPaymentId,
                adminId: req.user!.userId,
              },
            },
          ]);
        } else {
          await tx.insert(auditLogTable).values({
            actorUserId: req.user!.userId,
            entityType: "BOOKING",
            entityId: bookingId,
            action: "BOOKING_CANCELLED",
            metadata: {
              reason: reason ?? "Admin force-refund",
              cancelledBy: "ADMIN",
              noPayment: true,
            },
          });
        }
      });

      res.json({
        booking: {
          id: bookingId,
          status: "CANCELLED",
          cancellationReason: reason ?? "Admin force-refund",
        },
        refund: payment
          ? {
              refundId,
              amount: payment.amount,
              currency: payment.currency,
              status: "SUCCEEDED",
            }
          : null,
      });
    } catch (err) {
      console.error("POST /admin/bookings/:id/refund error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
