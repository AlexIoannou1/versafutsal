import React, { useState } from "react";
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
import { useGetVenue, useCreateBooking } from "@workspace/api-client-react";

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

  const [bookingError, setBookingError] = useState<string | null>(null);

  const decodedStartAt = startAt ? decodeURIComponent(String(startAt)) : "";
  const decodedEndAt = endAt ? decodeURIComponent(String(endAt)) : "";
  const decodedPitchName = pitchName ? decodeURIComponent(String(pitchName)) : "Pitch";

  const { data: venueData, isLoading: venueLoading } = useGetVenue(venueId!);
  const venue = venueData?.venue;

  const pitch = venue?.pitches?.find((p) => p.id === pitchId);
  const pricePerHour = pitch?.pricingRules?.[0]?.pricePerHour ?? null;
  const slotMinutes = parseInt(slotMins ?? "60", 10);
  const totalPrice = pricePerHour != null ? (parseFloat(pricePerHour) * slotMinutes) / 60 : null;

  const { mutate: createBooking, isPending: isBooking } = useCreateBooking();

  function handleConfirmBooking() {
    if (!pitchId || !decodedStartAt) return;
    setBookingError(null);
    createBooking(
      { data: { pitchId: pitchId!, startAt: decodedStartAt } },
      {
        onSuccess: (res) => {
          router.replace(`/player/booking/${res.booking.id}`);
        },
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            "Booking failed. Please try again.";
          setBookingError(msg);
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
      width: 72,
    },
    rowValue: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      flex: 1,
    },
    priceCard: {
      backgroundColor: colors.primary + "12",
      borderRadius: 12,
      marginHorizontal: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.primary + "40",
      padding: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    priceLabel: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
    priceSub: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    priceAmount: {
      fontSize: 24,
      fontFamily: "Inter_700Bold",
      color: colors.primary,
    },
    priceCurrency: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.primary,
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
      <Stack.Screen options={{ title: "Review Booking", headerBackTitle: "Back" }} />

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={s.heroBanner}>
          <View style={s.heroIcon}>
            <Feather name="calendar" size={28} color={colors.primary} />
          </View>
          <Text style={s.heroTitle}>Review your booking</Text>
          <Text style={s.heroSub}>Check the details below before confirming.</Text>
        </View>

        {/* Venue Card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Venue</Text>
          <View style={[s.row, s.rowFirst]}>
            <View style={s.rowIcon}>
              <Feather name="home" size={14} color={colors.mutedForeground} />
            </View>
            <Text style={s.rowLabel}>Name</Text>
            <Text style={s.rowValue} numberOfLines={2}>{venue?.name ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}>
              <Feather name="map-pin" size={14} color={colors.mutedForeground} />
            </View>
            <Text style={s.rowLabel}>District</Text>
            <Text style={s.rowValue}>{venue?.district ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}>
              <Feather name="navigation" size={14} color={colors.mutedForeground} />
            </View>
            <Text style={s.rowLabel}>Address</Text>
            <Text style={s.rowValue} numberOfLines={2}>{venue?.address ?? "—"}</Text>
          </View>
        </View>

        {/* Booking Details Card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Booking Details</Text>
          <View style={[s.row, s.rowFirst]}>
            <View style={s.rowIcon}>
              <Feather name="grid" size={14} color={colors.mutedForeground} />
            </View>
            <Text style={s.rowLabel}>Pitch</Text>
            <Text style={s.rowValue}>{decodedPitchName}</Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}>
              <Feather name="calendar" size={14} color={colors.mutedForeground} />
            </View>
            <Text style={s.rowLabel}>Date</Text>
            <Text style={s.rowValue}>{decodedStartAt ? formatFullDate(decodedStartAt) : "—"}</Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}>
              <Feather name="clock" size={14} color={colors.mutedForeground} />
            </View>
            <Text style={s.rowLabel}>Time</Text>
            <Text style={s.rowValue}>
              {decodedStartAt && decodedEndAt
                ? `${formatTime12(decodedStartAt)} – ${formatTime12(decodedEndAt)}`
                : "—"}
            </Text>
          </View>
          <View style={s.row}>
            <View style={s.rowIcon}>
              <Feather name="watch" size={14} color={colors.mutedForeground} />
            </View>
            <Text style={s.rowLabel}>Duration</Text>
            <Text style={s.rowValue}>{slotMinutes} minutes</Text>
          </View>
        </View>

        {/* Price Breakdown */}
        <View style={s.priceCard}>
          <View>
            <Text style={s.priceLabel}>Total to pay</Text>
            <Text style={s.priceSub}>
              {pricePerHour != null
                ? `€${pricePerHour}/hr × ${slotMinutes} min`
                : "Pricing unavailable"}
            </Text>
          </View>
          {totalPrice != null ? (
            <Text style={s.priceAmount}>
              <Text style={s.priceCurrency}>€</Text>
              {totalPrice.toFixed(2)}
            </Text>
          ) : (
            <Text style={[s.priceAmount, { fontSize: 16 }]}>—</Text>
          )}
        </View>

        {/* Payment disclaimer */}
        <View style={s.disclaimerCard}>
          <Feather name="info" size={14} color={colors.mutedForeground} style={{ marginTop: 2 }} />
          <Text style={s.disclaimerText}>
            Your booking will be reserved immediately. Payment is collected at the venue.
            Cancellations made within {venue?.cancellationWindowHours ?? 48} hours of the booking may be non-refundable.
          </Text>
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={s.bottomBar}>
        {bookingError && <Text style={s.errorText}>{bookingError}</Text>}
        <TouchableOpacity
          style={s.primaryBtn}
          onPress={handleConfirmBooking}
          disabled={isBooking}
          activeOpacity={0.85}
        >
          {isBooking ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="check-circle" size={20} color={colors.primaryForeground} />
              <Text style={s.primaryBtnText}>Confirm & Book Slot</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={s.secondaryBtn}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Text style={s.secondaryBtnText}>Back to Slots</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
