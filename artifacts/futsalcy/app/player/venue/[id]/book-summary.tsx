import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import {
  useGetVenue,
  useCreateBooking,
  useCheckoutBooking,
  useGetCheckoutFee,
} from "@workspace/api-client-react";

const MONTHS_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAYS_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function formatFullDate(iso: string) {
  const d = new Date(iso);
  return `${DAYS_FULL[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_FULL[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function formatTime12(iso: string) {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function makeIdempotencyKey() {
  return `checkout_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

type PaymentType = "FULL" | "DEPOSIT";

export default function BookSummaryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id: venueId, pitchId, pitchName, slotMins, startAt, endAt } = useLocalSearchParams<{
    id: string;
    pitchId: string;
    pitchName: string;
    slotMins: string;
    startAt: string;
    endAt: string;
  }>();

  const [paymentType, setPaymentType] = useState<PaymentType>("FULL");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Persisted booking ID — set on first successful createBooking, reused on checkout retry
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null);

  // New idempotency key per attempt; regenerated after each failure to avoid conflicts
  const idempotencyKeyRef = useRef<string>(makeIdempotencyKey());

  const decodedStartAt = startAt ? decodeURIComponent(String(startAt)) : "";
  const decodedEndAt = endAt ? decodeURIComponent(String(endAt)) : "";
  const decodedPitchName = pitchName ? decodeURIComponent(String(pitchName)) : "Pitch";

  const { data: venueData, isLoading: venueLoading } = useGetVenue(venueId!);
  const venue = venueData?.venue;

  const { data: feeData } = useGetCheckoutFee(
    { venueId: venueId! },
    { query: { enabled: !!venueId } },
  );

  const pitch = venue?.pitches?.find((p) => p.id === pitchId);
  const pricingRule = pitch?.pricingRules?.[0];
  const pricePerHour = pricingRule?.pricePerHour ?? null;
  const slotMinutes = parseInt(slotMins ?? "60", 10);
  const subtotal = pricePerHour != null ? (parseFloat(pricePerHour) * slotMinutes) / 60 : null;

  // Deposit availability and amount from venue pricing rule config
  const depositType = pricingRule?.depositType ?? "NONE";
  const depositAvailable = depositType !== "NONE";
  const depositAmount: number | null = (() => {
    if (!depositAvailable || subtotal == null) return null;
    if (depositType === "FIXED" && pricingRule?.depositAmount) {
      return parseFloat(pricingRule.depositAmount);
    }
    if (depositType === "PERCENT" && pricingRule?.depositAmount) {
      return subtotal * (parseFloat(pricingRule.depositAmount) / 100);
    }
    return null;
  })();

  const feeEnabled = feeData?.feeEnabled ?? true;
  const feeAmount = feeEnabled ? parseFloat(feeData?.feeAmount ?? "1.00") : 0;
  const feeLabel = feeEnabled ? `€${feeAmount.toFixed(2)}` : "Waived";

  const baseAmount = paymentType === "DEPOSIT" && depositAmount != null ? depositAmount : subtotal;
  const totalDue = baseAmount != null ? baseAmount + feeAmount : null;

  const { mutate: createBooking } = useCreateBooking();
  const { mutate: checkoutBooking } = useCheckoutBooking();

  // Inner function: perform checkout against an existing booking ID
  function doCheckout(bookingId: string) {
    checkoutBooking(
      {
        bookingId,
        data: {
          paymentType,
          idempotencyKey: idempotencyKeyRef.current,
        },
      },
      {
        onSuccess: () => {
          setIsProcessing(false);
          router.replace(`/player/booking/${bookingId}`);
        },
        onError: (err: unknown) => {
          setIsProcessing(false);
          // Regenerate key so the next retry doesn't collide with the failed attempt's record
          idempotencyKeyRef.current = makeIdempotencyKey();
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            "Payment failed. Tap Pay Now to try again.";
          setCheckoutError(msg);
        },
      },
    );
  }

  function handlePayNow() {
    if (isProcessing) return;
    setCheckoutError(null);
    setIsProcessing(true);

    if (pendingBookingId) {
      // Booking already created — retry checkout against same booking, new idempotency key
      doCheckout(pendingBookingId);
      return;
    }

    // First attempt — create the PENDING booking then immediately check out
    createBooking(
      { data: { pitchId: pitchId!, startAt: decodedStartAt } },
      {
        onSuccess: (res) => {
          const bookingId = res.booking.id;
          // Persist so retries reuse this booking, not create a conflicting one
          setPendingBookingId(bookingId);
          doCheckout(bookingId);
        },
        onError: (err: unknown) => {
          setIsProcessing(false);
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            "Could not reserve slot. Please try again.";
          setCheckoutError(msg);
        },
      },
    );
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    heroBanner: {
      alignItems: "center",
      paddingVertical: 28,
      paddingHorizontal: 24,
    },
    heroIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.primary + "20",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
    heroTitle: {
      fontSize: 20,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 4,
      textAlign: "center",
    },
    heroSub: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      marginHorizontal: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    cardTitle: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.primary,
      letterSpacing: 0.8,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 8,
      textTransform: "uppercase",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 11,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    rowFirst: { borderTopWidth: 0 },
    rowIcon: { width: 20, alignItems: "center" },
    rowLabel: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      width: 80,
    },
    rowValue: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      flex: 1,
    },
    breakdownCard: {
      backgroundColor: colors.card,
      borderRadius: 12,
      marginHorizontal: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    breakdownRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    breakdownRowFirst: { borderTopWidth: 0 },
    breakdownLabel: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    breakdownValue: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
    breakdownFeeWaived: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.primary,
    },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: colors.primary + "40",
      backgroundColor: colors.primary + "08",
    },
    totalLabel: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    totalValue: {
      fontSize: 20,
      fontFamily: "Inter_700Bold",
      color: colors.primary,
    },
    selectorCard: {
      marginHorizontal: 16,
      marginBottom: 12,
      gap: 8,
    },
    selectorLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 2,
    },
    selectorRow: {
      flexDirection: "row",
      gap: 8,
    },
    selectorBtn: {
      flex: 1,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.border,
      padding: 12,
      alignItems: "center",
      backgroundColor: colors.card,
    },
    selectorBtnActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + "12",
    },
    selectorBtnTitle: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
    },
    selectorBtnTitleActive: { color: colors.primary },
    selectorBtnSub: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    disclaimerCard: {
      marginHorizontal: 16,
      marginBottom: 16,
      flexDirection: "row",
      gap: 10,
      alignItems: "flex-start",
    },
    disclaimerText: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      flex: 1,
      lineHeight: 18,
    },
    bottomBar: {
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      padding: 16,
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 8 : 16),
      gap: 10,
    },
    errorText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: "#EF4444",
      textAlign: "center",
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      height: 54,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    primaryBtnDisabled: { opacity: 0.6 },
    primaryBtnText: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
    secondaryBtn: {
      borderRadius: 12,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryBtnText: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
  });

  if (venueLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: "Checkout", headerBackTitle: "Back" }} />

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={s.heroBanner}>
          <View style={s.heroIcon}>
            <Feather name="credit-card" size={28} color={colors.primary} />
          </View>
          <Text style={s.heroTitle}>Complete your booking</Text>
          <Text style={s.heroSub}>Review and pay to confirm your slot.</Text>
        </View>

        {/* Venue Card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Venue</Text>
          <View style={[s.row, s.rowFirst]}>
            <View style={s.rowIcon}><Feather name="home" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>Name</Text>
            <Text style={s.rowValue} numberOfLines={2}>{venue?.name ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}><Feather name="map-pin" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>District</Text>
            <Text style={s.rowValue}>{venue?.district ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}><Feather name="navigation" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>Address</Text>
            <Text style={s.rowValue} numberOfLines={2}>{venue?.address ?? "—"}</Text>
          </View>
        </View>

        {/* Booking Details Card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Booking Details</Text>
          <View style={[s.row, s.rowFirst]}>
            <View style={s.rowIcon}><Feather name="grid" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>Pitch</Text>
            <Text style={s.rowValue}>{decodedPitchName}</Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}><Feather name="calendar" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>Date</Text>
            <Text style={s.rowValue}>{decodedStartAt ? formatFullDate(decodedStartAt) : "—"}</Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}><Feather name="clock" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>Time</Text>
            <Text style={s.rowValue}>
              {decodedStartAt && decodedEndAt
                ? `${formatTime12(decodedStartAt)} – ${formatTime12(decodedEndAt)}`
                : "—"}
            </Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}><Feather name="watch" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>Duration</Text>
            <Text style={s.rowValue}>{slotMinutes} minutes</Text>
          </View>
        </View>

        {/* Payment Type Selector — only if venue allows deposit payments */}
        {subtotal != null && depositAvailable && depositAmount != null && (
          <View style={s.selectorCard}>
            <Text style={s.selectorLabel}>Payment Option</Text>
            <View style={s.selectorRow}>
              <TouchableOpacity
                style={[s.selectorBtn, paymentType === "FULL" && s.selectorBtnActive]}
                onPress={() => setPaymentType("FULL")}
                activeOpacity={0.8}
                disabled={isProcessing}
              >
                <Text style={[s.selectorBtnTitle, paymentType === "FULL" && s.selectorBtnTitleActive]}>
                  Pay in Full
                </Text>
                <Text style={s.selectorBtnSub}>€{subtotal.toFixed(2)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.selectorBtn, paymentType === "DEPOSIT" && s.selectorBtnActive]}
                onPress={() => setPaymentType("DEPOSIT")}
                activeOpacity={0.8}
                disabled={isProcessing}
              >
                <Text style={[s.selectorBtnTitle, paymentType === "DEPOSIT" && s.selectorBtnTitleActive]}>
                  Pay Deposit
                </Text>
                <Text style={s.selectorBtnSub}>
                  €{depositAmount.toFixed(2)}
                  {depositType === "PERCENT" && pricingRule?.depositAmount
                    ? ` (${pricingRule.depositAmount}%)`
                    : ""}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Price Breakdown */}
        <View style={s.breakdownCard}>
          <Text style={s.cardTitle}>Price Breakdown</Text>
          <View style={[s.breakdownRow, s.breakdownRowFirst]}>
            <Text style={s.breakdownLabel}>
              {paymentType === "DEPOSIT" ? "Deposit" : "Pitch subtotal"}
            </Text>
            <Text style={s.breakdownValue}>
              {baseAmount != null ? `€${baseAmount.toFixed(2)}` : "—"}
            </Text>
          </View>
          <View style={s.breakdownRow}>
            <Text style={s.breakdownLabel}>Platform fee</Text>
            {feeEnabled ? (
              <Text style={s.breakdownValue}>{feeLabel}</Text>
            ) : (
              <Text style={s.breakdownFeeWaived}>Fee waived</Text>
            )}
          </View>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Total due now</Text>
            <Text style={s.totalValue}>
              {totalDue != null ? `€${totalDue.toFixed(2)}` : "—"}
            </Text>
          </View>
        </View>

        {/* Cancellation Policy */}
        <View style={s.disclaimerCard}>
          <Feather name="shield" size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
          <Text style={s.disclaimerText}>
            Secure payment via MockPaymentProvider. Cancellations made within{" "}
            {venue?.cancellationWindowHours ?? 48} hours of the booking may incur a fee.
          </Text>
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={s.bottomBar}>
        {checkoutError && <Text style={s.errorText}>{checkoutError}</Text>}
        <TouchableOpacity
          style={[s.primaryBtn, isProcessing && s.primaryBtnDisabled]}
          onPress={handlePayNow}
          disabled={isProcessing}
          activeOpacity={0.85}
        >
          {isProcessing ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="lock" size={18} color={colors.primaryForeground} />
              <Text style={s.primaryBtnText}>
                {checkoutError ? "Retry Payment" : "Pay Now"}
                {totalDue != null ? ` · €${totalDue.toFixed(2)}` : ""}
              </Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={s.secondaryBtn}
          onPress={() => router.back()}
          activeOpacity={0.8}
          disabled={isProcessing}
        >
          <Text style={s.secondaryBtnText}>Back to Slots</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
