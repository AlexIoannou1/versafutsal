import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { venuesTable, usersTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

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
router.get("/admin/venues/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const [venue] = await db
      .select()
      .from(venuesTable)
      .where(eq(venuesTable.id, req.params.id))
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
});

// PUT /admin/venues/:id/approve — approve a venue
router.put(
  "/admin/venues/:id/approve",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const [existing] = await db
        .select()
        .from(venuesTable)
        .where(eq(venuesTable.id, req.params.id))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Venue not found" });
        return;
      }

      const [updated] = await db
        .update(venuesTable)
        .set({ status: "APPROVED", rejectionReason: null, updatedAt: new Date() })
        .where(eq(venuesTable.id, req.params.id))
        .returning();

      res.json({ venue: updated });
    } catch (err) {
      console.error("PUT /admin/venues/:id/approve error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PUT /admin/venues/:id/reject — reject a venue with reason
router.put(
  "/admin/venues/:id/reject",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const [existing] = await db
        .select()
        .from(venuesTable)
        .where(eq(venuesTable.id, req.params.id))
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
        .where(eq(venuesTable.id, req.params.id))
        .returning();

      res.json({ venue: updated });
    } catch (err) {
      console.error("PUT /admin/venues/:id/reject error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
