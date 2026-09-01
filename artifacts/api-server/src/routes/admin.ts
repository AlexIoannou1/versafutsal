import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  venuesTable,
  usersTable,
  pitchesTable,
  venuePhotosTable,
  openingHoursTable,
  pricingRulesTable,
  bookingsTable,
  paymentsTable,
  refundsTable,
  auditLogTable,
} from "@workspace/db/schema";
import { eq, inArray, and, gte, lte, desc, ilike, or, isNull, ne, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { paymentProvider } from "../lib/payment-provider";
import { sendNotification } from "../lib/notifications";
import { logBookingAudit } from "../lib/audit";

const router: IRouter = Router();

/** Construct the public HTTPS URL for a stored photo key (same logic as venues.ts). */
function resolvePhotoUrl(key: string): string {
  if (key.startsWith("http://") || key.startsWith("https://")) return key;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!domain) return key;
  return `https://${domain}/api/uploads/${key}`;
}

// GET /admin/venues — list all venues (optionally filtered by status)
router.get("/admin/venues", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const { status } = req.query as { status?: string };

    const validStatuses = ["PENDING", "APPROVED", "REJECTED", "DISABLED"];
    const statusFilter =
      status && validStatuses.includes(status)
        ? (status as "PENDING" | "APPROVED" | "REJECTED" | "DISABLED")
        : null;

    const venues = statusFilter
      ? await db.select().from(venuesTable).where(eq(venuesTable.status, statusFilter))
      : await db.select().from(venuesTable);

    // Enrich with owner info (name, email, phone)
    const ownerIds = [...new Set(venues.map((v) => v.ownerId))];
    const owners =
      ownerIds.length > 0
        ? await db
            .select({
              id: usersTable.id,
              name: usersTable.name,
              email: usersTable.email,
              phoneNumber: usersTable.phoneNumber,
            })
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
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          phoneNumber: usersTable.phoneNumber,
          stripeConnected: sql<boolean>`${usersTable.stripeConnectAccountId} IS NOT NULL`,
        })
        .from(usersTable)
        .where(eq(usersTable.id, venue.ownerId))
        .limit(1);

      const rawPhotos = await db
        .select()
        .from(venuePhotosTable)
        .where(eq(venuePhotosTable.venueId, id))
        .orderBy(venuePhotosTable.sortOrder);
      const photos = rawPhotos.map((p) => ({ ...p, url: resolvePhotoUrl(p.url) }));

      const pitches = await db
        .select()
        .from(pitchesTable)
        .where(eq(pitchesTable.venueId, id));

      const openingHours = await db
        .select()
        .from(openingHoursTable)
        .where(eq(openingHoursTable.venueId, id))
        .orderBy(openingHoursTable.dayOfWeek);

      const pricingRules =
        pitches.length > 0
          ? await db
              .select()
              .from(pricingRulesTable)
              .where(
                inArray(
                  pricingRulesTable.pitchId,
                  pitches.map((p) => p.id),
                ),
              )
          : [];

      const rulesByPitch = new Map<string, typeof pricingRules>();
      for (const rule of pricingRules) {
        const existing = rulesByPitch.get(rule.pitchId) ?? [];
        existing.push(rule);
        rulesByPitch.set(rule.pitchId, existing);
      }

      const pitchesWithPricing = pitches.map((p) => ({
        ...p,
        pricingRules: rulesByPitch.get(p.id) ?? [],
        maintenanceBlocks: [],
      }));

      res.json({
        venue: {
          ...venue,
          owner: owner ?? null,
          photos,
          pitches: pitchesWithPricing,
          openingHours,
        },
      });
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

      // Only send notification when status actually transitions into APPROVED.
      // Re-approving an already-approved venue must not fire a duplicate notification.
      if (existing.status !== "APPROVED") {
        try {
          await sendNotification({
            userId: existing.ownerId,
            type: "VENUE_APPROVED",
            title: "Venue Approved!",
            body: `Your venue "${existing.name}" has been approved and is now live on FutsalCY.`,
            entityType: "VENUE",
            entityId: id,
          });
        } catch (notifErr) {
          console.warn("[notifications] venue approval notification failed (non-fatal):", notifErr);
        }
      }

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

// PUT /admin/venues/:id/disable — disable an approved venue with a required reason
router.put<{ id: string }>(
  "/admin/venues/:id/disable",
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
      if (!reason || !reason.trim()) {
        res.status(400).json({ error: "A reason is required to disable a venue." });
        return;
      }

      const [updated] = await db
        .update(venuesTable)
        .set({
          status: "DISABLED",
          disabledReason: reason.trim(),
          updatedAt: new Date(),
        })
        .where(eq(venuesTable.id, id))
        .returning();

      try {
        await sendNotification({
          userId: existing.ownerId,
          type: "VENUE_DISABLED",
          title: "Venue Disabled",
          body: `Your venue "${existing.name}" has been disabled by an administrator. Reason: ${reason.trim()}`,
          entityType: "VENUE",
          entityId: id,
        });
      } catch (notifErr) {
        console.warn("[notifications] venue disabled notification failed (non-fatal):", notifErr);
      }

      res.json({ venue: updated });
    } catch (err) {
      console.error("PUT /admin/venues/:id/disable error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── Admin Bookings ────────────────────────────────────────────────────────────

// GET /admin/bookings?from=&to=&status= — List all bookings across all venues (admin only)
router.get("/admin/bookings", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const { from, to, status } = req.query as { from?: string; to?: string; status?: string };

    const conditions = [];
    if (status) {
      const validStatuses = ["PENDING", "CONFIRMED", "CANCELLED", "REFUNDED", "NO_SHOW"] as const;
      if (validStatuses.includes(status as (typeof validStatuses)[number])) {
        conditions.push(eq(bookingsTable.status, status as (typeof validStatuses)[number]));
      }
    }
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
        booking: bookingsTable,
         player: { id: usersTable.id, name: usersTable.name, email: usersTable.email, phoneNumber: usersTable.phoneNumber },
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
         player: r.player ?? { id: "", name: "Unknown", email: "", phoneNumber: null },
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
         player: { id: usersTable.id, name: usersTable.name, email: usersTable.email, phoneNumber: usersTable.phoneNumber },
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
        player: row.player ?? { id: "", name: "Unknown", email: "", phoneNumber: null },
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

      // Only block if already fully refunded — CANCELLED bookings are refundable
      // by admin (e.g. owner cancelled outside window, no auto-refund was issued)
      if (booking.status === "REFUNDED") {
        res.status(400).json({ error: "Booking has already been refunded." });
        return;
      }

      // Find a payment that can still be refunded (SUCCEEDED = not yet refunded)
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

      // If there's no refundable payment, there's nothing to refund
      if (!payment) {
        res.status(400).json({
          error: "No refundable payment found for this booking. It may have no payment or was already refunded.",
        });
        return;
      }

      // Call payment provider refund (outside tx).
      // The mock provider always succeeds and does not write to DB, so calling it
      // before the transaction is safe for development. For a real provider, use
      // an idempotency key + outbox/compensation pattern.
      let refundId: string | null = null;
      // payment is guaranteed non-null at this point (we return early above if null)
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

      // Atomic transaction: update booking + payment + refund record + audit log
      await db.transaction(async (tx) => {
        // Admin force-refund always sets booking to REFUNDED
        await tx
          .update(bookingsTable)
          .set({
            status: "REFUNDED",
            cancellationReason: reason ?? "Admin force-refund",
            updatedAt: new Date(),
          })
          .where(eq(bookingsTable.id, bookingId));

        // Idempotency guard: update payment only if it is still SUCCEEDED.
        // If another concurrent request already refunded it, this returns 0 rows.
        const [guardedPayment] = await tx
          .update(paymentsTable)
          .set({ status: "REFUNDED", updatedAt: new Date() })
          .where(and(eq(paymentsTable.id, payment.id), eq(paymentsTable.status, "SUCCEEDED")))
          .returning();
        if (!guardedPayment) {
          throw Object.assign(new Error("ALREADY_REFUNDED"), { code: "ALREADY_REFUNDED" });
        }

        await tx.insert(refundsTable).values({
          paymentId: payment.id,
          amount: payment.amount,
          status: "SUCCEEDED",
          reason: reason ?? "Admin force-refund",
          processedAt: new Date(),
        });

        await logBookingAudit(tx, {
          bookingId,
          actorUserId: req.user!.userId,
          actorRole: "ADMIN",
          action: "ADMIN_MODIFIED_BOOKING",
          previousValue: { status: booking.status },
          newValue: { status: "REFUNDED" },
          notes: reason ?? "Admin force-refund",
          metadata: { modification: "force-refund" },
        });
        await logBookingAudit(tx, {
          bookingId,
          actorUserId: req.user!.userId,
          actorRole: "ADMIN",
          action: "BOOKING_STATUS_CHANGED",
          previousValue: { status: booking.status },
          newValue: { status: "REFUNDED" },
          notes: reason ?? "Admin force-refund",
          metadata: { cancelledBy: "ADMIN" },
        });
        await logBookingAudit(tx, {
          bookingId,
          actorUserId: req.user!.userId,
          actorRole: "ADMIN",
          action: "PAYMENT_STATUS_CHANGED",
          previousValue: { paymentStatus: "SUCCEEDED" },
          newValue: { paymentStatus: "REFUNDED" },
          notes: reason ?? "Admin force-refund",
          metadata: { cancelledBy: "ADMIN" },
        });
        await logBookingAudit(tx, {
          bookingId,
          actorUserId: req.user!.userId,
          actorRole: "ADMIN",
          action: "REFUND_ISSUED",
          previousValue: { paymentStatus: "SUCCEEDED" },
          newValue: { paymentStatus: "REFUNDED", refundId, amount: payment?.amount },
          notes: reason ?? null,
          metadata: { providerPaymentId: payment?.providerPaymentId, via: "admin-force-refund" },
        });
        await logBookingAudit(tx, {
          bookingId,
          actorUserId: req.user!.userId,
          actorRole: "ADMIN",
          action: "ADMIN_REFUND_ISSUED",
          previousValue: { paymentStatus: "SUCCEEDED" },
          newValue: { paymentStatus: "REFUNDED", refundId, amount: payment?.amount },
          notes: reason ?? null,
          metadata: { providerPaymentId: payment?.providerPaymentId },
        });
      });

      res.json({
        booking: {
          id: bookingId,
          status: "REFUNDED",
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
      if ((err as { code?: string }).code === "ALREADY_REFUNDED") {
        res.status(409).json({ error: "This payment was already refunded by a concurrent request." });
        return;
      }
      console.error("POST /admin/bookings/:id/refund error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// GET /admin/bookings/:id/audit — Full audit trail for a booking (admin only, no ownership check)
router.get<{ id: string }>(
  "/admin/bookings/:id/audit",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const bookingId = req.params.id;

      const [bookingCheck] = await db
        .select({ id: bookingsTable.id })
        .from(bookingsTable)
        .where(eq(bookingsTable.id, bookingId))
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
      console.error("GET /admin/bookings/:id/audit error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── Admin Users ──────────────────────────────────────────────────────────────

// GET /admin/users?search=&role=&page=&limit= — List all non-admin users (admin only)
router.get("/admin/users", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const { search, role, page: pageStr, limit: limitStr } = req.query as {
      search?: string;
      role?: string;
      page?: string;
      limit?: string;
    };

    const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? "50", 10) || 50));
    const offset = (page - 1) * limit;

    const conditions: ReturnType<typeof eq>[] = [];

    // Exclude ADMIN accounts
    conditions.push(ne(usersTable.role, "ADMIN"));

    // Role filter
    if (role === "PLAYER" || role === "VENUE_OWNER") {
      conditions.push(eq(usersTable.role, role));
    }

    // Build base query with all conditions
    const baseWhere = conditions.length > 0 ? and(...(conditions as Parameters<typeof and>)) : undefined;

    // Search filter applied after role/admin filters
    const searchTerm = search?.trim();
    const whereClause = searchTerm
      ? and(
          baseWhere,
          or(
            ilike(usersTable.name, `%${searchTerm}%`),
            ilike(usersTable.email, `%${searchTerm}%`),
            ilike(usersTable.phoneNumber, `%${searchTerm}%`),
          ),
        )
      : baseWhere;

    const rows = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        phoneNumber: usersTable.phoneNumber,
        role: usersTable.role,
        avatarUrl: usersTable.avatarUrl,
        createdAt: usersTable.createdAt,
        deletedAt: usersTable.deletedAt,
        stripeConnected: sql<boolean>`${usersTable.stripeConnectAccountId} IS NOT NULL`,
      })
      .from(usersTable)
      .where(whereClause)
      .orderBy(desc(usersTable.createdAt))
      .limit(limit)
      .offset(offset);

    // Total count for pagination
    const countRows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(whereClause);

    res.json({
      users: rows.map((u) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
        deletedAt: u.deletedAt ? u.deletedAt.toISOString() : null,
      })),
      total: countRows.length,
      page,
      limit,
    });
  } catch (err) {
    console.error("GET /admin/users error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
