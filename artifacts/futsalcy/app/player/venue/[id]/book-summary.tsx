import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { MotionPressable } from "@/components/Motion";
import {
  useGetVenue,
  useCreateBooking,
  useCheckoutBooking,
  useGetCheckoutFee,
  getGetCheckoutFeeQueryKey,
  getGetPitchAvailabilityQueryKey,
  captureBookingPayment,
  getStripeConfig,
} from "@workspace/api-client-react";
import { StripeProvider, useStripe } from "@/lib/stripe-native";
import { getBookingQuote, previewBookingQuote, getPlayerVenueStreak, type BookingQuote } from "@/lib/growth-api";
import { useQuery } from "@tanstack/react-query";

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

function errorMessageForPromo(error: unknown): string {
  return error instanceof Error ? error.message : "This code could not be applied.";
}

type PaymentType = "FULL" | "DEPOSIT";
type StripeAttempt = {
  bookingId: string;
  clientSecret: string;
  paymentSheetCompleted?: boolean;
};

function BookSummaryInner() {
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

  const queryClient = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [paymentType, setPaymentType] = useState<PaymentType>("FULL");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [isSlotConflict, setIsSlotConflict] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [promoFeedback, setPromoFeedback] = useState<string | null>(null);
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);
  const [isLoadingQuote, setIsLoadingQuote] = useState(true);
  const [stripeAttempt, setStripeAttempt] = useState<StripeAttempt | null>(null);

  // Persisted booking ID — set on first successful createBooking, reused on checkout retry
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null);

  // New idempotency key per attempt; regenerated after each failure to avoid conflicts
  const idempotencyKeyRef = useRef<string>(makeIdempotencyKey());
  const initialQuoteStartedRef = useRef(false);

  const decodedStartAt = startAt ? decodeURIComponent(String(startAt)) : "";
  const decodedEndAt = endAt ? decodeURIComponent(String(endAt)) : "";
  const decodedPitchName = pitchName ? decodeURIComponent(String(pitchName)) : "Pitch";

  const { data: venueData, isLoading: venueLoading } = useGetVenue(venueId!);
  const venue = venueData?.venue;
  const streakQuery = useQuery({
    queryKey: ["playerVenueStreak", venueId],
    queryFn: () => getPlayerVenueStreak(venueId!),
    enabled: !!venueId,
  });

  const { data: feeData } = useGetCheckoutFee(
    { venueId: venueId! },
    { query: { queryKey: getGetCheckoutFeeQueryKey({ venueId: venueId! }), enabled: !!venueId } },
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
  const feePercent = feeEnabled ? parseFloat(feeData?.feePercent ?? "6.00") : 0;

  const discountedSubtotal = quote ? Number(quote.payableAmount) : subtotal;
  const discountedDeposit = discountedSubtotal != null && depositAmount != null
    ? depositType === "FIXED"
      ? Math.min(depositAmount, discountedSubtotal)
      : Math.round(discountedSubtotal * Number(pricingRule?.depositAmount ?? 0)) / 100
    : depositAmount;
  const baseAmount = paymentType === "DEPOSIT" && discountedDeposit != null
    ? discountedDeposit
    : discountedSubtotal;
  const feeAmount = feeEnabled && baseAmount != null ? baseAmount * (feePercent / 100) : 0;
  const feeLabel = feeEnabled
    ? `€${feeAmount.toFixed(2)} (${feePercent}%)`
    : "Waived";

  const totalDue = baseAmount != null ? baseAmount + feeAmount : null;

  const { mutate: createBooking } = useCreateBooking();
  const { mutate: checkoutBooking } = useCheckoutBooking();

  useEffect(() => {
    if (!pitchId || !decodedStartAt || initialQuoteStartedRef.current) return;
    initialQuoteStartedRef.current = true;
    void previewBookingQuote(pitchId, decodedStartAt)
      .then(({ quote: initialQuote }) => setQuote(initialQuote))
      .catch(() => setCheckoutError("Could not load a price preview. Retry before paying."))
      .finally(() => setIsLoadingQuote(false));
  }, [decodedStartAt, pitchId]);

  // ── Stripe payment sheet flow ───────────────────────────────────────────────

  /**
   * After checkout returns a clientSecret, initialize the Stripe payment sheet
   * and present it. On success, call /capture to confirm the booking server-side.
   */
  async function handleStripePayment(
    bookingId: string,
    clientSecret: string,
  ) {
    // initPaymentSheet with the server-provided client secret
    const initResult = await initPaymentSheet({
      paymentIntentClientSecret: clientSecret,
      merchantDisplayName: "FutsalCY",
      style: "automatic",
    });

    if (initResult.error) {
      setIsProcessing(false);
      // The checkout claim remains valid. Keep this server-issued secret so a
      // retry can initialize the same PaymentIntent instead of stranding it.
      setStripeAttempt({ bookingId, clientSecret });
      setCheckoutError(initResult.error.message ?? "Could not initialise payment sheet. Tap Retry Payment to try again.");
      return;
    }

    const presentResult = await presentPaymentSheet();

    if (presentResult.error) {
      setIsProcessing(false);
      // A cancelled/failed sheet has not necessarily failed the intent. Reuse
      // its client secret on retry rather than requesting a locked checkout.
      setStripeAttempt({ bookingId, clientSecret });
      if ((presentResult.error.code as string) === "Canceled") {
        setCheckoutError("Payment cancelled. Tap Pay Now to try again.");
      } else {
        setCheckoutError(presentResult.error.message ?? "Payment failed. Tap Pay Now to try again.");
      }
      return;
    }

    // Payment sheet succeeded — confirm on the server. If the network call
    // fails, a retry captures this same intent rather than presenting it again.
    setStripeAttempt({ bookingId, clientSecret, paymentSheetCompleted: true });
    await captureStripePayment(bookingId);
  }

  async function captureStripePayment(bookingId: string) {
    try {
      await captureBookingPayment(bookingId);
      setIsProcessing(false);
      setStripeAttempt(null);
      router.replace(`/player/booking/${bookingId}`);
    } catch (captureErr: unknown) {
      setIsProcessing(false);
      if ((captureErr as { data?: { code?: string } })?.data?.code === "CHECKOUT_EXPIRED") {
        setPendingBookingId(null);
        setStripeAttempt(null);
        idempotencyKeyRef.current = makeIdempotencyKey();
        setCheckoutError("This checkout expired. Tap Pay Now to reserve this slot again.");
        return;
      }
      const msg =
        (captureErr as { data?: { error?: string } })?.data?.error ??
        (captureErr as { message?: string })?.message ??
        "Payment succeeded but booking confirmation failed. Please contact support.";
      setCheckoutError(`${msg} Tap Retry Payment to confirm your booking.`);
    }
  }

  // Inner function: perform checkout against an existing booking ID
  function doCheckout(bookingId: string) {
    checkoutBooking(
      {
        bookingId,
        data: {
          paymentType,
          idempotencyKey: idempotencyKeyRef.current,
          promoCode: appliedPromoCode ?? undefined,
        } as Parameters<typeof checkoutBooking>[0]["data"],
      },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSuccess: (res: any) => {
          // Stripe mode: server returned clientSecret for payment sheet
          if (res?.clientSecret) {
            setStripeAttempt({ bookingId, clientSecret: res.clientSecret as string });
            void handleStripePayment(bookingId, res.clientSecret as string);
            return;
          }

          // Mock mode or already processed: booking is confirmed directly
          setIsProcessing(false);
          router.replace(`/player/booking/${bookingId}`);
        },
        onError: (err: unknown) => {
          setIsProcessing(false);
          const response = (err as { data?: { clientSecret?: string; code?: string; error?: string } })?.data ?? (err as {
            response?: {
              data?: {
                clientSecret?: string;
                requiresClientAction?: boolean;
                code?: string;
                error?: string;
              };
            };
          })?.response?.data;
          // An integration may return a recoverable secret with an existing
          // PENDING checkout. Present it directly instead of abandoning its lock.
          if (response?.clientSecret) {
            setStripeAttempt({ bookingId, clientSecret: response.clientSecret });
            void handleStripePayment(bookingId, response.clientSecret);
            return;
          }
          // A timeout or CHECKOUT_IN_PROGRESS can still be tied to a live
          // Stripe intent. Keep its idempotency key so the next checkout can
          // recover that intent/client secret. Only backend-stable codes say a
          // new key is required.
          if (
            response?.code === "PAYMENT_RETRY_KEY_REQUIRED" ||
            response?.code === "PAYMENT_INTENT_UNAVAILABLE" ||
            response?.code === "CHECKOUT_EXPIRED"
          ) {
            idempotencyKeyRef.current = makeIdempotencyKey();
            setStripeAttempt(null);
          }
          if (response?.code === "CHECKOUT_EXPIRED") setPendingBookingId(null);
          const msg =
            response?.error ??
            "Payment failed. Tap Pay Now to try again.";
          setCheckoutError(msg);
        },
      },
    );
  }

  function handlePayNow() {
    if (isProcessing) return;
    if (!quote && !stripeAttempt) {
      setIsLoadingQuote(true);
      setCheckoutError(null);
      const preview = pendingBookingId
        ? getBookingQuote(pendingBookingId, appliedPromoCode ?? undefined)
        : previewBookingQuote(pitchId!, decodedStartAt, appliedPromoCode ?? undefined);
      void preview.then(({ quote: nextQuote }) => setQuote(nextQuote))
        .catch(() => setCheckoutError("Could not load a price preview. Retry before paying."))
        .finally(() => setIsLoadingQuote(false));
      return;
    }
    setCheckoutError(null);
    setIsSlotConflict(false);
    setIsProcessing(true);

    if (stripeAttempt) {
      if (stripeAttempt.paymentSheetCompleted) {
        void captureStripePayment(stripeAttempt.bookingId);
      } else {
        void handleStripePayment(stripeAttempt.bookingId, stripeAttempt.clientSecret);
      }
      return;
    }

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
          const status = (err as { response?: { status?: number } })?.response?.status;
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            "Could not reserve slot. Please try again.";
          if (status === 409) {
            if (venueId && pitchId) {
              void queryClient.invalidateQueries({
                queryKey: getGetPitchAvailabilityQueryKey(venueId, pitchId),
              });
            }
            setIsSlotConflict(true);
          }
          setCheckoutError(msg);
        },
      },
    );
  }

  function handleApplyPromo() {
    const normalized = promoCode.trim().toUpperCase();
    if (!normalized) {
      setPromoFeedback("Enter a discount code.");
      return;
    }
    setIsApplyingPromo(true);
    setPromoFeedback(null);
    const preview = pendingBookingId
      ? getBookingQuote(pendingBookingId, normalized)
      : previewBookingQuote(pitchId!, decodedStartAt, normalized);
    void preview
        .then(({ quote: nextQuote }) => {
          setQuote(nextQuote);
          setAppliedPromoCode(normalized);
          setPromoFeedback(`Code applied — you save €${Number(nextQuote.discountAmount).toFixed(2)}.`);
        })
        .catch((error: unknown) => {
          setQuote(null);
          setAppliedPromoCode(null);
          setPromoFeedback(errorMessageForPromo(error));
        })
        .finally(() => setIsApplyingPromo(false));
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
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      marginBottom: 4,
      textAlign: "center",
    },
    heroSub: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_600SemiBold",
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
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      width: 80,
    },
    rowValue: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_500Medium",
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
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
    breakdownValue: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.foreground,
    },
    breakdownFeeWaived: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.primary,
    },
    promoCard: {
      marginHorizontal: 16,
      marginBottom: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 14,
    },
    promoTitle: { fontSize: 14, fontFamily: "PlusJakartaSans_700Bold", color: colors.foreground },
    promoRow: { flexDirection: "row", gap: 8, marginTop: 10 },
    promoInput: {
      flex: 1,
      height: 44,
      borderWidth: 1,
      borderColor: appliedPromoCode ? colors.success : colors.border,
      borderRadius: 9,
      paddingHorizontal: 12,
      color: colors.foreground,
      backgroundColor: colors.background,
      fontFamily: "PlusJakartaSans_600SemiBold",
    },
    promoButton: {
      minWidth: 76,
      height: 44,
      borderRadius: 9,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    promoFeedback: { fontSize: 12, lineHeight: 17, marginTop: 8, fontFamily: "PlusJakartaSans_500Medium" },
    rewardBanner: {
      marginHorizontal: 16,
      marginBottom: 12,
      flexDirection: "row",
      gap: 10,
      padding: 13,
      borderRadius: 11,
      backgroundColor: colors.success + "14",
      borderWidth: 1,
      borderColor: colors.success + "35",
    },
    rewardText: { flex: 1, color: colors.foreground, fontSize: 12, lineHeight: 18, fontFamily: "PlusJakartaSans_500Medium" },
    savingsValue: { color: colors.success, textDecorationLine: "line-through" },
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
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
    },
    totalValue: {
      fontSize: 20,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.primary,
    },
    selectorCard: {
      marginHorizontal: 16,
      marginBottom: 12,
      gap: 8,
    },
    selectorLabel: {
      fontSize: 11,
      fontFamily: "PlusJakartaSans_600SemiBold",
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
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.mutedForeground,
    },
    selectorBtnTitleActive: { color: colors.primary },
    selectorBtnSub: {
      fontSize: 11,
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_600SemiBold",
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
      fontFamily: "PlusJakartaSans_500Medium",
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
            <FeatherIcons name="credit-card" size={28} color={colors.primary} />
          </View>
          <Text style={s.heroTitle}>Complete your booking</Text>
          <Text style={s.heroSub}>Review and pay to confirm your slot.</Text>
        </View>

        {streakQuery.data?.enabled && (
          <View style={s.rewardBanner}>
            <FeatherIcons name="award" size={18} color={colors.success} />
            <Text style={s.rewardText}>
              {streakQuery.data.rewardAvailable || quote?.incentiveType === "STREAK_REWARD"
                ? "Free booking reward ready. It will be applied automatically unless you use a discount code."
                : `${streakQuery.data.progress?.paidWeeks ?? 0} of 4 paid weeks complete. This qualifying booking can advance your streak.`}
            </Text>
          </View>
        )}

        <View style={s.promoCard}>
          <Text style={s.promoTitle}>Have a discount code?</Text>
          <View style={s.promoRow}>
            <TextInput
              style={s.promoInput}
              value={promoCode}
              onChangeText={(text) => {
                setPromoCode(text.toUpperCase().replace(/[^A-Z0-9_-]/g, ""));
                if (appliedPromoCode && text.toUpperCase() !== appliedPromoCode) {
                  setAppliedPromoCode(null);
                  setQuote(null);
                }
                setPromoFeedback(null);
              }}
              placeholder="ENTER CODE"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!isProcessing && !isApplyingPromo && !stripeAttempt}
              maxLength={32}
            />
            <TouchableOpacity style={s.promoButton} onPress={handleApplyPromo} disabled={isApplyingPromo || isProcessing || !!stripeAttempt}>
              {isApplyingPromo ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={s.primaryBtnText}>Apply</Text>}
            </TouchableOpacity>
          </View>
          {!!promoFeedback && (
            <Text style={[s.promoFeedback, { color: appliedPromoCode ? colors.success : colors.destructive }]}>
              {promoFeedback}
            </Text>
          )}
        </View>

        {/* Venue Card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Venue</Text>
          <View style={[s.row, s.rowFirst]}>
            <View style={s.rowIcon}><FeatherIcons name="home" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>Name</Text>
            <Text style={s.rowValue} numberOfLines={2}>{venue?.name ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}><FeatherIcons name="map-pin" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>District</Text>
            <Text style={s.rowValue}>{venue?.district ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}><FeatherIcons name="navigation" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>Address</Text>
            <Text style={s.rowValue} numberOfLines={2}>{venue?.address ?? "—"}</Text>
          </View>
        </View>

        {/* Booking Details Card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Booking Details</Text>
          <View style={[s.row, s.rowFirst]}>
            <View style={s.rowIcon}><FeatherIcons name="grid" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>Pitch</Text>
            <Text style={s.rowValue}>{decodedPitchName}</Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}><FeatherIcons name="calendar" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>Date</Text>
            <Text style={s.rowValue}>{decodedStartAt ? formatFullDate(decodedStartAt) : "—"}</Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}><FeatherIcons name="clock" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>Time</Text>
            <Text style={s.rowValue}>
              {decodedStartAt && decodedEndAt
                ? `${formatTime12(decodedStartAt)} – ${formatTime12(decodedEndAt)}`
                : "—"}
            </Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}><FeatherIcons name="watch" size={14} color={colors.mutedForeground} /></View>
            <Text style={s.rowLabel}>Duration</Text>
            <Text style={s.rowValue}>{slotMinutes} minutes</Text>
          </View>
        </View>

        {/* Payment Type Selector — only if venue allows deposit payments */}
        {subtotal != null && depositAvailable && depositAmount != null && (
          <View style={s.selectorCard}>
            <Text style={s.selectorLabel}>Payment Option</Text>
            <View style={s.selectorRow}>
              <MotionPressable
                style={[s.selectorBtn, paymentType === "FULL" && s.selectorBtnActive]}
                onPress={() => setPaymentType("FULL")}
                activeOpacity={0.8}
                disabled={isProcessing || !!stripeAttempt}
              >
                <Text style={[s.selectorBtnTitle, paymentType === "FULL" && s.selectorBtnTitleActive]}>
                  Pay in Full
                </Text>
                 <Text style={s.selectorBtnSub}>€{(discountedSubtotal ?? subtotal).toFixed(2)}</Text>
              </MotionPressable>
              <MotionPressable
                style={[s.selectorBtn, paymentType === "DEPOSIT" && s.selectorBtnActive]}
                onPress={() => setPaymentType("DEPOSIT")}
                activeOpacity={0.8}
                disabled={isProcessing || !!stripeAttempt}
              >
                <Text style={[s.selectorBtnTitle, paymentType === "DEPOSIT" && s.selectorBtnTitleActive]}>
                  Pay Deposit
                </Text>
                <Text style={s.selectorBtnSub}>
                   €{(discountedDeposit ?? depositAmount).toFixed(2)}
                  {depositType === "PERCENT" && pricingRule?.depositAmount
                    ? ` (${pricingRule.depositAmount}%)`
                    : ""}
                </Text>
              </MotionPressable>
            </View>
          </View>
        )}

        {/* Price Breakdown */}
        <View style={s.breakdownCard}>
          <Text style={s.cardTitle}>Price Breakdown</Text>
          <View style={[s.breakdownRow, s.breakdownRowFirst]}>
            <Text style={s.breakdownLabel}>
              Pitch subtotal
            </Text>
            <Text style={s.breakdownValue}>
              {subtotal != null ? `€${subtotal.toFixed(2)}` : "—"}
            </Text>
          </View>
          {quote && Number(quote.discountAmount) > 0 && (
            <View style={s.breakdownRow}>
              <Text style={s.breakdownLabel}>
                {quote.incentiveType === "STREAK_REWARD" ? "Weekly streak reward" : `Discount (${appliedPromoCode})`}
              </Text>
              <Text style={[s.breakdownValue, { color: colors.success }]}>
                −€{Number(quote.discountAmount).toFixed(2)}
              </Text>
            </View>
          )}
          {paymentType === "DEPOSIT" && (
            <View style={s.breakdownRow}>
              <Text style={s.breakdownLabel}>Remaining at venue</Text>
              <Text style={s.breakdownValue}>−€{Math.max(0, (discountedSubtotal ?? 0) - (baseAmount ?? 0)).toFixed(2)}</Text>
            </View>
          )}
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
          <FeatherIcons name="shield" size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
          <Text style={s.disclaimerText}>
            Secure payment powered by Stripe. Cancellations made within{" "}
            {venue?.cancellationWindowHours ?? 48} hours of the booking may incur a fee.
          </Text>
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={s.bottomBar}>
        {checkoutError && <Text accessibilityLiveRegion="polite" style={s.errorText}>{checkoutError}</Text>}
        {isSlotConflict ? (
          <MotionPressable
            style={s.primaryBtn}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <FeatherIcons name="refresh-cw" size={18} color={colors.primaryForeground} />
            <Text style={s.primaryBtnText}>Choose Another Slot</Text>
          </MotionPressable>
        ) : (
          <>
            <MotionPressable
              style={[s.primaryBtn, (isProcessing || isLoadingQuote) && s.primaryBtnDisabled]}
              onPress={handlePayNow}
              disabled={isProcessing || isLoadingQuote}
              activeOpacity={0.85}
            >
              {isProcessing || isLoadingQuote ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <>
                  <FeatherIcons name="lock" size={18} color={colors.primaryForeground} />
                  <Text style={s.primaryBtnText}>
                    {!quote && !stripeAttempt ? "Retry Price Preview" : quote?.payableAmount === "0.00" ? "Confirm Free Booking" : checkoutError ? "Retry Payment" : "Pay Now"}
                    {totalDue != null ? ` · €${totalDue.toFixed(2)}` : ""}
                  </Text>
                </>
              )}
            </MotionPressable>
            <MotionPressable
              style={s.secondaryBtn}
              onPress={() => router.back()}
              activeOpacity={0.8}
              disabled={isProcessing}
            >
              <Text style={s.secondaryBtnText}>Back to Slots</Text>
            </MotionPressable>
          </>
        )}
      </View>
    </View>
  );
}

export default function BookSummaryScreen() {
  const [publishableKey, setPublishableKey] = useState<string | null>(null);

  useEffect(() => {
    getStripeConfig()
      .then((cfg) => {
        if (cfg.publishableKey) setPublishableKey(cfg.publishableKey);
      })
      .catch(() => {});
  }, []);

  return (
    <StripeProvider publishableKey={publishableKey ?? ""}>
      <BookSummaryInner />
    </StripeProvider>
  );
}
