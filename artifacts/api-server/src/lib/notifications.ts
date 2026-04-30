import { db } from "@workspace/db";
import {
  notificationsTable,
  usersTable,
  type Notification,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

type NotifType =
  | "BOOKING_CONFIRMED"
  | "BOOKING_CANCELLED"
  | "NEW_BOOKING_OWNER"
  | "BOOKING_REMINDER"
  | "VENUE_APPROVED"
  | "VENUE_REJECTED"
  | "PAYMENT_FAILED";

interface SendNotifOpts {
  userId: string;
  type: NotifType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  scheduledAt?: Date;
}

// ─── Expo Push API ─────────────────────────────────────────────────────────────

async function sendExpoPush(token: string, title: string, body: string, data?: Record<string, string>) {
  if (!token.startsWith("ExponentPushToken[")) return; // ignore invalid tokens
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: token, title, body, data: data ?? {}, sound: "default" }),
    });
  } catch (_) {
    // Non-fatal — continue if push fails
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function sendNotification(opts: SendNotifOpts): Promise<void> {
  const { userId, type, title, body, entityType, entityId, scheduledAt } = opts;

  // Store in-app notification and get its ID
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
    })
    .returning({ id: notificationsTable.id });

  // Send push notification if immediate (no scheduledAt)
  if (!scheduledAt && inserted) {
    const [user] = await db
      .select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (user?.pushToken) {
      await sendExpoPush(user.pushToken, title, body, { type, entityId: entityId ?? "" });
      // Mark exactly this notification row as pushed (by its PK)
      await db
        .update(notificationsTable)
        .set({ pushSent: true })
        .where(eq(notificationsTable.id, inserted.id));
    }
  }
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

  // Schedule reminder for player ~2 hours before booking
  const reminderAt = new Date(startAt.getTime() - 2 * 60 * 60 * 1000);
  if (reminderAt > new Date()) {
    await sendNotification({
      userId: playerId,
      type: "BOOKING_REMINDER",
      title: "Booking Reminder",
      body: `Your futsal session at ${venueName} starts in 2 hours.`,
      entityType: "BOOKING",
      entityId: bookingId,
      scheduledAt: reminderAt,
    });
  }
}
