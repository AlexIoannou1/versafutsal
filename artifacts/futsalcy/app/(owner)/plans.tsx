import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetOwnerSubscriptionQueryKey,
  useCancelOwnerSubscription,
  useCreateOwnerBillingPortal,
  useCreateOwnerSubscriptionCheckout,
  useGetOwnerSubscription,
} from "@workspace/api-client-react";
import type { SubscriptionPlan, SubscriptionStatus } from "@workspace/api-client-react";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";

const PLAN_ORDER: Record<SubscriptionPlan, number> = { FREE: 0, PRO: 1, ELITE: 2 };
type FeatureAvailability = "included" | "excluded" | "comingSoon";
type PlanFeature = {
  label: string;
  availability: FeatureAvailability;
};

const PLANS: Array<{
  id: SubscriptionPlan;
  title: string;
  price: string;
  cadence?: string;
  description: string;
  features: PlanFeature[];
}> = [
  {
    id: "FREE",
    title: "Free",
    price: "€0",
    description: "The essentials for running your venue.",
    features: [
      { label: "Create and manage venues", availability: "included" },
      { label: "Manage pitches, prices, and opening hours", availability: "included" },
      { label: "Booking calendar and availability blocks", availability: "included" },
      { label: "Receive and manage online bookings", availability: "included" },
      { label: "Player payments and deposits", availability: "included" },
      { label: "Stripe Connect owner payouts", availability: "included" },
      { label: "Booking and account notifications", availability: "included" },
      { label: "Owner booking and revenue overview", availability: "included" },
    ],
  },
  {
    id: "PRO",
    title: "Pro",
    price: "€29",
    cadence: "/ month",
    description: "More control for busy venue teams.",
    features: [
      { label: "Includes everything in Free", availability: "included" },
      { label: "Create manual and phone bookings", availability: "included" },
      { label: "Advanced match statistics", availability: "comingSoon" },
      { label: "Growth tools and promotions", availability: "comingSoon" },
      { label: "Insights and automated reminders", availability: "comingSoon" },
    ],
  },
  {
    id: "ELITE",
    title: "Elite",
    price: "€59",
    cadence: "/ month",
    description: "Our highest access tier for growing operators.",
    features: [
      { label: "Includes everything in Pro", availability: "included" },
      { label: "Tournament creator", availability: "comingSoon" },
      { label: "Matchmaking and waitlists", availability: "comingSoon" },
      { label: "Venue leaderboards", availability: "comingSoon" },
    ],
  },
];

function featurePresentation(
  availability: FeatureAvailability,
  colors: ReturnType<typeof useColors>,
) {
  switch (availability) {
    case "included":
      return { icon: "check-circle" as const, color: colors.success, status: "Included" };
    case "comingSoon":
      return { icon: "clock" as const, color: colors.info, status: "Coming soon" };
    case "excluded":
      return { icon: "minus-circle" as const, color: colors.mutedForeground, status: "Not included" };
  }
}

function formatDate(value: string | null): string {
  if (!value) return "Not available";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function readableStatus(status: SubscriptionStatus): string {
  return status.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^HTTP \d+ [^:]*:\s*/, "");
  return "Something went wrong. Please try again.";
}

export default function OwnerPlansScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const queryClient = useQueryClient();
  const subscriptionQuery = useGetOwnerSubscription();
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const refreshSubscription = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getGetOwnerSubscriptionQueryKey() });
  }, [queryClient]);

  const openBillingUrl = useCallback(async (url: string) => {
    if (Platform.OS === "web") {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    await WebBrowser.openBrowserAsync(url);
  }, []);

  const checkout = useCreateOwnerSubscriptionCheckout({
    mutation: {
      onSuccess: async ({ url }) => {
        setFeedback(null);
        try {
          await openBillingUrl(url);
          await refreshSubscription();
        } catch {
          setFeedback({ kind: "error", text: "Checkout could not be opened." });
        }
      },
      onError: (error) => setFeedback({ kind: "error", text: errorMessage(error) }),
    },
  });
  const portal = useCreateOwnerBillingPortal({
    mutation: {
      onSuccess: async ({ url }) => {
        setFeedback(null);
        try {
          await openBillingUrl(url);
          await refreshSubscription();
        } catch {
          setFeedback({ kind: "error", text: "The billing portal could not be opened." });
        }
      },
      onError: (error) => setFeedback({ kind: "error", text: errorMessage(error) }),
    },
  });
  const cancel = useCancelOwnerSubscription({
    mutation: {
      onSuccess: async () => {
        setFeedback({ kind: "success", text: "Your plan will end after the current billing period." });
        await refreshSubscription();
      },
      onError: (error) => setFeedback({ kind: "error", text: errorMessage(error) }),
    },
  });

  const subscription = subscriptionQuery.data?.subscription;
  const busy = checkout.isPending || portal.isPending || cancel.isPending;
  const compact = width < 760;
  const billingProblem = !!subscription && ["INCOMPLETE", "PAST_DUE", "UNPAID", "PAUSED"].includes(subscription.status);

  const choosePlan = (plan: SubscriptionPlan) => {
    if (!subscription || plan === subscription.effectivePlan || plan === "FREE" || busy) return;
    setFeedback(null);
    if (subscription.plan !== "FREE" && subscription.status !== "CANCELED" && subscription.status !== "NONE") {
      portal.mutate();
    } else {
      checkout.mutate({ data: { plan } });
    }
  };

  const confirmCancel = () => {
    Alert.alert(
      "Cancel paid plan?",
      `You will keep ${subscription?.effectivePlan === "ELITE" ? "Elite" : "Pro"} access until the end of the current period.`,
      [
        { text: "Keep plan", style: "cancel" },
        { text: "Cancel plan", style: "destructive", onPress: () => cancel.mutate() },
      ],
    );
  };

  if (subscriptionQuery.isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  if (!subscription) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <FeatherIcons name="alert-circle" size={32} color={colors.destructive} />
        <Text style={[styles.errorTitle, { color: colors.foreground }]}>Plans could not be loaded</Text>
        <TouchableOpacity testID="plans-retry" onPress={() => subscriptionQuery.refetch()}>
          <Text style={[styles.link, { color: colors.primary }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + (Platform.OS === "web" ? 118 : 100) },
      ]}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={subscriptionQuery.isRefetching} onRefresh={subscriptionQuery.refetch} tintColor={colors.primary} />}
    >
      <View style={styles.maxWidth}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>OWNER MEMBERSHIP</Text>
        <Text style={[styles.heading, { color: colors.foreground }]}>A plan that grows with your venue</Text>
        <Text style={[styles.subheading, { color: colors.mutedForeground }]}>Compare access and manage your billing securely.</Text>

        <View style={[styles.currentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.currentTop}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>CURRENT PLAN</Text>
              <Text style={[styles.currentPlan, { color: colors.foreground }]}>{subscription.effectivePlan[0] + subscription.effectivePlan.slice(1).toLowerCase()}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: (billingProblem ? colors.warning : colors.success) + "1F" }]}>
              <Text style={[styles.statusText, { color: billingProblem ? colors.warning : colors.success }]}>{readableStatus(subscription.status)}</Text>
            </View>
          </View>
          <View style={styles.periodRow}>
            <FeatherIcons name="calendar" size={15} color={colors.mutedForeground} />
            <Text style={[styles.periodText, { color: colors.mutedForeground }]}>
              {subscription.currentPeriodStart && subscription.currentPeriodEnd
                ? `${formatDate(subscription.currentPeriodStart)} – ${formatDate(subscription.currentPeriodEnd)}`
                : "No paid billing period"}
            </Text>
          </View>
          {subscription.cancelAtPeriodEnd && (
            <Text style={[styles.noticeText, { color: colors.warning }]}>Cancellation scheduled for {formatDate(subscription.currentPeriodEnd)}.</Text>
          )}
          {subscription.overridePlan && (
            <Text style={[styles.noticeText, { color: colors.info }]}>
              An administrator has applied {subscription.overridePlan.toLowerCase()} access
              {subscription.overrideEndsAt ? ` until ${formatDate(subscription.overrideEndsAt)}` : ""}.
            </Text>
          )}
          {!subscription.billingConfigured && (
            <View testID="billing-unavailable" style={[styles.warningBox, { backgroundColor: colors.warning + "18", borderColor: colors.warning + "45" }]}>
              <FeatherIcons name="info" size={18} color={colors.warning} />
              <Text style={[styles.warningText, { color: colors.foreground }]}>
                Online billing is not available right now. Your current access is unchanged. Please contact support to change plans.
              </Text>
            </View>
          )}
          {billingProblem && subscription.billingConfigured && (
            <TouchableOpacity testID="plans-recover-billing" disabled={busy} style={[styles.primaryButton, { backgroundColor: colors.warning }]} onPress={() => portal.mutate()}>
              {portal.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Fix billing</Text>}
            </TouchableOpacity>
          )}
          {feedback && (
            <View testID={`plans-${feedback.kind}`} style={[styles.feedback, { backgroundColor: (feedback.kind === "success" ? colors.success : colors.destructive) + "18" }]}>
              <Text style={[styles.feedbackText, { color: feedback.kind === "success" ? colors.success : colors.destructive }]}>{feedback.text}</Text>
            </View>
          )}
        </View>

        <View style={styles.comparisonHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.comparisonTitle, { color: colors.foreground }]}>Everything compared</Text>
            <Text style={[styles.comparisonSubtitle, { color: colors.mutedForeground }]}>
              Every plan includes the core tools below. Premium roadmap items are clearly marked as coming soon.
            </Text>
          </View>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <FeatherIcons name="check-circle" size={14} color={colors.success} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Included</Text>
            </View>
            <View style={styles.legendItem}>
              <FeatherIcons name="clock" size={14} color={colors.info} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Coming soon</Text>
            </View>
          </View>
        </View>

        <View style={[styles.planGrid, !compact && styles.planGridWide]}>
          {PLANS.map((plan) => {
            const current = subscription.effectivePlan === plan.id;
            const isPaidTarget = plan.id !== "FREE";
            const direction = PLAN_ORDER[plan.id] > PLAN_ORDER[subscription.effectivePlan] ? "Upgrade" : "Downgrade";
            return (
              <View key={plan.id} testID={`plan-card-${plan.id.toLowerCase()}`} style={[styles.planCard, !compact && styles.planCardWide, { backgroundColor: colors.card, borderColor: current ? colors.primary : colors.border }]}>
                {current && <Text style={[styles.currentPill, { color: colors.primary }]}>CURRENT</Text>}
                <Text style={[styles.planName, { color: colors.foreground }]}>{plan.title}</Text>
                <View style={styles.priceRow}>
                  <Text style={[styles.planPrice, { color: colors.foreground }]}>{plan.price}</Text>
                  {plan.cadence && <Text style={[styles.planCadence, { color: colors.mutedForeground }]}>{plan.cadence}</Text>}
                </View>
                <Text style={[styles.planDescription, { color: colors.mutedForeground }]}>{plan.description}</Text>
                <View style={styles.features}>
                  {plan.features.map((feature) => {
                    const presentation = featurePresentation(feature.availability, colors);
                    return (
                      <View key={feature.label} style={styles.featureRow}>
                        <FeatherIcons name={presentation.icon} size={17} color={presentation.color} />
                        <View style={styles.featureCopy}>
                          <Text style={[styles.featureText, {
                            color: feature.availability === "excluded"
                              ? colors.mutedForeground
                              : colors.foreground,
                          }]}>
                            {feature.label}
                          </Text>
                          <Text style={[styles.featureStatus, { color: presentation.color }]}>
                            {presentation.status}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
                {current ? (
                  <View style={[styles.currentButton, { backgroundColor: colors.muted }]}><Text style={[styles.buttonText, { color: colors.mutedForeground }]}>Your plan</Text></View>
                ) : plan.id === "FREE" ? (
                  subscription.plan !== "FREE" && subscription.status !== "CANCELED" && !subscription.cancelAtPeriodEnd ? (
                    <TouchableOpacity testID="plans-cancel" disabled={busy || !subscription.billingConfigured} style={[styles.outlineButton, { borderColor: colors.destructive, opacity: subscription.billingConfigured ? 1 : 0.45 }]} onPress={confirmCancel}>
                      <Text style={[styles.buttonText, { color: colors.destructive }]}>Cancel to Free</Text>
                    </TouchableOpacity>
                  ) : <View style={styles.actionSpacer} />
                ) : (
                  <TouchableOpacity testID={`plans-select-${plan.id.toLowerCase()}`} disabled={busy || !subscription.billingConfigured || !isPaidTarget} style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: subscription.billingConfigured ? 1 : 0.45 }]} onPress={() => choosePlan(plan.id)}>
                    {(checkout.isPending && checkout.variables?.data.plan === plan.id) || portal.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{subscription.effectivePlan === "FREE" || subscription.status === "CANCELED" ? `Choose ${plan.title}` : `${direction} to ${plan.title}`}</Text>}
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>

        {subscription.billingConfigured && subscription.status !== "NONE" && (
          <TouchableOpacity testID="plans-manage-billing" disabled={busy} style={styles.manageLink} onPress={() => portal.mutate()}>
            <FeatherIcons name="external-link" size={16} color={colors.primary} />
            <Text style={[styles.link, { color: colors.primary }]}>Manage payment method and invoices</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  content: { paddingHorizontal: 16, paddingTop: 20 },
  maxWidth: { width: "100%", maxWidth: 1080, alignSelf: "center" },
  eyebrow: { fontSize: 11, letterSpacing: 1.2, fontFamily: "PlusJakartaSans_700Bold" },
  heading: { fontSize: 27, lineHeight: 34, marginTop: 6, fontFamily: "PlusJakartaSans_700Bold" },
  subheading: { fontSize: 14, lineHeight: 21, marginTop: 5, marginBottom: 18, fontFamily: "PlusJakartaSans_400Regular" },
  currentCard: { padding: 18, borderRadius: 16, borderWidth: 1, marginBottom: 16 },
  currentTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  cardLabel: { fontSize: 10, letterSpacing: 0.9, fontFamily: "PlusJakartaSans_700Bold" },
  currentPlan: { fontSize: 24, marginTop: 2, fontFamily: "PlusJakartaSans_700Bold" },
  statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  statusText: { fontSize: 11, fontFamily: "PlusJakartaSans_700Bold" },
  periodRow: { flexDirection: "row", gap: 7, alignItems: "center", marginTop: 12 },
  periodText: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular" },
  noticeText: { fontSize: 12, lineHeight: 18, marginTop: 10, fontFamily: "PlusJakartaSans_500Medium" },
  warningBox: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 14 },
  warningText: { flex: 1, fontSize: 12, lineHeight: 18, fontFamily: "PlusJakartaSans_500Medium" },
  feedback: { marginTop: 12, borderRadius: 8, padding: 10 },
  feedbackText: { fontSize: 12, lineHeight: 18, fontFamily: "PlusJakartaSans_500Medium" },
  comparisonHeader: { marginTop: 4, marginBottom: 13, gap: 10 },
  comparisonTitle: { fontSize: 19, fontFamily: "PlusJakartaSans_700Bold" },
  comparisonSubtitle: { fontSize: 12, lineHeight: 18, marginTop: 3, fontFamily: "PlusJakartaSans_400Regular" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 13 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { fontSize: 10, fontFamily: "PlusJakartaSans_600SemiBold" },
  planGrid: { gap: 12 },
  planGridWide: { flexDirection: "row", alignItems: "stretch" },
  planCard: { borderRadius: 16, borderWidth: 1, padding: 17 },
  planCardWide: { flex: 1 },
  currentPill: { fontSize: 10, letterSpacing: 0.8, marginBottom: 7, fontFamily: "PlusJakartaSans_700Bold" },
  planName: { fontSize: 20, fontFamily: "PlusJakartaSans_700Bold" },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 7 },
  planPrice: { fontSize: 25, fontFamily: "PlusJakartaSans_700Bold" },
  planCadence: { fontSize: 11, fontFamily: "PlusJakartaSans_500Medium" },
  planDescription: { fontSize: 12, lineHeight: 18, minHeight: 38, marginTop: 4, fontFamily: "PlusJakartaSans_400Regular" },
  features: { gap: 10, marginVertical: 17, flex: 1 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  featureCopy: { flex: 1 },
  featureText: { fontSize: 12, lineHeight: 17, fontFamily: "PlusJakartaSans_500Medium" },
  featureStatus: { fontSize: 9, lineHeight: 13, marginTop: 1, fontFamily: "PlusJakartaSans_700Bold" },
  primaryButton: { minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, marginTop: 12 },
  outlineButton: { minHeight: 44, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  currentButton: { minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  actionSpacer: { height: 44 },
  buttonText: { fontSize: 13, fontFamily: "PlusJakartaSans_700Bold" },
  manageLink: { flexDirection: "row", alignSelf: "center", alignItems: "center", gap: 7, padding: 16 },
  link: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold" },
  errorTitle: { fontSize: 17, fontFamily: "PlusJakartaSans_700Bold" },
});