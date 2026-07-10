import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

// GET /owner/notifications — list the authenticated owner's notifications (newest first)
router.get("/owner/notifications", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const userId = req.user!.userId;

    const notifications = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, userId))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(100);

    res.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        entityType: n.entityType,
        entityId: n.entityId,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("GET /owner/notifications error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /owner/notifications/read — mark one or all notifications as read
// Body: { id?: string } — if id is provided, marks that one; otherwise marks all unread.
router.patch("/owner/notifications/read", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.body as { id?: string };

    if (id) {
      await db
        .update(notificationsTable)
        .set({ read: true })
        .where(
          and(
            eq(notificationsTable.id, id),
            eq(notificationsTable.userId, userId),
          ),
        );
    } else {
      await db
        .update(notificationsTable)
        .set({ read: true })
        .where(
          and(
            eq(notificationsTable.userId, userId),
            eq(notificationsTable.read, false),
          ),
        );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /owner/notifications/read error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
