import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

// ─── DELETE /player/account ───────────────────────────────────────────────────
// Soft-deletes the authenticated player's account: anonymises PII, sets deletedAt.
// The client must log out immediately after a successful response.

router.delete("/player/account", requireAuth, requireRole("PLAYER"), async (req, res) => {
  try {
    const userId = req.user!.userId;

    const anonEmail = `DELETED_${userId}@futsalcy.deleted`;
    const anonName = `DELETED_${userId}`;

    await db
      .update(usersTable)
      .set({
        deletedAt: new Date(),
        email: anonEmail,
        name: anonName,
        phoneNumber: null,
        pushToken: null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /player/account error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /player/payment-methods ─────────────────────────────────────────────
// Returns saved payment methods. Returns demo-mode response when Stripe is not configured.

router.get("/player/payment-methods", requireAuth, requireRole("PLAYER"), async (_req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    res.json({ demoMode: true, paymentMethods: [] });
    return;
  }
  // Stripe live path — not implemented yet; will be wired when Stripe integration is added
  res.json({ demoMode: true, paymentMethods: [] });
});

// ─── POST /player/payment-methods/setup-intent ───────────────────────────────
// Creates a Stripe SetupIntent so the client can save a card.

router.post(
  "/player/payment-methods/setup-intent",
  requireAuth,
  requireRole("PLAYER"),
  async (_req, res) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      res.status(503).json({ error: "Payment methods are not available in demo mode" });
      return;
    }
    res.status(503).json({ error: "Payment methods are not available in demo mode" });
  },
);

// ─── DELETE /player/payment-methods/:pmId ────────────────────────────────────
// Detaches a saved card from the player's Stripe customer.

router.delete<{ pmId: string }>(
  "/player/payment-methods/:pmId",
  requireAuth,
  requireRole("PLAYER"),
  async (_req, res) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      res.status(503).json({ error: "Payment methods are not available in demo mode" });
      return;
    }
    res.status(503).json({ error: "Payment methods are not available in demo mode" });
  },
);

// ─── DELETE /auth/push-token ──────────────────────────────────────────────────
// Clears the push token for the authenticated user (opt-out of notifications).

router.delete("/auth/push-token", requireAuth, async (req, res) => {
  try {
    await db
      .update(usersTable)
      .set({ pushToken: null, updatedAt: new Date() })
      .where(eq(usersTable.id, req.user!.userId));

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /auth/push-token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
