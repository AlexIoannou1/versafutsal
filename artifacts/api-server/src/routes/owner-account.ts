import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require("stripe");
  return new Stripe(key, { apiVersion: "2024-11-20.acacia" });
}

// ─── GET /owner/connect/config ────────────────────────────────────────────────

router.get(
  "/owner/connect/config",
  requireAuth,
  requireRole("VENUE_OWNER"),
  (_req, res) => {
    const stripe = getStripe();
    res.json({ demoMode: !stripe });
  },
);

// ─── POST /owner/connect/account ──────────────────────────────────────────────
// Creates a Stripe Connect Express account if none exists, saves the ID.

router.post(
  "/owner/connect/account",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) {
        res.status(503).json({ error: "Stripe Connect is not configured" });
        return;
      }

      const userId = req.user!.userId;
      const [row] = await db
        .select({
          stripeConnectAccountId: usersTable.stripeConnectAccountId,
          email: usersTable.email,
          name: usersTable.name,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (row.stripeConnectAccountId) {
        res.json({ accountId: row.stripeConnectAccountId });
        return;
      }

      const account = await stripe.accounts.create({
        type: "express",
        email: row.email,
        metadata: { userId },
      });

      await db
        .update(usersTable)
        .set({ stripeConnectAccountId: account.id, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));

      res.json({ accountId: account.id });
    } catch (err) {
      console.error("POST /owner/connect/account error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── POST /owner/connect/onboarding-link ──────────────────────────────────────

router.post(
  "/owner/connect/onboarding-link",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) {
        res.status(503).json({ error: "Stripe Connect is not configured" });
        return;
      }

      const userId = req.user!.userId;
      const [row] = await db
        .select({ stripeConnectAccountId: usersTable.stripeConnectAccountId })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!row?.stripeConnectAccountId) {
        res.status(400).json({ error: "No Connect account found — create one first" });
        return;
      }

      const appDomain = process.env.APP_DOMAIN ?? "https://example.com";

      const link = await stripe.accountLinks.create({
        account: row.stripeConnectAccountId,
        refresh_url: `${appDomain}/owner/settings-payments`,
        return_url: `${appDomain}/owner/settings-payments`,
        type: "account_onboarding",
      });

      res.json({ url: link.url });
    } catch (err) {
      console.error("POST /owner/connect/onboarding-link error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── GET /owner/connect/status ────────────────────────────────────────────────
// Returns only safe, computed status fields — never raw Stripe tokens.

router.get(
  "/owner/connect/status",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const stripe = getStripe();
      if (!stripe) {
        res.json({
          demoMode: true,
          connected: false,
          detailsSubmitted: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          displayName: null,
        });
        return;
      }

      const userId = req.user!.userId;
      const [row] = await db
        .select({ stripeConnectAccountId: usersTable.stripeConnectAccountId })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (!row?.stripeConnectAccountId) {
        res.json({
          demoMode: false,
          connected: false,
          detailsSubmitted: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          displayName: null,
        });
        return;
      }

      const account = await stripe.accounts.retrieve(row.stripeConnectAccountId, {
        expand: ["external_accounts"],
      });

      // Extract masked bank/card last-4 from the first external account if available
      let payoutLast4: string | null = null;
      const extAccounts = account.external_accounts?.data ?? [];
      if (extAccounts.length > 0) {
        const first = extAccounts[0];
        payoutLast4 = (first as { last4?: string }).last4 ?? null;
      }

      res.json({
        demoMode: false,
        connected: true,
        detailsSubmitted: account.details_submitted ?? false,
        chargesEnabled: account.charges_enabled ?? false,
        payoutsEnabled: account.payouts_enabled ?? false,
        displayName: account.business_profile?.name ?? account.display_name ?? null,
        payoutLast4,
      });
    } catch (err) {
      console.error("GET /owner/connect/status error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── DELETE /owner/connect/account ───────────────────────────────────────────
// Removes the Connect account ID from the user record (does NOT delete the Stripe account).

router.delete(
  "/owner/connect/account",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const userId = req.user!.userId;
      await db
        .update(usersTable)
        .set({ stripeConnectAccountId: null, updatedAt: new Date() })
        .where(eq(usersTable.id, userId));

      res.json({ ok: true });
    } catch (err) {
      console.error("DELETE /owner/connect/account error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── DELETE /owner/account ────────────────────────────────────────────────────
// Soft-deletes the owner's user record (anonymises PII, same pattern as player).

router.delete(
  "/owner/account",
  requireAuth,
  requireRole("VENUE_OWNER"),
  async (req, res) => {
    try {
      const userId = req.user!.userId;
      const anonEmail = `DELETED_${userId}@versa.deleted`;
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
          stripeConnectAccountId: null,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, userId));

      res.json({ ok: true });
    } catch (err) {
      console.error("DELETE /owner/account error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
