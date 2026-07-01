import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  playerFavouritesTable,
  venuesTable,
  venuePhotosTable,
  pitchesTable,
  pricingRulesTable,
} from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

// All routes require auth + PLAYER role
router.use("/player/favourites", requireAuth, requireRole("PLAYER"));

// GET /player/favourites — list all favourited venues with summary info
router.get("/player/favourites", async (req, res) => {
  try {
    const playerId = req.user!.userId;

    const favouriteRows = await db
      .select({ venueId: playerFavouritesTable.venueId })
      .from(playerFavouritesTable)
      .where(eq(playerFavouritesTable.playerId, playerId));

    if (favouriteRows.length === 0) {
      res.json({ venues: [], favouriteVenueIds: [] });
      return;
    }

    const venueIds = favouriteRows.map((r) => r.venueId);

    const [venues, photos, pitchRows, priceRangeRows] = await Promise.all([
      db
        .select()
        .from(venuesTable)
        .where(and(inArray(venuesTable.id, venueIds), eq(venuesTable.status, "APPROVED"))),
      db.select().from(venuePhotosTable).where(inArray(venuePhotosTable.venueId, venueIds)),
      db
        .select({ venueId: pitchesTable.venueId, type: pitchesTable.type })
        .from(pitchesTable)
        .where(inArray(pitchesTable.venueId, venueIds)),
      db
        .select({
          venueId: pitchesTable.venueId,
          minPrice: sql<string>`MIN(${pricingRulesTable.pricePerHour})`,
          maxPrice: sql<string>`MAX(${pricingRulesTable.pricePerHour})`,
        })
        .from(pitchesTable)
        .innerJoin(pricingRulesTable, eq(pricingRulesTable.pitchId, pitchesTable.id))
        .where(inArray(pitchesTable.venueId, venueIds))
        .groupBy(pitchesTable.venueId),
    ]);

    const photoMap = new Map<string, string>();
    for (const photo of photos) {
      if (!photoMap.has(photo.venueId)) photoMap.set(photo.venueId, photo.url);
    }

    const priceRangeMap = new Map(priceRangeRows.map((r) => [r.venueId, r]));

    const pitchTypesMap = new Map<string, string[]>();
    for (const row of pitchRows) {
      const types = pitchTypesMap.get(row.venueId) ?? [];
      if (!types.includes(row.type)) types.push(row.type);
      pitchTypesMap.set(row.venueId, types);
    }

    const result = venues.map((v) => {
      const priceRange = priceRangeMap.get(v.id);
      return {
        id: v.id,
        name: v.name,
        district: v.district,
        address: v.address,
        amenities: v.amenities,
        coverPhoto: photoMap.get(v.id) ?? null,
        minPrice: priceRange?.minPrice ? parseFloat(priceRange.minPrice) : null,
        maxPrice: priceRange?.maxPrice ? parseFloat(priceRange.maxPrice) : null,
        pitchTypes: pitchTypesMap.get(v.id) ?? [],
      };
    });

    res.json({ venues: result, favouriteVenueIds: venueIds });
  } catch (err) {
    console.error("GET /player/favourites error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /player/favourites/:venueId — add to favourites
router.post("/player/favourites/:venueId", async (req, res) => {
  try {
    const playerId = req.user!.userId;
    const { venueId } = req.params as { venueId: string };

    // Verify venue exists
    const [venue] = await db
      .select({ id: venuesTable.id })
      .from(venuesTable)
      .where(and(eq(venuesTable.id, venueId), eq(venuesTable.status, "APPROVED")))
      .limit(1);

    if (!venue) {
      res.status(404).json({ error: "Venue not found" });
      return;
    }

    // Upsert (ignore conflict)
    await db
      .insert(playerFavouritesTable)
      .values({ playerId, venueId })
      .onConflictDoNothing();

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("POST /player/favourites/:venueId error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /player/favourites/:venueId — remove from favourites
router.delete("/player/favourites/:venueId", async (req, res) => {
  try {
    const playerId = req.user!.userId;
    const { venueId } = req.params as { venueId: string };

    await db
      .delete(playerFavouritesTable)
      .where(
        and(
          eq(playerFavouritesTable.playerId, playerId),
          eq(playerFavouritesTable.venueId, venueId),
        ),
      );

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /player/favourites/:venueId error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /player/favourites/ids — lightweight: just the venue IDs
router.get("/player/favourites/ids", async (req, res) => {
  try {
    const playerId = req.user!.userId;

    const rows = await db
      .select({ venueId: playerFavouritesTable.venueId })
      .from(playerFavouritesTable)
      .where(eq(playerFavouritesTable.playerId, playerId));

    res.json({ venueIds: rows.map((r) => r.venueId) });
  } catch (err) {
    console.error("GET /player/favourites/ids error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
