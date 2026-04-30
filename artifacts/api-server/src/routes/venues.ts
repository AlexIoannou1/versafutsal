import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import {
  venuesTable,
  pitchesTable,
  openingHoursTable,
  pricingRulesTable,
  venuePhotosTable,
  maintenanceBlocksTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getVenueWithDetails(venueId: string) {
  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.id, venueId))
    .limit(1);

  if (!venue) return null;

  const [photos, pitches, hours] = await Promise.all([
    db.select().from(venuePhotosTable).where(eq(venuePhotosTable.venueId, venueId)),
    db.select().from(pitchesTable).where(eq(pitchesTable.venueId, venueId)),
    db.select().from(openingHoursTable).where(eq(openingHoursTable.venueId, venueId)),
  ]);

  const pitchIds = pitches.map((p) => p.id);
  const [pricing, blocks] = await Promise.all([
    pitchIds.length > 0
      ? db.select().from(pricingRulesTable).where(inArray(pricingRulesTable.pitchId, pitchIds))
      : ([] as (typeof pricingRulesTable.$inferSelect)[]),
    pitchIds.length > 0
      ? db.select().from(maintenanceBlocksTable).where(inArray(maintenanceBlocksTable.pitchId, pitchIds))
      : ([] as (typeof maintenanceBlocksTable.$inferSelect)[]),
  ]);

  const pitchesWithPricing = pitches.map((p) => ({
    ...p,
    pricingRules: pricing.filter((r) => r.pitchId === p.id),
    maintenanceBlocks: blocks
      .filter((b) => b.pitchId === p.id)
      .map((b) => ({
        id: b.id,
        pitchId: b.pitchId,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        reason: b.reason,
      })),
  }));

  return { ...venue, photos, pitches: pitchesWithPricing, openingHours: hours };
}

function assertOwnsVenue(venueOwnerId: string, userId: string, res: Response): boolean {
  if (venueOwnerId !== userId) {
    res.status(403).json({ error: "Forbidden: you do not own this venue" });
    return false;
  }
  return true;
}

// ─── Public: Venue Discovery ──────────────────────────────────────────────────

// GET /venues — approved venues with optional filters
router.get("/venues", async (req, res) => {
  try {
    const { district, type, minPrice, maxPrice } = req.query as Record<string, string | undefined>;

    // Build subquery: get venue IDs that have pitches matching type filter
    let venueIdsWithType: string[] | null = null;
    if (type && ["INDOOR", "OUTDOOR", "HYBRID"].includes(type)) {
      const matchingPitches = await db
        .select({ venueId: pitchesTable.venueId })
        .from(pitchesTable)
        .where(eq(pitchesTable.type, type as "INDOOR" | "OUTDOOR" | "HYBRID"));
      venueIdsWithType = [...new Set(matchingPitches.map((p) => p.venueId))];
      if (venueIdsWithType.length === 0) {
        res.json({ venues: [] });
        return;
      }
    }

    // Build conditions for venue query
    const conditions: ReturnType<typeof eq>[] = [eq(venuesTable.status, "APPROVED")];
    if (district) conditions.push(eq(venuesTable.district, district));

    const approvedVenues = await db
      .select()
      .from(venuesTable)
      .where(and(...conditions));

    // Filter by type if needed
    const filteredVenues = venueIdsWithType
      ? approvedVenues.filter((v) => venueIdsWithType!.includes(v.id))
      : approvedVenues;

    if (filteredVenues.length === 0) {
      res.json({ venues: [] });
      return;
    }

    const venueIds = filteredVenues.map((v) => v.id);

    // Get photos (first photo per venue)
    const photos = await db
      .select()
      .from(venuePhotosTable)
      .where(inArray(venuePhotosTable.venueId, venueIds));

    // Get pitch types per venue + price ranges
    const pitchRows = await db
      .select({
        venueId: pitchesTable.venueId,
        type: pitchesTable.type,
      })
      .from(pitchesTable)
      .where(inArray(pitchesTable.venueId, venueIds));

    const priceRangeRows = await db
      .select({
        venueId: pitchesTable.venueId,
        minPrice: sql<string>`MIN(${pricingRulesTable.pricePerHour})`,
        maxPrice: sql<string>`MAX(${pricingRulesTable.pricePerHour})`,
      })
      .from(pitchesTable)
      .innerJoin(pricingRulesTable, eq(pricingRulesTable.pitchId, pitchesTable.id))
      .where(inArray(pitchesTable.venueId, venueIds))
      .groupBy(pitchesTable.venueId);

    const priceRangeMap = new Map(priceRangeRows.map((r) => [r.venueId, r]));
    const photoMap = new Map<string, string>();
    for (const photo of photos) {
      if (!photoMap.has(photo.venueId)) photoMap.set(photo.venueId, photo.url);
    }
    const pitchTypesMap = new Map<string, string[]>();
    for (const row of pitchRows) {
      const types = pitchTypesMap.get(row.venueId) ?? [];
      if (!types.includes(row.type)) types.push(row.type);
      pitchTypesMap.set(row.venueId, types);
    }

    // Apply price filters
    let venues = filteredVenues.map((v) => {
      const priceRange = priceRangeMap.get(v.id);
      return {
        ...v,
        coverPhoto: photoMap.get(v.id) ?? null,
        minPrice: priceRange?.minPrice ? parseFloat(priceRange.minPrice) : null,
        maxPrice: priceRange?.maxPrice ? parseFloat(priceRange.maxPrice) : null,
        pitchTypes: pitchTypesMap.get(v.id) ?? [],
      };
    });

    if (minPrice) {
      const min = parseFloat(minPrice);
      venues = venues.filter((v) => v.maxPrice !== null && v.maxPrice >= min);
    }
    if (maxPrice) {
      const max = parseFloat(maxPrice);
      venues = venues.filter((v) => v.minPrice !== null && v.minPrice <= max);
    }

    res.json({ venues });
  } catch (err) {
    console.error("GET /venues error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /venues/:id — public venue detail
router.get<{ id: string }>("/venues/:id", async (req, res) => {
  try {
    const venue = await getVenueWithDetails(req.params.id);
    if (!venue) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }
    if (venue.status !== "APPROVED") {
      res.status(404).json({ error: "Venue not found" });
      return;
    }
    res.json({ venue });
  } catch (err) {
    console.error("GET /venues/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Owner: Venue CRUD ────────────────────────────────────────────────────────

// GET /owner/venues — list owner's venues
router.get("/owner/venues", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const venues = await db
      .select()
      .from(venuesTable)
      .where(eq(venuesTable.ownerId, req.user!.userId));

    const venueIds = venues.map((v) => v.id);
    if (venueIds.length === 0) {
      res.json({ venues: [] });
      return;
    }

    const [photos, pitches] = await Promise.all([
      db.select().from(venuePhotosTable).where(inArray(venuePhotosTable.venueId, venueIds)),
      db.select().from(pitchesTable).where(inArray(pitchesTable.venueId, venueIds)),
    ]);

    const photoMap = new Map<string, string>();
    for (const p of photos) {
      if (!photoMap.has(p.venueId)) photoMap.set(p.venueId, p.url);
    }
    const pitchCountMap = new Map<string, number>();
    for (const p of pitches) {
      pitchCountMap.set(p.venueId, (pitchCountMap.get(p.venueId) ?? 0) + 1);
    }

    res.json({
      venues: venues.map((v) => ({
        ...v,
        coverPhoto: photoMap.get(v.id) ?? null,
        pitchCount: pitchCountMap.get(v.id) ?? 0,
      })),
    });
  } catch (err) {
    console.error("GET /owner/venues error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /owner/venues/:id — owner venue detail
router.get<{ id: string }>("/owner/venues/:id", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const venue = await getVenueWithDetails(req.params.id);
    if (!venue) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }
    if (!assertOwnsVenue(venue.ownerId, req.user!.userId, res)) return;
    res.json({ venue });
  } catch (err) {
    console.error("GET /owner/venues/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /owner/venues — create venue
router.post("/owner/venues", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const { name, district, address, description, amenities, cancellationWindowHours } =
      req.body as {
        name: string;
        district: string;
        address: string;
        description?: string;
        amenities?: string[];
        cancellationWindowHours?: number;
      };

    if (!name || !district || !address) {
      res.status(400).json({ error: "name, district, and address are required" });
      return;
    }

    const [venue] = await db
      .insert(venuesTable)
      .values({
        ownerId: req.user!.userId,
        name,
        district,
        address,
        description: description ?? null,
        amenities: amenities ?? [],
        cancellationWindowHours: cancellationWindowHours ?? 24,
        status: "PENDING",
      })
      .returning();

    res.status(201).json({ venue });
  } catch (err) {
    console.error("POST /owner/venues error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /owner/venues/:id — update venue
router.put<{ id: string }>("/owner/venues/:id", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
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
    if (!assertOwnsVenue(existing.ownerId, req.user!.userId, res)) return;

    const { name, district, address, description, amenities, cancellationWindowHours } =
      req.body as Partial<{
        name: string;
        district: string;
        address: string;
        description: string;
        amenities: string[];
        cancellationWindowHours: number;
      }>;

    const [updated] = await db
      .update(venuesTable)
      .set({
        ...(name !== undefined && { name }),
        ...(district !== undefined && { district }),
        ...(address !== undefined && { address }),
        ...(description !== undefined && { description }),
        ...(amenities !== undefined && { amenities }),
        ...(cancellationWindowHours !== undefined && { cancellationWindowHours }),
        updatedAt: new Date(),
      })
      .where(eq(venuesTable.id, req.params.id))
      .returning();

    res.json({ venue: updated });
  } catch (err) {
    console.error("PUT /owner/venues/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /owner/venues/:id — delete venue
router.delete<{ id: string }>("/owner/venues/:id", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
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
    if (!assertOwnsVenue(existing.ownerId, req.user!.userId, res)) return;

    await db.delete(venuesTable).where(eq(venuesTable.id, req.params.id));
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /owner/venues/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /owner/venues/:id/submit — submit venue for review
router.post<{ id: string }>(
  "/owner/venues/:id/submit",
  requireAuth,
  requireRole("VENUE_OWNER"),
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
      if (!assertOwnsVenue(existing.ownerId, req.user!.userId, res)) return;

      if (existing.status === "APPROVED") {
        res.status(400).json({ error: "Venue is already approved" });
        return;
      }

      // Check has at least one pitch
      const pitches = await db
        .select()
        .from(pitchesTable)
        .where(eq(pitchesTable.venueId, req.params.id));

      if (pitches.length === 0) {
        res.status(400).json({ error: "Add at least one pitch before submitting" });
        return;
      }

      const [updated] = await db
        .update(venuesTable)
        .set({ status: "PENDING", rejectionReason: null, updatedAt: new Date() })
        .where(eq(venuesTable.id, req.params.id))
        .returning();

      res.json({ venue: updated });
    } catch (err) {
      console.error("POST /owner/venues/:id/submit error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /owner/venues/:id/photos — add photo URL
router.post<{ id: string }>(
  "/owner/venues/:id/photos",
  requireAuth,
  requireRole("VENUE_OWNER"),
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
      if (!assertOwnsVenue(existing.ownerId, req.user!.userId, res)) return;

      const { url, sortOrder } = req.body as { url: string; sortOrder?: number };
      if (!url) {
        res.status(400).json({ error: "url is required" });
        return;
      }

      const [photo] = await db
        .insert(venuePhotosTable)
        .values({ venueId: req.params.id, url, sortOrder: sortOrder ?? 0 })
        .returning();

      res.status(201).json({ photo });
    } catch (err) {
      console.error("POST /owner/venues/:id/photos error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// DELETE /owner/venues/:venueId/photos/:photoId — remove photo
router.delete<{ venueId: string; photoId: string }>(
  "/owner/venues/:venueId/photos/:photoId",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const [existing] = await db
        .select()
        .from(venuesTable)
        .where(eq(venuesTable.id, req.params.venueId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Venue not found" });
        return;
      }
      if (!assertOwnsVenue(existing.ownerId, req.user!.userId, res)) return;

      await db
        .delete(venuePhotosTable)
        .where(
          and(
            eq(venuePhotosTable.id, req.params.photoId),
            eq(venuePhotosTable.venueId, req.params.venueId),
          ),
        );

      res.status(204).send();
    } catch (err) {
      console.error("DELETE /owner/venues/:id/photos/:photoId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── Owner: Pitch CRUD ────────────────────────────────────────────────────────

async function assertVenueOwner(venueId: string, userId: string, res: Response) {
  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.id, venueId))
    .limit(1);

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return null;
  }
  if (venue.ownerId !== userId) {
    res.status(403).json({ error: "Forbidden: you do not own this venue" });
    return null;
  }
  return venue;
}

// POST /owner/venues/:id/pitches
router.post<{ id: string }>(
  "/owner/venues/:id/pitches",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const venue = await assertVenueOwner(req.params.id, req.user!.userId, res);
      if (!venue) return;

      const { name, size, type, slotDurationMinutes } = req.body as {
        name: string;
        size: string;
        type?: "INDOOR" | "OUTDOOR" | "HYBRID";
        slotDurationMinutes?: number;
      };

      if (!name || !size) {
        res.status(400).json({ error: "name and size are required" });
        return;
      }

      const [pitch] = await db
        .insert(pitchesTable)
        .values({
          venueId: req.params.id,
          name,
          size,
          type: type ?? "INDOOR",
          slotDurationMinutes: slotDurationMinutes ?? 60,
        })
        .returning();

      res.status(201).json({ pitch });
    } catch (err) {
      console.error("POST /owner/venues/:id/pitches error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PUT /owner/venues/:id/pitches/:pitchId
router.put<{ id: string; pitchId: string }>(
  "/owner/venues/:id/pitches/:pitchId",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const venue = await assertVenueOwner(req.params.id, req.user!.userId, res);
      if (!venue) return;

      const { name, size, type, slotDurationMinutes } = req.body as Partial<{
        name: string;
        size: string;
        type: "INDOOR" | "OUTDOOR" | "HYBRID";
        slotDurationMinutes: number;
      }>;

      const [updated] = await db
        .update(pitchesTable)
        .set({
          ...(name !== undefined && { name }),
          ...(size !== undefined && { size }),
          ...(type !== undefined && { type }),
          ...(slotDurationMinutes !== undefined && { slotDurationMinutes }),
        })
        .where(
          and(
            eq(pitchesTable.id, req.params.pitchId),
            eq(pitchesTable.venueId, req.params.id),
          ),
        )
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Pitch not found" });
        return;
      }

      res.json({ pitch: updated });
    } catch (err) {
      console.error("PUT /owner/venues/:id/pitches/:pitchId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// DELETE /owner/venues/:id/pitches/:pitchId
router.delete<{ id: string; pitchId: string }>(
  "/owner/venues/:id/pitches/:pitchId",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const venue = await assertVenueOwner(req.params.id, req.user!.userId, res);
      if (!venue) return;

      await db
        .delete(pitchesTable)
        .where(
          and(
            eq(pitchesTable.id, req.params.pitchId),
            eq(pitchesTable.venueId, req.params.id),
          ),
        );

      res.status(204).send();
    } catch (err) {
      console.error("DELETE /owner/venues/:id/pitches/:pitchId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── Owner: Opening Hours ─────────────────────────────────────────────────────

// PUT /owner/venues/:id/opening-hours — replace all opening hours
router.put<{ id: string }>(
  "/owner/venues/:id/opening-hours",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const venue = await assertVenueOwner(req.params.id, req.user!.userId, res);
      if (!venue) return;

      const { hours } = req.body as {
        hours: Array<{
          dayOfWeek: number;
          openTime: string;
          closeTime: string;
          isClosed: boolean;
        }>;
      };

      if (!Array.isArray(hours)) {
        res.status(400).json({ error: "hours must be an array" });
        return;
      }

      // Replace all hours for this venue
      await db.delete(openingHoursTable).where(eq(openingHoursTable.venueId, req.params.id));

      if (hours.length > 0) {
        await db.insert(openingHoursTable).values(
          hours.map((h) => ({
            venueId: req.params.id,
            dayOfWeek: h.dayOfWeek,
            openTime: h.openTime,
            closeTime: h.closeTime,
            isClosed: h.isClosed ?? false,
          })),
        );
      }

      const updated = await db
        .select()
        .from(openingHoursTable)
        .where(eq(openingHoursTable.venueId, req.params.id));

      res.json({ openingHours: updated });
    } catch (err) {
      console.error("PUT /owner/venues/:id/opening-hours error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── Owner: Pricing Rules ──────────────────────────────────────────────────────

// PUT /owner/venues/:id/pitches/:pitchId/pricing — replace pricing rules
router.put<{ id: string; pitchId: string }>(
  "/owner/venues/:id/pitches/:pitchId/pricing",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const venue = await assertVenueOwner(req.params.id, req.user!.userId, res);
      if (!venue) return;

      // Verify the pitch actually belongs to this venue (IDOR prevention)
      const [pitch] = await db
        .select()
        .from(pitchesTable)
        .where(
          and(
            eq(pitchesTable.id, req.params.pitchId),
            eq(pitchesTable.venueId, req.params.id),
          ),
        )
        .limit(1);

      if (!pitch) {
        res.status(404).json({ error: "Pitch not found in this venue" });
        return;
      }

      const { rules } = req.body as {
        rules: Array<{
          dayType: "WEEKDAY" | "WEEKEND" | "ALL";
          pricePerHour: string;
          depositType: string;
          depositAmount?: string;
        }>;
      };

      if (!Array.isArray(rules)) {
        res.status(400).json({ error: "rules must be an array" });
        return;
      }

      await db
        .delete(pricingRulesTable)
        .where(eq(pricingRulesTable.pitchId, req.params.pitchId));

      if (rules.length > 0) {
        await db.insert(pricingRulesTable).values(
          rules.map((r) => ({
            pitchId: req.params.pitchId,
            dayType: r.dayType,
            pricePerHour: r.pricePerHour,
            depositType: r.depositType ?? "NONE",
            depositAmount: r.depositAmount ?? null,
          })),
        );
      }

      const updated = await db
        .select()
        .from(pricingRulesTable)
        .where(eq(pricingRulesTable.pitchId, req.params.pitchId));

      res.json({ pricingRules: updated });
    } catch (err) {
      console.error("PUT /owner/venues/:id/pitches/:pitchId/pricing error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
