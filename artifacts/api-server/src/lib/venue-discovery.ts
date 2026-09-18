import type { SubscriptionPlan } from "@workspace/db/schema";

export function getVenueDiscoveryMetadata(plan: SubscriptionPlan) {
  const boost = plan === "ELITE" ? 2 : plan === "PRO" ? 1 : 0;
  const badgeLabel = plan === "FREE" ? null : `Verified ${plan === "PRO" ? "Pro" : "Elite"}`;
  return {
    effectivePlan: plan,
    verified: plan !== "FREE",
    discoveryBoost: boost,
    badgeLabel,
    planBadgeLabel: badgeLabel,
    rankingMetadata: {
      planBoost: boost,
      minPlanBoost: 0,
      maxPlanBoost: 2,
    },
  };
}

export function rankVenuesWithBoundedPlanBoost<
  T extends { id: string; name: string; effectivePlan: SubscriptionPlan },
>(venues: T[]): T[] {
  const baseline = [...venues].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  return baseline
    .map((venue, baselineIndex) => ({
      venue,
      baselineIndex,
      promotedIndex:
        baselineIndex -
        (venue.effectivePlan === "ELITE" ? 2 : venue.effectivePlan === "PRO" ? 1 : 0),
    }))
    .sort(
      (a, b) =>
        a.promotedIndex - b.promotedIndex ||
        a.baselineIndex - b.baselineIndex,
    )
    .map(({ venue }) => venue);
}