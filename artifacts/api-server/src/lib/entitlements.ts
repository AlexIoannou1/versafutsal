import type { NextFunction, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  ownerSubscriptionsTable,
  type OwnerSubscription,
  type SubscriptionPlan,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export const PLAN_CAPABILITIES = {
  FREE: [],
  PRO: ["MANUAL_BOOKING", "ADVANCED_ANALYTICS"],
  ELITE: ["MANUAL_BOOKING", "ADVANCED_ANALYTICS"],
} as const satisfies Record<SubscriptionPlan, readonly string[]>;

export type OwnerCapability = "MANUAL_BOOKING" | "ADVANCED_ANALYTICS";

export function shouldAdvanceProviderEventCursor(
  lastAppliedAt: Date | null,
  lastAppliedId: string | null,
  incomingAt: Date,
  incomingId: string,
): boolean {
  if (!lastAppliedAt) return true;
  const timeDifference = incomingAt.getTime() - lastAppliedAt.getTime();
  if (timeDifference !== 0) return timeDifference > 0;
  return !lastAppliedId || incomingId > lastAppliedId;
}

export function resolveEffectivePlan(
  subscription: OwnerSubscription | null | undefined,
  now = new Date(),
): SubscriptionPlan {
  if (!subscription) return "FREE";

  const overrideIsActive =
    subscription.overridePlan &&
    (!subscription.overrideStartsAt || subscription.overrideStartsAt <= now) &&
    (!subscription.overrideEndsAt || subscription.overrideEndsAt > now);
  if (overrideIsActive) return subscription.overridePlan!;

  if (subscription.status === "ACTIVE" &&
      (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > now)) {
    return subscription.plan;
  }
  if (
    subscription.currentPeriodEnd &&
    subscription.currentPeriodEnd > now &&
    (subscription.status === "PAST_DUE" || subscription.status === "CANCELED")
  ) {
    return subscription.plan;
  }
  return "FREE";
}

export function planHasCapability(plan: SubscriptionPlan, capability: OwnerCapability): boolean {
  return (PLAN_CAPABILITIES[plan] as readonly string[]).includes(capability);
}

export async function getOwnerEntitlements(ownerId: string, now = new Date()) {
  const [subscription] = await db
    .select()
    .from(ownerSubscriptionsTable)
    .where(eq(ownerSubscriptionsTable.ownerId, ownerId))
    .limit(1);
  const effectivePlan = resolveEffectivePlan(subscription, now);
  return {
    effectivePlan,
    capabilities: [...PLAN_CAPABILITIES[effectivePlan]],
    subscription: subscription ?? null,
  };
}

export function requireOwnerCapability(capability: OwnerCapability) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user || req.user.role !== "VENUE_OWNER") {
      res.status(403).json({ error: "Forbidden: insufficient role" });
      return;
    }
    try {
      const entitlement = await getOwnerEntitlements(req.user.userId);
      if (!planHasCapability(entitlement.effectivePlan, capability)) {
        res.status(403).json({
          error: "This feature requires a Pro or Elite owner plan.",
          code: "ENTITLEMENT_REQUIRED",
          capability,
        });
        return;
      }
      next();
    } catch (error) {
      req.log.error({ err: error, ownerId: req.user.userId, capability }, "Entitlement lookup failed");
      res.status(500).json({ error: "Internal server error" });
    }
  };
}