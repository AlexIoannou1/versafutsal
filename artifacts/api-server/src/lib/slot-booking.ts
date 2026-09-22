import { db } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import {
  availabilityBlocksTable,
  bookingsTable,
  maintenanceBlocksTable,
  openingHoursTable,
  pitchesTable,
  pricingRulesTable,
  venuesTable,
} from "@workspace/db/schema";
import { and, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type SlotBookingErrorCode =
  | "PITCH_NOT_FOUND"
  | "VENUE_NOT_APPROVED"
  | "VENUE_CLOSED"
  | "INVALID_SLOT"
  | "AVAILABILITY_BLOCKED"
  | "MAINTENANCE_BLOCKED"
  | "SLOT_TAKEN";

export class SlotBookingError extends Error {
  constructor(public readonly code: SlotBookingErrorCode) {
    super(code);
  }
}

type Transaction = Parameters<Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]>[0];

function slotBoundaries(date: string, openTime: string, closeTime: string, duration: number) {
  const start = new Date(`${date}T${openTime}Z`);
  const close = new Date(`${date}T${closeTime}Z`);
  const values: number[] = [];
  while (start.getTime() + duration * 60_000 <= close.getTime()) {
    values.push(start.getTime());
    start.setTime(start.getTime() + duration * 60_000);
  }
  return values;
}

function availabilityOverlaps(
  startAt: Date,
  endAt: Date,
  block: typeof availabilityBlocksTable.$inferSelect,
) {
  const date = startAt.toISOString().slice(0, 10);
  const day = startAt.getUTCDay();
  if (block.startDate > date || block.endDate < date || (block.recursWeekly && block.dayOfWeek !== day)) return false;
  if (!block.startTime || !block.endTime) return true;
  return new Date(`${date}T${block.startTime}Z`) < endAt &&
    new Date(`${date}T${block.endTime}Z`) > startAt;
}

export async function reserveValidatedSlot(input: {
  pitchId: string;
  playerId: string;
  startAt: Date;
  status?: "PENDING" | "CONFIRMED";
  guestName?: string;
  guestPhone?: string;
  afterReserve?: (tx: Transaction, booking: typeof bookingsTable.$inferSelect) => Promise<void>;
}) {
  try {
    return await db.transaction(async (tx) => {
      const [pitch] = await tx.select({
        id: pitchesTable.id,
        venueId: pitchesTable.venueId,
        duration: pitchesTable.slotDurationMinutes,
        venueStatus: venuesTable.status,
        cancellationWindowHours: venuesTable.cancellationWindowHours,
      }).from(pitchesTable)
        .innerJoin(venuesTable, eq(pitchesTable.venueId, venuesTable.id))
        .where(eq(pitchesTable.id, input.pitchId)).limit(1);
      if (!pitch) throw new SlotBookingError("PITCH_NOT_FOUND");
      if (pitch.venueStatus !== "APPROVED") throw new SlotBookingError("VENUE_NOT_APPROVED");

      const date = input.startAt.toISOString().slice(0, 10);
      const [hours] = await tx.select().from(openingHoursTable).where(and(
        eq(openingHoursTable.venueId, pitch.venueId),
        eq(openingHoursTable.dayOfWeek, input.startAt.getUTCDay()),
      )).limit(1);
      if (!hours || hours.isClosed) throw new SlotBookingError("VENUE_CLOSED");
      if (!slotBoundaries(date, hours.openTime, hours.closeTime, pitch.duration).includes(input.startAt.getTime())) {
        throw new SlotBookingError("INVALID_SLOT");
      }
      const endAt = new Date(input.startAt.getTime() + pitch.duration * 60_000);
      const availability = await tx.select().from(availabilityBlocksTable).where(and(
        eq(availabilityBlocksTable.venueId, pitch.venueId),
        or(isNull(availabilityBlocksTable.pitchId), eq(availabilityBlocksTable.pitchId, input.pitchId)),
      ));
      if (availability.some((block) => availabilityOverlaps(input.startAt, endAt, block))) {
        throw new SlotBookingError("AVAILABILITY_BLOCKED");
      }
      const maintenance = await tx.select({ id: maintenanceBlocksTable.id }).from(maintenanceBlocksTable).where(and(
        eq(maintenanceBlocksTable.pitchId, input.pitchId),
        lt(maintenanceBlocksTable.startAt, endAt),
        gt(maintenanceBlocksTable.endAt, input.startAt),
      )).limit(1);
      if (maintenance.length) throw new SlotBookingError("MAINTENANCE_BLOCKED");
      const occupied = await tx.select({ id: bookingsTable.id }).from(bookingsTable).where(and(
        eq(bookingsTable.pitchId, input.pitchId),
        eq(bookingsTable.startAt, input.startAt),
        inArray(bookingsTable.status, ["PENDING", "CONFIRMED"]),
      )).limit(1);
      if (occupied.length) throw new SlotBookingError("SLOT_TAKEN");

      const [pricing] = await tx.select().from(pricingRulesTable).where(eq(pricingRulesTable.pitchId, input.pitchId)).limit(1);
      const [booking] = await tx.insert(bookingsTable).values({
        venueId: pitch.venueId,
        pitchId: input.pitchId,
        playerId: input.playerId,
        startAt: input.startAt,
        endAt,
        status: input.status ?? "PENDING",
        guestName: input.guestName,
        guestPhone: input.guestPhone,
        policySnapshot: {
          pricePerHour: pricing?.pricePerHour ?? null,
          cancellationWindowHours: pitch.cancellationWindowHours,
          slotDurationMinutes: pitch.duration,
          capturedAt: new Date().toISOString(),
        },
      }).returning();
      await input.afterReserve?.(tx, booking!);
      return booking!;
    }, { isolationLevel: "serializable" });
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ??
      (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505" || code === "40001") throw new SlotBookingError("SLOT_TAKEN");
    throw error;
  }
}