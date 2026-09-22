import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  bookingsTable,
  matchProposalsTable,
  pitchesTable,
  squadAvailabilityTable,
  squadRequestMembersTable,
  squadRequestsTable,
  usersTable,
  venuesTable,
  waitlistClaimsTable,
  waitlistEntriesTable,
} from "@workspace/db/schema";
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, lt, or } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";
import { assertEliteVenue, attemptMatch, consumeEliteMutation, promoteWaitlist } from "../lib/elite";
import { reserveValidatedSlot, SlotBookingError } from "../lib/slot-booking";
import { sendNotification } from "../lib/notifications";
import {
  CreateSquadRequestBody,
  JoinSlotWaitlistBody,
  RespondMatchProposalBody,
} from "@workspace/api-zod";
import { cappedResultLimit, isCompleteFivePlayerSquad } from "../lib/elite-validation";

const router: IRouter = Router();
const cap = cappedResultLimit;
const iso = (date: Date) => date.toISOString();

async function requestView(id: string, captainId?: string) {
  const conditions = [eq(squadRequestsTable.id, id)];
  if (captainId) conditions.push(eq(squadRequestsTable.captainId, captainId));
  const [request] = await db.select().from(squadRequestsTable).where(and(...conditions)).limit(1);
  if (!request) return null;
  const [members, availability, proposals] = await Promise.all([
    db.select().from(squadRequestMembersTable).where(eq(squadRequestMembersTable.requestId, id)).orderBy(asc(squadRequestMembersTable.position)),
    db.select().from(squadAvailabilityTable).where(eq(squadAvailabilityTable.requestId, id)),
    db.select().from(matchProposalsTable).where(and(
      inArray(matchProposalsTable.status, ["PENDING", "ACCEPTED", "BOOKED"]),
      or(eq(matchProposalsTable.squadAId, id), eq(matchProposalsTable.squadBId, id)),
    )).orderBy(desc(matchProposalsTable.createdAt)).limit(1),
  ]);
  const proposal = proposals.find((p) => p.squadAId === id || p.squadBId === id);
  return {
    ...request, expiresAt: iso(request.expiresAt), createdAt: iso(request.createdAt),
    members: members.map((m) => m.userId),
    availability: availability.map((a) => ({
      pitchId: a.pitchId, startAt: iso(a.startAt), endAt: iso(a.endAt), exactSlot: !!a.isExactSlot,
    })),
    proposal: proposal ? { ...proposal, expiresAt: iso(proposal.expiresAt) } : null,
  };
}

router.post("/player/squad-requests", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  try {
    await consumeEliteMutation(req.user!.userId, "CREATE_SQUAD", 10);
    const validated = CreateSquadRequestBody.safeParse(req.body);
    if (!validated.success) {
      res.status(400).json({ error: validated.error.message });
      return;
    }
    const body = req.body as {
      venueId?: string; skillMin?: number; skillMax?: number; members?: { userId?: string }[];
      availability?: { pitchId?: string | null; startAt?: string; endAt?: string; exactSlot?: boolean }[]; expiresAt?: string;
    };
    if (!body.venueId || !Number.isInteger(body.skillMin) || !Number.isInteger(body.skillMax) ||
      body.skillMin! < 1 || body.skillMax! > 10 || body.skillMin! > body.skillMax! ||
      body.members?.length !== 5 || !body.availability?.length || body.availability.length > 50 || !body.expiresAt) {
      res.status(400).json({ error: "A valid venue, skill range, exactly five members, availability, and expiry are required." }); return;
    }
    await assertEliteVenue(body.venueId);
    const memberIds = body.members.map((m) => m.userId).filter((id): id is string => !!id);
    if (!isCompleteFivePlayerSquad(req.user!.userId, memberIds)) {
      res.status(400).json({ error: "Members must be five unique player IDs and include the captain." }); return;
    }
    const users = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(inArray(usersTable.id, memberIds));
    if (users.length !== 5 || users.some((u) => u.role !== "PLAYER")) {
      res.status(400).json({ error: "Every squad member must be an existing player." }); return;
    }
    const expiresAt = new Date(body.expiresAt);
    const availability = body.availability.map((a) => ({
      pitchId: a.pitchId ?? null, startAt: new Date(a.startAt ?? ""), endAt: new Date(a.endAt ?? ""), exactSlot: !!a.exactSlot,
    }));
    if (!(expiresAt > new Date()) || availability.some((a) => !Number.isFinite(a.startAt.getTime()) || !(a.endAt > a.startAt))) {
      res.status(400).json({ error: "Expiry and availability windows must be valid future date-times." }); return;
    }
    const pitchIds = availability.flatMap((a) => a.pitchId ? [a.pitchId] : []);
    if (pitchIds.length) {
      const pitches = await db.select({ id: pitchesTable.id }).from(pitchesTable).where(and(
        eq(pitchesTable.venueId, body.venueId), inArray(pitchesTable.id, pitchIds),
      ));
      if (new Set(pitches.map((p) => p.id)).size !== new Set(pitchIds).size) {
        res.status(400).json({ error: "A preferred pitch does not belong to the venue." }); return;
      }
    }
    let id = "";
    await db.transaction(async (tx) => {
      const [request] = await tx.insert(squadRequestsTable).values({
        captainId: req.user!.userId, venueId: body.venueId!, skillMin: body.skillMin!,
        skillMax: body.skillMax!, expiresAt, status: "DRAFT",
      }).returning();
      id = request!.id;
      await tx.insert(squadRequestMembersTable).values(memberIds.map((userId, position) => ({ requestId: id, userId, position: position + 1 })));
      await tx.insert(squadAvailabilityTable).values(availability.map((a) => ({
        requestId: id, pitchId: a.pitchId, startAt: a.startAt, endAt: a.endAt, isExactSlot: a.exactSlot ? 1 : 0,
      })));
      await tx.update(squadRequestsTable).set({ status: "PENDING", updatedAt: new Date() }).where(eq(squadRequestsTable.id, id));
    });
    void attemptMatch(id).catch((err) => req.log.error({ err, requestId: id }, "Match attempt failed"));
    res.status(201).json(await requestView(id, req.user!.userId));
  } catch (error) {
    const status = (error as { status?: number }).status ?? ((error as { code?: string }).code === "23505" ? 409 : 500);
    if (status === 429) res.setHeader("Retry-After", String((error as { retryAfter?: number }).retryAfter ?? 60));
    req.log[status >= 500 ? "error" : "warn"]({ err: error }, "Create squad request failed");
    res.status(status).json({ error: (error as Error).message });
  }
});

function emailHint(email: string): string {
  const [local, domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, local.length - 1))}@${domain}`;
}

router.get("/player/teammates", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  if (query.length < 3 || query.length > 100) {
    res.status(400).json({ error: "query must be between 3 and 100 characters" });
    return;
  }
  const players = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.role, "PLAYER"), isNull(usersTable.deletedAt), or(
      ilike(usersTable.name, `%${query}%`), ilike(usersTable.email, `%${query}%`),
    )))
    .orderBy(asc(usersTable.name)).limit(Math.min(10, cap(req.query.limit)));
  res.json({ players: players.map((player) => ({ id: player.id, name: player.name, emailHint: emailHint(player.email) })) });
});

router.get("/player/squad-requests", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  const rows = await db.select({ id: squadRequestsTable.id }).from(squadRequestsTable)
    .where(eq(squadRequestsTable.captainId, req.user!.userId)).orderBy(desc(squadRequestsTable.createdAt)).limit(cap(req.query.limit));
  res.json({ requests: (await Promise.all(rows.map((r) => requestView(r.id, req.user!.userId)))).filter(Boolean) });
});

router.get("/player/squad-requests/:id", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  const view = await requestView(String(req.params.id), req.user!.userId);
  if (!view) { res.status(404).json({ error: "Squad request not found" }); return; }
  res.json(view);
});

router.post("/player/squad-requests/:id/cancel", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  await consumeEliteMutation(req.user!.userId, "CANCEL_SQUAD");
  const id = String(req.params.id);
  let releasedSlot: { pitchId: string; startAt: Date } | undefined;
  let cancelledProposalId: string | undefined;
  let otherCaptainId: string | undefined;
  await db.transaction(async (tx) => {
    const cancelled = await tx.update(squadRequestsTable).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(
      eq(squadRequestsTable.id, id), eq(squadRequestsTable.captainId, req.user!.userId),
      inArray(squadRequestsTable.status, ["PENDING", "MATCHED"]),
    )).returning({ id: squadRequestsTable.id });
    if (!cancelled.length) throw Object.assign(new Error("Squad request is not cancellable"), { status: 409 });
    const proposals = await tx.select().from(matchProposalsTable).where(and(
      inArray(matchProposalsTable.status, ["PENDING", "ACCEPTED"]),
      or(eq(matchProposalsTable.squadAId, id), eq(matchProposalsTable.squadBId, id)),
    )).for("update");
    for (const proposal of proposals) {
      const [won] = await tx.update(matchProposalsTable).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(
        eq(matchProposalsTable.id, proposal.id), inArray(matchProposalsTable.status, ["PENDING", "ACCEPTED"]),
      )).returning({ id: matchProposalsTable.id });
      if (!won) continue;
      const [released] = await tx.update(bookingsTable).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(
        eq(bookingsTable.id, proposal.bookingId), inArray(bookingsTable.status, ["PENDING", "CONFIRMED"]),
      )).returning({ pitchId: bookingsTable.pitchId, startAt: bookingsTable.startAt });
      if (released) releasedSlot = released;
      cancelledProposalId = proposal.id;
      const otherId = proposal.squadAId === id ? proposal.squadBId : proposal.squadAId;
      const [other] = await tx.select({ captainId: squadRequestsTable.captainId }).from(squadRequestsTable)
        .where(eq(squadRequestsTable.id, otherId)).limit(1);
      otherCaptainId = other?.captainId;
      await tx.update(squadRequestsTable).set({ status: "PENDING", updatedAt: new Date() }).where(and(
        eq(squadRequestsTable.id, otherId), eq(squadRequestsTable.status, "MATCHED"),
        gt(squadRequestsTable.expiresAt, new Date()),
      ));
    }
  });
  if (releasedSlot) {
    await promoteWaitlist(releasedSlot.pitchId, releasedSlot.startAt);
  }
  if (otherCaptainId && cancelledProposalId) void sendNotification({
    userId: otherCaptainId, type: "MATCH_CANCELLED", title: "Match proposal cancelled",
    body: "The other squad cancelled the proposal; your request is available for matching again.",
    entityType: "BOOKING", entityId: cancelledProposalId,
    dedupeKey: `match-cancelled:${cancelledProposalId}:${otherCaptainId}`,
  });
  const view = await requestView(id, req.user!.userId);
  if (!view) { res.status(404).json({ error: "Squad request not found" }); return; }
  res.json(view);
});

router.post("/player/match-proposals/:id/response", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  await consumeEliteMutation(req.user!.userId, "PROPOSAL_RESPONSE");
  const validated = RespondMatchProposalBody.safeParse(req.body);
  if (!validated.success) { res.status(400).json({ error: validated.error.message }); return; }
  const response = (req.body as { response?: string }).response;
  if (response !== "ACCEPTED" && response !== "DECLINED") { res.status(400).json({ error: "response must be ACCEPTED or DECLINED" }); return; }
  const [proposal] = await db.select().from(matchProposalsTable).where(eq(matchProposalsTable.id, String(req.params.id))).limit(1);
  if (!proposal || !["PENDING", "ACCEPTED"].includes(proposal.status) || proposal.expiresAt <= new Date()) {
    res.status(409).json({ error: "Proposal is no longer active" }); return;
  }
  const squads = await db.select().from(squadRequestsTable).where(inArray(squadRequestsTable.id, [proposal.squadAId, proposal.squadBId]));
  const side = squads.find((s) => s.captainId === req.user!.userId)?.id;
  if (!side) { res.status(403).json({ error: "Only a squad captain may respond" }); return; }
  let resultStatus: "ACCEPTED" | "BOOKED" | "DECLINED" = "ACCEPTED";
  let resultValues: { squadAResponse?: "ACCEPTED" | "DECLINED"; squadBResponse?: "ACCEPTED" | "DECLINED" } = {};
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(matchProposalsTable)
      .where(eq(matchProposalsTable.id, proposal.id)).limit(1).for("update");
    if (!current || !["PENDING", "ACCEPTED"].includes(current.status) || current.expiresAt <= new Date()) {
      throw Object.assign(new Error("Proposal is no longer active"), { code: "PROPOSAL_INACTIVE" });
    }
    resultValues = side === current.squadAId ? { squadAResponse: response } : { squadBResponse: response };
    const a = side === current.squadAId ? response : current.squadAResponse;
    const b = side === current.squadBId ? response : current.squadBResponse;
    resultStatus = response === "DECLINED" ? "DECLINED" : a === "ACCEPTED" && b === "ACCEPTED" ? "BOOKED" : "ACCEPTED";
    await tx.update(matchProposalsTable).set({ ...resultValues, status: resultStatus, updatedAt: new Date() }).where(eq(matchProposalsTable.id, proposal.id));
    if (resultStatus === "BOOKED") {
      await tx.update(bookingsTable).set({ status: "CONFIRMED", updatedAt: new Date() }).where(and(eq(bookingsTable.id, proposal.bookingId), eq(bookingsTable.status, "PENDING")));
      await tx.update(squadRequestsTable).set({ status: "BOOKED", updatedAt: new Date() }).where(inArray(squadRequestsTable.id, [proposal.squadAId, proposal.squadBId]));
    } else if (resultStatus === "DECLINED") {
      await tx.update(bookingsTable).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(bookingsTable.id, proposal.bookingId));
      await tx.update(squadRequestsTable).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(squadRequestsTable.id, side));
      const other = side === proposal.squadAId ? proposal.squadBId : proposal.squadAId;
      await tx.update(squadRequestsTable).set({ status: "PENDING", updatedAt: new Date() }).where(eq(squadRequestsTable.id, other));
    }
  });
  if ((resultStatus as string) === "DECLINED") {
    const [booking] = await db.select({ pitchId: bookingsTable.pitchId, startAt: bookingsTable.startAt })
      .from(bookingsTable).where(eq(bookingsTable.id, proposal.bookingId)).limit(1);
    if (booking) await promoteWaitlist(booking.pitchId, booking.startAt);
    const other = squads.find((squad) => squad.id !== side);
    if (other) void sendNotification({
      userId: other.captainId, type: "MATCH_CANCELLED", title: "Match proposal declined",
      body: "The other squad declined the proposal; your request is available for matching again.",
      entityType: "BOOKING", entityId: proposal.bookingId,
      dedupeKey: `match-declined:${proposal.id}:${other.id}`,
    });
  }
  res.json({ ...proposal, ...resultValues, status: resultStatus, expiresAt: iso(proposal.expiresAt) });
});

router.get("/player/waitlist-entries", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const permittedStatuses = ["WAITING", "OFFERED", "CLAIMED", "LEFT", "EXPIRED", "CANCELLED"] as const;
  if (status && !permittedStatuses.includes(status as typeof permittedStatuses[number])) {
    res.status(400).json({ error: "Invalid waitlist status" });
    return;
  }
  const conditions = [eq(waitlistEntriesTable.userId, req.user!.userId)];
  if (status) conditions.push(eq(waitlistEntriesTable.status, status as typeof permittedStatuses[number]));
  const entries = await db.select().from(waitlistEntriesTable).where(and(...conditions))
    .orderBy(desc(waitlistEntriesTable.createdAt)).limit(cap(req.query.limit));
  const claims = entries.length
    ? await db.select().from(waitlistClaimsTable).where(inArray(waitlistClaimsTable.entryId, entries.map((entry) => entry.id)))
    : [];
  const result = await Promise.all(entries.map(async (entry) => {
    const [queueLength, queuePosition] = await Promise.all([
      db.select({ value: count() }).from(waitlistEntriesTable).where(and(
        eq(waitlistEntriesTable.pitchId, entry.pitchId), eq(waitlistEntriesTable.startAt, entry.startAt),
        inArray(waitlistEntriesTable.status, ["WAITING", "OFFERED"]),
      )),
      entry.status === "WAITING" || entry.status === "OFFERED"
        ? db.select({ value: count() }).from(waitlistEntriesTable).where(and(
          eq(waitlistEntriesTable.pitchId, entry.pitchId), eq(waitlistEntriesTable.startAt, entry.startAt),
          inArray(waitlistEntriesTable.status, ["WAITING", "OFFERED"]),
          or(lt(waitlistEntriesTable.position, entry.position), eq(waitlistEntriesTable.position, entry.position)),
        ))
        : Promise.resolve([]),
    ]);
    const claim = claims.find((item) => item.entryId === entry.id);
    return {
      ...entry,
      startAt: iso(entry.startAt),
      endAt: iso(entry.endAt),
      createdAt: iso(entry.createdAt),
      claimId: claim?.id ?? null,
      claimExpiresAt: claim ? iso(claim.expiresAt) : null,
      queuePosition: queuePosition[0] ? Number(queuePosition[0].value) : null,
      queueLength: Number(queueLength[0]?.value ?? 0),
    };
  }));
  res.json({ entries: result });
});

router.get("/player/waitlist", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  const pitchId = String(req.query.pitchId ?? ""); const startAt = new Date(String(req.query.startAt ?? ""));
  if (!pitchId || !Number.isFinite(startAt.getTime())) { res.status(400).json({ error: "pitchId and startAt are required" }); return; }
  const [entries, queue] = await Promise.all([
    db.select().from(waitlistEntriesTable).where(and(
      eq(waitlistEntriesTable.pitchId, pitchId), eq(waitlistEntriesTable.startAt, startAt),
      eq(waitlistEntriesTable.userId, req.user!.userId),
    )).orderBy(desc(waitlistEntriesTable.createdAt)).limit(1),
    db.select({ value: count() }).from(waitlistEntriesTable).where(and(
      eq(waitlistEntriesTable.pitchId, pitchId), eq(waitlistEntriesTable.startAt, startAt),
      inArray(waitlistEntriesTable.status, ["WAITING", "OFFERED"]),
    )),
  ]);
  const entry = entries[0];
  if (!entry) { res.json({ entry: null, queueLength: Number(queue[0]?.value ?? 0) }); return; }
  const [claim] = await db.select().from(waitlistClaimsTable).where(eq(waitlistClaimsTable.entryId, entry.id)).limit(1);
  const position = await db.select({ value: count() }).from(waitlistEntriesTable).where(and(
    eq(waitlistEntriesTable.pitchId, pitchId), eq(waitlistEntriesTable.startAt, startAt),
    inArray(waitlistEntriesTable.status, ["WAITING", "OFFERED"]),
    or(lt(waitlistEntriesTable.position, entry.position), eq(waitlistEntriesTable.position, entry.position)),
  ));
  const queuePosition = entry.status === "WAITING" || entry.status === "OFFERED"
    ? Number(position[0]?.value ?? 0) : null;
  res.json({ entry: { ...entry, startAt: iso(entry.startAt), endAt: iso(entry.endAt), createdAt: iso(entry.createdAt),
    claimId: claim?.id ?? null, claimExpiresAt: claim ? iso(claim.expiresAt) : null, queuePosition, queueLength: Number(queue[0]?.value ?? 0) },
  queueLength: Number(queue[0]?.value ?? 0) });
});

router.post("/player/waitlist", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  try {
    await consumeEliteMutation(req.user!.userId, "JOIN_WAITLIST");
    const validated = JoinSlotWaitlistBody.safeParse(req.body);
    if (!validated.success) { res.status(400).json({ error: validated.error.message }); return; }
    const pitchId = String((req.body as { pitchId?: string }).pitchId ?? "");
    const startAt = new Date(String((req.body as { startAt?: string }).startAt ?? ""));
    const [pitch] = await db.select().from(pitchesTable).where(eq(pitchesTable.id, pitchId)).limit(1);
    if (!pitch || !Number.isFinite(startAt.getTime())) { res.status(400).json({ error: "Valid pitchId and startAt are required" }); return; }
    await assertEliteVenue(pitch.venueId);
    const [occupied] = await db.select().from(bookingsTable).where(and(
      eq(bookingsTable.pitchId, pitchId), eq(bookingsTable.startAt, startAt), inArray(bookingsTable.status, ["PENDING", "CONFIRMED"]),
    )).limit(1);
    if (!occupied) { res.status(409).json({ error: "Waitlists are only available for a full slot." }); return; }
    const [entry] = await db.insert(waitlistEntriesTable).values({
      venueId: pitch.venueId, pitchId, userId: req.user!.userId, startAt, endAt: occupied.endAt,
    }).returning();
    res.status(201).json({ ...entry, startAt: iso(entry!.startAt), endAt: iso(entry!.endAt), createdAt: iso(entry!.createdAt), claimId: null, claimExpiresAt: null });
  } catch (error) {
    const status = (error as { status?: number; code?: string }).status ?? ((error as { code?: string }).code === "23505" ? 409 : 500);
    res.status(status).json({ error: status === 409 ? "You are already waiting for this slot." : (error as Error).message });
  }
});

router.delete("/player/waitlist/:id", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  await consumeEliteMutation(req.user!.userId, "LEAVE_WAITLIST");
  const [entry] = await db.update(waitlistEntriesTable).set({ status: "LEFT", updatedAt: new Date() }).where(and(
    eq(waitlistEntriesTable.id, String(req.params.id)), eq(waitlistEntriesTable.userId, req.user!.userId),
    inArray(waitlistEntriesTable.status, ["WAITING", "OFFERED"]),
  )).returning();
  if (!entry) { res.status(404).json({ error: "Active waitlist entry not found" }); return; }
  await db.update(waitlistClaimsTable).set({ status: "REJECTED", resolvedAt: new Date() }).where(and(
    eq(waitlistClaimsTable.entryId, entry.id), eq(waitlistClaimsTable.status, "ACTIVE"),
  ));
  await promoteWaitlist(entry.pitchId, entry.startAt);
  res.sendStatus(204);
});

router.post("/player/waitlist-claims/:id/claim", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  try {
    await consumeEliteMutation(req.user!.userId, "CLAIM_WAITLIST", 10);
    const [claim] = await db.select().from(waitlistClaimsTable).where(and(
      eq(waitlistClaimsTable.id, String(req.params.id)), eq(waitlistClaimsTable.userId, req.user!.userId),
      eq(waitlistClaimsTable.status, "ACTIVE"),
    )).limit(1);
    if (!claim || claim.expiresAt <= new Date()) {
      if (claim) {
        const [expired] = await db.update(waitlistClaimsTable).set({ status: "EXPIRED", resolvedAt: new Date() })
          .where(and(eq(waitlistClaimsTable.id, claim.id), eq(waitlistClaimsTable.status, "ACTIVE")))
          .returning();
        if (expired) {
          await db.update(waitlistEntriesTable).set({ status: "EXPIRED", updatedAt: new Date() })
            .where(eq(waitlistEntriesTable.id, expired.entryId));
          await promoteWaitlist(expired.pitchId, expired.startAt);
        }
      }
      res.status(409).json({ error: "Claim is not active" }); return;
    }
    const booking = await reserveValidatedSlot({
      pitchId: claim.pitchId, playerId: req.user!.userId, startAt: claim.startAt,
      afterReserve: async (tx, inserted) => {
        const [won] = await tx.update(waitlistClaimsTable).set({ status: "CLAIMED", bookingId: inserted.id, resolvedAt: new Date() }).where(and(
          eq(waitlistClaimsTable.id, claim.id), eq(waitlistClaimsTable.status, "ACTIVE"),
        )).returning();
        if (!won) throw new SlotBookingError("SLOT_TAKEN");
        await tx.update(waitlistEntriesTable).set({ status: "CLAIMED", updatedAt: new Date() }).where(eq(waitlistEntriesTable.id, claim.entryId));
      },
    });
    res.status(201).json({ claimId: claim.id, bookingId: booking.id, status: "CLAIMED" });
  } catch (error) {
    res.status(error instanceof SlotBookingError ? 409 : 500).json({ error: (error as Error).message });
  }
});

router.get("/owner/venues/:venueId/elite-demand", requireAuth, requireRole("VENUE_OWNER"), async (req, res): Promise<void> => {
  try {
    const venueId = String(req.params.venueId); const venue = await assertEliteVenue(venueId);
    if (venue.ownerId !== req.user!.userId) { res.status(403).json({ error: "You do not own this venue." }); return; }
    const limit = cap(req.query.limit);
    const requests = await db.select({ id: squadRequestsTable.id }).from(squadRequestsTable).where(eq(squadRequestsTable.venueId, venueId)).orderBy(desc(squadRequestsTable.createdAt)).limit(limit);
    const entries = await db.select().from(waitlistEntriesTable).where(eq(waitlistEntriesTable.venueId, venueId)).orderBy(desc(waitlistEntriesTable.createdAt)).limit(limit);
    res.json({
      squadRequests: (await Promise.all(requests.map((r) => requestView(r.id)))).filter(Boolean),
      waitlistEntries: entries.map((e) => ({ ...e, startAt: iso(e.startAt), endAt: iso(e.endAt), createdAt: iso(e.createdAt), claimId: null, claimExpiresAt: null })),
    });
  } catch (error) {
    res.status((error as { status?: number }).status ?? 500).json({ error: (error as Error).message });
  }
});

export default router;