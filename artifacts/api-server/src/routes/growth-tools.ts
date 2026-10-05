import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  bookingsTable,
  promotionRedemptionsTable,
  promotionsTable,
  venueStreakProgressTable,
  venueStreakRewardsTable,
  venueStreakSettingsTable,
  venuesTable,
  notificationsTable,
  pitchesTable,
  pricingRulesTable,
} from "@workspace/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { requireOwnerCapability } from "../lib/entitlements";
import { uuid } from "@workspace/api-zod";
import {
  calculateDiscount,
  isValidPromotionInput,
  PROMOTION_CODE_RE,
  quoteFromDiscount,
  venueGrowthToolsEnabled,
} from "../lib/growth-tools";

const router: IRouter = Router();
for (const name of ["id", "venueId", "bookingId"]) {
  router.param(name, (_req, res, next, value) => {
    if (!uuid.safeParse(value).success) { res.status(400).json({ error: "Invalid resource ID" }); return; }
    next();
  });
}
const ownerGrowth = [requireAuth, requireRole("VENUE_OWNER"), requireOwnerCapability("GROWTH_TOOLS")] as const;

async function ownedVenue(venueId: string, ownerId: string) {
  const [venue] = await db.select().from(venuesTable)
    .where(and(eq(venuesTable.id, venueId), eq(venuesTable.ownerId, ownerId))).limit(1);
  return venue;
}

router.get("/owner/promotions", ...ownerGrowth, async (req, res) => {
  const promotions = await db.select().from(promotionsTable).where(eq(promotionsTable.ownerId, req.user!.userId));
  const ids = promotions.map((promotion) => promotion.id);
  const redemptions = ids.length ? await db.select().from(promotionRedemptionsTable)
    .where(inArray(promotionRedemptionsTable.promotionId, ids)) : [];
  res.json({ promotions: promotions.map((promotion) => {
    const rows = redemptions.filter((redemption) => redemption.promotionId === promotion.id);
    const redeemed = rows.filter((redemption) => redemption.status === "REDEEMED");
    return {
      ...promotion,
      reservedCount: rows.filter((redemption) => redemption.status === "RESERVED").length,
      redeemedCount: redeemed.length,
      redeemedDiscountTotal: redeemed.reduce((sum, redemption) => sum + Number(redemption.discountAmount), 0).toFixed(2),
    };
  }) });
});

router.post("/owner/promotions", ...ownerGrowth, async (req, res) => {
  try {
    const { venueId, code, kind, value, startsAt, endsAt, redemptionLimit, perPlayerLimit } = req.body;
    if (!venueId || !isValidPromotionInput(code, value) || !["PERCENTAGE", "FIXED"].includes(kind)) {
      res.status(400).json({ error: "venueId, code, and a valid kind are required" }); return;
    }
    if (!await ownedVenue(venueId, req.user!.userId)) {
      res.status(404).json({ error: "Venue not found" }); return;
    }
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || (kind === "PERCENTAGE" && amount > 100)) {
      res.status(400).json({ error: "value must be positive and percentage cannot exceed 100" }); return;
    }
    const start = startsAt ? new Date(startsAt) : null;
    const end = endsAt ? new Date(endsAt) : null;
    if ((startsAt != null && typeof startsAt !== "string") || (endsAt != null && typeof endsAt !== "string")) {
      res.status(400).json({ error: "Promotion dates must be date-time strings" }); return;
    }
    if ((start && isNaN(start.getTime())) || (end && isNaN(end.getTime())) || (start && end && end <= start)) {
      res.status(400).json({ error: "Promotion dates are invalid" }); return;
    }
    if ((redemptionLimit != null && (!Number.isInteger(redemptionLimit) || redemptionLimit < 1 || redemptionLimit > 2147483647)) ||
        (perPlayerLimit != null && (!Number.isInteger(perPlayerLimit) || perPlayerLimit < 1 || perPlayerLimit > 2147483647))) {
      res.status(400).json({ error: "Limits must be positive integers" }); return;
    }
    const [promotion] = await db.insert(promotionsTable).values({
      ownerId: req.user!.userId, venueId, code: code.trim().toUpperCase(), kind,
      value: amount.toFixed(2), startsAt: start, endsAt: end,
      redemptionLimit: redemptionLimit ?? null, perPlayerLimit: perPlayerLimit ?? 1,
    }).returning();
    res.status(201).json({ promotion });
  } catch (error: any) {
    if (error?.code === "23505" || error?.cause?.code === "23505") {
      res.status(409).json({ error: "That code already exists for this venue" }); return;
    }
    req.log.error({ err: error }, "Promotion creation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/owner/promotions/:id", ...ownerGrowth, async (req, res) => {
  const [existing] = await db.select().from(promotionsTable).where(and(
    eq(promotionsTable.id, req.params.id as string), eq(promotionsTable.ownerId, req.user!.userId),
  )).limit(1);
  if (!existing) { res.status(404).json({ error: "Promotion not found" }); return; }
  const updates: any = { updatedAt: new Date() };
  if (typeof req.body.enabled === "boolean") updates.enabled = req.body.enabled;
  if (req.body.code !== undefined) {
    if (!PROMOTION_CODE_RE.test(String(req.body.code).trim().toUpperCase())) {
      res.status(400).json({ error: "code is invalid" }); return;
    }
    updates.code = String(req.body.code).trim().toUpperCase();
  }
  const nextKind = req.body.kind ?? existing.kind;
  const nextValue = req.body.value ?? existing.value;
  if (!isValidPromotionInput(updates.code ?? existing.code, nextValue) ||
      !["PERCENTAGE", "FIXED"].includes(nextKind) || !Number.isFinite(Number(nextValue)) ||
      Number(nextValue) <= 0 || (nextKind === "PERCENTAGE" && Number(nextValue) > 100)) {
    res.status(400).json({ error: "Promotion kind or value is invalid" }); return;
  }
  if (req.body.kind !== undefined) updates.kind = nextKind;
  if (req.body.value !== undefined) updates.value = Number(nextValue).toFixed(2);
  for (const field of ["redemptionLimit", "perPlayerLimit"] as const) {
    if (req.body[field] !== undefined) {
      if ((field === "perPlayerLimit" && req.body[field] === null) ||
          (req.body[field] !== null && (!Number.isInteger(req.body[field]) || req.body[field] < 1 || req.body[field] > 2147483647))) {
        res.status(400).json({ error: `${field} must be a positive integer` }); return;
      }
      updates[field] = req.body[field];
    }
  }
  if (req.body.endsAt !== undefined) {
    const end = req.body.endsAt === null ? null : new Date(req.body.endsAt);
    if (end && (isNaN(end.getTime()) || (existing.startsAt && end <= existing.startsAt))) {
      res.status(400).json({ error: "endsAt is invalid" }); return;
    }
    updates.endsAt = end;
  }
  const [promotion] = await db.update(promotionsTable).set(updates).where(eq(promotionsTable.id, existing.id)).returning();
  res.json({ promotion });
});

router.delete("/owner/promotions/:id", ...ownerGrowth, async (req, res) => {
  try {
    const [deleted] = await db.delete(promotionsTable).where(and(
      eq(promotionsTable.id, req.params.id as string), eq(promotionsTable.ownerId, req.user!.userId),
    )).returning();
    if (!deleted) { res.status(404).json({ error: "Promotion not found" }); return; }
    res.status(204).send();
  } catch (error: any) {
    const code = error?.code ?? error?.cause?.code;
    if (code === "23503") {
      res.status(409).json({ error: "Promotions with redemption history cannot be deleted; disable it instead." });
      return;
    }
    throw error;
  }
});

router.get("/owner/growth/analytics", ...ownerGrowth, async (req, res) => {
  const now = new Date();
  const promotions = await db.select({ id: promotionsTable.id }).from(promotionsTable)
    .where(eq(promotionsTable.ownerId, req.user!.userId));
  const ids = promotions.map((p) => p.id);
  const redemptions = ids.length ? await db.select().from(promotionRedemptionsTable)
    .where(inArray(promotionRedemptionsTable.promotionId, ids)) : [];
  const venueIds = (await db.select({ id: venuesTable.id }).from(venuesTable)
    .where(eq(venuesTable.ownerId, req.user!.userId))).map((v) => v.id);
  const progress = venueIds.length ? await db.select().from(venueStreakProgressTable)
    .where(inArray(venueStreakProgressTable.venueId, venueIds)) : [];
  res.json({
    promotionCount: promotions.length,
    redeemedCount: redemptions.filter((r) => r.status === "REDEEMED").length,
    discountTotal: redemptions.filter((r) => r.status === "REDEEMED")
      .reduce((sum, r) => sum + Number(r.discountAmount), 0).toFixed(2),
    activeStreakPlayers: progress.filter((p) =>
      p.paidWeeks > 0 && (!p.expiresAt || p.expiresAt > now)
    ).length,
    nearRewardPlayers: progress.filter((p) =>
      p.paidWeeks === 3 && (!p.expiresAt || p.expiresAt > now)
    ).length,
  });
});

router.put("/owner/venues/:id/streak", ...ownerGrowth, async (req, res) => {
  const venueId = req.params.id as string;
  if (typeof req.body.enabled !== "boolean") { res.status(400).json({ error: "enabled must be boolean" }); return; }
  if (!await ownedVenue(venueId, req.user!.userId)) { res.status(404).json({ error: "Venue not found" }); return; }
  const [setting] = await db.insert(venueStreakSettingsTable).values({
    venueId, enabled: req.body.enabled,
  }).onConflictDoUpdate({
    target: venueStreakSettingsTable.venueId,
    set: { enabled: req.body.enabled, updatedAt: new Date() },
  }).returning();
  if (!req.body.enabled) {
    await db.delete(notificationsTable).where(and(
      eq(notificationsTable.entityType, "STREAK_PROGRESS"),
      eq(notificationsTable.pushSent, false),
      inArray(notificationsTable.type, ["STREAK_NEAR_COMPLETION", "STREAK_EXPIRING"]),
      sql`${notificationsTable.entityId} IN (SELECT id FROM venue_streak_progress WHERE venue_id = ${venueId})`,
    ));
  }
  res.json({ streak: setting });
});

router.post(["/bookings/:bookingId/quote", "/growth/quote"], requireAuth, requireRole("PLAYER"), async (req, res) => {
  let booking: Pick<typeof bookingsTable.$inferSelect, "venueId" | "playerId" | "policySnapshot" | "status" | "pricingSnapshot"> | undefined;
  if (req.params.bookingId) {
    [booking] = await db.select().from(bookingsTable).where(and(
      eq(bookingsTable.id, req.params.bookingId as string), eq(bookingsTable.playerId, req.user!.userId),
    )).limit(1);
  } else {
    const [pitch] = await db.select({ pitch: pitchesTable }).from(pitchesTable)
      .innerJoin(venuesTable, eq(venuesTable.id, pitchesTable.venueId))
      .where(and(eq(pitchesTable.id, req.body.pitchId), eq(venuesTable.status, "APPROVED"))).limit(1);
    if (!pitch) { res.status(404).json({ error: "Pitch not found" }); return; }
    const [rule] = await db.select().from(pricingRulesTable).where(eq(pricingRulesTable.pitchId, req.body.pitchId)).limit(1);
    // A preview never creates a booking, claims a slot, or reserves an incentive.
    // The same policy values are captured authoritatively when Pay Now creates it.
    booking = {
      venueId: pitch.pitch.venueId, playerId: req.user!.userId, status: "PENDING", pricingSnapshot: null,
      policySnapshot: { pricePerHour: rule?.pricePerHour ?? null, slotDurationMinutes: pitch.pitch.slotDurationMinutes },
    };
  }
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.status !== "PENDING") { res.status(400).json({ error: "Only pending bookings can be quoted" }); return; }
  if (booking.pricingSnapshot) {
    res.json({ quote: booking.pricingSnapshot });
    return;
  }
  if (!await venueGrowthToolsEnabled(booking.venueId)) {
    if (req.body.promoCode) {
      res.status(409).json({ error: "Discount codes are unavailable for this venue.", code: "GROWTH_DISABLED" });
      return;
    }
    res.json({ quote: quoteFromDiscount((Number((booking.policySnapshot as any).pricePerHour ?? 0) * Number((booking.policySnapshot as any).slotDurationMinutes ?? 60) / 60).toFixed(2)) });
    return;
  }
  const snapshot = booking.policySnapshot as { pricePerHour?: string; slotDurationMinutes?: number };
  const subtotal = (Number(snapshot.pricePerHour ?? 0) * (snapshot.slotDurationMinutes ?? 60) / 60).toFixed(2);
  if (!req.body.promoCode) {
    const [progress] = await db.select().from(venueStreakProgressTable).where(and(
      eq(venueStreakProgressTable.venueId, booking.venueId),
      eq(venueStreakProgressTable.playerId, booking.playerId),
    )).limit(1);
    const [reward] = progress ? await db.select().from(venueStreakRewardsTable).where(and(
      eq(venueStreakRewardsTable.progressId, progress.id), eq(venueStreakRewardsTable.status, "AVAILABLE"),
      sql`${venueStreakRewardsTable.expiresAt} > now()`,
    )).limit(1) : [];
    res.json({ quote: reward ? quoteFromDiscount(subtotal, subtotal, "STREAK_REWARD", reward.id) : quoteFromDiscount(subtotal) });
    return;
  }
  const [promo] = await db.select().from(promotionsTable).where(and(
    eq(promotionsTable.venueId, booking.venueId),
    eq(promotionsTable.code, String(req.body.promoCode).trim().toUpperCase()),
    eq(promotionsTable.enabled, true),
  )).limit(1);
  const now = new Date();
  if (!promo || (promo.startsAt && promo.startsAt > now) || (promo.endsAt && promo.endsAt <= now)) {
    res.status(400).json({ error: "Promotion is invalid or inactive", code: "PROMO_INVALID" }); return;
  }
  const activeRedemptions = await db.select().from(promotionRedemptionsTable).where(and(
    eq(promotionRedemptionsTable.promotionId, promo.id),
    inArray(promotionRedemptionsTable.status, ["RESERVED", "REDEEMED"]),
  ));
  if (promo.redemptionLimit != null && activeRedemptions.length >= promo.redemptionLimit) {
    res.status(409).json({ error: "Promotion redemption limit reached", code: "PROMO_LIMIT" }); return;
  }
  if (activeRedemptions.filter((row) => row.playerId === booking.playerId).length >= promo.perPlayerLimit) {
    res.status(409).json({ error: "You have already used this promotion", code: "PROMO_PLAYER_LIMIT" }); return;
  }
  res.json({ quote: quoteFromDiscount(subtotal, calculateDiscount(subtotal, promo.kind, promo.value), "PROMOTION", promo.id) });
});

router.get("/player/venues/:venueId/streak", requireAuth, requireRole("PLAYER"), async (req, res) => {
  const venueId = req.params.venueId as string;
  const growthEnabled = await venueGrowthToolsEnabled(venueId);
  const [setting] = await db.select().from(venueStreakSettingsTable)
    .where(eq(venueStreakSettingsTable.venueId, venueId)).limit(1);
  const [progress] = await db.select().from(venueStreakProgressTable).where(and(
    eq(venueStreakProgressTable.venueId, venueId),
    eq(venueStreakProgressTable.playerId, req.user!.userId),
  )).limit(1);
  const [reward] = growthEnabled && progress ? await db.select().from(venueStreakRewardsTable).where(and(
    eq(venueStreakRewardsTable.progressId, progress.id),
    eq(venueStreakRewardsTable.status, "AVAILABLE"),
    sql`${venueStreakRewardsTable.expiresAt} > now()`,
  )).limit(1) : [];
  res.json({
    enabled: growthEnabled && (setting?.enabled ?? false),
    progress: growthEnabled && progress
      ? { ...progress, paidWeeks: progress.expiresAt && progress.expiresAt <= new Date() ? 0 : progress.paidWeeks }
      : null,
    rewardAvailable: !!reward,
    reward: reward ? { id: reward.id, status: reward.status, expiresAt: reward.expiresAt.toISOString() } : null,
  });
});

export default router;