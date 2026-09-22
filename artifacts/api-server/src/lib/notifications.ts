import { db } from "@workspace/db";
import {
  notificationsTable,
  usersTable,
  bookingsTable,
  pitchesTable,
  venuesTable,
  type Notification,
} from "@workspace/db/schema";
import { and, eq, isNotNull, lt, lte, notExists } from "drizzle-orm";
import { logger } from "./logger";

type NotifType =
  | "BOOKING_CONFIRMED"
  | "BOOKING_CANCELLED"
  | "NEW_BOOKING_OWNER"
  | "BOOKING_REMINDER"
  | "VENUE_APPROVED"
  | "VENUE_REJECTED"
  | "VENUE_DISABLED"
  | "PAYMENT_FAILED"
  | "MATCH_FINISHED"
  | "SQUAD_MATCHED"
  | "MATCH_EXPIRED"
  | "MATCH_CANCELLED"
  | "WAITLIST_CLAIM"
  | "WAITLIST_CLAIM_EXPIRED";

interface SendNotifOpts {
  userId: string;
  type: NotifType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  scheduledAt?: Date;
  dedupeKey?: string;
}

// ─── Expo Push API ─────────────────────────────────────────────────────────────

type PushDeliveryStatus = "delivered" | "skipped (no token)" | "failed (token invalidated)";

interface SendResult {
  status: PushDeliveryStatus;
  ticketId: string | null;
}

/**
 * Sends a single Expo push notification.
 * Returns the delivery status and, on success, the Expo ticket ID for later
 * receipt polling.
 *
 * If the ticket immediately contains DeviceNotRegistered the token is cleared
 * right away. Otherwise the ticket ID is stored and the receipt is checked
 * asynchronously by checkPushReceipts().
 */
async function sendExpoPush(
  userId: string,
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<SendResult> {
  if (!token.startsWith("ExponentPushToken[")) {
    console.info(`[push] skipped (no token) — invalid token format for user ${userId}`);
    return { status: "skipped (no token)", ticketId: null };
  }

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: token, title, body, data: data ?? {}, sound: "default" }),
    });

    if (!response.ok) {
      console.warn(`[push] HTTP ${response.status} from Expo for user ${userId} — non-fatal`);
      return { status: "delivered", ticketId: null };
    }

    // Expo returns { data: Ticket }
    // Ticket is either { status: "ok", id: "..." }
    //               or { status: "error", message: "...", details?: { error: string } }
    const json = (await response.json()) as {
      data?: { status?: string; id?: string; details?: { error?: string }; message?: string };
    };

    const ticket = json.data;

    if (ticket?.status === "error") {
      const expoError = ticket.details?.error ?? "unknown";

      if (expoError === "DeviceNotRegistered") {
        console.info(
          `[push] failed (token invalidated) — DeviceNotRegistered for user ${userId}; clearing push token`,
        );
        await db.update(usersTable).set({ pushToken: null }).where(eq(usersTable.id, userId));
        return { status: "failed (token invalidated)", ticketId: null };
      }

      console.warn(
        `[push] Expo ticket error "${expoError}" for user ${userId}: ${ticket.message ?? ""}`,
      );
      return { status: "delivered", ticketId: null };
    }

    const ticketId = ticket?.id ?? null;
    console.info(`[push] delivered to user ${userId}${ticketId ? ` (ticket ${ticketId})` : ""}`);
    return { status: "delivered", ticketId };
  } catch (err) {
    console.warn(`[push] network error for user ${userId} (non-fatal):`, err);
    return { status: "delivered", ticketId: null };
  }
}

// ─── Receipt polling ──────────────────────────────────────────────────────────

/**
 * Queries Expo push receipts for notifications that have a stored ticket ID.
 * Expo guarantees receipts are available ~15 minutes after send; we call this
 * from the reminder dispatcher so it runs every minute and naturally picks up
 * receipts once they appear.
 *
 * When a receipt reports DeviceNotRegistered the user's pushToken is NULLed so
 * the stale entry is removed and future sends are skipped early.
 */
async function checkPushReceipts(): Promise<void> {
  // Only check tickets that are at least 1 minute old (Expo needs time to process).
  const cutoff = new Date(Date.now() - 60_000);

  const rows = await db
    .select({
      notifId: notificationsTable.id,
      userId: notificationsTable.userId,
      ticketId: notificationsTable.expoTicketId,
    })
    .from(notificationsTable)
    .where(
      and(
        isNotNull(notificationsTable.expoTicketId),
        lt(notificationsTable.createdAt, cutoff),
      ),
    )
    .limit(100);

  if (rows.length === 0) return;

  const ticketIds = rows.map((r) => r.ticketId as string);

  let receipts: Record<
    string,
    { status: string; details?: { error?: string }; message?: string }
  > = {};

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ticketIds }),
    });

    if (!response.ok) {
      console.warn(`[push] getReceipts HTTP ${response.status} — will retry next tick`);
      return;
    }

    const json = (await response.json()) as { data?: typeof receipts };
    receipts = json.data ?? {};
  } catch (err) {
    console.warn("[push] getReceipts network error (non-fatal):", err);
    return;
  }

  // Process each receipt and clear the stored ticket ID so we don't re-check.
  for (const row of rows) {
    const receipt = receipts[row.ticketId as string];

    if (!receipt) {
      // Receipt not yet available — leave expoTicketId in place, retry next tick.
      continue;
    }

    const expoError = receipt.details?.error;

    if (receipt.status === "error" && expoError === "DeviceNotRegistered") {
      console.info(
        `[push] failed (token invalidated) — receipt DeviceNotRegistered for user ${row.userId}; clearing push token`,
      );
      await db.update(usersTable).set({ pushToken: null }).where(eq(usersTable.id, row.userId));
    } else if (receipt.status === "error") {
      console.warn(
        `[push] receipt error "${expoError ?? "unknown"}" for user ${row.userId} (notif ${row.notifId})`,
      );
    } else {
      console.info(`[push] receipt ok for user ${row.userId} (notif ${row.notifId})`);
    }

    // Mark ticket as processed by clearing the stored ID.
    await db
      .update(notificationsTable)
      .set({ expoTicketId: null })
      .where(eq(notificationsTable.id, row.notifId));
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function sendNotification(opts: SendNotifOpts): Promise<void> {
  const { userId, type, title, body, entityType, entityId, scheduledAt, dedupeKey } = opts;

  // Store in-app notification and get its ID.
  const [inserted] = await db
    .insert(notificationsTable)
    .values({
      userId,
      type,
      title,
      body,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      scheduledAt: scheduledAt ?? null,
      dedupeKey: dedupeKey ?? null,
    })
    .onConflictDoNothing({ target: notificationsTable.dedupeKey })
    .returning({ id: notificationsTable.id });

  // Send push notification if immediate (no scheduledAt).
  if (!scheduledAt && inserted) {
    const [user] = await db
      .select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user?.pushToken) {
      console.info(`[push] skipped (no token) — user ${userId} has no push token`);
      return;
    }

    const { status, ticketId } = await sendExpoPush(userId, user.pushToken, title, body, {
      type,
      entityId: entityId ?? "",
    });

    if (status === "delivered") {
      await db
        .update(notificationsTable)
        .set({ pushSent: true, expoTicketId: ticketId })
        .where(eq(notificationsTable.id, inserted.id));
    }
    // For "failed (token invalidated)" and "skipped" we intentionally leave
    // pushSent=false so the record remains visible in the in-app feed only.
  }
}

// ─── Reminder Dispatcher ──────────────────────────────────────────────────────
// Polls every minute for:
//   1. Scheduled notification rows whose scheduledAt has passed — sends push.
//   2. Stored Expo ticket IDs — checks receipts and clears stale tokens.
//   3. CONFIRMED bookings whose endAt has passed — sends MATCH_FINISHED to player (once).

export function startReminderDispatcher(intervalMs = 60_000): NodeJS.Timeout {
  return setInterval(async () => {
    // ── Step 1: send due scheduled notifications ──
    try {
      const now = new Date();
      const dueRows = await db
        .select({
          notif: notificationsTable,
          userId: usersTable.id,
          pushToken: usersTable.pushToken,
        })
        .from(notificationsTable)
        .innerJoin(usersTable, eq(notificationsTable.userId, usersTable.id))
        .where(
          and(
            eq(notificationsTable.pushSent, false),
            isNotNull(notificationsTable.scheduledAt),
            lte(notificationsTable.scheduledAt, now),
          ),
        )
        .limit(50);

      for (const row of dueRows) {
        if (!row.pushToken) {
          console.info(
            `[push] skipped (no token) — user ${row.userId} has no push token (reminder notif ${row.notif.id})`,
          );
          // Mark as sent so the dispatcher doesn't retry indefinitely.
          await db
            .update(notificationsTable)
            .set({ pushSent: true })
            .where(eq(notificationsTable.id, row.notif.id));
          continue;
        }

        const { status, ticketId } = await sendExpoPush(
          row.userId,
          row.pushToken,
          row.notif.title,
          row.notif.body,
          {
            type: row.notif.type,
            entityId: row.notif.entityId ?? "",
          },
        );

        // Always mark pushSent=true — token was cleared if invalidated.
        await db
          .update(notificationsTable)
          .set({ pushSent: true, expoTicketId: ticketId })
          .where(eq(notificationsTable.id, row.notif.id));

        console.info(
          `[push] reminder notif ${row.notif.id} for user ${row.userId}: ${status}`,
        );
      }
    } catch (err) {
      console.warn("[push] reminder dispatcher send error (non-fatal):", err);
    }

    // ── Step 2: check Expo receipts for pending ticket IDs ──
    try {
      await checkPushReceipts();
    } catch (err) {
      console.warn("[push] receipt check error (non-fatal):", err);
    }

    // ── Step 3: send MATCH_FINISHED for past-due CONFIRMED bookings ──
    try {
      const now = new Date();
      // Find CONFIRMED bookings whose session has ended and haven't yet received
      // a MATCH_FINISHED notification (idempotent — checked via NOT EXISTS).
      const finishedBookings = await db
        .select({
          bookingId: bookingsTable.id,
          playerId: bookingsTable.playerId,
          venueName: venuesTable.name,
          pitchName: pitchesTable.name,
        })
        .from(bookingsTable)
        .innerJoin(venuesTable, eq(bookingsTable.venueId, venuesTable.id))
        .innerJoin(pitchesTable, eq(bookingsTable.pitchId, pitchesTable.id))
        .where(
          and(
            eq(bookingsTable.status, "CONFIRMED"),
            lt(bookingsTable.endAt, now),
            notExists(
              db
                .select({ id: notificationsTable.id })
                .from(notificationsTable)
                .where(
                  and(
                    eq(notificationsTable.userId, bookingsTable.playerId),
                    eq(notificationsTable.type, "MATCH_FINISHED"),
                    eq(notificationsTable.entityType, "BOOKING"),
                    eq(notificationsTable.entityId, bookingsTable.id),
                  ),
                ),
            ),
          ),
        )
        .limit(50);

      for (const row of finishedBookings) {
        await sendNotification({
          userId: row.playerId,
          type: "MATCH_FINISHED",
          title: "Match Finished",
          body: `Your futsal session at ${row.venueName} — ${row.pitchName} has ended. Well played!`,
          entityType: "BOOKING",
          entityId: row.bookingId,
        });
        console.info(
          `[notif] MATCH_FINISHED sent to player ${row.playerId} for booking ${row.bookingId}`,
        );
      }
    } catch (err) {
      console.warn("[notif] MATCH_FINISHED dispatcher error (non-fatal):", err);
    }
  }, intervalMs);
}

export async function sendBookingConfirmedNotifications(opts: {
  bookingId: string;
  playerId: string;
  playerName: string;
  ownerId: string;
  venueName: string;
  pitchName: string;
  startAt: Date;
}): Promise<void> {
  const { bookingId, playerId, playerName, ownerId, venueName, pitchName, startAt } = opts;

  const formattedDate = startAt.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });

  // Notify player
  await sendNotification({
    userId: playerId,
    type: "BOOKING_CONFIRMED",
    title: "Booking Confirmed!",
    body: `Your slot at ${venueName} — ${pitchName} on ${formattedDate} UTC is confirmed.`,
    entityType: "BOOKING",
    entityId: bookingId,
  });

  // Notify owner
  await sendNotification({
    userId: ownerId,
    type: "NEW_BOOKING_OWNER",
    title: "New Booking",
    body: `${playerName} booked ${pitchName} at ${venueName} for ${formattedDate} UTC.`,
    entityType: "BOOKING",
    entityId: bookingId,
  });

  // Schedule reminder for player ~1 hour before booking
  const reminderAt = new Date(startAt.getTime() - 1 * 60 * 60 * 1000);
  if (reminderAt > new Date()) {
    await sendNotification({
      userId: playerId,
      type: "BOOKING_REMINDER",
      title: "Booking Reminder",
      body: `Your futsal session at ${venueName} starts in 1 hour.`,
      entityType: "BOOKING",
      entityId: bookingId,
      scheduledAt: reminderAt,
    });
  }
}
