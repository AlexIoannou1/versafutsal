import { Router, type IRouter, type Response } from "express";
import multer from "multer";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@workspace/db";
import {
  venuesTable,
  pitchesTable,
  openingHoursTable,
  pricingRulesTable,
  venuePhotosTable,
  maintenanceBlocksTable,
  availabilityBlocksTable,
  bookingsTable,
  ownerSubscriptionsTable,
} from "@workspace/db/schema";
import { eq, and, gte, lte, inArray, sql, gt, or, isNull, asc } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  assertSupportedImageSignature,
  reencodeImageAsWebp,
  validateImageUploadFilename,
  VENUE_IMAGE_POLICY,
} from "../lib/image-upload-validation";
import {
  isVenuePhotoStorageKey,
  readVenuePhoto,
  removeVenuePhoto,
  saveVenuePhoto,
} from "../lib/venue-photo-storage";
import { resolveEffectivePlan } from "../lib/entitlements";
import {
  getVenueDiscoveryMetadata,
  rankVenuesWithBoundedPlanBoost,
} from "../lib/venue-discovery";

const router: IRouter = Router();

// ─── Photo upload middleware ──────────────────────────────────────────────────

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VENUE_IMAGE_POLICY.maxFileSizeBytes },
  fileFilter(_req, file, cb) {
    const validationError = validateImageUploadFilename(file, VENUE_IMAGE_POLICY);
    if (validationError) {
      cb(new Error(validationError));
      return;
    }
    cb(null, true);
  },
});

/** Applies multer.single("photo") and converts multer errors into JSON 400s.
 *  Returns true if the request is ready to handle, false if a response was already sent. */
function applyPhotoUpload(req: any, res: any): Promise<boolean> {
  return new Promise((resolve) => {
    photoUpload.single("photo")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const error =
          err.code === "LIMIT_FILE_SIZE"
            ? "Image file must be 5 MB or smaller"
            : err.message;
        res.status(400).json({ error });
        resolve(false);
      } else if (err) {
        res.status(400).json({ error: (err as Error).message ?? "Upload failed" });
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// ─── Object-storage photo helpers ───────────────────────────────────────────

const PHOTO_KEY_PREFIX = "uploads/venue-photos/";
const LEGACY_VENUE_PHOTO_PREFIX = "venue-photos/";

function getLegacyVenuePhotoPath(rawUrl: string): string | null {
  let candidate = rawUrl;
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    try {
      const legacyUrl = new URL(rawUrl);
      if (!legacyUrl.pathname.startsWith("/api/uploads/venue-photos/")) return null;
      candidate = legacyUrl.pathname.slice("/api/uploads/".length);
    } catch {
      return null;
    }
  }

  try {
    const normalized = path.posix.normalize(decodeURIComponent(candidate));
    return normalized.startsWith(LEGACY_VENUE_PHOTO_PREFIX) ? normalized : null;
  } catch {
    return null;
  }
}

function getVenuePhotoEndpoint(photoId: string): string {
  const domain =
    process.env.REPLIT_DOMAINS?.split(",").map((value) => value.trim()).find(Boolean) ??
    process.env.REPLIT_DEV_DOMAIN;
  const apiDomain = domain?.replace(".expo.", ".");
  return apiDomain
    ? `https://${apiDomain}/api/venue-photos/${photoId}`
    : `/api/venue-photos/${photoId}`;
}

function legacyVenuePhotoContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

/** Construct the public HTTPS URL for a stored photo key. */
function resolvePhotoUrl(photo: { id: string; url: string }): string {
  if (isVenuePhotoStorageKey(photo.url) || getLegacyVenuePhotoPath(photo.url)) {
    return getVenuePhotoEndpoint(photo.id);
  }
  return photo.url;
}

function createOwnerPreviewToken(photoId: string, ownerId: string): string {
  const expiresAt = Date.now() + 15 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ photoId, ownerId, expiresAt })).toString("base64url");
  const secret = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) throw new Error("Photo preview signing is not configured");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function hasValidOwnerPreviewToken(token: unknown, photoId: string, ownerId: string): boolean {
  if (typeof token !== "string") return false;
  const [payload, signature] = token.split(".");
  const secret = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
  if (!payload || !signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const provided = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (provided.length !== expectedBytes.length || !timingSafeEqual(provided, expectedBytes)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      photoId?: string;
      ownerId?: string;
      expiresAt?: number;
    };
    return decoded.photoId === photoId && decoded.ownerId === ownerId && decoded.expiresAt! > Date.now();
  } catch {
    return false;
  }
}

async function signPhotoUrl(photo: { id: string; url: string }, ownerId?: string): Promise<string> {
  const url = resolvePhotoUrl(photo);
  if (ownerId && (isVenuePhotoStorageKey(photo.url) || getLegacyVenuePhotoPath(photo.url))) {
    return `${url}?preview=${encodeURIComponent(createOwnerPreviewToken(photo.id, ownerId))}`;
  }
  return url;
}

async function signPhotoList<T extends { id: string; url: string }>(
  photos: T[],
  ownerId?: string,
): Promise<T[]> {
  return Promise.all(
    photos.map(async (photo) => ({ ...photo, url: await signPhotoUrl(photo, ownerId) })),
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getVenueWithDetails(venueId: string, ownerPreviewForId?: string) {
  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.id, venueId))
    .limit(1);

  if (!venue) return null;

  const [photos, pitches, hours, subscriptions] = await Promise.all([
    db
      .select()
      .from(venuePhotosTable)
      .where(eq(venuePhotosTable.venueId, venueId))
      .orderBy(asc(venuePhotosTable.sortOrder), asc(venuePhotosTable.createdAt)),
    db.select().from(pitchesTable).where(eq(pitchesTable.venueId, venueId)),
    db.select().from(openingHoursTable).where(eq(openingHoursTable.venueId, venueId)),
    db.select().from(ownerSubscriptionsTable).where(eq(ownerSubscriptionsTable.ownerId, venue.ownerId)).limit(1),
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

  const signedPhotos = await signPhotoList(photos, ownerPreviewForId);
  const discovery = getVenueDiscoveryMetadata(resolveEffectivePlan(subscriptions[0]));
  return { ...venue, ...discovery, photos: signedPhotos, pitches: pitchesWithPricing, openingHours: hours };
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
    const ownerIds = [...new Set(filteredVenues.map((v) => v.ownerId))];
    const subscriptions = await db
      .select()
      .from(ownerSubscriptionsTable)
      .where(inArray(ownerSubscriptionsTable.ownerId, ownerIds));
    const planByOwner = new Map(
      subscriptions.map((subscription) => [
        subscription.ownerId,
        resolveEffectivePlan(subscription),
      ]),
    );

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
    const photosGroupMap = new Map<string, typeof photos>();
    for (const photo of photos.sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (!photoMap.has(photo.venueId)) photoMap.set(photo.venueId, photo.url);
      const list = photosGroupMap.get(photo.venueId) ?? [];
      list.push(photo);
      photosGroupMap.set(photo.venueId, list);
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
        ...getVenueDiscoveryMetadata(planByOwner.get(v.ownerId) ?? "FREE"),
        coverPhoto: photoMap.get(v.id) ?? null,
        photos: photosGroupMap.get(v.id) ?? [],
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
    venues = rankVenuesWithBoundedPlanBoost(venues);

    // Sign cover photo URLs and all photo URLs for object-storage photos
    const signedVenues = await Promise.all(
      venues.map(async (v) => ({
        ...v,
        coverPhoto: v.coverPhoto
          ? await signPhotoUrl(
              (photosGroupMap.get(v.id) ?? []).find((photo) => photo.url === v.coverPhoto)!,
            )
          : null,
        photos: await signPhotoList(v.photos),
      })),
    );

    res.json({ venues: signedVenues });
  } catch (err) {
    req.log.error({ err }, "GET /venues failed");
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
    req.log.error({ err, venueId: req.params.id }, "GET /venues/:id failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /venue-photos/:photoId — stream a processed venue photo from private object storage.
// Object keys are never exposed to clients; the opaque photo ID is the public read handle.
router.get<{ photoId: string }>("/venue-photos/:photoId", async (req, res): Promise<void> => {
  try {
    const [record] = await db
      .select({ photo: venuePhotosTable, venue: venuesTable })
      .from(venuePhotosTable)
      .innerJoin(venuesTable, eq(venuesTable.id, venuePhotosTable.venueId))
      .where(eq(venuePhotosTable.id, req.params.photoId))
      .limit(1);

    const isOwnerPreview =
      record &&
      hasValidOwnerPreviewToken(req.query.preview, record.photo.id, record.venue.ownerId);
    const legacyPhotoPath = record ? getLegacyVenuePhotoPath(record.photo.url) : null;
    if (
      !record ||
      (!isVenuePhotoStorageKey(record.photo.url) && !legacyPhotoPath) ||
      (record.venue.status !== "APPROVED" && !isOwnerPreview)
    ) {
      res.status(404).json({ error: "Photo not found" });
      return;
    }

    const image = isVenuePhotoStorageKey(record.photo.url)
      ? await readVenuePhoto(record.photo.url)
      : await readFile(path.join(process.cwd(), "uploads", legacyPhotoPath!));
    res.set({
      "Content-Type": isVenuePhotoStorageKey(record.photo.url)
        ? "image/webp"
        : legacyVenuePhotoContentType(legacyPhotoPath!),
      "Cache-Control": isOwnerPreview
        ? "private, no-store"
        : "public, max-age=31536000, immutable",
      "Content-Length": String(image.length),
    });
    res.send(image);
  } catch (error) {
    req.log.warn({ err: error, photoId: req.params.photoId }, "Unable to read venue photo");
    res.status(404).json({ error: "Photo not found" });
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

    const [photos, pitches, subscription] = await Promise.all([
      db.select().from(venuePhotosTable).where(inArray(venuePhotosTable.venueId, venueIds)),
      db.select().from(pitchesTable).where(inArray(pitchesTable.venueId, venueIds)),
      db
        .select()
        .from(ownerSubscriptionsTable)
        .where(eq(ownerSubscriptionsTable.ownerId, req.user!.userId))
        .limit(1),
    ]);
    const discovery = getVenueDiscoveryMetadata(resolveEffectivePlan(subscription[0]));

    const photoMap = new Map<string, string>();
    for (const p of photos.sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (!photoMap.has(p.venueId)) photoMap.set(p.venueId, p.url);
    }
    const pitchCountMap = new Map<string, number>();
    for (const p of pitches) {
      pitchCountMap.set(p.venueId, (pitchCountMap.get(p.venueId) ?? 0) + 1);
    }

    const signedOwnerVenues = await Promise.all(
      venues.map(async (v) => {
        const rawCover = photoMap.get(v.id) ?? null;
        return {
          ...v,
          ...discovery,
          coverPhoto: rawCover
            ? await signPhotoUrl(
                photos.find((photo) => photo.venueId === v.id && photo.url === rawCover)!,
                req.user!.userId,
              )
            : null,
          pitchCount: pitchCountMap.get(v.id) ?? 0,
        };
      }),
    );
    res.json({ venues: signedOwnerVenues });
  } catch (err) {
    req.log.error({ err, ownerId: req.user?.userId }, "GET /owner/venues failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /owner/venues/:id — owner venue detail
router.get<{ id: string }>("/owner/venues/:id", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const venue = await getVenueWithDetails(req.params.id, req.user!.userId);
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
    const { name, district, address, description, amenities, cancellationWindowHours, contactPhone } =
      req.body as {
        name: string;
        district: string;
        address: string;
        description?: string;
        amenities?: string[];
        cancellationWindowHours?: number;
        contactPhone: string;
      };

    if (!name || !district || !address) {
      res.status(400).json({ error: "name, district, and address are required" });
      return;
    }

    if (!contactPhone?.trim()) {
      res.status(400).json({ error: "contactPhone is required" });
      return;
    }

    if (cancellationWindowHours !== undefined) {
      if (
        !Number.isInteger(cancellationWindowHours) ||
        cancellationWindowHours < 0 ||
        cancellationWindowHours > 168
      ) {
        res.status(400).json({
          error: "cancellationWindowHours must be an integer between 0 and 168 (7 days).",
        });
        return;
      }
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
        contactPhone: contactPhone.trim(),
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

    const { name, district, address, description, amenities, cancellationWindowHours, contactPhone } =
      req.body as Partial<{
        name: string;
        district: string;
        address: string;
        description: string;
        amenities: string[];
        cancellationWindowHours: number;
        contactPhone: string;
      }>;

    if (cancellationWindowHours !== undefined) {
      if (
        !Number.isInteger(cancellationWindowHours) ||
        cancellationWindowHours < 0 ||
        cancellationWindowHours > 168
      ) {
        res.status(400).json({
          error: "cancellationWindowHours must be an integer between 0 and 168 (7 days).",
        });
        return;
      }
    }

    const [updated] = await db
      .update(venuesTable)
      .set({
        ...(name !== undefined && { name }),
        ...(district !== undefined && { district }),
        ...(address !== undefined && { address }),
        ...(description !== undefined && { description }),
        ...(amenities !== undefined && { amenities }),
        ...(cancellationWindowHours !== undefined && { cancellationWindowHours }),
        ...(contactPhone !== undefined && { contactPhone: contactPhone.trim() }),
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

// POST /owner/venues/:id/photos/upload — upload a photo file
router.post<{ id: string }>(
  "/owner/venues/:id/photos/upload",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    // Apply multer and convert any parse/size/type errors to JSON 400s
    const ready = await applyPhotoUpload(req, res);
    if (!ready) return; // response already sent by applyPhotoUpload

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

      if (!req.file) {
        res.status(400).json({ error: "No image file provided" });
        return;
      }

      // Verify signatures before decode, then strip EXIF, auto-orient, and re-encode as WebP.
      let processed: Buffer;
      try {
        assertSupportedImageSignature(req.file.buffer, VENUE_IMAGE_POLICY);
        processed = await reencodeImageAsWebp(req.file.buffer);
      } catch (imageError) {
        req.log.warn({ err: imageError }, "Rejected venue image upload");
        res.status(400).json({
          error: imageError instanceof Error ? imageError.message : "Invalid image file",
        });
        return;
      }

      const uuid = randomUUID();
      const photoKey = `${PHOTO_KEY_PREFIX}${existing.id}/${uuid}.webp`;
      let didStoreObject = false;

      try {
        const photo = await db.transaction(async (tx) => {
          // Serializes upload counts per venue so concurrent uploads cannot pass the 7-photo limit.
          await tx.execute(sql`SELECT id FROM venues WHERE id = ${existing.id} FOR UPDATE`);
          const currentPhotos = await tx
            .select({ id: venuePhotosTable.id, sortOrder: venuePhotosTable.sortOrder })
            .from(venuePhotosTable)
            .where(eq(venuePhotosTable.venueId, existing.id));

          if (currentPhotos.length >= 7) {
            throw new Error("VENUE_PHOTO_LIMIT_REACHED");
          }

          await saveVenuePhoto(photoKey, processed);
          didStoreObject = true;
          const [created] = await tx
            .insert(venuePhotosTable)
            .values({
              venueId: existing.id,
              url: photoKey,
              sortOrder: Math.max(-1, ...currentPhotos.map((photo) => photo.sortOrder)) + 1,
            })
            .returning();
          return created;
        });

        res.status(201).json({ photo: { ...photo, url: resolvePhotoUrl(photo) } });
      } catch (storageError) {
        if (storageError instanceof Error && storageError.message === "VENUE_PHOTO_LIMIT_REACHED") {
          res.status(400).json({ error: "Maximum of 7 photos per venue" });
          return;
        }
        if (didStoreObject) {
          try {
            await removeVenuePhoto(photoKey);
          } catch (cleanupError) {
            req.log.error({ err: cleanupError, photoKey }, "Unable to clean up failed venue photo upload");
          }
        }
        req.log.error({ err: storageError }, "Unable to store venue photo");
        res.status(500).json({ error: "Failed to save image" });
      }
    } catch (err) {
      req.log.error({ err }, "POST /owner/venues/:id/photos/upload failed");
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

      const [photoRecord] = await db
        .select()
        .from(venuePhotosTable)
        .where(
          and(
            eq(venuePhotosTable.id, req.params.photoId),
            eq(venuePhotosTable.venueId, req.params.venueId),
          ),
        )
        .limit(1);

      await db.transaction(async (tx) => {
        await tx
          .delete(venuePhotosTable)
          .where(
            and(
              eq(venuePhotosTable.id, req.params.photoId),
              eq(venuePhotosTable.venueId, req.params.venueId),
            ),
          );
        const remainingPhotos = await tx
          .select({ id: venuePhotosTable.id })
          .from(venuePhotosTable)
          .where(eq(venuePhotosTable.venueId, req.params.venueId))
          .orderBy(asc(venuePhotosTable.sortOrder), asc(venuePhotosTable.createdAt));
        await Promise.all(
          remainingPhotos.map((photo, index) =>
            tx.update(venuePhotosTable).set({ sortOrder: index }).where(eq(venuePhotosTable.id, photo.id)),
          ),
        );
      });

      if (photoRecord && isVenuePhotoStorageKey(photoRecord.url)) {
        try {
          await removeVenuePhoto(photoRecord.url);
        } catch (error) {
          req.log.warn({ err: error, photoId: photoRecord.id }, "Unable to remove venue photo object");
        }
      }

      res.status(204).send();
    } catch (err) {
      console.error("DELETE /owner/venues/:id/photos/:photoId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PUT /owner/venues/:id/photos/reorder — set sort order for all photos
router.put<{ id: string }>(
  "/owner/venues/:id/photos/reorder",
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

      const { orderedIds } = req.body as { orderedIds: string[] };
      if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
        res.status(400).json({ error: "orderedIds must be an array of photo id strings" });
        return;
      }

      const venuePhotos = await db
        .select({ id: venuePhotosTable.id })
        .from(venuePhotosTable)
        .where(eq(venuePhotosTable.venueId, req.params.id));
      const knownIds = new Set(venuePhotos.map((photo) => photo.id));
      const isCompleteOrder =
        orderedIds.length === venuePhotos.length &&
        new Set(orderedIds).size === orderedIds.length &&
        orderedIds.every((photoId) => knownIds.has(photoId));
      if (!isCompleteOrder) {
        res.status(400).json({ error: "orderedIds must contain every venue photo exactly once" });
        return;
      }

      await db.transaction(async (tx) => {
        await Promise.all(
          orderedIds.map((photoId, idx) =>
            tx
              .update(venuePhotosTable)
              .set({ sortOrder: idx })
              .where(
                and(
                  eq(venuePhotosTable.id, photoId),
                  eq(venuePhotosTable.venueId, req.params.id),
                ),
              ),
          ),
        );
      });

      res.json({ success: true });
    } catch (err) {
      req.log.error({ err }, "PUT /owner/venues/:id/photos/reorder failed");
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

      // Validate provided fields
      if (name !== undefined && !name.trim()) {
        res.status(400).json({ error: "name cannot be empty" });
        return;
      }
      if (size !== undefined && !size.trim()) {
        res.status(400).json({ error: "size cannot be empty" });
        return;
      }
      if (type !== undefined && !["INDOOR", "OUTDOOR", "HYBRID"].includes(type)) {
        res.status(400).json({ error: "type must be INDOOR, OUTDOOR, or HYBRID" });
        return;
      }
      if (slotDurationMinutes !== undefined) {
        if (!Number.isInteger(slotDurationMinutes) || slotDurationMinutes < 15 || slotDurationMinutes > 240) {
          res.status(400).json({ error: "slotDurationMinutes must be an integer between 15 and 240" });
          return;
        }
      }

      // Fetch the current pitch
      const [existing] = await db
        .select()
        .from(pitchesTable)
        .where(
          and(
            eq(pitchesTable.id, req.params.pitchId),
            eq(pitchesTable.venueId, req.params.id),
          ),
        )
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Pitch not found" });
        return;
      }

      // Booking conflict check: if slotDurationMinutes is changing, ensure no future active bookings
      if (slotDurationMinutes !== undefined && slotDurationMinutes !== existing.slotDurationMinutes) {
        const now = new Date();
        const conflictingBookings = await db
          .select({
            id: bookingsTable.id,
            startAt: bookingsTable.startAt,
            endAt: bookingsTable.endAt,
            status: bookingsTable.status,
          })
          .from(bookingsTable)
          .where(
            and(
              eq(bookingsTable.pitchId, req.params.pitchId),
              gt(bookingsTable.startAt, now),
              sql`(${bookingsTable.status} = 'PENDING' OR ${bookingsTable.status} = 'CONFIRMED')`,
            ),
          );

        if (conflictingBookings.length > 0) {
          res.status(409).json({
            error: "Cannot change slot duration: this pitch has existing future bookings that would be affected.",
            conflictingBookings: conflictingBookings.map((b) => ({
              id: b.id,
              startAt: b.startAt.toISOString(),
              endAt: b.endAt.toISOString(),
              status: b.status,
            })),
          });
          return;
        }
      }

      const [updated] = await db
        .update(pitchesTable)
        .set({
          ...(name !== undefined && { name: name.trim() }),
          ...(size !== undefined && { size: size.trim() }),
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

// ─── Owner: Availability Blocks ───────────────────────────────────────────────

// GET /owner/venues/:venueId/blocks — list all availability blocks for a venue
router.get<{ venueId: string }>(
  "/owner/venues/:venueId/blocks",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const venue = await assertVenueOwner(req.params.venueId, req.user!.userId, res);
      if (!venue) return;

      const blocks = await db
        .select()
        .from(availabilityBlocksTable)
        .where(eq(availabilityBlocksTable.venueId, req.params.venueId))
        .orderBy(availabilityBlocksTable.startDate);

      res.json({ blocks });
    } catch (err) {
      console.error("GET /owner/venues/:venueId/blocks error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /owner/venues/:venueId/blocks — create an availability block
router.post<{ venueId: string }>(
  "/owner/venues/:venueId/blocks",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const venue = await assertVenueOwner(req.params.venueId, req.user!.userId, res);
      if (!venue) return;

      const {
        pitchId,
        blockType,
        label,
        startDate,
        endDate,
        startTime,
        endTime,
        recursWeekly,
        dayOfWeek,
      } = req.body as {
        pitchId?: string;
        blockType?: string;
        label?: string;
        startDate: string;
        endDate: string;
        startTime?: string;
        endTime?: string;
        recursWeekly?: boolean;
        dayOfWeek?: number;
      };

      if (!startDate || !endDate) {
        res.status(400).json({ error: "startDate and endDate are required" });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        res.status(400).json({ error: "startDate and endDate must be YYYY-MM-DD" });
        return;
      }
      if (startDate > endDate) {
        res.status(400).json({ error: "startDate must be on or before endDate" });
        return;
      }

      const validBlockTypes = ["OFF_DAY", "BANK_HOLIDAY", "TRAINING", "MAINTENANCE", "PRIVATE"];
      const resolvedBlockType = (blockType && validBlockTypes.includes(blockType)
        ? blockType
        : "OFF_DAY") as "OFF_DAY" | "BANK_HOLIDAY" | "TRAINING" | "MAINTENANCE" | "PRIVATE";

      // If pitchId provided, verify it belongs to this venue
      if (pitchId) {
        const [pitch] = await db
          .select()
          .from(pitchesTable)
          .where(and(eq(pitchesTable.id, pitchId), eq(pitchesTable.venueId, req.params.venueId)))
          .limit(1);
        if (!pitch) {
          res.status(404).json({ error: "Pitch not found in this venue" });
          return;
        }
      }

      if (recursWeekly && (dayOfWeek === undefined || dayOfWeek === null || dayOfWeek < 0 || dayOfWeek > 6)) {
        res.status(400).json({ error: "dayOfWeek (0-6) is required when recursWeekly is true" });
        return;
      }

      // startTime and endTime must be provided as a pair in HH:MM format with start < end
      const timeRe = /^\d{2}:\d{2}$/;
      if ((startTime || endTime) && !(startTime && endTime)) {
        res.status(400).json({ error: "Both startTime and endTime must be provided together" });
        return;
      }
      if (startTime && endTime) {
        if (!timeRe.test(startTime) || !timeRe.test(endTime)) {
          res.status(400).json({ error: "startTime and endTime must be in HH:MM format" });
          return;
        }
        if (startTime >= endTime) {
          res.status(400).json({ error: "startTime must be before endTime" });
          return;
        }
      }

      // Check for confirmed booking conflicts on affected pitches
      const affectedPitchIds: string[] = [];
      if (pitchId) {
        affectedPitchIds.push(pitchId);
      } else {
        const pitches = await db
          .select({ id: pitchesTable.id })
          .from(pitchesTable)
          .where(eq(pitchesTable.venueId, req.params.venueId));
        affectedPitchIds.push(...pitches.map((p) => p.id));
      }

      let conflictingBookings: { id: string; startAt: string; endAt: string; status: string; pitchId: string }[] = [];
      if (affectedPitchIds.length > 0) {
        const dayStart = new Date(`${startDate}T00:00:00.000Z`);
        const dayEnd = new Date(`${endDate}T23:59:59.999Z`);

        const rawConflicts = await db
          .select({
            id: bookingsTable.id,
            startAt: bookingsTable.startAt,
            endAt: bookingsTable.endAt,
            status: bookingsTable.status,
            pitchId: bookingsTable.pitchId,
          })
          .from(bookingsTable)
          .where(
            and(
              inArray(bookingsTable.pitchId, affectedPitchIds),
              inArray(bookingsTable.status, ["PENDING", "CONFIRMED"]),
              gte(bookingsTable.startAt, dayStart),
              lte(bookingsTable.startAt, dayEnd),
            ),
          );

        conflictingBookings = rawConflicts
          .filter((b) => {
            if (recursWeekly && dayOfWeek !== undefined) {
              return b.startAt.getUTCDay() === dayOfWeek;
            }
            const bookingDate = b.startAt.toISOString().slice(0, 10);
            if (bookingDate < startDate || bookingDate > endDate) return false;
            if (startTime && endTime) {
              const bStartTime = b.startAt.toISOString().slice(11, 16);
              const bEndTime = b.endAt.toISOString().slice(11, 16);
              return bStartTime < endTime && bEndTime > startTime;
            }
            return true;
          })
          .map((b) => ({
            id: b.id,
            startAt: b.startAt.toISOString(),
            endAt: b.endAt.toISOString(),
            status: b.status,
            pitchId: b.pitchId,
          }));
      }

      const [block] = await db
        .insert(availabilityBlocksTable)
        .values({
          venueId: req.params.venueId,
          pitchId: pitchId ?? null,
          blockType: resolvedBlockType,
          label: label ?? null,
          startDate,
          endDate,
          startTime: startTime ?? null,
          endTime: endTime ?? null,
          recursWeekly: recursWeekly ?? false,
          dayOfWeek: recursWeekly && dayOfWeek !== undefined ? dayOfWeek : null,
        })
        .returning();

      res.status(201).json({
        block,
        ...(conflictingBookings.length > 0
          ? {
              warning: `This block overlaps ${conflictingBookings.length} pending/confirmed booking(s). Those bookings have not been cancelled.`,
              conflictingBookings,
            }
          : {}),
      });
    } catch (err) {
      console.error("POST /owner/venues/:venueId/blocks error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// DELETE /owner/venues/:venueId/blocks/:blockId — remove a block
router.delete<{ venueId: string; blockId: string }>(
  "/owner/venues/:venueId/blocks/:blockId",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const venue = await assertVenueOwner(req.params.venueId, req.user!.userId, res);
      if (!venue) return;

      const [existing] = await db
        .select()
        .from(availabilityBlocksTable)
        .where(
          and(
            eq(availabilityBlocksTable.id, req.params.blockId),
            eq(availabilityBlocksTable.venueId, req.params.venueId),
          ),
        )
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Block not found" });
        return;
      }

      await db
        .delete(availabilityBlocksTable)
        .where(
          and(
            eq(availabilityBlocksTable.id, req.params.blockId),
            eq(availabilityBlocksTable.venueId, req.params.venueId),
          ),
        );

      res.status(204).send();
    } catch (err) {
      console.error("DELETE /owner/venues/:venueId/blocks/:blockId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
