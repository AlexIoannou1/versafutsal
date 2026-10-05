import { Router, type IRouter } from "express";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  availabilityBlocksTable,
  adminSettingsTable,
  bookingsTable,
  maintenanceBlocksTable,
  openingHoursTable,
  pitchesTable,
  tournamentAuditTable,
  tournamentMatchesTable,
  tournamentPaymentsTable,
  tournamentRegistrationsTable,
  tournamentTeamsTable,
  tournamentsTable,
  usersTable,
  venuesTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../middlewares/auth";
import { requireOwnerCapability } from "../lib/entitlements";
import { constructVerifiedSubscriptionEvent } from "../lib/subscription-webhook";

const router: IRouter = Router();
const ownerGuard = [requireAuth, requireRole("VENUE_OWNER"), requireOwnerCapability("TOURNAMENT_CREATOR")] as const;

type TournamentInput = {
  venueId?: string; pitchId?: string; name?: string; description?: string;
  entryType?: "PLAYER" | "TEAM"; capacity?: number; registrationDeadline?: string;
  startsAt?: string; endsAt?: string; entryFeeAmount?: string; prizePoolAmount?: string;
};

function parseInput(body: TournamentInput) {
  const startsAt = new Date(body.startsAt ?? "");
  const endsAt = new Date(body.endsAt ?? "");
  const deadline = new Date(body.registrationDeadline ?? "");
  const money = /^\d{1,10}(\.\d{1,2})?$/;
  if (!body.venueId || !body.pitchId || !body.name?.trim() || body.name.trim().length > 160 ||
      !["PLAYER", "TEAM"].includes(body.entryType ?? "") ||
      !Number.isInteger(body.capacity) || body.capacity! < 2 || body.capacity! > 256 ||
      !money.test(body.entryFeeAmount ?? "") || !money.test(body.prizePoolAmount ?? "") ||
      Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || Number.isNaN(deadline.getTime()) ||
      endsAt <= startsAt || deadline >= startsAt) {
    return null;
  }
  return {
    venueId: body.venueId, pitchId: body.pitchId, name: body.name.trim(),
    description: body.description?.trim() || null, entryType: body.entryType!,
    capacity: body.capacity!, registrationDeadline: deadline, startsAt, endsAt,
    entryFeeAmount: Number(body.entryFeeAmount).toFixed(2),
    prizePoolAmount: Number(body.prizePoolAmount).toFixed(2),
  };
}

function serializeRegistration(row: typeof tournamentRegistrationsTable.$inferSelect, teamName: string | null = null,
  extras: { tournamentId?: string; tournamentName?: string; paymentStatus?: string | null; participantName?: string | null } = {}) {
  return {
    id: row.id, status: row.status, amountSnapshot: row.amountSnapshot,
    currencySnapshot: row.currencySnapshot, teamName, participantName: extras.participantName ?? null, paymentStatus: extras.paymentStatus ?? null,
    tournamentId: extras.tournamentId ?? row.tournamentId, tournamentName: extras.tournamentName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeMatch(row: typeof tournamentMatchesTable.$inferSelect) {
  return {
    id: row.id, roundNumber: row.roundNumber, matchNumber: row.matchNumber,
    participantOneRegistrationId: row.participantOneRegistrationId,
    participantTwoRegistrationId: row.participantTwoRegistrationId,
    winnerRegistrationId: row.winnerRegistrationId,
    startAt: row.startAt?.toISOString() ?? null, endAt: row.endAt?.toISOString() ?? null,
    status: row.status, score: row.score,
  };
}

async function confirmedCount(tournamentId: string) {
  const [row] = await db.select({ value: count() }).from(tournamentRegistrationsTable)
    .where(and(eq(tournamentRegistrationsTable.tournamentId, tournamentId), eq(tournamentRegistrationsTable.status, "CONFIRMED")));
  return Number(row?.value ?? 0);
}

async function serializeTournament(row: typeof tournamentsTable.$inferSelect) {
  const [funding] = await db.select({
    entry: sql<string>`coalesce(sum(${tournamentRegistrationsTable.prizeContributionSnapshot}), 0)`,
  }).from(tournamentRegistrationsTable).where(and(
    eq(tournamentRegistrationsTable.tournamentId, row.id),
    eq(tournamentRegistrationsTable.status, "CONFIRMED"),
  ));
  const successfulEntryAmount = Number(funding?.entry ?? 0).toFixed(2);
  return {
    id: row.id, venueId: row.venueId, pitchId: row.pitchId, name: row.name,
    description: row.description, status: row.status, format: row.format, entryType: row.entryType,
    capacity: row.capacity, registrationDeadline: row.registrationDeadline.toISOString(),
    startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(),
    entryFeeAmount: row.entryFeeAmount, prizePoolAmount: row.prizePoolAmount, currency: row.currency,
    successfulEntryAmount,
    fundedPrizePoolAmount: (Number(row.prizePoolAmount) + Number(successfulEntryAmount)).toFixed(2),
    confirmedRegistrations: await confirmedCount(row.id),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

async function detail(row: typeof tournamentsTable.$inferSelect) {
  const registrations = await db.select({
    registration: tournamentRegistrationsTable, teamName: tournamentTeamsTable.name, participantName: usersTable.name,
  })
    .from(tournamentRegistrationsTable)
    .leftJoin(tournamentTeamsTable, eq(tournamentRegistrationsTable.teamId, tournamentTeamsTable.id))
    .innerJoin(usersTable, eq(tournamentRegistrationsTable.registrantId, usersTable.id))
    .where(eq(tournamentRegistrationsTable.tournamentId, row.id))
    .orderBy(asc(tournamentRegistrationsTable.createdAt));
  const payments = await db.select({ registrationId: tournamentRegistrationsTable.id, paymentStatus: tournamentPaymentsTable.status })
    .from(tournamentPaymentsTable)
    .innerJoin(tournamentRegistrationsTable, eq(tournamentRegistrationsTable.id, tournamentPaymentsTable.registrationId))
    .where(eq(tournamentRegistrationsTable.tournamentId, row.id))
    .orderBy(desc(tournamentPaymentsTable.updatedAt));
  const paymentStatuses = new Map<string, string>();
  for (const payment of payments) {
    if (!paymentStatuses.has(payment.registrationId)) paymentStatuses.set(payment.registrationId, payment.paymentStatus);
  }
  const matches = await db.select().from(tournamentMatchesTable)
    .where(eq(tournamentMatchesTable.tournamentId, row.id))
    .orderBy(asc(tournamentMatchesTable.roundNumber), asc(tournamentMatchesTable.matchNumber));
  return {
    tournament: await serializeTournament(row),
    registrations: registrations.map((item) => serializeRegistration(item.registration, item.teamName, {
      paymentStatus: paymentStatuses.get(item.registration.id) ?? null,
      participantName: item.participantName,
    })),
    matches: matches.map(serializeMatch),
  };
}

async function ownerTournament(id: string, ownerId: string) {
  const [row] = await db.select().from(tournamentsTable)
    .where(and(eq(tournamentsTable.id, id), eq(tournamentsTable.ownerId, ownerId))).limit(1);
  return row;
}

async function audit(tx: any, tournamentId: string, actorUserId: string | null, action: string,
  previousValue: Record<string, unknown> | null, newValue: Record<string, unknown> | null,
  metadata: Record<string, unknown> = {}) {
  await tx.insert(tournamentAuditTable).values({ tournamentId, actorUserId, action, previousValue, newValue, metadata });
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

async function validateSchedule(pitchId: string, venueId: string, startAt: Date, endAt: Date,
  excludeMatchId?: string, excludeTournamentId?: string, executor: any = db) {
  if (endAt <= startAt || startAt.toISOString().slice(0, 10) !== endAt.toISOString().slice(0, 10)) {
    return "Matches must start and end on the same day";
  }
  const day = startAt.getUTCDay();
  const [hours] = await executor.select().from(openingHoursTable)
    .where(and(eq(openingHoursTable.venueId, venueId), eq(openingHoursTable.dayOfWeek, day))).limit(1);
  const hhmm = (date: Date) => date.toISOString().slice(11, 19);
  if (!hours || hours.isClosed || hhmm(startAt) < hours.openTime || hhmm(endAt) > hours.closeTime) {
    return "Schedule is outside venue opening hours";
  }
  const maintenance = await executor.select().from(maintenanceBlocksTable)
    .where(and(eq(maintenanceBlocksTable.pitchId, pitchId), lt(maintenanceBlocksTable.startAt, endAt)));
  if (maintenance.some((block: typeof maintenanceBlocksTable.$inferSelect) => overlaps(startAt, endAt, block.startAt, block.endAt))) return "Schedule conflicts with maintenance";

  const date = startAt.toISOString().slice(0, 10);
  const blocks = await executor.select().from(availabilityBlocksTable)
    .where(or(
      and(eq(availabilityBlocksTable.venueId, venueId), isNull(availabilityBlocksTable.pitchId)),
      eq(availabilityBlocksTable.pitchId, pitchId),
    ));
  if (blocks.some((block: typeof availabilityBlocksTable.$inferSelect) => {
    const dateApplies = block.startDate <= date && block.endDate >= date &&
      (block.recursWeekly ? block.dayOfWeek === day : true);
    if (!dateApplies) return false;
    if (!block.startTime || !block.endTime) return true;
    return hhmm(startAt) < block.endTime && hhmm(endAt) > block.startTime;
  })) return "Schedule conflicts with an availability block";

  const bookings = await executor.select().from(bookingsTable).where(and(
    eq(bookingsTable.pitchId, pitchId), inArray(bookingsTable.status, ["PENDING", "CONFIRMED"]),
    lt(bookingsTable.startAt, endAt),
  ));
  if (bookings.some((booking: typeof bookingsTable.$inferSelect) => overlaps(startAt, endAt, booking.startAt, booking.endAt))) return "Schedule conflicts with an active booking";
  const tournaments = await executor.select({ id: tournamentsTable.id }).from(tournamentsTable).where(and(
    eq(tournamentsTable.pitchId, pitchId),
    inArray(tournamentsTable.status, ["PUBLISHED", "REGISTRATION_CLOSED", "IN_PROGRESS"]),
    ...(excludeTournamentId ? [ne(tournamentsTable.id, excludeTournamentId)] : []),
    lt(tournamentsTable.startsAt, endAt),
    gt(tournamentsTable.endsAt, startAt),
  )).limit(1);
  if (tournaments.length) return "Schedule conflicts with another tournament";
  const matches = await executor.select({ match: tournamentMatchesTable }).from(tournamentMatchesTable)
    .innerJoin(tournamentsTable, eq(tournamentsTable.id, tournamentMatchesTable.tournamentId)).where(and(
    eq(tournamentsTable.pitchId, pitchId),
    ...(excludeMatchId ? [ne(tournamentMatchesTable.id, excludeMatchId)] : []),
    lt(tournamentMatchesTable.startAt, endAt),
    inArray(tournamentMatchesTable.status, ["PENDING", "READY"]),
  ));
  if (matches.some(({ match }: { match: typeof tournamentMatchesTable.$inferSelect }) =>
    match.startAt && match.endAt && overlaps(startAt, endAt, match.startAt, match.endAt))) {
    return "Schedule conflicts with another tournament match";
  }
  return null;
}

router.get("/tournaments", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(tournamentsTable).where(inArray(tournamentsTable.status, [
      "PUBLISHED", "REGISTRATION_CLOSED", "IN_PROGRESS", "COMPLETED",
    ])).orderBy(asc(tournamentsTable.startsAt));
    res.json({ tournaments: await Promise.all(rows.map(serializeTournament)) });
  } catch (error) {
    req.log.error({ err: error }, "Tournament discovery failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get<{ id: string }>("/tournaments/:id", async (req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(tournamentsTable).where(and(
      eq(tournamentsTable.id, req.params.id),
      inArray(tournamentsTable.status, ["PUBLISHED", "REGISTRATION_CLOSED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
    )).limit(1);
    if (!row) { res.status(404).json({ error: "Tournament not found" }); return; }
    res.json(await detail(row));
  } catch (error) {
    req.log.error({ err: error, tournamentId: req.params.id }, "Tournament detail failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/owner/tournaments", ...ownerGuard, async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(tournamentsTable)
      .where(eq(tournamentsTable.ownerId, req.user!.userId)).orderBy(asc(tournamentsTable.startsAt));
    res.json({ tournaments: await Promise.all(rows.map(serializeTournament)) });
  } catch (error) {
    req.log.error({ err: error, ownerId: req.user!.userId }, "Owner tournament list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/owner/tournaments", ...ownerGuard, async (req, res): Promise<void> => {
  try {
    const input = parseInput(req.body);
    if (!input) { res.status(400).json({ error: "Invalid tournament details" }); return; }
    const [venuePitch] = await db.select({ venueId: venuesTable.id }).from(venuesTable)
      .innerJoin(pitchesTable, and(eq(pitchesTable.id, input.pitchId), eq(pitchesTable.venueId, venuesTable.id)))
      .where(and(eq(venuesTable.id, input.venueId), eq(venuesTable.ownerId, req.user!.userId), eq(venuesTable.status, "APPROVED"))).limit(1);
    if (!venuePitch) { res.status(404).json({ error: "Approved owned venue and pitch not found" }); return; }
    const [row] = await db.transaction(async (tx) => {
      const inserted = await tx.insert(tournamentsTable).values({ ...input, ownerId: req.user!.userId }).returning();
      await audit(tx, inserted[0]!.id, req.user!.userId, "TOURNAMENT_CREATED", null, { status: "DRAFT" });
      return inserted;
    });
    res.status(201).json({ tournament: await serializeTournament(row!) });
  } catch (error) {
    req.log.error({ err: error, ownerId: req.user!.userId }, "Tournament creation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get<{ id: string }>("/owner/tournaments/:id", ...ownerGuard, async (req, res): Promise<void> => {
  try {
    const row = await ownerTournament(req.params.id, req.user!.userId);
    if (!row) { res.status(404).json({ error: "Tournament not found" }); return; }
    res.json(await detail(row));
  } catch (error) {
    req.log.error({ err: error, tournamentId: req.params.id }, "Owner tournament detail failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put<{ id: string }>("/owner/tournaments/:id", ...ownerGuard, async (req, res): Promise<void> => {
  try {
    const input = parseInput(req.body);
    if (!input) { res.status(400).json({ error: "Invalid tournament details" }); return; }
    const current = await ownerTournament(req.params.id, req.user!.userId);
    if (!current) { res.status(404).json({ error: "Tournament not found" }); return; }
    if (!["DRAFT", "PUBLISHED"].includes(current.status) || current.bracketGeneratedAt) {
      res.status(409).json({ error: "Tournament can no longer be edited" }); return;
    }
    const [owned] = await db.select({ id: pitchesTable.id }).from(pitchesTable).innerJoin(venuesTable, eq(venuesTable.id, pitchesTable.venueId))
      .where(and(eq(pitchesTable.id, input.pitchId), eq(venuesTable.id, input.venueId), eq(venuesTable.ownerId, req.user!.userId))).limit(1);
    if (!owned) { res.status(404).json({ error: "Owned venue and pitch not found" }); return; }
    const result = await db.transaction(async (tx) => {
      for (const pitchId of [current.pitchId, input.pitchId].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${pitchId}))`);
      }
      if (current.status === "PUBLISHED") {
        const conflict = await validateSchedule(input.pitchId, input.venueId, input.startsAt, input.endsAt,
          undefined, current.id, tx);
        if (conflict) return { conflict, rows: [] };
      }
      const rows = await tx.update(tournamentsTable).set({ ...input, updatedAt: new Date() })
        .where(and(eq(tournamentsTable.id, current.id), inArray(tournamentsTable.status, ["DRAFT", "PUBLISHED"]))).returning();
      if (rows[0]) await audit(tx, current.id, req.user!.userId, "TOURNAMENT_UPDATED", { status: current.status }, { status: rows[0].status });
      return { conflict: null, rows };
    });
    if (result.conflict) { res.status(409).json({ error: result.conflict }); return; }
    const updated = result.rows[0];
    if (!updated) { res.status(409).json({ error: "Tournament changed concurrently" }); return; }
    res.json({ tournament: await serializeTournament(updated) });
  } catch (error) {
    req.log.error({ err: error, tournamentId: req.params.id }, "Tournament update failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete<{ id: string }>("/owner/tournaments/:id", ...ownerGuard, async (req, res): Promise<void> => {
  try {
    const deleted = await db.delete(tournamentsTable).where(and(eq(tournamentsTable.id, req.params.id),
      eq(tournamentsTable.ownerId, req.user!.userId), eq(tournamentsTable.status, "DRAFT"))).returning({ id: tournamentsTable.id });
    if (!deleted.length) { res.status(409).json({ error: "Only an owned draft tournament can be deleted" }); return; }
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ err: error, tournamentId: req.params.id }, "Tournament deletion failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post<{ id: string }>("/owner/tournaments/:id/publish", ...ownerGuard, async (req, res): Promise<void> => {
  try {
    const current = await ownerTournament(req.params.id, req.user!.userId);
    if (!current) { res.status(404).json({ error: "Tournament not found" }); return; }
    if (current.status !== "DRAFT" || current.registrationDeadline <= new Date()) {
      res.status(409).json({ error: "Only a draft with a future deadline can be published" }); return;
    }
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${current.pitchId}))`);
      const conflict = await validateSchedule(current.pitchId, current.venueId, current.startsAt, current.endsAt,
        undefined, current.id, tx);
      if (conflict) return { conflict, rows: [] };
      const rows = await tx.update(tournamentsTable).set({ status: "PUBLISHED", publishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(tournamentsTable.id, current.id), eq(tournamentsTable.status, "DRAFT"))).returning();
      if (rows[0]) await audit(tx, current.id, req.user!.userId, "TOURNAMENT_PUBLISHED", { status: "DRAFT" }, { status: "PUBLISHED" });
      return { conflict: null, rows };
    });
    if (result.conflict) { res.status(409).json({ error: result.conflict }); return; }
    const updated = result.rows[0];
    if (!updated) { res.status(409).json({ error: "Tournament changed concurrently" }); return; }
    res.json({ tournament: await serializeTournament(updated) });
  } catch (error) {
    req.log.error({ err: error, tournamentId: req.params.id }, "Tournament publish failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post<{ id: string }>("/owner/tournaments/:id/close", ...ownerGuard, async (req, res): Promise<void> => {
  try {
    const [updated] = await db.transaction(async (tx) => {
      const rows = await tx.update(tournamentsTable).set({ status: "REGISTRATION_CLOSED", closedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(tournamentsTable.id, req.params.id), eq(tournamentsTable.ownerId, req.user!.userId), eq(tournamentsTable.status, "PUBLISHED"))).returning();
      if (rows[0]) await audit(tx, rows[0].id, req.user!.userId, "REGISTRATION_CLOSED", { status: "PUBLISHED" }, { status: "REGISTRATION_CLOSED" });
      return rows;
    });
    if (!updated) { res.status(409).json({ error: "Only an owned published tournament can be closed" }); return; }
    res.json({ tournament: await serializeTournament(updated) });
  } catch (error) {
    req.log.error({ err: error, tournamentId: req.params.id }, "Tournament close failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post<{ id: string }>("/tournaments/:id/register", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  try {
    const body = req.body as { teamName?: string };
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${req.params.id}))`);
      const [tournament] = await tx.select().from(tournamentsTable).where(eq(tournamentsTable.id, req.params.id)).for("update").limit(1);
      if (!tournament || tournament.status !== "PUBLISHED") return { error: "Tournament is not open for registration", code: 409 } as const;
      if (tournament.registrationDeadline <= new Date()) return { error: "Registration deadline has passed", code: 409 } as const;
      const [existing] = await tx.select().from(tournamentRegistrationsTable).where(and(
        eq(tournamentRegistrationsTable.tournamentId, tournament.id),
        eq(tournamentRegistrationsTable.registrantId, req.user!.userId),
      )).limit(1);
      if (existing) return { error: "You are already registered", code: 409 } as const;
      const [used] = await tx.select({ value: count() }).from(tournamentRegistrationsTable).where(and(
        eq(tournamentRegistrationsTable.tournamentId, tournament.id),
        inArray(tournamentRegistrationsTable.status, ["PAYMENT_PENDING", "CONFIRMED"]),
      ));
      if (Number(used?.value ?? 0) >= tournament.capacity) return { error: "Tournament is full", code: 409 } as const;
      let teamId: string | null = null;
      if (tournament.entryType === "TEAM") {
        if (!body.teamName?.trim() || body.teamName.trim().length > 100) {
          return { error: "A valid team name is required", code: 400 } as const;
        }
        const [team] = await tx.insert(tournamentTeamsTable).values({
          tournamentId: tournament.id, captainId: req.user!.userId, name: body.teamName.trim(),
        }).returning();
        teamId = team!.id;
      } else if (body.teamName) {
        return { error: "Team details are not allowed for player entry", code: 400 } as const;
      }
      const [registration] = await tx.insert(tournamentRegistrationsTable).values({
        tournamentId: tournament.id, registrantId: req.user!.userId, teamId,
        amountSnapshot: tournament.entryFeeAmount, prizeContributionSnapshot: tournament.entryFeeAmount,
        currencySnapshot: tournament.currency,
      }).returning();
      await audit(tx, tournament.id, req.user!.userId, "REGISTRATION_RESERVED", null, { registrationId: registration!.id });
      return { registration: registration!, teamName: body.teamName?.trim() ?? null };
    });
    if ("error" in result) { res.status(result.code ?? 409).json({ error: result.error }); return; }
    res.status(201).json({ registration: serializeRegistration(result.registration, result.teamName) });
  } catch (error) {
    const pgCode = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
    if (pgCode === "23505") { res.status(409).json({ error: "Duplicate tournament registration" }); return; }
    req.log.error({ err: error, tournamentId: req.params.id, playerId: req.user!.userId }, "Tournament registration failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/player/tournament-registrations", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  try {
    const rows = await db.select({ registration: tournamentRegistrationsTable, teamName: tournamentTeamsTable.name,
      tournamentName: tournamentsTable.name, paymentStatus: tournamentPaymentsTable.status })
      .from(tournamentRegistrationsTable)
      .leftJoin(tournamentTeamsTable, eq(tournamentTeamsTable.id, tournamentRegistrationsTable.teamId))
      .innerJoin(tournamentsTable, eq(tournamentsTable.id, tournamentRegistrationsTable.tournamentId))
      .leftJoin(tournamentPaymentsTable, eq(tournamentPaymentsTable.registrationId, tournamentRegistrationsTable.id))
      .where(eq(tournamentRegistrationsTable.registrantId, req.user!.userId))
      .orderBy(asc(tournamentRegistrationsTable.createdAt));
    res.json({ registrations: rows.map((row) => serializeRegistration(row.registration, row.teamName, {
      tournamentId: row.registration.tournamentId, tournamentName: row.tournamentName, paymentStatus: row.paymentStatus,
    })) });
  } catch (error) {
    req.log.error({ err: error, playerId: req.user!.userId }, "Player tournament registrations failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function createIntent(registration: typeof tournamentRegistrationsTable.$inferSelect, tournament: typeof tournamentsTable.$inferSelect, key: string) {
  const stripeKey = process.env.STRIPE_TEST_SK;
  if (!stripeKey || Number(registration.amountSnapshot) === 0) {
    const stableId = createHash("sha256").update(`${registration.id}:${key}`).digest("hex").slice(0, 24);
    return { provider: "MOCK", providerPaymentId: `mock_tpi_${stableId}`, clientSecret: null };
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require("stripe");
  const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });
  const [venue] = await db.select({ ownerConnect: usersTable.stripeConnectAccountId }).from(venuesTable)
    .innerJoin(usersTable, eq(usersTable.id, venuesTable.ownerId)).where(eq(venuesTable.id, tournament.venueId)).limit(1);
  const [settings] = await db.select().from(adminSettingsTable).limit(1);
  const overridden = settings?.perVenueOverrides?.[tournament.venueId];
  const feePercent = settings?.feeEnabled !== false && overridden !== false ? Number(settings?.feePercent ?? 0) : 0;
  const amount = Math.round(Number(registration.amountSnapshot) * 100);
  const params: Record<string, unknown> = {
    amount, currency: registration.currencySnapshot.toLowerCase(),
    automatic_payment_methods: { enabled: true },
    metadata: { tournamentId: tournament.id, registrationId: registration.id },
  };
  if (venue?.ownerConnect) {
    params.transfer_data = { destination: venue.ownerConnect };
    if (feePercent > 0) params.application_fee_amount = Math.round(amount * feePercent / 100);
  }
  const intent = await stripe.paymentIntents.create({
    ...params,
  }, { idempotencyKey: `tournament:${registration.id}:${key}` });
  return { provider: "STRIPE", providerPaymentId: intent.id, clientSecret: intent.client_secret as string | null };
}

router.post<{ id: string }>("/tournament-registrations/:id/checkout", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  try {
    const key = (req.body as { idempotencyKey?: string }).idempotencyKey;
    if (!key || key.length < 8 || key.length > 200) { res.status(400).json({ error: "A valid idempotencyKey is required" }); return; }
    const [record] = await db.select({ registration: tournamentRegistrationsTable, tournament: tournamentsTable })
      .from(tournamentRegistrationsTable).innerJoin(tournamentsTable, eq(tournamentsTable.id, tournamentRegistrationsTable.tournamentId))
      .where(and(eq(tournamentRegistrationsTable.id, req.params.id), eq(tournamentRegistrationsTable.registrantId, req.user!.userId))).limit(1);
    if (!record) { res.status(404).json({ error: "Registration not found" }); return; }
    const [existing] = await db.select().from(tournamentPaymentsTable).where(and(
      eq(tournamentPaymentsTable.registrationId, record.registration.id),
      inArray(tournamentPaymentsTable.status, ["PENDING", "SUCCEEDED", "REFUND_PENDING", "REFUNDED"]),
    )).limit(1);
    if (existing) {
      let clientSecret: string | null = null;
      if (existing.provider === "STRIPE" && existing.status === "PENDING" && process.env.STRIPE_TEST_SK) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Stripe = require("stripe");
        const stripe = new Stripe(process.env.STRIPE_TEST_SK, { apiVersion: "2024-11-20.acacia" });
        const intent = await stripe.paymentIntents.retrieve(existing.providerPaymentId);
        clientSecret = intent.client_secret;
      }
      res.json({ registration: serializeRegistration(record.registration), requiresClientAction: existing.provider === "STRIPE" && existing.status === "PENDING", clientSecret, publishableKey: process.env.STRIPE_TEST_PK ?? null });
      return;
    }
    if (!["PAYMENT_PENDING", "PAYMENT_FAILED"].includes(record.registration.status) || record.tournament.status !== "PUBLISHED" || record.tournament.registrationDeadline <= new Date()) {
      res.status(409).json({ error: "Registration cannot be checked out" }); return;
    }
    if (Number(record.registration.amountSnapshot) > 0 && process.env.STRIPE_TEST_SK) {
      const [venue] = await db.select({ account: usersTable.stripeConnectAccountId }).from(venuesTable)
        .innerJoin(usersTable, eq(usersTable.id, venuesTable.ownerId))
        .where(eq(venuesTable.id, record.tournament.venueId)).limit(1);
      if (!venue?.account) { res.status(409).json({ error: "Venue owner payment onboarding is required", code: "OWNER_ONBOARDING_REQUIRED" }); return; }
    }
    const intent = await createIntent(record.registration, record.tournament, key);
    try {
      if (record.registration.status === "PAYMENT_FAILED") {
        await db.update(tournamentRegistrationsTable).set({ status: "PAYMENT_PENDING", updatedAt: new Date() })
          .where(and(eq(tournamentRegistrationsTable.id, record.registration.id), eq(tournamentRegistrationsTable.status, "PAYMENT_FAILED")));
      }
      await db.insert(tournamentPaymentsTable).values({
        registrationId: record.registration.id, provider: intent.provider, providerPaymentId: intent.providerPaymentId,
        idempotencyKey: key, amountSnapshot: record.registration.amountSnapshot, currencySnapshot: record.registration.currencySnapshot,
      });
    } catch (error) {
      const pgCode = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
      if (pgCode !== "23505") throw error;
      // A concurrent request persisted an active attempt. Stripe idempotency
      // returns the same intent for Stripe; mock IDs are deterministic.
      const [winner] = await db.select().from(tournamentPaymentsTable).where(and(
        eq(tournamentPaymentsTable.registrationId, record.registration.id),
        inArray(tournamentPaymentsTable.status, ["PENDING", "SUCCEEDED", "REFUND_PENDING", "REFUNDED"]),
      )).limit(1);
      if (!winner) throw error;
      if (intent.provider === "STRIPE" && winner.providerPaymentId !== intent.providerPaymentId) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Stripe = require("stripe"); const stripe = new Stripe(process.env.STRIPE_TEST_SK, { apiVersion: "2024-11-20.acacia" });
          await stripe.paymentIntents.cancel(intent.providerPaymentId);
        } catch { /* provider truth will be reconciled by webhook */ }
      }
    }
    if (intent.provider === "MOCK") {
      await captureRegistration(record.registration.id, req.user!.userId, intent.providerPaymentId);
      const [confirmed] = await db.select().from(tournamentRegistrationsTable).where(eq(tournamentRegistrationsTable.id, record.registration.id));
      res.json({ registration: serializeRegistration(confirmed!), requiresClientAction: false, clientSecret: null, publishableKey: null });
      return;
    }
    res.json({ registration: serializeRegistration(record.registration), requiresClientAction: true, clientSecret: intent.clientSecret, publishableKey: process.env.STRIPE_TEST_PK ?? null });
  } catch (error) {
    req.log.error({ err: error, registrationId: req.params.id, playerId: req.user!.userId }, "Tournament checkout failed");
    res.status(502).json({ error: "Unable to start tournament checkout" });
  }
});

async function captureRegistration(registrationId: string, actorId: string | null, providerPaymentId?: string) {
  return db.transaction(async (tx) => {
    const [registrationForLock] = await tx.select({ tournamentId: tournamentRegistrationsTable.tournamentId })
      .from(tournamentRegistrationsTable).where(eq(tournamentRegistrationsTable.id, registrationId)).limit(1);
    if (!registrationForLock) return null;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${registrationForLock.tournamentId}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${registrationId}))`);
    const [registration] = await tx.select().from(tournamentRegistrationsTable)
      .where(eq(tournamentRegistrationsTable.id, registrationId)).for("update").limit(1);
    if (!registration) return null;
    if (registration.status === "CONFIRMED") return registration;
    const [tournament] = await tx.select().from(tournamentsTable).where(eq(tournamentsTable.id, registration.tournamentId)).for("update").limit(1);
    const [payment] = await tx.select().from(tournamentPaymentsTable).where(and(
      eq(tournamentPaymentsTable.registrationId, registrationId),
      ...(providerPaymentId ? [eq(tournamentPaymentsTable.providerPaymentId, providerPaymentId)] : []),
      eq(tournamentPaymentsTable.status, "PENDING"),
    )).limit(1);
    if (!payment) return null;
    if (!tournament || tournament.status === "CANCELLED" || tournament.status === "IN_PROGRESS" || tournament.bracketGeneratedAt) {
      await tx.update(tournamentPaymentsTable).set({ status: "REFUND_PENDING", updatedAt: new Date() })
        .where(eq(tournamentPaymentsTable.id, payment.id));
      await audit(tx, registration.tournamentId, actorId, "LATE_PAYMENT_REFUND_REQUIRED", null, { registrationId, paymentId: payment.id });
      return null;
    }
    const [updated] = await tx.update(tournamentRegistrationsTable).set({ status: "CONFIRMED", confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(tournamentRegistrationsTable.id, registrationId)).returning();
    await tx.update(tournamentPaymentsTable).set({ status: "SUCCEEDED", updatedAt: new Date() }).where(eq(tournamentPaymentsTable.id, payment.id));
    await audit(tx, registration.tournamentId, actorId, "PAYMENT_CAPTURED", { status: "PAYMENT_PENDING" }, { status: "CONFIRMED" }, { registrationId });
    return updated!;
  });
}

async function failRegistrationPayment(providerPaymentId: string, actorId: string | null, source: string) {
  await db.transaction(async (tx) => {
    const [payment] = await tx.update(tournamentPaymentsTable).set({ status: "FAILED", updatedAt: new Date() })
      .where(and(eq(tournamentPaymentsTable.providerPaymentId, providerPaymentId), eq(tournamentPaymentsTable.status, "PENDING"))).returning();
    if (!payment) return;
    const [registration] = await tx.update(tournamentRegistrationsTable).set({ status: "PAYMENT_FAILED", updatedAt: new Date() })
      .where(eq(tournamentRegistrationsTable.id, payment.registrationId)).returning();
    if (registration) await audit(tx, registration.tournamentId, actorId ?? registration.registrantId,
      "PAYMENT_FAILED", { status: "PAYMENT_PENDING" }, { status: "PAYMENT_FAILED" }, { source, paymentId: payment.id });
  });
}

router.post<{ id: string }>("/tournament-registrations/:id/capture", requireAuth, requireRole("PLAYER"), async (req, res): Promise<void> => {
  try {
    const [alreadyCaptured] = await db.select().from(tournamentRegistrationsTable).where(and(
      eq(tournamentRegistrationsTable.id, req.params.id),
      eq(tournamentRegistrationsTable.registrantId, req.user!.userId),
      eq(tournamentRegistrationsTable.status, "CONFIRMED"),
    )).limit(1);
    if (alreadyCaptured) {
      res.json({ registration: serializeRegistration(alreadyCaptured) });
      return;
    }
    const [record] = await db.select({ registration: tournamentRegistrationsTable, payment: tournamentPaymentsTable })
      .from(tournamentRegistrationsTable).innerJoin(tournamentPaymentsTable, eq(tournamentPaymentsTable.registrationId, tournamentRegistrationsTable.id))
      .where(and(eq(tournamentRegistrationsTable.id, req.params.id), eq(tournamentRegistrationsTable.registrantId, req.user!.userId), eq(tournamentPaymentsTable.status, "PENDING"))).limit(1);
    if (!record) { res.status(404).json({ error: "Pending registration payment not found" }); return; }
    if (record.payment.provider === "STRIPE") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Stripe = require("stripe");
      const stripe = new Stripe(process.env.STRIPE_TEST_SK, { apiVersion: "2024-11-20.acacia" });
      const intent = await stripe.paymentIntents.retrieve(record.payment.providerPaymentId);
      if (intent.status !== "succeeded") {
        if (["canceled", "requires_payment_method"].includes(intent.status)) {
          await failRegistrationPayment(record.payment.providerPaymentId, req.user!.userId, "capture");
          res.status(402).json({ error: "Payment failed. Register again to retry." });
          return;
        }
        res.status(402).json({ error: "Payment has not succeeded" }); return;
      }
    }
    const updated = await captureRegistration(record.registration.id, req.user!.userId, record.payment.providerPaymentId);
    if (!updated) {
      await settlePendingTournamentRefund(record.payment.id, req.user!.userId);
      res.status(409).json({ error: "Payment was not admitted; refund reconciliation has started" }); return;
    }
    res.json({ registration: serializeRegistration(updated) });
  } catch (error) {
    req.log.error({ err: error, registrationId: req.params.id }, "Tournament capture failed");
    res.status(502).json({ error: "Unable to verify tournament payment" });
  }
});

router.post("/webhooks/stripe/tournaments", async (req, res): Promise<void> => {
  const signature = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_TOURNAMENT_WEBHOOK_SECRET;
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!process.env.STRIPE_TEST_SK || !secret || typeof signature !== "string" || !rawBody) {
    res.status(400).json({ error: "Invalid webhook request" });
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Stripe = require("stripe");
    const stripe = new Stripe(process.env.STRIPE_TEST_SK, { apiVersion: "2024-11-20.acacia" });
    const event = constructVerifiedSubscriptionEvent(stripe, rawBody, signature, secret) as {
      type: string; id: string; data: { object: { id: string; status?: string } };
    };
    if (!["payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled"].includes(event.type)) {
      res.json({ received: true }); return;
    }
    const [payment] = await db.select().from(tournamentPaymentsTable)
      .where(eq(tournamentPaymentsTable.providerPaymentId, event.data.object.id)).limit(1);
    if (!payment) { res.json({ received: true }); return; }
    if (event.type === "payment_intent.succeeded") {
      await captureRegistration(payment.registrationId, null, payment.providerPaymentId);
      await settlePendingTournamentRefund(payment.id, null);
    } else {
      await failRegistrationPayment(payment.providerPaymentId, null, `webhook:${event.type}`);
    }
    req.log.info({ stripeEventId: event.id, tournamentPaymentId: payment.id }, "Tournament payment webhook reconciled");
    res.json({ received: true });
  } catch (error) {
    req.log.error({ err: error }, "Tournament payment webhook failed");
    res.status(400).json({ error: "Invalid webhook request" });
  }
});

router.post<{ id: string }>("/owner/tournaments/:id/bracket", ...ownerGuard, async (req, res): Promise<void> => {
  try {
    const current = await ownerTournament(req.params.id, req.user!.userId);
    if (!current) { res.status(404).json({ error: "Tournament not found" }); return; }
    const generated = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${current.id}))`);
      const [locked] = await tx.select().from(tournamentsTable).where(and(eq(tournamentsTable.id, current.id), eq(tournamentsTable.ownerId, req.user!.userId))).for("update").limit(1);
      if (!locked || !["PUBLISHED", "REGISTRATION_CLOSED"].includes(locked.status) || locked.bracketGeneratedAt) return false;
      const registrations = await tx.select().from(tournamentRegistrationsTable).where(and(
        eq(tournamentRegistrationsTable.tournamentId, locked.id), eq(tournamentRegistrationsTable.status, "CONFIRMED"),
      )).orderBy(asc(tournamentRegistrationsTable.createdAt));
      if (registrations.length < 2) return false;
      const size = 2 ** Math.ceil(Math.log2(registrations.length));
      const rounds = Math.log2(size);
      const byRound: (typeof tournamentMatchesTable.$inferSelect)[][] = [];
      for (let round = rounds; round >= 1; round--) {
        const matches = await tx.insert(tournamentMatchesTable).values(Array.from({ length: size / 2 ** round }, (_, i) => ({
          tournamentId: locked.id, roundNumber: round, matchNumber: i + 1,
        }))).returning();
        byRound[round] = matches;
      }
      const first = byRound[1]!;
      for (let i = 0; i < first.length; i++) {
        const one = registrations[i]?.id ?? null;
        const two = registrations[first.length + i]?.id ?? null;
        const next = rounds > 1 ? byRound[2]![Math.floor(i / 2)] : null;
        const winner = one && !two ? one : null;
        await tx.update(tournamentMatchesTable).set({
          participantOneRegistrationId: one, participantTwoRegistrationId: two,
          status: winner ? "COMPLETED" : one && two ? "READY" : "PENDING", winnerRegistrationId: winner,
          nextMatchId: next?.id ?? null, nextMatchSlot: next ? (i % 2) + 1 : null,
        }).where(eq(tournamentMatchesTable.id, first[i]!.id));
        if (winner && next) await tx.update(tournamentMatchesTable).set(i % 2 === 0
          ? { participantOneRegistrationId: winner } : { participantTwoRegistrationId: winner }).where(eq(tournamentMatchesTable.id, next.id));
      }
      for (let round = 2; round <= rounds; round++) {
        for (let i = 0; i < byRound[round]!.length; i++) {
          const match = byRound[round]![i]!;
          const next = round < rounds ? byRound[round + 1]![Math.floor(i / 2)] : null;
          await tx.update(tournamentMatchesTable).set({ nextMatchId: next?.id ?? null, nextMatchSlot: next ? (i % 2) + 1 : null })
            .where(eq(tournamentMatchesTable.id, match.id));
        }
        await tx.update(tournamentMatchesTable).set({ status: "READY", updatedAt: new Date() }).where(and(
          eq(tournamentMatchesTable.tournamentId, locked.id),
          eq(tournamentMatchesTable.roundNumber, round),
          sql`${tournamentMatchesTable.participantOneRegistrationId} is not null`,
          sql`${tournamentMatchesTable.participantTwoRegistrationId} is not null`,
          eq(tournamentMatchesTable.status, "PENDING"),
        ));
      }
      await tx.update(tournamentsTable).set({ bracketGeneratedAt: new Date(), status: "IN_PROGRESS", closedAt: locked.closedAt ?? new Date(), updatedAt: new Date() })
        .where(and(eq(tournamentsTable.id, locked.id), sql`${tournamentsTable.bracketGeneratedAt} is null`));
      await audit(tx, locked.id, req.user!.userId, "BRACKET_GENERATED", null, { registrations: registrations.length, rounds });
      return true;
    });
    if (!generated) { res.status(409).json({ error: "Bracket cannot be generated in the current state" }); return; }
    const refreshed = await ownerTournament(current.id, req.user!.userId);
    res.status(201).json(await detail(refreshed!));
  } catch (error) {
    req.log.error({ err: error, tournamentId: req.params.id }, "Bracket generation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put<{ id: string; matchId: string }>("/owner/tournaments/:id/matches/:matchId", ...ownerGuard, async (req, res): Promise<void> => {
  try {
    const startAt = new Date((req.body as { startAt?: string }).startAt ?? "");
    const endAt = new Date((req.body as { endAt?: string }).endAt ?? "");
    const tournament = await ownerTournament(req.params.id, req.user!.userId);
    if (!tournament) { res.status(404).json({ error: "Tournament not found" }); return; }
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || startAt < tournament.startsAt || endAt > tournament.endsAt) {
      res.status(400).json({ error: "Match schedule must be within the tournament window" }); return;
    }
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tournament.pitchId}))`);
      const conflict = await validateSchedule(tournament.pitchId, tournament.venueId, startAt, endAt,
        req.params.matchId, tournament.id, tx);
      if (conflict) return { conflict, match: undefined };
      const [match] = await tx.update(tournamentMatchesTable).set({ startAt, endAt, updatedAt: new Date() }).where(and(
        eq(tournamentMatchesTable.id, req.params.matchId), eq(tournamentMatchesTable.tournamentId, tournament.id),
        inArray(tournamentMatchesTable.status, ["PENDING", "READY"]),
      )).returning();
      return { conflict: null, match };
    });
    if (result.conflict) { res.status(409).json({ error: result.conflict }); return; }
    const match = result.match;
    if (!match) { res.status(409).json({ error: "Match cannot be scheduled" }); return; }
    await db.insert(tournamentAuditTable).values({ tournamentId: tournament.id, actorUserId: req.user!.userId, action: "MATCH_SCHEDULED", newValue: { matchId: match.id, startAt, endAt } });
    res.json({ match: serializeMatch(match) });
  } catch (error) {
    req.log.error({ err: error, tournamentId: req.params.id, matchId: req.params.matchId }, "Match scheduling failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post<{ id: string; matchId: string }>("/owner/tournaments/:id/matches/:matchId/result", ...ownerGuard, async (req, res): Promise<void> => {
  try {
    const winnerId = (req.body as { winnerRegistrationId?: string }).winnerRegistrationId;
    const score = (req.body as { score?: Record<string, number> }).score;
    if (!winnerId || !score || Object.values(score).length !== 2 ||
      Object.values(score).some((value) => !Number.isInteger(value) || value < 0)) {
      res.status(400).json({ error: "A valid winner and score are required" }); return;
    }
    const tournament = await ownerTournament(req.params.id, req.user!.userId);
    if (!tournament || tournament.status !== "IN_PROGRESS") { res.status(409).json({ error: "Tournament is not in progress" }); return; }
    const outcome = await db.transaction(async (tx) => {
      const [match] = await tx.select().from(tournamentMatchesTable).where(and(
        eq(tournamentMatchesTable.id, req.params.matchId), eq(tournamentMatchesTable.tournamentId, tournament.id),
      )).for("update").limit(1);
      if (!match || match.status !== "READY" || ![match.participantOneRegistrationId, match.participantTwoRegistrationId].includes(winnerId)) return false;
      await tx.update(tournamentMatchesTable).set({ winnerRegistrationId: winnerId, score, status: "COMPLETED", updatedAt: new Date() }).where(eq(tournamentMatchesTable.id, match.id));
      if (match.nextMatchId) {
        const changes = match.nextMatchSlot === 1 ? { participantOneRegistrationId: winnerId } : { participantTwoRegistrationId: winnerId };
        const [next] = await tx.update(tournamentMatchesTable).set({ ...changes, updatedAt: new Date() }).where(eq(tournamentMatchesTable.id, match.nextMatchId)).returning();
        if (next?.participantOneRegistrationId && next.participantTwoRegistrationId) {
          await tx.update(tournamentMatchesTable).set({ status: "READY" }).where(eq(tournamentMatchesTable.id, next.id));
        }
      } else {
        await tx.update(tournamentsTable).set({ status: "COMPLETED", updatedAt: new Date() }).where(eq(tournamentsTable.id, tournament.id));
      }
      await audit(tx, tournament.id, req.user!.userId, "MATCH_RESULT_RECORDED", { matchId: match.id, status: match.status }, { winnerRegistrationId: winnerId, score });
      return true;
    });
    if (!outcome) { res.status(409).json({ error: "Result is invalid or was already recorded" }); return; }
    res.json(await detail((await ownerTournament(tournament.id, req.user!.userId))!));
  } catch (error) {
    req.log.error({ err: error, tournamentId: req.params.id, matchId: req.params.matchId }, "Result recording failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

async function refund(provider: string, providerPaymentId: string, amount: string) {
  if (provider === "MOCK") return `mock_tre_${randomUUID().replaceAll("-", "")}`;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require("stripe");
  const stripe = new Stripe(process.env.STRIPE_TEST_SK, { apiVersion: "2024-11-20.acacia" });
  const result = await stripe.refunds.create({
    payment_intent: providerPaymentId, amount: Math.round(Number(amount) * 100),
    reason: "requested_by_customer", reverse_transfer: true, refund_application_fee: true,
  }, { idempotencyKey: `tournament-refund:${providerPaymentId}` });
  return result.id as string;
}

async function settlePendingTournamentRefund(paymentId: string, actorId: string | null) {
  const [payment] = await db.select().from(tournamentPaymentsTable).where(and(
    eq(tournamentPaymentsTable.id, paymentId), eq(tournamentPaymentsTable.status, "REFUND_PENDING"),
  )).limit(1);
  if (!payment) return;
  try {
    const refundId = await refund(payment.provider, payment.providerPaymentId, payment.amountSnapshot);
    await db.transaction(async (tx) => {
      const [changed] = await tx.update(tournamentPaymentsTable).set({
        status: "REFUNDED", refundId, refundedAt: new Date(), updatedAt: new Date(),
      }).where(and(eq(tournamentPaymentsTable.id, payment.id), eq(tournamentPaymentsTable.status, "REFUND_PENDING"))).returning();
      if (!changed) return;
      const [registration] = await tx.update(tournamentRegistrationsTable).set({ status: "REFUNDED", updatedAt: new Date() })
        .where(eq(tournamentRegistrationsTable.id, payment.registrationId)).returning();
      if (registration) await audit(tx, registration.tournamentId, actorId, "REGISTRATION_REFUNDED", null, { registrationId: registration.id, refundId });
    });
  } catch {
    // It remains REFUND_PENDING for a safe owner retry/reconciliation.
  }
}

router.post<{ id: string }>("/owner/tournaments/:id/refunds/retry", ...ownerGuard, async (req, res): Promise<void> => {
  try {
    const tournament = await ownerTournament(req.params.id, req.user!.userId);
    if (!tournament || tournament.status !== "CANCELLED") {
      res.status(409).json({ error: "Only a cancelled owned tournament can reconcile refunds" }); return;
    }
    const pending = await db.select({ paymentId: tournamentPaymentsTable.id }).from(tournamentPaymentsTable)
      .innerJoin(tournamentRegistrationsTable, eq(tournamentRegistrationsTable.id, tournamentPaymentsTable.registrationId))
      .where(and(eq(tournamentRegistrationsTable.tournamentId, tournament.id),
        eq(tournamentPaymentsTable.status, "REFUND_PENDING")));
    for (const payment of pending) {
      await settlePendingTournamentRefund(payment.paymentId, req.user!.userId);
    }
    res.json(await detail(tournament));
  } catch (error) {
    req.log.error({ err: error, tournamentId: req.params.id }, "Tournament refund reconciliation failed");
    res.status(502).json({ error: "Unable to reconcile tournament refunds" });
  }
});

router.post<{ id: string }>("/owner/tournaments/:id/cancel", ...ownerGuard, async (req, res): Promise<void> => {
  try {
    const reason = (req.body as { reason?: string }).reason?.trim();
    if (!reason || reason.length > 1000) { res.status(400).json({ error: "A cancellation reason is required" }); return; }
    const tournament = await ownerTournament(req.params.id, req.user!.userId);
    if (!tournament || ["COMPLETED", "CANCELLED"].includes(tournament.status)) {
      res.status(409).json({ error: "Tournament cannot be cancelled" }); return;
    }
    const payments = await db.transaction(async (tx) => {
      const [changed] = await tx.update(tournamentsTable).set({ status: "CANCELLED", cancellationReason: reason, cancelledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(tournamentsTable.id, tournament.id), ne(tournamentsTable.status, "CANCELLED"))).returning();
      if (!changed) return [];
      await tx.update(tournamentMatchesTable).set({ status: "CANCELLED", updatedAt: new Date() })
        .where(and(eq(tournamentMatchesTable.tournamentId, tournament.id), ne(tournamentMatchesTable.status, "COMPLETED")));
      const paid = await tx.select().from(tournamentPaymentsTable).innerJoin(tournamentRegistrationsTable, eq(tournamentRegistrationsTable.id, tournamentPaymentsTable.registrationId))
        .where(and(eq(tournamentRegistrationsTable.tournamentId, tournament.id), inArray(tournamentPaymentsTable.status, ["SUCCEEDED", "PENDING"])));
      const succeeded = paid.filter((item) => item.tournament_payments.status === "SUCCEEDED");
      if (succeeded.length) await tx.update(tournamentPaymentsTable).set({ status: "REFUND_PENDING", updatedAt: new Date() })
        .where(inArray(tournamentPaymentsTable.id, succeeded.map((item) => item.tournament_payments.id)));
      await audit(tx, tournament.id, req.user!.userId, "TOURNAMENT_CANCELLED", { status: tournament.status }, { status: "CANCELLED" }, { reason });
      return paid;
    });
    for (const item of payments) {
      try {
        const payment = item.tournament_payments;
        if (payment.status === "PENDING") {
          if (payment.provider === "STRIPE") {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const Stripe = require("stripe"); const stripe = new Stripe(process.env.STRIPE_TEST_SK, { apiVersion: "2024-11-20.acacia" });
            await stripe.paymentIntents.cancel(payment.providerPaymentId);
          }
          await db.update(tournamentPaymentsTable).set({ status: "FAILED", updatedAt: new Date() })
            .where(and(eq(tournamentPaymentsTable.id, payment.id), eq(tournamentPaymentsTable.status, "PENDING")));
          continue;
        }
        const refundId = await refund(payment.provider, payment.providerPaymentId, payment.amountSnapshot);
        await db.transaction(async (tx) => {
          await tx.update(tournamentPaymentsTable).set({ status: "REFUNDED", refundId, refundedAt: new Date(), updatedAt: new Date() }).where(and(eq(tournamentPaymentsTable.id, payment.id), eq(tournamentPaymentsTable.status, "REFUND_PENDING")));
          await tx.update(tournamentRegistrationsTable).set({ status: "REFUNDED", updatedAt: new Date() }).where(eq(tournamentRegistrationsTable.id, payment.registrationId));
          await audit(tx, tournament.id, req.user!.userId, "REGISTRATION_REFUNDED", { status: "SUCCEEDED" }, { status: "REFUNDED" }, { registrationId: payment.registrationId, refundId });
        });
      } catch (error) {
        req.log.error({ err: error, tournamentId: tournament.id, paymentId: item.tournament_payments.id }, "Tournament refund remains pending");
      }
    }
    res.json({ tournament: await serializeTournament((await ownerTournament(tournament.id, req.user!.userId))!) });
  } catch (error) {
    req.log.error({ err: error, tournamentId: req.params.id }, "Tournament cancellation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;