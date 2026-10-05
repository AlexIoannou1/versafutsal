import {
  promotionRedemptionsTable,
  promotionsTable,
  venueStreakEntriesTable,
  venueStreakProgressTable,
  venueStreakRewardsTable,
  venueStreakSettingsTable,
  notificationsTable,
  venuesTable,
  bookingsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { getOwnerEntitlements, planHasCapability } from "./entitlements";

export type PricingQuote = {
  currency: "EUR";
  subtotal: string;
  discountAmount: string;
  payableAmount: string;
  incentiveType: "PROMOTION" | "STREAK_REWARD" | null;
  incentiveId: string | null;
};
export const PROMOTION_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
export const PROMOTION_VALUE_RE = /^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?$/;

/** Rebuild the current cycle; refunds in settled older cycles are not new credits. */
async function recomputeStreakProgress(tx: any, progressId: string) {
  const rewards: Array<typeof venueStreakRewardsTable.$inferSelect> = await tx.select()
    .from(venueStreakRewardsTable).where(eq(venueStreakRewardsTable.progressId, progressId));
  const ids = (reward: typeof venueStreakRewardsTable.$inferSelect): string[] =>
    Array.isArray(reward.metadata.qualifyingBookingIds)
      ? reward.metadata.qualifyingBookingIds.filter((id): id is string => typeof id === "string") : [];
  const qualifyingIds = [...new Set(rewards.flatMap(ids))];
  const qualifyingBookings: { id: string; startAt: Date }[] = qualifyingIds.length
    ? await tx.select({ id: bookingsTable.id, startAt: bookingsTable.startAt }).from(bookingsTable)
      .where(inArray(bookingsTable.id, qualifyingIds)) : [];
  const dates = new Map(qualifyingBookings.map((booking) => [booking.id, booking.startAt.getTime()]));
  const cycleEnd = (reward: typeof venueStreakRewardsTable.$inferSelect) =>
    Math.max(0, ...ids(reward).map((id) => dates.get(id) ?? 0));
  const boundary = Math.max(0, ...rewards.map(cycleEnd));
  const latest = rewards.filter((reward) => cycleEnd(reward) === boundary);
  const settled = latest.some((reward) => ["AVAILABLE", "RESERVED", "REDEEMED"].includes(reward.status));
  const reopenedIds = new Set(settled ? [] : latest.flatMap(ids));
  const entries: { bookingId: string; weekKey: string; startAt: Date }[] = await tx.select({
    bookingId: venueStreakEntriesTable.bookingId, weekKey: venueStreakEntriesTable.weekKey,
    startAt: bookingsTable.startAt,
  }).from(venueStreakEntriesTable).innerJoin(bookingsTable, eq(bookingsTable.id, venueStreakEntriesTable.bookingId))
    .where(eq(venueStreakEntriesTable.progressId, progressId)).orderBy(bookingsTable.startAt);
  let count = 0;
  let last: typeof entries[number] | undefined;
  for (const entry of entries) {
    if (entry.startAt.getTime() <= boundary && !reopenedIds.has(entry.bookingId)) continue;
    if (last && entry.startAt.getTime() >= last.startAt.getTime() + 14 * 86400000) count = 0;
    count++;
    last = entry;
  }
  await tx.update(venueStreakProgressTable).set({
    paidWeeks: Math.min(3, count), lastQualifiedWeek: last?.weekKey ?? null,
    expiresAt: last ? new Date(last.startAt.getTime() + 14 * 86400000) : null,
    updatedAt: new Date(),
  }).where(eq(venueStreakProgressTable.id, progressId));
}

export function isValidPromotionInput(code: unknown, value: unknown): boolean {
  return typeof code === "string" && PROMOTION_CODE_RE.test(code.trim().toUpperCase()) &&
    (typeof value === "string" || typeof value === "number") && PROMOTION_VALUE_RE.test(String(value));
}

/** Checks the live owner plan as well as the venue setting; never trusts a stale setting alone. */
export async function venueGrowthToolsEnabled(venueId: string): Promise<boolean> {
  const [venue] = await db.select({ ownerId: venuesTable.ownerId }).from(venuesTable)
    .where(eq(venuesTable.id, venueId)).limit(1);
  if (!venue) return false;
  const entitlements = await getOwnerEntitlements(venue.ownerId);
  return planHasCapability(entitlements.effectivePlan, "GROWTH_TOOLS");
}

function cents(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Invalid monetary amount");
  return Math.round(parsed * 100);
}

function money(value: number): string {
  return (value / 100).toFixed(2);
}

export function calculateDiscount(
  subtotal: string,
  kind: "PERCENTAGE" | "FIXED",
  value: string,
): string {
  const subtotalCents = cents(subtotal);
  const discount = kind === "PERCENTAGE"
    ? Math.round(subtotalCents * Number(value) / 100)
    : cents(value);
  return money(Math.min(subtotalCents, Math.max(0, discount)));
}

export function quoteFromDiscount(
  subtotal: string,
  discountAmount = "0.00",
  incentiveType: PricingQuote["incentiveType"] = null,
  incentiveId: string | null = null,
): PricingQuote {
  const subtotalCents = cents(subtotal);
  const discountCents = Math.min(subtotalCents, cents(discountAmount));
  return {
    currency: "EUR",
    subtotal: money(subtotalCents),
    discountAmount: money(discountCents),
    payableAmount: money(subtotalCents - discountCents),
    incentiveType,
    incentiveId,
  };
}

export function weekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function reservePromotion(
  tx: any,
  opts: { bookingId: string; playerId: string; venueId: string; code: string; subtotal: string; now?: Date },
): Promise<PricingQuote> {
  const now = opts.now ?? new Date();
  if (!await venueGrowthToolsEnabled(opts.venueId)) {
    throw Object.assign(new Error("Promotion is unavailable because this venue no longer offers growth tools"), { code: "GROWTH_DISABLED" });
  }
  const code = opts.code.trim().toUpperCase();
  await tx.execute(sql`SELECT id FROM bookings WHERE id = ${opts.bookingId} FOR UPDATE`);
  await tx.execute(sql`SELECT id FROM promotions WHERE venue_id = ${opts.venueId} AND code = ${code} FOR UPDATE`);
  const [promotion] = await tx.select().from(promotionsTable).where(and(
    eq(promotionsTable.venueId, opts.venueId),
    eq(promotionsTable.code, code),
  )).limit(1);
  if (!promotion || !promotion.enabled) throw Object.assign(new Error("Promotion is invalid or disabled"), { code: "PROMO_INVALID" });
  if ((promotion.startsAt && promotion.startsAt > now) || (promotion.endsAt && promotion.endsAt <= now)) {
    throw Object.assign(new Error("Promotion is not active"), { code: "PROMO_INACTIVE" });
  }
  const redemptions = await tx.select().from(promotionRedemptionsTable).where(and(
    eq(promotionRedemptionsTable.promotionId, promotion.id),
    inArray(promotionRedemptionsTable.status, ["RESERVED", "REDEEMED"]),
  ));
  if (promotion.redemptionLimit != null && redemptions.length >= promotion.redemptionLimit) {
    throw Object.assign(new Error("Promotion redemption limit reached"), { code: "PROMO_LIMIT" });
  }
  if (redemptions.filter((row: any) => row.playerId === opts.playerId).length >= promotion.perPlayerLimit) {
    throw Object.assign(new Error("You have already used this promotion"), { code: "PROMO_PLAYER_LIMIT" });
  }
  const discount = calculateDiscount(opts.subtotal, promotion.kind, promotion.value);
  await tx.insert(promotionRedemptionsTable).values({
    promotionId: promotion.id,
    bookingId: opts.bookingId,
    playerId: opts.playerId,
    discountAmount: discount,
  });
  return quoteFromDiscount(opts.subtotal, discount, "PROMOTION", promotion.id);
}

export async function reserveStreakReward(
  tx: any,
  opts: { bookingId: string; playerId: string; venueId: string; subtotal: string; now?: Date },
): Promise<PricingQuote | null> {
  const now = opts.now ?? new Date();
  if (!await venueGrowthToolsEnabled(opts.venueId)) return null;
  await tx.execute(sql`SELECT id FROM bookings WHERE id = ${opts.bookingId} FOR UPDATE`);
  const [progress] = await tx.select().from(venueStreakProgressTable).where(and(
    eq(venueStreakProgressTable.venueId, opts.venueId),
    eq(venueStreakProgressTable.playerId, opts.playerId),
  )).limit(1);
  if (!progress) return null;
  await tx.execute(sql`SELECT id FROM venue_streak_progress WHERE id = ${progress.id} FOR UPDATE`);
  const [reward] = await tx.select().from(venueStreakRewardsTable).where(and(
    eq(venueStreakRewardsTable.progressId, progress.id),
    eq(venueStreakRewardsTable.status, "AVAILABLE"),
    sql`${venueStreakRewardsTable.expiresAt} > ${now}`,
  )).limit(1);
  if (!reward) return null;
  const [claimed] = await tx.update(venueStreakRewardsTable).set({
    status: "RESERVED",
    bookingId: opts.bookingId,
  }).where(and(eq(venueStreakRewardsTable.id, reward.id), eq(venueStreakRewardsTable.status, "AVAILABLE"))).returning();
  if (!claimed) throw Object.assign(new Error("Reward was claimed concurrently"), { code: "REWARD_CONFLICT" });
  return quoteFromDiscount(opts.subtotal, opts.subtotal, "STREAK_REWARD", reward.id);
}

export async function finalizeGrowthIncentive(tx: any, booking: {
  id: string; playerId: string; venueId: string; startAt: Date; pricingSnapshot?: any;
}): Promise<void> {
  const snapshot = booking.pricingSnapshot;
  if (snapshot?.incentiveType === "PROMOTION") {
    await tx.update(promotionRedemptionsTable).set({ status: "REDEEMED", redeemedAt: new Date() })
      .where(and(eq(promotionRedemptionsTable.bookingId, booking.id), eq(promotionRedemptionsTable.status, "RESERVED")));
    // A fully discounted booking is not one of the four paid qualifying weeks.
    if (snapshot.payableAmount === "0.00") return;
  } else if (snapshot?.incentiveType === "STREAK_REWARD") {
    const [reward] = await tx.select().from(venueStreakRewardsTable)
      .where(eq(venueStreakRewardsTable.id, snapshot.incentiveId)).limit(1);
    if (!reward) throw new Error("STREAK_REWARD_UNAVAILABLE");
    await tx.execute(sql`SELECT id FROM venue_streak_progress WHERE id = ${reward.progressId} FOR UPDATE`);
    const redeemed = await tx.update(venueStreakRewardsTable).set({ status: "REDEEMED", redeemedAt: new Date() })
      .where(and(eq(venueStreakRewardsTable.bookingId, booking.id), eq(venueStreakRewardsTable.status, "RESERVED"))).returning();
    if (!redeemed.length) throw new Error("STREAK_REWARD_UNAVAILABLE");
    const earnedFromBookingId = reward.sourceBookingId ?? reward.metadata?.earnedFromBookingId;
    if (typeof earnedFromBookingId === "string") {
      await tx.delete(notificationsTable).where(and(
        eq(notificationsTable.entityId, reward.progressId),
        inArray(notificationsTable.dedupeKey, [earnedFromBookingId, reward.id]),
        eq(notificationsTable.pushSent, false),
      ));
    }
    return;
  }
  if (!await venueGrowthToolsEnabled(booking.venueId)) return;
  const [setting] = await tx.select().from(venueStreakSettingsTable)
    .where(and(eq(venueStreakSettingsTable.venueId, booking.venueId), eq(venueStreakSettingsTable.enabled, true))).limit(1);
  if (!setting) return;
  const [progress] = await tx.insert(venueStreakProgressTable).values({
    venueId: booking.venueId, playerId: booking.playerId,
  }).onConflictDoUpdate({
    target: [venueStreakProgressTable.venueId, venueStreakProgressTable.playerId],
    set: { updatedAt: new Date() },
  }).returning();
  if (!progress) return;
  const key = weekKey(booking.startAt);
  const inserted = await tx.insert(venueStreakEntriesTable).values({
    progressId: progress.id, bookingId: booking.id, weekKey: key,
  }).onConflictDoNothing().returning();
  if (!inserted.length) return;
  const previousPaidWeeks =
    progress.expiresAt && progress.expiresAt <= booking.startAt ? 0 : progress.paidWeeks;
  const paidWeeks = Math.min(4, previousPaidWeeks + 1);
  const expiry = new Date(booking.startAt.getTime() + 14 * 86400000);
  await tx.update(venueStreakProgressTable).set({
    paidWeeks: paidWeeks === 4 ? 0 : paidWeeks,
    lastQualifiedWeek: key,
    expiresAt: expiry,
    updatedAt: new Date(),
  }).where(eq(venueStreakProgressTable.id, progress.id));
  await tx.delete(notificationsTable).where(and(
    eq(notificationsTable.userId, booking.playerId),
    eq(notificationsTable.entityType, "STREAK_PROGRESS"),
    eq(notificationsTable.entityId, progress.id),
    eq(notificationsTable.pushSent, false),
    inArray(notificationsTable.type, ["STREAK_NEAR_COMPLETION", "STREAK_EXPIRING"]),
  ));
  if (paidWeeks === 3) {
    await tx.insert(notificationsTable).values({
      userId: booking.playerId,
      type: "STREAK_NEAR_COMPLETION",
      title: "One booking from a free game",
      body: "Book one more qualifying week to earn your fifth booking free.",
      entityType: "STREAK_PROGRESS",
      entityId: progress.id,
      dedupeKey: booking.id,
      scheduledAt: new Date(),
    }).onConflictDoNothing();
  }
  const expiryNotificationAt = new Date(expiry.getTime() - 3 * 86400000);
  await tx.insert(notificationsTable).values({
    userId: booking.playerId,
    type: "STREAK_EXPIRING",
    title: "Your venue streak expires soon",
    body: "Book again before your weekly streak expires.",
    entityType: "STREAK_PROGRESS",
    entityId: progress.id,
    dedupeKey: booking.id,
    scheduledAt: expiryNotificationAt,
  }).onConflictDoNothing();
  if (paidWeeks === 4) {
    const cycleEntries = await tx.select({ bookingId: venueStreakEntriesTable.bookingId })
      .from(venueStreakEntriesTable).where(eq(venueStreakEntriesTable.progressId, progress.id))
      .orderBy(desc(venueStreakEntriesTable.createdAt), desc(venueStreakEntriesTable.id)).limit(4);
    await tx.insert(venueStreakRewardsTable).values({
      progressId: progress.id,
      sourceBookingId: booking.id,
      expiresAt: expiry,
      metadata: { earnedFromBookingId: booking.id, qualifyingBookingIds: cycleEntries.map((entry: any) => entry.bookingId) },
    });
  }
}

export async function reverseGrowthIncentive(tx: any, bookingId: string): Promise<void> {
  const [entryToReverse] = await tx.select().from(venueStreakEntriesTable)
    .where(eq(venueStreakEntriesTable.bookingId, bookingId)).limit(1);
  const [usedReward] = await tx.select().from(venueStreakRewardsTable)
    .where(eq(venueStreakRewardsTable.bookingId, bookingId)).limit(1);
  const progressId = entryToReverse?.progressId ?? usedReward?.progressId;
  if (progressId) await tx.execute(sql`SELECT id FROM venue_streak_progress WHERE id = ${progressId} FOR UPDATE`);
  await tx.update(promotionRedemptionsTable).set({ status: "REVERSED", reversedAt: new Date() })
    .where(and(eq(promotionRedemptionsTable.bookingId, bookingId), inArray(promotionRedemptionsTable.status, ["RESERVED", "REDEEMED"])));
  const reversedUsedRewards = await tx.update(venueStreakRewardsTable)
    .set({ status: "REVERSED", reversedAt: new Date() })
    .where(and(
      eq(venueStreakRewardsTable.bookingId, bookingId),
      inArray(venueStreakRewardsTable.status, ["RESERVED", "REDEEMED"]),
    )).returning();
  for (const reward of reversedUsedRewards) {
    const qualifyingIds = reward.metadata?.qualifyingBookingIds;
    if (Array.isArray(qualifyingIds) && qualifyingIds.length) {
      const remaining = await tx.select({ id: venueStreakEntriesTable.id }).from(venueStreakEntriesTable)
        .where(inArray(venueStreakEntriesTable.bookingId, qualifyingIds));
      if (remaining.length !== qualifyingIds.length) continue;
    }
    const [restored] = await tx.insert(venueStreakRewardsTable).values({
      progressId: reward.progressId,
      expiresAt: reward.expiresAt,
      metadata: { ...reward.metadata, restoredFromRewardId: reward.id },
    }).returning();
    if (restored && reward.expiresAt > new Date()) {
      await tx.insert(notificationsTable).values({
        userId: (await tx.select({ playerId: venueStreakProgressTable.playerId })
          .from(venueStreakProgressTable).where(eq(venueStreakProgressTable.id, reward.progressId)).limit(1))[0].playerId,
        type: "STREAK_EXPIRING", title: "Your free booking reward expires soon",
        body: "Use your restored weekly streak reward before it expires.",
        entityType: "STREAK_PROGRESS", entityId: reward.progressId, dedupeKey: restored.id,
        scheduledAt: new Date(Math.max(Date.now(), reward.expiresAt.getTime() - 3 * 86400000)),
      }).onConflictDoNothing();
    }
  }
  const [entry] = await tx.delete(venueStreakEntriesTable)
    .where(eq(venueStreakEntriesTable.bookingId, bookingId)).returning();
  if (entry) {
    await tx.update(venueStreakRewardsTable).set({ status: "REVERSED", reversedAt: new Date() })
      .where(and(
        sql`(${venueStreakRewardsTable.sourceBookingId} = ${bookingId} OR (${venueStreakRewardsTable.metadata}->'qualifyingBookingIds') @> ${JSON.stringify([bookingId])}::jsonb)`,
        inArray(venueStreakRewardsTable.status, ["AVAILABLE", "RESERVED"]),
      ));
    await recomputeStreakProgress(tx, entry.progressId);
    await tx.delete(notificationsTable).where(and(
      eq(notificationsTable.entityType, "STREAK_PROGRESS"),
      eq(notificationsTable.entityId, entry.progressId),
      eq(notificationsTable.pushSent, false),
      inArray(notificationsTable.type, ["STREAK_NEAR_COMPLETION", "STREAK_EXPIRING"]),
    ));
  }
}

/** Releases an unpriced checkout reservation after provider intent creation fails. */
export async function releaseGrowthReservation(tx: any, bookingId: string): Promise<void> {
  await tx.delete(promotionRedemptionsTable).where(and(
    eq(promotionRedemptionsTable.bookingId, bookingId),
    eq(promotionRedemptionsTable.status, "RESERVED"),
  ));
  await tx.update(venueStreakRewardsTable).set({ status: "AVAILABLE", bookingId: null })
    .where(and(
      eq(venueStreakRewardsTable.bookingId, bookingId),
      eq(venueStreakRewardsTable.status, "RESERVED"),
    ));
}