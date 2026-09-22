import { db } from "@workspace/db";
import {
  bookingsTable,
  matchProposalsTable,
  ownerSubscriptionsTable,
  pitchesTable,
  openingHoursTable,
  squadAvailabilityTable,
  squadRequestMembersTable,
  squadRequestsTable,
  venuesTable,
  waitlistClaimsTable,
  waitlistEntriesTable,
} from "@workspace/db/schema";
import { and, asc, eq, gt, inArray, lt, lte, or, sql } from "drizzle-orm";
import { getOwnerEntitlements } from "./entitlements";
import { sendNotification } from "./notifications";
import { reserveValidatedSlot, SlotBookingError } from "./slot-booking";
import { logger } from "./logger";
import { availabilityOverlaps, skillRangesOverlap, validSlotStartsInOverlap } from "./elite-validation";

export async function assertEliteVenue(venueId: string) {
  const [venue] = await db.select().from(venuesTable).where(eq(venuesTable.id, venueId)).limit(1);
  if (!venue || venue.status !== "APPROVED") throw Object.assign(new Error("Elite venue not found"), { status: 404 });
  const entitlement = await getOwnerEntitlements(venue.ownerId);
  if (entitlement.effectivePlan !== "ELITE") {
    throw Object.assign(new Error("This feature requires an Elite owner plan."), { status: 403, code: "ENTITLEMENT_REQUIRED" });
  }
  return venue;
}

export async function consumeEliteMutation(userId: string, action: string, limit = 20) {
  const now = new Date();
  const expires = new Date(now.getTime() + 60_000);
  const result = await db.execute(sql`
    INSERT INTO elite_mutation_buckets (user_id, action, count, window_started_at, expires_at)
    VALUES (${userId}, ${action}, 1, ${now}, ${expires})
    ON CONFLICT (user_id, action) DO UPDATE SET
      count = CASE WHEN elite_mutation_buckets.expires_at <= ${now} THEN 1 ELSE elite_mutation_buckets.count + 1 END,
      window_started_at = CASE WHEN elite_mutation_buckets.expires_at <= ${now} THEN ${now} ELSE elite_mutation_buckets.window_started_at END,
      expires_at = CASE WHEN elite_mutation_buckets.expires_at <= ${now} THEN ${expires} ELSE elite_mutation_buckets.expires_at END
    RETURNING count, expires_at
  `);
  const row = result.rows[0] as { count: number | string; expires_at: Date | string };
  if (Number(row.count) > limit) {
    const retryAfter = Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - now.getTime()) / 1000));
    throw Object.assign(new Error("Too many requests"), { status: 429, retryAfter });
  }
}

export async function attemptMatch(requestId: string): Promise<void> {
  const [request] = await db.select().from(squadRequestsTable).where(and(
    eq(squadRequestsTable.id, requestId), eq(squadRequestsTable.status, "PENDING"), gt(squadRequestsTable.expiresAt, new Date()),
  )).limit(1);
  if (!request) return;
  const candidates = await db.select().from(squadRequestsTable).where(and(
    eq(squadRequestsTable.venueId, request.venueId), eq(squadRequestsTable.status, "PENDING"),
    gt(squadRequestsTable.expiresAt, new Date()), lt(squadRequestsTable.skillMin, request.skillMax + 1),
    gt(squadRequestsTable.skillMax, request.skillMin - 1),
  )).orderBy(asc(squadRequestsTable.createdAt)).limit(20);
  const ownAvailability = await db.select().from(squadAvailabilityTable).where(eq(squadAvailabilityTable.requestId, request.id));
  const venuePitches = await db.select().from(pitchesTable).where(eq(pitchesTable.venueId, request.venueId));
  for (const candidate of candidates) {
    if (candidate.id === request.id) continue;
    if (!skillRangesOverlap(request.skillMin, request.skillMax, candidate.skillMin, candidate.skillMax)) continue;
    const theirs = await db.select().from(squadAvailabilityTable).where(eq(squadAvailabilityTable.requestId, candidate.id));
    // Check shared members with a parameterized EXISTS query; captains may not
    // match if any player appears in both submitted squads.
    const requestMembers = await db.select({ userId: squadRequestMembersTable.userId }).from(squadRequestMembersTable).where(eq(squadRequestMembersTable.requestId, request.id));
    const candidateMembers = await db.select({ userId: squadRequestMembersTable.userId }).from(squadRequestMembersTable).where(eq(squadRequestMembersTable.requestId, candidate.id));
    if (requestMembers.some((m) => candidateMembers.some((other) => other.userId === m.userId))) continue;
    for (const a of ownAvailability) {
      for (const b of theirs) {
        if (!availabilityOverlaps(a, b)) continue;
        const compatiblePitches = venuePitches.filter((pitch) =>
          (!a.pitchId || a.pitchId === pitch.id) && (!b.pitchId || b.pitchId === pitch.id));
        for (const pitch of compatiblePitches) {
          if (a.isExactSlot && b.isExactSlot && a.startAt.getTime() !== b.startAt.getTime()) continue;
          const overlapStart = new Date(Math.max(a.startAt.getTime(), b.startAt.getTime(), Date.now()));
          const overlapEnd = new Date(Math.min(a.endAt.getTime(), b.endAt.getTime()));
          // Availability may span midnight and several calendar days. Opening
          // hours are a property of each candidate day, not the overlap start.
          for (let day = new Date(Date.UTC(overlapStart.getUTCFullYear(), overlapStart.getUTCMonth(), overlapStart.getUTCDate()));
            day < overlapEnd; day.setUTCDate(day.getUTCDate() + 1)) {
            const dayStart = new Date(day);
            const dayEnd = new Date(day); dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
            const candidateStart = new Date(Math.max(overlapStart.getTime(), dayStart.getTime()));
            const candidateEnd = new Date(Math.min(overlapEnd.getTime(), dayEnd.getTime()));
            const [hours] = await db.select().from(openingHoursTable).where(and(
              eq(openingHoursTable.venueId, request.venueId), eq(openingHoursTable.dayOfWeek, day.getUTCDay()),
            )).limit(1);
            if (!hours || hours.isClosed) continue;
            for (const startAt of validSlotStartsInOverlap({ overlapStart: candidateStart, overlapEnd: candidateEnd, pitchId: pitch.id,
              durationMinutes: pitch.slotDurationMinutes, openTime: hours.openTime, closeTime: hours.closeTime,
              exactA: !!a.isExactSlot, exactB: !!b.isExactSlot, exactStartA: a.startAt, exactStartB: b.startAt })) try {
          const booking = await reserveValidatedSlot({
            pitchId: pitch.id, playerId: request.captainId, startAt, status: "PENDING",
            afterReserve: async (tx, inserted) => {
              const locked = await tx.update(squadRequestsTable).set({ status: "MATCHED", updatedAt: new Date() }).where(and(
                inArray(squadRequestsTable.id, [request.id, candidate.id]), eq(squadRequestsTable.status, "PENDING"),
              )).returning({ id: squadRequestsTable.id });
              if (locked.length !== 2) throw Object.assign(new Error("match_race"), { code: "MATCH_RACE" });
              await tx.insert(matchProposalsTable).values({
                venueId: request.venueId, squadAId: request.id, squadBId: candidate.id, bookingId: inserted.id,
                expiresAt: new Date(Date.now() + 30 * 60_000),
              });
            },
          });
          await Promise.all([request, candidate].map((squad) => sendNotification({
            userId: squad.captainId, type: "SQUAD_MATCHED", title: "Squad match found",
            body: "A compatible squad and pitch have been reserved. Respond within 30 minutes.",
            entityType: "BOOKING", entityId: booking.id, dedupeKey: `squad-match:${booking.id}:${squad.id}`,
          })));
          return;
        } catch (error) {
          if (error instanceof SlotBookingError || (error as { code?: string }).code === "MATCH_RACE") continue;
          throw error;
        }
          }
        }
      }
    }
  }
}
export async function promoteWaitlist(pitchId: string, startAt: Date): Promise<void> {
  let promoted: { id: string; userId: string; claimId: string; expiresAt: Date } | undefined;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${pitchId}:${startAt.toISOString()}`}))`);
    const now = new Date();
    const active = await tx.select().from(waitlistClaimsTable).where(and(
      eq(waitlistClaimsTable.pitchId, pitchId), eq(waitlistClaimsTable.startAt, startAt), eq(waitlistClaimsTable.status, "ACTIVE"),
    )).limit(1);
    if (active[0] && active[0].expiresAt > now) return;
    if (active[0]) {
      await tx.update(waitlistClaimsTable).set({ status: "EXPIRED", resolvedAt: now }).where(eq(waitlistClaimsTable.id, active[0].id));
      await tx.update(waitlistEntriesTable).set({ status: "EXPIRED", updatedAt: now }).where(eq(waitlistEntriesTable.id, active[0].entryId));
    }
    const occupied = await tx.select({ id: bookingsTable.id }).from(bookingsTable).where(and(
      eq(bookingsTable.pitchId, pitchId), eq(bookingsTable.startAt, startAt), inArray(bookingsTable.status, ["PENDING", "CONFIRMED"]),
    )).limit(1);
    if (occupied.length) return;
    const entries = await tx.select().from(waitlistEntriesTable).where(and(
      eq(waitlistEntriesTable.pitchId, pitchId), eq(waitlistEntriesTable.startAt, startAt), eq(waitlistEntriesTable.status, "WAITING"),
    )).orderBy(asc(waitlistEntriesTable.position)).limit(100).for("update", { skipLocked: true });
    let eligible: typeof entries[number] | undefined;
    for (const entry of entries) {
      const activeForUser = await tx.select({ id: waitlistClaimsTable.id }).from(waitlistClaimsTable).where(and(
        eq(waitlistClaimsTable.userId, entry.userId), eq(waitlistClaimsTable.status, "ACTIVE"),
      )).limit(1);
      if (!activeForUser.length) { eligible = entry; break; }
    }
    if (!eligible) return;
    const entry = eligible;
    const expiresAt = new Date(now.getTime() + 10 * 60_000);
    const [claim] = await tx.insert(waitlistClaimsTable).values({
      entryId: entry.id, userId: entry.userId, pitchId, startAt, expiresAt,
    }).returning();
    await tx.update(waitlistEntriesTable).set({ status: "OFFERED", updatedAt: now }).where(eq(waitlistEntriesTable.id, entry.id));
    promoted = { id: entry.id, userId: entry.userId, claimId: claim!.id, expiresAt };
  }, { isolationLevel: "serializable" });
  if (promoted) await sendNotification({
    userId: promoted.userId, type: "WAITLIST_CLAIM", title: "A slot is available",
    body: "You have 10 minutes to claim your exclusive waitlist offer.", entityType: "WAITLIST_CLAIM",
    entityId: promoted.claimId, dedupeKey: `waitlist-claim:${promoted.claimId}`,
  });
}

export async function recoverEliteWork(): Promise<void> {
  const now = new Date();
  const expiredClaims = await db.select().from(waitlistClaimsTable).where(and(
    eq(waitlistClaimsTable.status, "ACTIVE"), lte(waitlistClaimsTable.expiresAt, now),
  )).limit(100);
  for (const claim of expiredClaims) {
    await promoteWaitlist(claim.pitchId, claim.startAt);
    await sendNotification({
      userId: claim.userId, type: "WAITLIST_CLAIM_EXPIRED", title: "Waitlist offer expired",
      body: "Your exclusive claim window expired.", entityType: "WAITLIST_CLAIM", entityId: claim.id,
      dedupeKey: `waitlist-expired:${claim.id}`,
    });
  }
  const expiredRequests = await db.update(squadRequestsTable).set({ status: "EXPIRED", updatedAt: now }).where(and(
    eq(squadRequestsTable.status, "PENDING"), lte(squadRequestsTable.expiresAt, now),
  )).returning({ id: squadRequestsTable.id, captainId: squadRequestsTable.captainId });
  await Promise.all(expiredRequests.map((request) => sendNotification({
    userId: request.captainId, type: "MATCH_EXPIRED", title: "Squad request expired",
    body: "Your squad request expired before a match was found.", entityType: "SQUAD_REQUEST",
    entityId: request.id, dedupeKey: `squad-request-expired:${request.id}`,
  })));
  const proposals = await db.select().from(matchProposalsTable).where(and(
    inArray(matchProposalsTable.status, ["PENDING", "ACCEPTED"]), lte(matchProposalsTable.expiresAt, now),
  )).limit(100);
  for (const proposal of proposals) {
    let expired = false;
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(matchProposalsTable)
        .where(eq(matchProposalsTable.id, proposal.id)).limit(1).for("update");
      if (!locked || !["PENDING", "ACCEPTED"].includes(locked.status) || locked.expiresAt > now) return;
      const [transitioned] = await tx.update(matchProposalsTable).set({ status: "EXPIRED", updatedAt: now }).where(and(
        eq(matchProposalsTable.id, proposal.id), inArray(matchProposalsTable.status, ["PENDING", "ACCEPTED"]),
      )).returning({ id: matchProposalsTable.id });
      if (!transitioned) return;
      expired = true;
      await tx.update(bookingsTable).set({ status: "CANCELLED", updatedAt: now }).where(and(
        eq(bookingsTable.id, proposal.bookingId), eq(bookingsTable.status, "PENDING"),
      ));
      await tx.update(squadRequestsTable).set({ status: "PENDING", updatedAt: now }).where(and(
        inArray(squadRequestsTable.id, [proposal.squadAId, proposal.squadBId]),
        gt(squadRequestsTable.expiresAt, now),
      ));
    });
    if (!expired) continue;
    const squads = await db.select().from(squadRequestsTable).where(inArray(
      squadRequestsTable.id, [proposal.squadAId, proposal.squadBId],
    ));
    await Promise.all(squads.map((squad) => sendNotification({
      userId: squad.captainId, type: "MATCH_EXPIRED", title: "Match proposal expired",
      body: "The reserved match was released because the proposal expired.",
      entityType: "BOOKING", entityId: proposal.bookingId,
      dedupeKey: `match-expired:${proposal.id}:${squad.id}`,
    })));
    const [booking] = await db.select({ pitchId: bookingsTable.pitchId, startAt: bookingsTable.startAt })
      .from(bookingsTable).where(eq(bookingsTable.id, proposal.bookingId)).limit(1);
    if (booking) await promoteWaitlist(booking.pitchId, booking.startAt);
  }
  const pending = await db.select({ id: squadRequestsTable.id }).from(squadRequestsTable).where(and(
    eq(squadRequestsTable.status, "PENDING"), gt(squadRequestsTable.expiresAt, now),
  )).orderBy(asc(squadRequestsTable.createdAt)).limit(100);
  for (const request of pending) await attemptMatch(request.id);
}

export function startEliteRecovery(intervalMs = 30_000): NodeJS.Timeout {
  void recoverEliteWork().catch((err) => logger.error({ err }, "Elite recovery failed"));
  return setInterval(() => void recoverEliteWork().catch((err) => logger.error({ err }, "Elite recovery failed")), intervalMs);
}