import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  ownerSubscriptionsTable,
  subscriptionEventsTable,
  usersTable,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from "@workspace/db/schema";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  getOwnerEntitlements,
  PLAN_CAPABILITIES,
  resolveEffectivePlan,
  shouldAdvanceProviderEventCursor,
} from "../lib/entitlements";
import { constructVerifiedSubscriptionEvent } from "../lib/subscription-webhook";

const router: IRouter = Router();
const VALID_PLANS = ["FREE", "PRO", "ELITE"] as const;

function getStripe(): any | null {
  const key = process.env.STRIPE_TEST_SK;
  if (!key) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require("stripe");
  return new Stripe(key, { apiVersion: "2024-11-20.acacia" });
}

function priceForPlan(plan: "PRO" | "ELITE"): string | null {
  return process.env[`STRIPE_SUBSCRIPTION_${plan}_PRICE_ID`] ?? null;
}

function billingConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_TEST_SK &&
    process.env.STRIPE_SUBSCRIPTION_PRO_PRICE_ID &&
    process.env.STRIPE_SUBSCRIPTION_ELITE_PRICE_ID &&
    process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET,
  );
}

function publicBaseUrl(): string {
  return (process.env.APP_DOMAIN ?? "https://example.com").replace(/\/+$/, "");
}

function serializeSubscription(subscription: typeof ownerSubscriptionsTable.$inferSelect | null) {
  const effectivePlan = resolveEffectivePlan(subscription);
  return {
    plan: subscription?.plan ?? "FREE",
    effectivePlan,
    status: subscription?.status ?? "NONE",
    currentPeriodStart: subscription?.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    overridePlan: subscription?.overridePlan ?? null,
    overrideReason: subscription?.overrideReason ?? null,
    overrideStartsAt: subscription?.overrideStartsAt?.toISOString() ?? null,
    overrideEndsAt: subscription?.overrideEndsAt?.toISOString() ?? null,
    capabilities: [...PLAN_CAPABILITIES[effectivePlan]],
    billingConfigured: billingConfigured(),
  };
}

async function ensureOwnerSubscription(ownerId: string) {
  const [row] = await db
    .insert(ownerSubscriptionsTable)
    .values({ ownerId })
    .onConflictDoNothing({ target: ownerSubscriptionsTable.ownerId })
    .returning();
  if (row) return row;
  const [existing] = await db.select().from(ownerSubscriptionsTable)
    .where(eq(ownerSubscriptionsTable.ownerId, ownerId)).limit(1);
  return existing!;
}

function planFromStripeSubscription(subscription: any): SubscriptionPlan {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  return priceId === priceForPlan("ELITE")
    ? "ELITE"
    : priceId === priceForPlan("PRO")
      ? "PRO"
      : "FREE";
}

async function reconcileOwnerSubscription(
  ownerId: string,
  providerSubscription: any,
  eventType: string,
) {
  const plan = planFromStripeSubscription(providerSubscription);
  const [previous] = await db.select().from(ownerSubscriptionsTable)
    .where(eq(ownerSubscriptionsTable.ownerId, ownerId)).limit(1);
  await db.transaction(async (tx) => {
    await tx.update(ownerSubscriptionsTable).set({
      plan,
      status: statusFromStripe(providerSubscription.status),
      provider: "STRIPE",
      providerCustomerId: typeof providerSubscription.customer === "string"
        ? providerSubscription.customer
        : providerSubscription.customer?.id,
      providerSubscriptionId: providerSubscription.id,
      pendingCheckoutSessionId: null,
      pendingCheckoutPlan: null,
      pendingCheckoutExpiresAt: null,
      currentPeriodStart: dateFromSeconds(providerSubscription.current_period_start),
      currentPeriodEnd: dateFromSeconds(providerSubscription.current_period_end),
      cancelAtPeriodEnd: Boolean(providerSubscription.cancel_at_period_end),
      canceledAt: dateFromSeconds(providerSubscription.canceled_at),
      updatedAt: new Date(),
    }).where(eq(ownerSubscriptionsTable.ownerId, ownerId));
    await tx.insert(subscriptionEventsTable).values({
      ownerId,
      eventType,
      previousValue: previous
        ? { plan: previous.plan, status: previous.status, subscriptionId: previous.providerSubscriptionId }
        : null,
      newValue: { plan, status: providerSubscription.status, subscriptionId: providerSubscription.id },
      metadata: { provider: "STRIPE" },
    });
  });
}

async function findBlockingStripeSubscription(stripe: any, customerId: string) {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  return subscriptions.data.find((subscription: any) =>
    !["canceled", "incomplete_expired"].includes(subscription.status),
  ) ?? null;
}

router.get("/owner/subscription", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const entitlement = await getOwnerEntitlements(req.user!.userId);
    res.json({ subscription: serializeSubscription(entitlement.subscription) });
  } catch (error) {
    req.log.error({ err: error, ownerId: req.user!.userId }, "Owner subscription lookup failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/owner/subscription/checkout", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  let checkoutLeaseId: string | null = null;
  let checkoutSessionExpiresAt: Date | null = null;
  try {
    const plan = (req.body as { plan?: string }).plan;
    if (plan !== "PRO" && plan !== "ELITE") {
      res.status(400).json({ error: "plan must be PRO or ELITE" });
      return;
    }
    const stripe = getStripe();
    const price = priceForPlan(plan);
    if (!stripe || !price || !billingConfigured()) {
      res.status(503).json({ error: "Subscription billing is not configured" });
      return;
    }
    const ownerId = req.user!.userId;
    const subscription = await ensureOwnerSubscription(ownerId);
    const now = new Date();
    if (subscription.providerSubscriptionId && subscription.status !== "CANCELED") {
      res.status(409).json({ error: "Manage the existing subscription through the billing portal" });
      return;
    }

    if (
      subscription.pendingCheckoutSessionId &&
      !subscription.pendingCheckoutSessionId.startsWith("creating:")
    ) {
      const pendingSession = await stripe.checkout.sessions.retrieve(
        subscription.pendingCheckoutSessionId,
      );
      const pendingSubscriptionId = typeof pendingSession.subscription === "string"
        ? pendingSession.subscription
        : pendingSession.subscription?.id;
      if (pendingSession.status === "complete" && pendingSubscriptionId) {
        const recovered = await stripe.subscriptions.retrieve(pendingSubscriptionId);
        await reconcileOwnerSubscription(ownerId, recovered, "CHECKOUT_SUBSCRIPTION_RECOVERED");
        res.status(409).json({ error: "Manage the existing subscription through the billing portal" });
        return;
      }
      if (
        pendingSession.status === "open" &&
        pendingSession.expires_at * 1000 > now.getTime()
      ) {
        if (subscription.pendingCheckoutPlan === plan && pendingSession.url) {
          res.status(201).json({ url: pendingSession.url });
        } else {
          res.status(409).json({ error: "A subscription checkout is already in progress" });
        }
        return;
      }
    }

    if (subscription.providerCustomerId) {
      const blockingSubscription = await findBlockingStripeSubscription(
        stripe,
        subscription.providerCustomerId,
      );
      if (blockingSubscription) {
        await reconcileOwnerSubscription(
          ownerId,
          blockingSubscription,
          "CUSTOMER_SUBSCRIPTION_RECOVERED",
        );
        res.status(409).json({ error: "Manage the existing subscription through the billing portal" });
        return;
      }
    }

    const checkoutLeaseCandidate = `creating:${randomUUID()}`;
    // Checkout is explicitly limited to two hours. The creation lease lasts
    // one minute longer, so a lost Stripe success response cannot be replaced
    // with a new idempotency key while the original session is still usable.
    const leaseExpiresAt = new Date(now.getTime() + (2 * 60 + 1) * 60 * 1000);
    const [lease] = await db.update(ownerSubscriptionsTable).set({
      pendingCheckoutSessionId: checkoutLeaseCandidate,
      pendingCheckoutPlan: plan,
      pendingCheckoutExpiresAt: leaseExpiresAt,
      updatedAt: now,
    }).where(and(
      eq(ownerSubscriptionsTable.ownerId, ownerId),
      or(
        isNull(ownerSubscriptionsTable.providerSubscriptionId),
        eq(ownerSubscriptionsTable.status, "CANCELED"),
      ),
      or(
        isNull(ownerSubscriptionsTable.pendingCheckoutExpiresAt),
        lt(ownerSubscriptionsTable.pendingCheckoutExpiresAt, now),
      ),
    )).returning();

    if (lease) {
      checkoutLeaseId = checkoutLeaseCandidate;
      checkoutSessionExpiresAt = new Date(leaseExpiresAt.getTime() - 60 * 1000);
    } else {
      const [pending] = await db.select().from(ownerSubscriptionsTable)
        .where(eq(ownerSubscriptionsTable.ownerId, ownerId)).limit(1);
      if (
        pending?.pendingCheckoutSessionId &&
        pending.pendingCheckoutPlan === plan &&
        pending.pendingCheckoutExpiresAt &&
        pending.pendingCheckoutExpiresAt > now
      ) {
        if (pending.pendingCheckoutSessionId.startsWith("creating:")) {
          // A retry (or concurrent identical request) resumes the same Stripe
          // idempotency key instead of opening a second Checkout session.
          checkoutLeaseId = pending.pendingCheckoutSessionId;
          checkoutSessionExpiresAt = new Date(pending.pendingCheckoutExpiresAt.getTime() - 60 * 1000);
        } else {
          const existingSession = await stripe.checkout.sessions.retrieve(pending.pendingCheckoutSessionId);
          if (existingSession.status === "open" && existingSession.url) {
            res.status(201).json({ url: existingSession.url });
            return;
          }
        }
      }
      if (!checkoutLeaseId) {
        res.status(409).json({ error: "A subscription checkout is already in progress" });
        return;
      }
    }
    const [owner] = await db.select({ email: usersTable.email }).from(usersTable)
      .where(eq(usersTable.id, ownerId)).limit(1);
    let customerId = subscription.providerCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: owner?.email,
        metadata: { ownerId },
      }, {
        idempotencyKey: `owner-subscription-customer:${ownerId}`,
      });
      customerId = customer.id;
      await db.update(ownerSubscriptionsTable).set({
        provider: "STRIPE",
        providerCustomerId: customerId,
        updatedAt: new Date(),
      }).where(and(
        eq(ownerSubscriptionsTable.ownerId, ownerId),
        eq(ownerSubscriptionsTable.pendingCheckoutSessionId, checkoutLeaseId),
      ));
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      success_url: `${publicBaseUrl()}/owner/plans?checkout=success`,
      cancel_url: `${publicBaseUrl()}/owner/plans?checkout=cancelled`,
      client_reference_id: ownerId,
      metadata: { ownerId, plan },
      subscription_data: { metadata: { ownerId, plan } },
      expires_at: Math.floor(checkoutSessionExpiresAt!.getTime() / 1000),
    }, { idempotencyKey: `owner-subscription-checkout:${ownerId}:${checkoutLeaseId}` });
    if (!session.url) {
      throw new Error("Stripe Checkout session did not include a URL");
    }
    await db.update(ownerSubscriptionsTable).set({
      pendingCheckoutSessionId: session.id,
      pendingCheckoutPlan: plan,
      pendingCheckoutExpiresAt: leaseExpiresAt,
      updatedAt: new Date(),
    }).where(and(
      eq(ownerSubscriptionsTable.ownerId, ownerId),
      eq(ownerSubscriptionsTable.pendingCheckoutSessionId, checkoutLeaseId),
    ));
    res.status(201).json({ url: session.url });
  } catch (error) {
    req.log.error({ err: error, ownerId: req.user!.userId }, "Subscription checkout creation failed");
    res.status(502).json({ error: "Unable to start subscription checkout" });
  }
});

router.post("/owner/subscription/portal", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      res.status(503).json({ error: "Subscription billing is not configured" });
      return;
    }
    const subscription = await ensureOwnerSubscription(req.user!.userId);
    if (!subscription.providerCustomerId) {
      res.status(409).json({ error: "No billing account exists for this owner" });
      return;
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.providerCustomerId,
      return_url: `${publicBaseUrl()}/owner/plans`,
    });
    res.json({ url: session.url });
  } catch (error) {
    req.log.error({ err: error, ownerId: req.user!.userId }, "Billing portal creation failed");
    res.status(502).json({ error: "Unable to open billing management" });
  }
});

router.post("/owner/subscription/cancel", requireAuth, requireRole("VENUE_OWNER"), async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      res.status(503).json({ error: "Subscription billing is not configured" });
      return;
    }
    const subscription = await ensureOwnerSubscription(req.user!.userId);
    if (!subscription.providerSubscriptionId) {
      res.status(409).json({ error: "No active subscription exists" });
      return;
    }
    await stripe.subscriptions.update(subscription.providerSubscriptionId, { cancel_at_period_end: true });
    const [updated] = await db.update(ownerSubscriptionsTable)
      .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
      .where(eq(ownerSubscriptionsTable.id, subscription.id)).returning();
    await db.insert(subscriptionEventsTable).values({
      ownerId: req.user!.userId,
      actorUserId: req.user!.userId,
      eventType: "OWNER_CANCELLATION_REQUESTED",
      previousValue: { cancelAtPeriodEnd: subscription.cancelAtPeriodEnd },
      newValue: { cancelAtPeriodEnd: true },
    });
    res.json({ subscription: serializeSubscription(updated!) });
  } catch (error) {
    req.log.error({ err: error, ownerId: req.user!.userId }, "Subscription cancellation failed");
    res.status(502).json({ error: "Unable to cancel subscription" });
  }
});

router.get("/admin/subscriptions/owners", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const plan = typeof req.query.plan === "string" ? req.query.plan : undefined;
    if (plan && !VALID_PLANS.includes(plan as SubscriptionPlan)) {
      res.status(400).json({ error: "Invalid plan filter" });
      return;
    }
    const rows = await db.select({ owner: usersTable, subscription: ownerSubscriptionsTable })
      .from(usersTable)
      .leftJoin(ownerSubscriptionsTable, eq(ownerSubscriptionsTable.ownerId, usersTable.id))
      .where(eq(usersTable.role, "VENUE_OWNER"))
      .orderBy(desc(usersTable.createdAt));
    const owners = rows.map(({ owner, subscription }) => ({
      id: owner.id,
      name: owner.name,
      email: owner.email,
      createdAt: owner.createdAt.toISOString(),
      subscription: serializeSubscription(subscription),
    })).filter((owner) => !plan || owner.subscription.effectivePlan === plan);
    res.json({ owners });
  } catch (error) {
    req.log.error({ err: error }, "Admin owner subscription list failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get<{ ownerId: string }>("/admin/subscriptions/owners/:ownerId", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const ownerId = req.params.ownerId;
    const [owner] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, createdAt: usersTable.createdAt })
      .from(usersTable).where(and(eq(usersTable.id, ownerId), eq(usersTable.role, "VENUE_OWNER"))).limit(1);
    if (!owner) {
      res.status(404).json({ error: "Venue owner not found" });
      return;
    }
    const subscription = await ensureOwnerSubscription(ownerId);
    const events = await db.select().from(subscriptionEventsTable)
      .where(eq(subscriptionEventsTable.ownerId, ownerId))
      .orderBy(desc(subscriptionEventsTable.occurredAt));
    res.json({
      owner: { ...owner, createdAt: owner.createdAt.toISOString(), subscription: serializeSubscription(subscription) },
      events: events.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString(), processedAt: event.processedAt.toISOString() })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Admin owner subscription detail failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put<{ ownerId: string }>("/admin/subscriptions/owners/:ownerId/override", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const { plan, reason, startsAt, endsAt } = req.body as {
      plan?: SubscriptionPlan | null; reason?: string; startsAt?: string | null; endsAt?: string | null;
    };
    if (plan !== null && !VALID_PLANS.includes(plan as SubscriptionPlan)) {
      res.status(400).json({ error: "plan must be FREE, PRO, ELITE, or null" });
      return;
    }
    if (!reason?.trim() || reason.trim().length > 1000) {
      res.status(400).json({ error: "A reason of 1-1000 characters is required" });
      return;
    }
    const start = startsAt ? new Date(startsAt) : null;
    const end = endsAt ? new Date(endsAt) : null;
    if ((start && isNaN(start.getTime())) || (end && isNaN(end.getTime())) || (start && end && end <= start)) {
      res.status(400).json({ error: "Invalid override timing" });
      return;
    }
    const [owner] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(and(eq(usersTable.id, req.params.ownerId), eq(usersTable.role, "VENUE_OWNER"))).limit(1);
    if (!owner) {
      res.status(404).json({ error: "Venue owner not found" });
      return;
    }
    const current = await ensureOwnerSubscription(owner.id);
    const [updated] = await db.transaction(async (tx) => {
      const changed = await tx.update(ownerSubscriptionsTable).set({
        overridePlan: plan ?? null,
        overrideReason: plan ? reason.trim() : null,
        overrideStartsAt: plan ? start : null,
        overrideEndsAt: plan ? end : null,
        overrideActorId: req.user!.userId,
        updatedAt: new Date(),
      }).where(eq(ownerSubscriptionsTable.id, current.id)).returning();
      await tx.insert(subscriptionEventsTable).values({
        ownerId: owner.id,
        actorUserId: req.user!.userId,
        eventType: plan ? "ADMIN_OVERRIDE_APPLIED" : "ADMIN_OVERRIDE_REMOVED",
        previousValue: { plan: current.overridePlan, startsAt: current.overrideStartsAt, endsAt: current.overrideEndsAt },
        newValue: { plan: plan ?? null, startsAt: start, endsAt: end },
        reason: reason.trim(),
      });
      return changed;
    });
    res.json({ subscription: serializeSubscription(updated!) });
  } catch (error) {
    req.log.error({ err: error, ownerId: req.params.ownerId }, "Admin subscription override failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

function statusFromStripe(value: string): SubscriptionStatus {
  const statuses: Record<string, SubscriptionStatus> = {
    active: "ACTIVE", trialing: "ACTIVE", past_due: "PAST_DUE", unpaid: "UNPAID",
    canceled: "CANCELED", paused: "PAUSED", incomplete: "INCOMPLETE", incomplete_expired: "INCOMPLETE",
  };
  return statuses[value] ?? "NONE";
}

function dateFromSeconds(value: unknown): Date | null {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

router.post("/webhooks/stripe/subscriptions", async (req, res) => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET;
  const signature = req.headers["stripe-signature"];
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!stripe || !secret || typeof signature !== "string" || !rawBody) {
    res.status(400).json({ error: "Invalid webhook request" });
    return;
  }
  let event: any;
  try {
    event = constructVerifiedSubscriptionEvent(stripe, rawBody, signature, secret);
  } catch {
    res.status(400).json({ error: "Invalid webhook request" });
    return;
  }
  try {
    if (!String(event.type).startsWith("customer.subscription.")) {
      res.json({ received: true });
      return;
    }
    const object = event.data.object;
    const ownerId = object.metadata?.ownerId;
    const providerCustomerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
    const [known] = await db.select().from(ownerSubscriptionsTable).where(or(
      eq(ownerSubscriptionsTable.providerSubscriptionId, object.id),
      eq(ownerSubscriptionsTable.providerCustomerId, providerCustomerId ?? ""),
    )).limit(1);
    const effectiveOwnerId = ownerId || known?.ownerId;
    if (!effectiveOwnerId) {
      req.log.warn({ stripeEventId: event.id, stripeSubscriptionId: object.id }, "Subscription webhook has no owner mapping");
      res.json({ received: true });
      return;
    }
    const eventCreatedAt = new Date(event.created * 1000);
    await ensureOwnerSubscription(effectiveOwnerId);
    await db.transaction(async (tx) => {
      const inserted = await tx.insert(subscriptionEventsTable).values({
        ownerId: effectiveOwnerId,
        providerEventId: event.id,
        eventType: event.type,
        newValue: { status: object.status, subscriptionId: object.id },
        metadata: { provider: "STRIPE" },
        occurredAt: eventCreatedAt,
      }).onConflictDoNothing({ target: subscriptionEventsTable.providerEventId }).returning({ id: subscriptionEventsTable.id });
      if (!inserted.length) return;
      const [current] = await tx.select().from(ownerSubscriptionsTable)
        .where(eq(ownerSubscriptionsTable.ownerId, effectiveOwnerId))
        .for("update")
        .limit(1);
      if (!current) throw new Error("Owner subscription row disappeared during webhook processing");

      if (
        current.providerSubscriptionId &&
        current.providerSubscriptionId !== object.id &&
        current.status !== "CANCELED"
      ) {
        req.log.warn({
          stripeEventId: event.id,
          stripeSubscriptionId: object.id,
          ownerId: effectiveOwnerId,
        }, "Ignored event for a non-current owner subscription");
        return;
      }

      // Always reconcile from Stripe while holding the owner row lock. This
      // makes retries and out-of-order deliveries converge on provider truth
      // instead of replaying the stale snapshot embedded in an older event.
      const providerSubscription = await stripe.subscriptions.retrieve(object.id);
      const currentPlan = planFromStripeSubscription(providerSubscription);
      const advanceCursor = shouldAdvanceProviderEventCursor(
        current.lastProviderEventCreatedAt,
        current.lastProviderEventId,
        eventCreatedAt,
        event.id,
      );
      await tx.update(ownerSubscriptionsTable).set({
        plan: currentPlan,
        status: statusFromStripe(providerSubscription.status),
        provider: "STRIPE",
        providerCustomerId: typeof providerSubscription.customer === "string"
          ? providerSubscription.customer
          : providerSubscription.customer?.id,
        providerSubscriptionId: providerSubscription.id,
        pendingCheckoutSessionId: null,
        pendingCheckoutPlan: null,
        pendingCheckoutExpiresAt: null,
        currentPeriodStart: dateFromSeconds(providerSubscription.current_period_start),
        currentPeriodEnd: dateFromSeconds(providerSubscription.current_period_end),
        cancelAtPeriodEnd: Boolean(providerSubscription.cancel_at_period_end),
        canceledAt: dateFromSeconds(providerSubscription.canceled_at),
        ...(advanceCursor ? {
          lastProviderEventCreatedAt: eventCreatedAt,
          lastProviderEventId: event.id,
        } : {}),
        updatedAt: new Date(),
      }).where(eq(ownerSubscriptionsTable.id, current.id));
    });
    req.log.info({ stripeEventId: event.id, stripeSubscriptionId: object.id, ownerId: effectiveOwnerId }, "Subscription webhook processed");
    res.json({ received: true });
  } catch (error) {
    req.log.error({ err: error, stripeEventId: event.id }, "Subscription webhook processing failed");
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

export default router;