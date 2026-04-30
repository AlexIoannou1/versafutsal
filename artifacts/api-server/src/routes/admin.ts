import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  venuesTable,
  usersTable,
  bookingsTable,
  paymentsTable,
  refundsTable,
  auditLogTable,
} from "@workspace/db/schema";
import { eq, inArray, and } from "drizzle-orm";
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
