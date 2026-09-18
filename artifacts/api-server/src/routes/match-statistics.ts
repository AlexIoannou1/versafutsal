import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  bookingsTable,
  matchParticipantsTable,
  matchResultsTable,
  matchStatEventsTable,
  usersTable,
  venuesTable,
} from "@workspace/db/schema";
import {
  DeleteAdminMatchStatisticsBody,
  DeleteAdminMatchStatisticsParams,
  DeleteOwnerMatchStatisticsParams,
  GetAdminMatchStatisticsParams,
  GetAdminMatchStatisticsResponse,
  GetOwnerMatchStatisticsParams,
  GetOwnerMatchStatisticsResponse,
  GetPlayerCareerMatchStatisticsParams,
  GetPlayerCareerMatchStatisticsResponse,
  GetPlayerVenueMatchStatisticsParams,
  GetPlayerVenueMatchStatisticsResponse,
  PutAdminMatchStatisticsBody,
  PutAdminMatchStatisticsParams,
  PutAdminMatchStatisticsResponse,
  PutOwnerMatchStatisticsBody,
  PutOwnerMatchStatisticsParams,
  PutOwnerMatchStatisticsResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { requireOwnerCapability } from "../lib/entitlements";
import {
  hasMatchVersionConflict,
  isCompletedConfirmedBooking,
  ownerCanManageBooking,
  validateMatchStatistics,
  type MatchStatisticsInput,
} from "../lib/match-statistics-validation";
import { logMatchStatisticsAudit } from "../lib/audit";

const router: IRouter = Router();

type MatchSnapshot = {
  homeScore: number;
  awayScore: number;
  version: number;
  participants: MatchStatisticsInput["participants"];
};

function pgCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
}

async function loadMatch(matchId?: string, bookingId?: string) {
  const [match] = await db
    .select()
    .from(matchResultsTable)
    .where(matchId
      ? eq(matchResultsTable.id, matchId)
      : eq(matchResultsTable.bookingId, bookingId!))
    .limit(1);
  if (!match) return null;

  const participants = await db
    .select({
      id: matchParticipantsTable.id,
      playerId: matchParticipantsTable.playerId,
      playerName: usersTable.name,
      team: matchParticipantsTable.team,
      goals: matchStatEventsTable.goals,
      assists: matchStatEventsTable.assists,
      saves: matchStatEventsTable.saves,
      yellowCards: matchStatEventsTable.yellowCards,
      redCards: matchStatEventsTable.redCards,
    })
    .from(matchParticipantsTable)
    .innerJoin(usersTable, eq(matchParticipantsTable.playerId, usersTable.id))
    .innerJoin(
      matchStatEventsTable,
      and(
        eq(matchStatEventsTable.matchId, matchParticipantsTable.matchId),
        eq(matchStatEventsTable.participantId, matchParticipantsTable.id),
      ),
    )
    .where(eq(matchParticipantsTable.matchId, match.id))
    .orderBy(matchParticipantsTable.team, usersTable.name, matchParticipantsTable.playerId);

  return {
    id: match.id,
    bookingId: match.bookingId,
    venueId: match.venueId,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    version: match.version,
    participants,
    createdAt: match.createdAt.toISOString(),
    updatedAt: match.updatedAt.toISOString(),
  };
}

function snapshot(match: Awaited<ReturnType<typeof loadMatch>>): MatchSnapshot | null {
  if (!match) return null;
  return {
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    version: match.version,
    participants: match.participants.map(({ playerId, team, goals, assists, saves, yellowCards, redCards }) => ({
      playerId,
      team,
      goals,
      assists,
      saves,
      yellowCards,
      redCards,
    })),
  };
}

function snapshotFromRows(
  match: Pick<typeof matchResultsTable.$inferSelect, "homeScore" | "awayScore" | "version">,
  participants: MatchStatisticsInput["participants"],
): MatchSnapshot {
  return {
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    version: match.version,
    participants,
  };
}

async function listAvailablePlayers(venueId: string) {
  return db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(usersTable)
    .innerJoin(bookingsTable, eq(bookingsTable.playerId, usersTable.id))
    .where(and(
      eq(usersTable.role, "PLAYER"),
      sql`${usersTable.deletedAt} IS NULL`,
      eq(bookingsTable.venueId, venueId),
      eq(bookingsTable.status, "CONFIRMED"),
      sql`${bookingsTable.endAt} <= now()`,
    ))
    .groupBy(usersTable.id, usersTable.name, usersTable.avatarUrl)
    .orderBy(usersTable.name, usersTable.id);
}

async function saveMatchStatistics(
  req: Request,
  res: Response,
  admin: boolean,
): Promise<void> {
  const params = admin
    ? PutAdminMatchStatisticsParams.safeParse(req.params)
    : PutOwnerMatchStatisticsParams.safeParse(req.params);
  const body = admin
    ? PutAdminMatchStatisticsBody.safeParse(req.body)
    : PutOwnerMatchStatisticsBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid match statistics request" });
    return;
  }

  const input = body.data as MatchStatisticsInput;
  const identity = params.data as { matchId?: string; bookingId?: string };
  const existing = await loadMatch(identity.matchId, identity.bookingId);
  const bookingId = existing?.bookingId ?? identity.bookingId;
  if (!bookingId) {
    res.status(404).json({ error: "Match statistics not found" });
    return;
  }

  const [booking] = await db
    .select({
      id: bookingsTable.id,
      venueId: bookingsTable.venueId,
      playerId: bookingsTable.playerId,
      playerRole: usersTable.role,
      ownerId: venuesTable.ownerId,
      status: bookingsTable.status,
      endAt: bookingsTable.endAt,
    })
    .from(bookingsTable)
    .innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
    .innerJoin(usersTable, eq(bookingsTable.playerId, usersTable.id))
    .where(eq(bookingsTable.id, bookingId))
    .limit(1);

  if (!booking || (!admin && booking.ownerId !== req.user!.userId)) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  if (admin
    ? !isCompletedConfirmedBooking(booking)
    : !ownerCanManageBooking(booking, req.user!.userId)) {
    res.status(400).json({ error: "Match statistics can only be recorded for completed confirmed bookings." });
    return;
  }

  const validationError = validateMatchStatistics(
    input,
    booking.playerRole === "PLAYER" ? booking.playerId : undefined,
  );
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const playerIds = input.participants.map((participant) => participant.playerId);

  try {
    const matchId = await db.transaction(
      async (tx) => {
        const [lockedBooking] = await tx
          .select({
            id: bookingsTable.id,
            status: bookingsTable.status,
            endAt: bookingsTable.endAt,
          })
          .from(bookingsTable)
          .where(eq(bookingsTable.id, booking.id))
          .for("update");
        if (!lockedBooking ||
            lockedBooking.status !== "CONFIRMED" ||
            lockedBooking.endAt > new Date()) {
          throw Object.assign(new Error("booking_not_completed"), { code: "BOOKING_NOT_COMPLETED" });
        }

        const eligiblePlayers = await tx
          .select({ id: usersTable.id })
          .from(usersTable)
          .innerJoin(bookingsTable, eq(bookingsTable.playerId, usersTable.id))
          .where(and(
            inArray(usersTable.id, playerIds),
            eq(usersTable.role, "PLAYER"),
            sql`${usersTable.deletedAt} IS NULL`,
            eq(bookingsTable.venueId, booking.venueId),
            eq(bookingsTable.status, "CONFIRMED"),
            sql`${bookingsTable.endAt} <= now()`,
          ))
          .groupBy(usersTable.id);
        if (new Set(eligiblePlayers.map((player) => player.id)).size !== playerIds.length) {
          throw Object.assign(new Error("invalid_player"), { code: "INVALID_PLAYER" });
        }

        const [current] = await tx
          .select()
          .from(matchResultsTable)
          .where(eq(matchResultsTable.bookingId, booking.id))
          .limit(1)
          .for("update");

        if (hasMatchVersionConflict(current?.version ?? null, input.expectedVersion)) {
          throw Object.assign(new Error("version_conflict"), { code: "VERSION_CONFLICT" });
        }
        if (admin && identity.matchId && current?.id !== identity.matchId) {
          throw Object.assign(new Error("not_found"), { code: "NOT_FOUND" });
        }

        const previousValue = current
          ? snapshotFromRows(
              current,
              await tx
                .select({
                  playerId: matchParticipantsTable.playerId,
                  team: matchParticipantsTable.team,
                  goals: matchStatEventsTable.goals,
                  assists: matchStatEventsTable.assists,
                  saves: matchStatEventsTable.saves,
                  yellowCards: matchStatEventsTable.yellowCards,
                  redCards: matchStatEventsTable.redCards,
                })
                .from(matchParticipantsTable)
                .innerJoin(
                  matchStatEventsTable,
                  and(
                    eq(matchStatEventsTable.matchId, matchParticipantsTable.matchId),
                    eq(matchStatEventsTable.participantId, matchParticipantsTable.id),
                  ),
                )
                .where(eq(matchParticipantsTable.matchId, current.id))
                .orderBy(matchParticipantsTable.team, matchParticipantsTable.playerId),
            )
          : null;

        let saved: typeof matchResultsTable.$inferSelect;
        if (current) {
          const [updated] = await tx
            .update(matchResultsTable)
            .set({
              homeScore: input.homeScore,
              awayScore: input.awayScore,
              version: current.version + 1,
              updatedBy: req.user!.userId,
              updatedAt: new Date(),
            })
            .where(and(
              eq(matchResultsTable.id, current.id),
              eq(matchResultsTable.version, input.expectedVersion),
            ))
            .returning();
          if (!updated) {
            throw Object.assign(new Error("version_conflict"), { code: "VERSION_CONFLICT" });
          }
          saved = updated;
          await tx.delete(matchParticipantsTable).where(eq(matchParticipantsTable.matchId, saved.id));
        } else {
          const [created] = await tx
            .insert(matchResultsTable)
            .values({
              bookingId: booking.id,
              venueId: booking.venueId,
              homeScore: input.homeScore,
              awayScore: input.awayScore,
              createdBy: req.user!.userId,
              updatedBy: req.user!.userId,
            })
            .returning();
          saved = created!;
        }

        for (const participant of input.participants) {
          const [createdParticipant] = await tx
            .insert(matchParticipantsTable)
            .values({
              matchId: saved.id,
              playerId: participant.playerId,
              team: participant.team,
            })
            .returning({ id: matchParticipantsTable.id });
          await tx.insert(matchStatEventsTable).values({
            matchId: saved.id,
            participantId: createdParticipant!.id,
            goals: participant.goals,
            assists: participant.assists,
            saves: participant.saves,
            yellowCards: participant.yellowCards,
            redCards: participant.redCards,
          });
        }

        await logMatchStatisticsAudit(tx, {
          matchId: saved.id,
          bookingId: booking.id,
          actorUserId: req.user!.userId,
          actorRole: req.user!.role,
          action: current ? "MATCH_STATISTICS_UPDATED" : "MATCH_STATISTICS_CREATED",
          previousValue,
          newValue: { ...input, version: saved.version },
          metadata: { venueId: booking.venueId },
        });
        return saved.id;
      },
      { isolationLevel: "serializable" },
    );

    const result = await loadMatch(matchId);
    const responseSchema = admin
      ? PutAdminMatchStatisticsResponse
      : PutOwnerMatchStatisticsResponse;
    res.json(responseSchema.parse({ match: result }));
  } catch (error) {
    if (pgCode(error) === "40001" || pgCode(error) === "23505" ||
        (error as { code?: string }).code === "VERSION_CONFLICT") {
      res.status(409).json({ error: "Match statistics changed in another request. Reload and try again." });
      return;
    }
    if ((error as { code?: string }).code === "NOT_FOUND") {
      res.status(404).json({ error: "Match statistics not found" });
      return;
    }
    if ((error as { code?: string }).code === "INVALID_PLAYER") {
      res.status(400).json({ error: "Every participant must be an active registered player." });
      return;
    }
    if ((error as { code?: string }).code === "BOOKING_NOT_COMPLETED") {
      res.status(400).json({ error: "Match statistics can only be recorded for completed confirmed bookings." });
      return;
    }
    throw error;
  }
}

router.get(
  "/owner/bookings/:bookingId/match-statistics",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res): Promise<void> => {
    try {
      const params = GetOwnerMatchStatisticsParams.safeParse(req.params);
      if (!params.success) {
        res.status(400).json({ error: "Invalid booking ID" });
        return;
      }
      const [booking] = await db
        .select({ ownerId: venuesTable.ownerId, venueId: bookingsTable.venueId })
        .from(bookingsTable)
        .innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
        .where(eq(bookingsTable.id, params.data.bookingId))
        .limit(1);
      if (!booking || booking.ownerId !== req.user!.userId) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }
      res.json(GetOwnerMatchStatisticsResponse.parse({
        match: await loadMatch(undefined, params.data.bookingId),
        availablePlayers: await listAvailablePlayers(booking.venueId),
      }));
    } catch (error) {
      req.log.error({ err: error }, "Owner match statistics lookup failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.put(
  "/owner/bookings/:bookingId/match-statistics",
  requireAuth,
  requireRole("VENUE_OWNER"),
  requireOwnerCapability("MATCH_STATISTICS"),
  async (req, res): Promise<void> => {
    try {
      await saveMatchStatistics(req, res, false);
    } catch (error) {
      req.log.error({ err: error }, "Owner match statistics save failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

async function deleteMatchStatistics(
  req: Request,
  res: Response,
  admin: boolean,
): Promise<void> {
  const params = admin
    ? DeleteAdminMatchStatisticsParams.safeParse(req.params)
    : DeleteOwnerMatchStatisticsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid match statistics ID" });
    return;
  }
  const identity = params.data as { matchId?: string; bookingId?: string };
  const current = await loadMatch(identity.matchId, identity.bookingId);
  if (!current) {
    res.status(404).json({ error: "Match statistics not found" });
    return;
  }
  const [booking] = await db
    .select({ ownerId: venuesTable.ownerId })
    .from(bookingsTable)
    .innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
    .where(eq(bookingsTable.id, current.bookingId))
    .limit(1);
  if (!booking || (!admin && booking.ownerId !== req.user!.userId)) {
    res.status(404).json({ error: "Match statistics not found" });
    return;
  }
  const parsedDeleteBody = admin ? DeleteAdminMatchStatisticsBody.safeParse(req.body ?? {}) : null;
  if (parsedDeleteBody && !parsedDeleteBody.success) {
    res.status(400).json({ error: "Invalid delete request" });
    return;
  }

  await db.transaction(
    async (tx) => {
      const [locked] = await tx
        .select()
        .from(matchResultsTable)
        .where(eq(matchResultsTable.id, current.id))
        .limit(1)
        .for("update");
      if (!locked) throw Object.assign(new Error("not_found"), { code: "NOT_FOUND" });
      const lockedParticipants = await tx
        .select({
          playerId: matchParticipantsTable.playerId,
          team: matchParticipantsTable.team,
          goals: matchStatEventsTable.goals,
          assists: matchStatEventsTable.assists,
          saves: matchStatEventsTable.saves,
          yellowCards: matchStatEventsTable.yellowCards,
          redCards: matchStatEventsTable.redCards,
        })
        .from(matchParticipantsTable)
        .innerJoin(
          matchStatEventsTable,
          and(
            eq(matchStatEventsTable.matchId, matchParticipantsTable.matchId),
            eq(matchStatEventsTable.participantId, matchParticipantsTable.id),
          ),
        )
        .where(eq(matchParticipantsTable.matchId, locked.id))
        .orderBy(matchParticipantsTable.team, matchParticipantsTable.playerId);
      await logMatchStatisticsAudit(tx, {
        matchId: locked.id,
        bookingId: locked.bookingId,
        actorUserId: req.user!.userId,
        actorRole: req.user!.role,
        action: "MATCH_STATISTICS_DELETED",
        previousValue: snapshotFromRows(locked, lockedParticipants),
        notes: parsedDeleteBody?.success ? parsedDeleteBody.data.reason ?? null : null,
        metadata: { venueId: locked.venueId },
      });
      await tx.delete(matchResultsTable).where(eq(matchResultsTable.id, locked.id));
    },
    { isolationLevel: "serializable" },
  );
  res.status(204).send();
}

router.delete(
  "/owner/bookings/:bookingId/match-statistics",
  requireAuth,
  requireRole("VENUE_OWNER"),
  requireOwnerCapability("MATCH_STATISTICS"),
  async (req, res): Promise<void> => {
    try {
      await deleteMatchStatistics(req, res, false);
    } catch (error) {
      if ((error as { code?: string }).code === "NOT_FOUND" || pgCode(error) === "40001") {
        res.status(409).json({ error: "Match statistics changed in another request. Reload and try again." });
        return;
      }
      req.log.error({ err: error }, "Owner match statistics deletion failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.get(
  "/admin/match-statistics/:matchId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    try {
      const params = GetAdminMatchStatisticsParams.safeParse(req.params);
      if (!params.success) {
        res.status(400).json({ error: "Invalid match statistics ID" });
        return;
      }
      const match = await loadMatch(params.data.matchId);
      if (!match) {
        res.status(404).json({ error: "Match statistics not found" });
        return;
      }
      res.json(GetAdminMatchStatisticsResponse.parse({
        match,
        availablePlayers: await listAvailablePlayers(match.venueId),
      }));
    } catch (error) {
      req.log.error({ err: error }, "Admin match statistics lookup failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.put(
  "/admin/match-statistics/:matchId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    try {
      await saveMatchStatistics(req, res, true);
    } catch (error) {
      req.log.error({ err: error }, "Admin match statistics save failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.delete(
  "/admin/match-statistics/:matchId",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    try {
      await deleteMatchStatistics(req, res, true);
    } catch (error) {
      if ((error as { code?: string }).code === "NOT_FOUND" || pgCode(error) === "40001") {
        res.status(409).json({ error: "Match statistics changed in another request. Reload and try again." });
        return;
      }
      req.log.error({ err: error }, "Admin match statistics deletion failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

async function getSummary(playerId: string, venueId?: string) {
  const conditions = [eq(matchParticipantsTable.playerId, playerId)];
  if (venueId) conditions.push(eq(matchResultsTable.venueId, venueId));
  const [totals] = await db
    .select({
      matchesPlayed: sql<number>`count(distinct ${matchParticipantsTable.matchId})`,
      goals: sql<number>`coalesce(sum(${matchStatEventsTable.goals}), 0)`,
      assists: sql<number>`coalesce(sum(${matchStatEventsTable.assists}), 0)`,
      saves: sql<number>`coalesce(sum(${matchStatEventsTable.saves}), 0)`,
      yellowCards: sql<number>`coalesce(sum(${matchStatEventsTable.yellowCards}), 0)`,
      redCards: sql<number>`coalesce(sum(${matchStatEventsTable.redCards}), 0)`,
      venuesPlayed: sql<number>`count(distinct ${matchResultsTable.venueId})`,
    })
    .from(matchParticipantsTable)
    .innerJoin(matchResultsTable, eq(matchParticipantsTable.matchId, matchResultsTable.id))
    .innerJoin(matchStatEventsTable, eq(matchParticipantsTable.id, matchStatEventsTable.participantId))
    .where(and(...conditions));
  return {
    playerId,
    matchesPlayed: Number(totals?.matchesPlayed ?? 0),
    goals: Number(totals?.goals ?? 0),
    assists: Number(totals?.assists ?? 0),
    saves: Number(totals?.saves ?? 0),
    yellowCards: Number(totals?.yellowCards ?? 0),
    redCards: Number(totals?.redCards ?? 0),
    venuesPlayed: Number(totals?.venuesPlayed ?? 0),
  };
}

router.get("/players/:playerId/match-statistics", requireAuth, async (req, res): Promise<void> => {
  try {
    const params = GetPlayerCareerMatchStatisticsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid player ID" });
      return;
    }
    if (req.user!.role !== "ADMIN" && req.user!.userId !== params.data.playerId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [player] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.id, params.data.playerId),
        eq(usersTable.role, "PLAYER"),
        sql`${usersTable.deletedAt} IS NULL`,
      ))
      .limit(1);
    if (!player) {
      res.status(404).json({ error: "Player not found" });
      return;
    }
    res.json(GetPlayerCareerMatchStatisticsResponse.parse(await getSummary(player.id)));
  } catch (error) {
    req.log.error({ err: error }, "Player career statistics lookup failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get(
  "/venues/:venueId/players/:playerId/match-statistics",
  requireAuth,
  async (req, res): Promise<void> => {
  try {
    const params = GetPlayerVenueMatchStatisticsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid player or venue ID" });
      return;
    }
    if (req.user!.role !== "ADMIN" && req.user!.userId !== params.data.playerId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [[player], [venue]] = await Promise.all([
      db.select({ id: usersTable.id }).from(usersTable).where(and(
        eq(usersTable.id, params.data.playerId),
        eq(usersTable.role, "PLAYER"),
        sql`${usersTable.deletedAt} IS NULL`,
      )).limit(1),
      db.select({ id: venuesTable.id, name: venuesTable.name }).from(venuesTable)
        .where(eq(venuesTable.id, params.data.venueId)).limit(1),
    ]);
    if (!player || !venue) {
      res.status(404).json({ error: "Player or venue not found" });
      return;
    }
    res.json(GetPlayerVenueMatchStatisticsResponse.parse({
      ...await getSummary(player.id, venue.id),
      venueId: venue.id,
      venueName: venue.name,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Player venue statistics lookup failed");
    res.status(500).json({ error: "Internal server error" });
  }
  },
);

export default router;