import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

// ─── Stripe helpers ───────────────────────────────────────────────────────────

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require("stripe");
  return new Stripe(key, { apiVersion: "2024-11-20.acacia" });
}

/** Get-or-create a Stripe customer for the authenticated player. */
async function getOrCreateStripeCustomer(
  stripe: ReturnType<typeof getStripe>,
  userId: string,
  userEmail: string,
  userName: string,
): Promise<string> {
  const [row] = await db
    .select({ stripeCustomerId: usersTable.stripeCustomerId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (row?.stripeCustomerId) return row.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: userEmail,
    name: userName,
    metadata: { userId },
  });

  await db
    .update(usersTable)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  return customer.id;
}

// ─── DELETE /player/account ───────────────────────────────────────────────────

router.delete("/player/account", requireAuth, requireRole("PLAYER"), async (req, res) => {
  try {
    const userId = req.user!.userId;
    const anonEmail = `DELETED_${userId}@futsalcy.deleted`;
    const anonName = `DELETED_${userId}`;

    const [current] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    await db
      .update(usersTable)
      .set({
        deletedAt: new Date(),
        deletedOriginalEmail: current?.email ?? null,
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

router.get("/player/payment-methods", requireAuth, requireRole("PLAYER"), async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      res.json({ demoMode: true, paymentMethods: [] });
      return;
    }

    const userId = req.user!.userId;
    const [row] = await db
      .select({ stripeCustomerId: usersTable.stripeCustomerId, email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const customerId = row.stripeCustomerId
      ? row.stripeCustomerId
      : await getOrCreateStripeCustomer(stripe, userId, row.email, row.name);

    const pmList = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });

    const paymentMethods = pmList.data.map((pm: { id: string; card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number } }) => ({
      id: pm.id,
      brand: pm.card?.brand ?? "unknown",
      last4: pm.card?.last4 ?? "????",
      expMonth: pm.card?.exp_month ?? 0,
      expYear: pm.card?.exp_year ?? 0,
    }));

    res.json({ demoMode: false, paymentMethods });
  } catch (err) {
    console.error("GET /player/payment-methods error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /player/payment-methods/setup-intent ───────────────────────────────

router.post(
  "/player/payment-methods/setup-intent",
  requireAuth,
  requireRole("PLAYER"),
  async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) {
        res.status(503).json({ error: "Payment methods are not available in demo mode" });
        return;
      }

      const userId = req.user!.userId;
      const [row] = await db
        .select({ stripeCustomerId: usersTable.stripeCustomerId, email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const customerId = await getOrCreateStripeCustomer(stripe, userId, row.email, row.name);

      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ["card"],
      });

      res.json({ clientSecret: setupIntent.client_secret });
    } catch (err) {
      console.error("POST /player/payment-methods/setup-intent error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── DELETE /player/payment-methods/:pmId ────────────────────────────────────

router.delete<{ pmId: string }>(
  "/player/payment-methods/:pmId",
  requireAuth,
  requireRole("PLAYER"),
  async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) {
        res.status(503).json({ error: "Payment methods are not available in demo mode" });
        return;
      }

      const { pmId } = req.params;
      const userId = req.user!.userId;

      // Verify the payment method belongs to this player's Stripe customer
      const [row] = await db
        .select({ stripeCustomerId: usersTable.stripeCustomerId })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!row?.stripeCustomerId) {
        res.status(404).json({ error: "No payment methods found" });
        return;
      }

      const pm = await stripe.paymentMethods.retrieve(pmId);
      if (pm.customer !== row.stripeCustomerId) {
        res.status(403).json({ error: "Payment method does not belong to this account" });
        return;
      }

      await stripe.paymentMethods.detach(pmId);
      res.json({ ok: true });
    } catch (err) {
      console.error("DELETE /player/payment-methods/:pmId error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── DELETE /auth/push-token ──────────────────────────────────────────────────

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
