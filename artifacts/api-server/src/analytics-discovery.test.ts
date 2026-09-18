import assert from "node:assert/strict";
import { computeCollectedRevenue, computePremiumAnalytics } from "./lib/owner-analytics";
import {
  getVenueDiscoveryMetadata,
  rankVenuesWithBoundedPlanBoost,
} from "./lib/venue-discovery";
import { planHasCapability } from "./lib/entitlements";

const now = new Date("2026-04-01T00:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

const bookings = [
  ...["a", "b", "c", "d", "e"].flatMap((customerId) => [
    { customerId, startAt: daysAgo(45), status: "CONFIRMED" },
    { customerId, startAt: daysAgo(15), status: "CONFIRMED" },
  ]),
  { customerId: "a", startAt: daysAgo(10), status: "CONFIRMED" },
  { customerId: "x", startAt: daysAgo(40), status: "CANCELLED" },
  { customerId: "y", startAt: daysAgo(10), status: "CANCELLED" },
];
const payments = Array.from({ length: 6 }, (_, index) => ({
  id: String(index),
  createdAt: daysAgo(10 + index),
  amount: 100,
  feeAmount: 10,
  status: "SUCCEEDED",
  refundedAmount: index === 0 ? 30 : 0,
}));
const analytics = computePremiumAnalytics(bookings, payments, now);
assert.equal(analytics.retention.value, 100);
assert.equal(analytics.repeatCustomers.value, 100);
assert.equal(analytics.cancellationTrend.value, -2.38);
assert.equal(analytics.revenueForecast.value, 170);

const sparse = computePremiumAnalytics([], [], now);
assert.equal(sparse.retention.value, null);
assert.equal(sparse.revenueForecast.confidence, "insufficient");

const collected = computeCollectedRevenue([
  { bookingId: "full", amount: 100, feeAmount: 10, status: "SUCCEEDED", refundedAmount: 0 },
  { bookingId: "deposit", amount: 25, feeAmount: 2.5, status: "SUCCEEDED", refundedAmount: 0 },
  { bookingId: "partial", amount: 80, feeAmount: 8, status: "PARTIALLY_REFUNDED", refundedAmount: 30 },
  { bookingId: "failed", amount: 90, feeAmount: 9, status: "FAILED", refundedAmount: 0 },
  { bookingId: "unpaid", amount: 0, feeAmount: 0, status: "PENDING", refundedAmount: 0 },
]);
assert.equal(collected.totalRevenue, 175, "full payments, deposits, and partial refunds use collected amounts");
assert.equal(collected.platformFees, 20.5, "stored fees are neither recalculated nor prorated");
assert.equal(collected.netRevenue, 154.5);
assert.equal(collected.revenueByBooking.get("failed"), undefined);
assert.equal(collected.revenueByBooking.get("unpaid"), undefined);

assert.equal(planHasCapability("FREE", "ADVANCED_ANALYTICS"), false);
assert.equal(planHasCapability("PRO", "ADVANCED_ANALYTICS"), true);
assert.deepEqual(getVenueDiscoveryMetadata("FREE").rankingMetadata, {
  planBoost: 0,
  minPlanBoost: 0,
  maxPlanBoost: 2,
});
assert.equal(getVenueDiscoveryMetadata("PRO").planBadgeLabel, "Verified Pro");
const ranked = rankVenuesWithBoundedPlanBoost([
  { id: "1", name: "Alpha", effectivePlan: "FREE" as const },
  { id: "2", name: "Bravo", effectivePlan: "FREE" as const },
  { id: "3", name: "Charlie", effectivePlan: "FREE" as const },
  { id: "4", name: "Delta", effectivePlan: "ELITE" as const },
  { id: "5", name: "Echo", effectivePlan: "PRO" as const },
]);
assert.deepEqual(
  ranked.map((venue) => venue.name),
  ["Alpha", "Bravo", "Delta", "Charlie", "Echo"],
  "Elite and Pro venues receive only their bounded two/one-position lift",
);
assert.equal(ranked.filter((venue) => venue.effectivePlan === "FREE").length, 3);
const densePaidRanking = rankVenuesWithBoundedPlanBoost([
  { id: "1", name: "Alpha", effectivePlan: "FREE" as const },
  { id: "2", name: "Bravo", effectivePlan: "FREE" as const },
  { id: "3", name: "Charlie", effectivePlan: "FREE" as const },
  { id: "4", name: "Delta", effectivePlan: "ELITE" as const },
  { id: "5", name: "Echo", effectivePlan: "ELITE" as const },
  { id: "6", name: "Foxtrot", effectivePlan: "ELITE" as const },
  { id: "7", name: "Golf", effectivePlan: "ELITE" as const },
]);
assert.ok(
  densePaidRanking.findIndex((venue) => venue.name === "Charlie") <= 4,
  "later paid venues cannot cumulatively push a Free venue down by more than two positions",
);

process.stdout.write("analytics and discovery tests passed\n");