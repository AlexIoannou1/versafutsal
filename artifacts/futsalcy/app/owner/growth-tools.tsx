import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import { useGetOwnerSubscription, useListOwnerVenues } from "@workspace/api-client-react";
import {
  createOwnerPromotion,
  getOwnerGrowthAnalytics,
  listOwnerPromotions,
  setOwnerPromotionEnabled,
  setVenueStreak,
  type Promotion,
} from "@/lib/growth-api";

type Kind = "PERCENTAGE" | "FIXED";

function dateInputToIso(value: string, endOfDay = false): string | undefined {
  if (!value.trim()) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return undefined;
  const date = new Date(`${value.trim()}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default function OwnerGrowthToolsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const subscriptionQuery = useGetOwnerSubscription();
  const venuesQuery = useListOwnerVenues();
  const plan = subscriptionQuery.data?.subscription?.effectivePlan;
  const entitled = plan === "PRO" || plan === "ELITE";

  const promotionsQuery = useQuery({
    queryKey: ["ownerGrowthPromotions"],
    queryFn: listOwnerPromotions,
    enabled: entitled,
  });
  const analyticsQuery = useQuery({
    queryKey: ["ownerGrowthAnalytics"],
    queryFn: getOwnerGrowthAnalytics,
    enabled: entitled,
  });

  const venues = venuesQuery.data?.venues ?? [];
  const venueNames = useMemo(
    () => new Map(venues.map((venue) => [venue.id, venue.name])),
    [venues],
  );
  const [showForm, setShowForm] = useState(false);
  const [selectedVenueId, setVenueId] = useState("");
  const venueId = venues.some((venue) => venue.id === selectedVenueId)
    ? selectedVenueId : venues[0]?.id ?? "";
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<Kind>("PERCENTAGE");
  const [value, setValue] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [redemptionLimit, setRedemptionLimit] = useState("");
  const [perPlayerLimit, setPerPlayerLimit] = useState("1");
  const [formError, setFormError] = useState<string | null>(null);
  const [streakOverrides, setStreakOverrides] = useState<Record<string, boolean>>({});

  const createMutation = useMutation({
    mutationFn: createOwnerPromotion,
    onSuccess: async () => {
      setShowForm(false);
      setCode("");
      setValue("");
      setStartsOn("");
      setEndsOn("");
      setRedemptionLimit("");
      setPerPlayerLimit("1");
      setFormError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ownerGrowthPromotions"] }),
        queryClient.invalidateQueries({ queryKey: ["ownerGrowthAnalytics"] }),
      ]);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const togglePromotion = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setOwnerPromotionEnabled(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ownerGrowthPromotions"] }),
    onError: (error) => Alert.alert("Could not update code", errorMessage(error)),
  });
  const streakMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean; previousEnabled: boolean }) =>
      setVenueStreak(id, enabled),
    onSuccess: ({ streak }) => {
      setStreakOverrides((current) => ({ ...current, [streak.venueId]: streak.enabled }));
    },
    onError: (error, variables) => {
      // The switch updates immediately; restore the server value if its save fails.
      setStreakOverrides((current) => ({ ...current, [variables.id]: variables.previousEnabled }));
      Alert.alert("Could not update streak", errorMessage(error));
    },
  });

  const createPromotion = () => {
    const amount = Number(value);
    const totalLimit = redemptionLimit ? Number(redemptionLimit) : undefined;
    const playerLimit = Number(perPlayerLimit);
    const startsAt = dateInputToIso(startsOn);
    const endsAt = dateInputToIso(endsOn, true);
    if (!venueId) return setFormError("Choose a venue.");
    if (!/^[A-Z0-9_-]{3,32}$/.test(code.trim().toUpperCase())) {
      return setFormError("Use 3–32 letters, numbers, dashes, or underscores.");
    }
    if (!Number.isFinite(amount) || amount <= 0 || (kind === "PERCENTAGE" && amount > 100)) {
      return setFormError(kind === "PERCENTAGE" ? "Enter a percentage from 0.01 to 100." : "Enter a positive discount.");
    }
    if (startsOn && !startsAt) return setFormError("Start date must use YYYY-MM-DD.");
    if (endsOn && !endsAt) return setFormError("End date must use YYYY-MM-DD.");
    if (startsAt && endsAt && endsAt <= startsAt) return setFormError("End date must be after start date.");
    if ((totalLimit != null && (!Number.isInteger(totalLimit) || totalLimit < 1)) ||
        !Number.isInteger(playerLimit) || playerLimit < 1) {
      return setFormError("Usage limits must be positive whole numbers.");
    }
    setFormError(null);
    createMutation.mutate({
      venueId,
      code: code.trim().toUpperCase(),
      kind,
      value: amount,
      startsAt,
      endsAt,
      redemptionLimit: totalLimit,
      perPlayerLimit: playerLimit,
    });
  };

  const refreshing = promotionsQuery.isRefetching || analyticsQuery.isRefetching || venuesQuery.isRefetching;
  const refresh = () => void Promise.all([
    promotionsQuery.refetch(),
    analyticsQuery.refetch(),
    venuesQuery.refetch(),
  ]);
  const analytics = analyticsQuery.data;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16,
      paddingTop: insets.top + (Platform.OS === "web" ? 16 : 8), paddingBottom: 12,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    headerTitle: { fontSize: 19, fontFamily: "PlusJakartaSans_700Bold", color: colors.foreground },
    content: { padding: 16, paddingBottom: insets.bottom + 36 },
    hero: { backgroundColor: colors.primary + "12", borderRadius: 16, padding: 18, marginBottom: 16 },
    eyebrow: { color: colors.primary, fontSize: 10, letterSpacing: 1, fontFamily: "PlusJakartaSans_700Bold" },
    heroTitle: { color: colors.foreground, fontSize: 23, marginTop: 5, fontFamily: "PlusJakartaSans_700Bold" },
    copy: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19, marginTop: 6, fontFamily: "PlusJakartaSans_400Regular" },
    upgrade: { backgroundColor: colors.card, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
    upgradeTitle: { color: colors.foreground, fontSize: 18, fontFamily: "PlusJakartaSans_700Bold", marginTop: 12 },
    upgradeCopy: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19, textAlign: "center", marginVertical: 8, fontFamily: "PlusJakartaSans_400Regular" },
    primaryBtn: { minHeight: 46, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 },
    primaryText: { color: colors.primaryForeground, fontSize: 14, fontFamily: "PlusJakartaSans_700Bold" },
    sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, marginBottom: 10 },
    sectionTitle: { color: colors.foreground, fontSize: 17, fontFamily: "PlusJakartaSans_700Bold" },
    statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
    stat: { width: "48%", flexGrow: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 13 },
    statValue: { color: colors.foreground, fontSize: 20, fontFamily: "PlusJakartaSans_700Bold" },
    statLabel: { color: colors.mutedForeground, fontSize: 11, marginTop: 2, fontFamily: "PlusJakartaSans_500Medium" },
    card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 9 },
    promoTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    code: { color: colors.foreground, fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
    promoMeta: { color: colors.mutedForeground, fontSize: 12, marginTop: 3, fontFamily: "PlusJakartaSans_400Regular" },
    form: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary + "50", borderRadius: 14, padding: 15, marginBottom: 14 },
    label: { color: colors.foreground, fontSize: 12, marginBottom: 6, fontFamily: "PlusJakartaSans_600SemiBold" },
    input: { height: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 12, color: colors.foreground, backgroundColor: colors.background, marginBottom: 12, fontFamily: "PlusJakartaSans_400Regular" },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 12 },
    chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7 },
    chipText: { fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold" },
    twoCol: { flexDirection: "row", gap: 9 },
    col: { flex: 1 },
    error: { color: colors.destructive, fontSize: 12, marginBottom: 10, fontFamily: "PlusJakartaSans_500Medium" },
    empty: { color: colors.mutedForeground, fontSize: 13, textAlign: "center", padding: 18, fontFamily: "PlusJakartaSans_400Regular" },
    venueRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    venueName: { color: colors.foreground, fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold" },
  });

  if (subscriptionQuery.isLoading) {
    return <View style={[s.container, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back"><FeatherIcons name="arrow-left" size={22} color={colors.foreground} /></TouchableOpacity>
        <Text style={s.headerTitle}>Growth Tools</Text>
      </View>
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={s.content}
        bottomOffset={60}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      >
        <View style={s.hero}>
          <Text style={s.eyebrow}>{plan ?? "FREE"} GROWTH</Text>
          <Text style={s.heroTitle}>Turn first visits into habits</Text>
          <Text style={s.copy}>Run venue-scoped offers and reward players who book every week.</Text>
        </View>

        {!entitled ? (
          <View style={s.upgrade}>
            <FeatherIcons name="lock" size={28} color={colors.primary} />
            <Text style={s.upgradeTitle}>Unlock growth tools</Text>
            <Text style={s.upgradeCopy}>Upgrade to Pro or Elite to create discount codes, track redemptions, and enable weekly streak rewards.</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => router.push("/(owner)/plans")}>
              <Text style={s.primaryText}>Compare plans</Text>
              <FeatherIcons name="arrow-right" size={16} color={colors.primaryForeground} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={s.sectionHeader}><Text style={s.sectionTitle}>Performance</Text></View>
            <View style={s.statGrid}>
              {[
                ["Redemptions", analytics?.redeemedCount ?? 0],
                ["Discounts given", `€${analytics?.discountTotal ?? "0.00"}`],
                ["Active streaks", analytics?.activeStreakPlayers ?? 0],
                ["Near reward", analytics?.nearRewardPlayers ?? 0],
              ].map(([label, stat]) => (
                <View key={String(label)} style={s.stat}>
                  <Text style={s.statValue}>{stat}</Text><Text style={s.statLabel}>{label}</Text>
                </View>
              ))}
            </View>

            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Discount codes</Text>
              <TouchableOpacity onPress={() => setShowForm((open) => !open)}>
                <FeatherIcons name={showForm ? "x" : "plus-circle"} size={22} color={colors.primary} />
              </TouchableOpacity>
            </View>
            {showForm && (
              <View style={s.form}>
                <Text style={s.label}>Venue</Text>
                <View style={s.chipRow}>
                  {venues.map((venue) => <TouchableOpacity key={venue.id} accessibilityRole="button" accessibilityLabel={`Select ${venue.name}`} accessibilityState={{ selected: venueId === venue.id }} style={[s.chip, { borderColor: venueId === venue.id ? colors.primary : colors.border, backgroundColor: venueId === venue.id ? colors.primary + "15" : colors.background }]} onPress={() => setVenueId(venue.id)}><Text style={[s.chipText, { color: venueId === venue.id ? colors.primary : colors.foreground }]}>{venue.name}{venueId === venue.id ? " (selected)" : ""}</Text></TouchableOpacity>)}
                </View>
                <Text style={s.label}>Code</Text>
                <TextInput style={s.input} value={code} onChangeText={(text) => setCode(text.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} placeholder="WEEKDAY20" placeholderTextColor={colors.mutedForeground} autoCapitalize="characters" maxLength={32} />
                <Text style={s.label}>Discount type</Text>
                <View style={s.chipRow}>{(["PERCENTAGE", "FIXED"] as Kind[]).map((option) => <TouchableOpacity key={option} style={[s.chip, { borderColor: kind === option ? colors.primary : colors.border, backgroundColor: kind === option ? colors.primary + "15" : colors.background }]} onPress={() => setKind(option)}><Text style={[s.chipText, { color: kind === option ? colors.primary : colors.foreground }]}>{option === "PERCENTAGE" ? "Percentage" : "Fixed amount"}</Text></TouchableOpacity>)}</View>
                <Text style={s.label}>{kind === "PERCENTAGE" ? "Percentage (%)" : "Amount (€)"}</Text>
                <TextInput style={s.input} value={value} onChangeText={setValue} placeholder={kind === "PERCENTAGE" ? "20" : "10.00"} placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" />
                <View style={s.twoCol}><View style={s.col}><Text style={s.label}>Starts (optional)</Text><TextInput style={s.input} value={startsOn} onChangeText={setStartsOn} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} /></View><View style={s.col}><Text style={s.label}>Ends (optional)</Text><TextInput style={s.input} value={endsOn} onChangeText={setEndsOn} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} /></View></View>
                <View style={s.twoCol}><View style={s.col}><Text style={s.label}>Total uses</Text><TextInput style={s.input} value={redemptionLimit} onChangeText={setRedemptionLimit} placeholder="Unlimited" placeholderTextColor={colors.mutedForeground} keyboardType="number-pad" /></View><View style={s.col}><Text style={s.label}>Per player</Text><TextInput style={s.input} value={perPlayerLimit} onChangeText={setPerPlayerLimit} keyboardType="number-pad" /></View></View>
                {!!formError && <Text style={s.error}>{formError}</Text>}
                <TouchableOpacity style={s.primaryBtn} onPress={createPromotion} disabled={createMutation.isPending}>{createMutation.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={s.primaryText}>Create code</Text>}</TouchableOpacity>
              </View>
            )}
            {promotionsQuery.isLoading ? <ActivityIndicator color={colors.primary} /> : promotionsQuery.isError ? (
              <TouchableOpacity style={s.card} onPress={() => promotionsQuery.refetch()}>
                <Text style={s.error}>Discount codes could not be loaded.</Text>
                <Text style={[s.promoMeta, { color: colors.primary }]}>Tap to try again</Text>
              </TouchableOpacity>
            ) : (promotionsQuery.data?.promotions ?? []).length === 0 ? <Text style={s.empty}>No codes yet. Create one for a quiet day or loyal players.</Text> : (promotionsQuery.data?.promotions ?? []).map((promotion: Promotion) => (
              <View key={promotion.id} style={s.card}><View style={s.promoTop}><View style={{ flex: 1 }}><Text style={s.code}>{promotion.code}</Text><Text style={s.promoMeta}>{venueNames.get(promotion.venueId) ?? "Venue"} · {promotion.kind === "PERCENTAGE" ? `${Number(promotion.value)}% off` : `€${Number(promotion.value).toFixed(2)} off`}</Text><Text style={s.promoMeta}>Active {promotion.startsAt ? new Date(promotion.startsAt).toLocaleDateString() : "now"} – {promotion.endsAt ? new Date(promotion.endsAt).toLocaleDateString() : "no end date"}</Text><Text style={s.promoMeta}>Per player: {promotion.perPlayerLimit} · Uses: {promotion.redeemedCount ?? 0}{promotion.redemptionLimit != null ? `/${promotion.redemptionLimit}` : " (unlimited)"}{(promotion.reservedCount ?? 0) > 0 ? ` · ${promotion.reservedCount} reserved` : ""}</Text>{promotion.redeemedDiscountTotal != null && <Text style={s.promoMeta}>Discounts given: €{Number(promotion.redeemedDiscountTotal).toFixed(2)}</Text>}</View><Switch value={promotion.enabled} onValueChange={(enabled) => togglePromotion.mutate({ id: promotion.id, enabled })} disabled={togglePromotion.isPending} trackColor={{ false: colors.muted, true: colors.success }} thumbColor={colors.primaryForeground} /></View></View>
            ))}

            <View style={s.sectionHeader}><Text style={s.sectionTitle}>Weekly streaks</Text></View>
            <Text style={[s.copy, { marginTop: -5, marginBottom: 10 }]}>Four qualifying paid weeks unlock a free fifth booking at that venue.</Text>
            {venues.length === 0 ? <Text style={s.empty}>Create a venue before enabling streaks.</Text> : venues.map((venue) => {
              const serverEnabled = (venue as typeof venue & { streakEnabled?: boolean; weeklyStreakEnabled?: boolean }).streakEnabled ??
                (venue as typeof venue & { weeklyStreakEnabled?: boolean }).weeklyStreakEnabled ?? false;
              const enabled = streakOverrides[venue.id] ?? serverEnabled;
              return <View key={venue.id} style={s.card}><View style={s.venueRow}><FeatherIcons name="award" size={18} color={enabled ? colors.success : colors.mutedForeground} /><View style={{ flex: 1 }}><Text style={s.venueName}>{venue.name}</Text><Text style={s.promoMeta}>{enabled ? "Visible to players" : "Not active"}</Text></View><Switch value={enabled} onValueChange={(next) => { setStreakOverrides((current) => ({ ...current, [venue.id]: next })); streakMutation.mutate({ id: venue.id, enabled: next, previousEnabled: enabled }); }} disabled={streakMutation.isPending} trackColor={{ false: colors.muted, true: colors.success }} thumbColor={colors.primaryForeground} /></View></View>;
            })}
          </>
        )}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}