import assert from "node:assert/strict";
import Stripe from "stripe";
import type { OwnerSubscription } from "@workspace/db/schema";
import {
  planHasCapability,
  resolveEffectivePlan,
  shouldAdvanceProviderEventCursor,
} from "./lib/entitlements";
import { constructVerifiedSubscriptionEvent } from "./lib/subscription-webhook";

const now = new Date("2026-01-15T12:00:00.000Z");

function subscription(values: Partial<OwnerSubscription>): OwnerSubscription {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    ownerId: "00000000-0000-0000-0000-000000000002",
    plan: "FREE",
    status: "NONE",
    provider: null,
    providerCustomerId: null,
    providerSubscriptionId: null,
    pendingCheckoutSessionId: null,
    pendingCheckoutPlan: null,
    pendingCheckoutExpiresAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    overridePlan: null,
    overrideReason: null,
    overrideStartsAt: null,
    overrideEndsAt: null,
    overrideActorId: null,
    lastProviderEventCreatedAt: null,
    lastProviderEventId: null,
    createdAt: now,
    updatedAt: now,
    ...values,
  };
}

assert.equal(resolveEffectivePlan(null, now), "FREE", "owners without rows default to Free");
assert.equal(resolveEffectivePlan(subscription({ plan: "PRO", status: "ACTIVE" }), now), "PRO");
assert.equal(resolveEffectivePlan(subscription({
  plan: "ELITE",
  status: "CANCELED",
  currentPeriodEnd: new Date("2026-02-01T00:00:00.000Z"),
}), now), "ELITE", "cancellation retains access through the paid period");
assert.equal(resolveEffectivePlan(subscription({
  plan: "ELITE",
  status: "CANCELED",
  currentPeriodEnd: new Date("2026-01-01T00:00:00.000Z"),
}), now), "FREE", "expired cancellation loses paid access");
assert.equal(resolveEffectivePlan(subscription({
  plan: "PRO",
  status: "UNPAID",
  currentPeriodEnd: new Date("2026-02-01T00:00:00.000Z"),
}), now), "FREE", "unpaid subscriptions fail closed");
assert.equal(resolveEffectivePlan(subscription({
  overridePlan: "ELITE",
  overrideStartsAt: new Date("2026-01-01T00:00:00.000Z"),
  overrideEndsAt: new Date("2026-02-01T00:00:00.000Z"),
}), now), "ELITE", "active admin overrides take precedence");
assert.equal(planHasCapability("FREE", "MANUAL_BOOKING"), false);
assert.equal(planHasCapability("PRO", "MANUAL_BOOKING"), true);
assert.equal(planHasCapability("ELITE", "MANUAL_BOOKING"), true);
assert.equal(shouldAdvanceProviderEventCursor(null, null, now, "evt_b"), true);
assert.equal(shouldAdvanceProviderEventCursor(new Date("2026-01-14T00:00:00Z"), "evt_z", now, "evt_a"), true);
assert.equal(shouldAdvanceProviderEventCursor(new Date("2026-01-16T00:00:00Z"), "evt_a", now, "evt_z"), false);
assert.equal(shouldAdvanceProviderEventCursor(now, "evt_a", now, "evt_b"), true, "equal-second events use a stable ID tie-breaker");
assert.equal(shouldAdvanceProviderEventCursor(now, "evt_b", now, "evt_a"), false);
assert.equal(shouldAdvanceProviderEventCursor(now, "evt_b", now, "evt_b"), false);

const webhookSecret = "whsec_subscription_test";
const webhookPayload = JSON.stringify({
  id: "evt_subscription_test",
  object: "event",
  created: 1768478400,
  type: "customer.subscription.updated",
  data: { object: { id: "sub_test" } },
});
const webhookSignature = Stripe.webhooks.generateTestHeaderString({
  payload: webhookPayload,
  secret: webhookSecret,
});
const stripe = new Stripe("sk_test_subscription_foundation");
const verified = constructVerifiedSubscriptionEvent(
  stripe,
  Buffer.from(webhookPayload),
  webhookSignature,
  webhookSecret,
) as Stripe.Event;
assert.equal(verified.id, "evt_subscription_test");
assert.throws(() => constructVerifiedSubscriptionEvent(
  stripe,
  Buffer.from(webhookPayload),
  webhookSignature,
  "whsec_wrong",
));

console.info("entitlement tests passed");