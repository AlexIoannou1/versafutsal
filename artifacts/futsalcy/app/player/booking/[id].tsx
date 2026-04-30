import React from "react";
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
import { useGetPlayerBooking } from "@workspace/api-client-react";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#F59E0B",
  CONFIRMED: "#00C851",
  CANCELLED: "#EF4444",
  REFUNDED: "#6366F1",
  NO_SHOW: "#6B7280",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending Confirmation",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  NO_SHOW: "No Show",
};

const STATUS_TITLES: Record<string, string> = {
  PENDING: "Booking Requested",
  CONFIRMED: "Booking Confirmed",
  CANCELLED: "Booking Cancelled",
  REFUNDED: "Booking Refunded",
  NO_SHOW: "No Show",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function PlayerBookingDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading, error } = useGetPlayerBooking(id!);
  const booking = data?.booking;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    scroll: { flex: 1 },
    errorText: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    successBanner: {
      alignItems: "center",
      padding: 32,
      paddingBottom: 16,
    },
    successIcon: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    successTitle: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 4,
    },
    bookingId: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    statusWrap: {
      alignItems: "center",
      marginBottom: 24,
    },
    statusBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    statusText: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
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
      fontSize: 12,
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
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    rowFirst: { borderTopWidth: 0 },
    rowLabel: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      width: 70,
    },
    rowValue: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      flex: 1,
    },
    bottomBar: {
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      padding: 16,
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 8 : 12),
      gap: 10,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryBtnText: {
      fontSize: 15,
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

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !booking) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>Booking not found.</Text>
      </View>
    );
  }

  const statusColor = STATUS_COLORS[booking.status] ?? colors.primary;
  const venue = booking.venue as { name: string; district: string; address: string } | undefined;
  const pitch = booking.pitch as { name: string; type: string; size: string; slotDurationMinutes: number } | undefined;

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: "Booking", headerBackTitle: "Back" }} />

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Success Banner */}
        <View style={s.successBanner}>
          <View style={[s.successIcon, { backgroundColor: statusColor + "20" }]}>
            <Feather name="check-circle" size={36} color={statusColor} />
          </View>
          <Text style={s.successTitle}>{STATUS_TITLES[booking.status] ?? "Booking"}</Text>
          <Text style={s.bookingId}>#{booking.id.slice(0, 8).toUpperCase()}</Text>
        </View>

        <View style={s.statusWrap}>
          <View style={[s.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <Feather name="circle" size={8} color={statusColor} />
            <Text style={[s.statusText, { color: statusColor }]}>
              {STATUS_LABELS[booking.status] ?? booking.status}
            </Text>
          </View>
        </View>

        {/* Venue Info */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Venue</Text>
          <View style={[s.row, s.rowFirst]}>
            <Text style={s.rowLabel}>Name</Text>
            <Text style={s.rowValue}>{venue?.name ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>District</Text>
            <Text style={s.rowValue}>{venue?.district ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>Address</Text>
            <Text style={s.rowValue}>{venue?.address ?? "—"}</Text>
          </View>
        </View>

        {/* Pitch Info */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Pitch</Text>
          <View style={[s.row, s.rowFirst]}>
            <Text style={s.rowLabel}>Name</Text>
            <Text style={s.rowValue}>{pitch?.name ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>Type</Text>
            <Text style={s.rowValue}>{pitch?.type ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>Size</Text>
            <Text style={s.rowValue}>{pitch?.size ?? "—"}</Text>
          </View>
        </View>

        {/* Booking Details */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Booking Details</Text>
          <View style={[s.row, s.rowFirst]}>
            <Text style={s.rowLabel}>Date</Text>
            <Text style={s.rowValue}>{formatDate(booking.startAt)}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>Time</Text>
            <Text style={s.rowValue}>
              {formatTime(booking.startAt)} – {formatTime(booking.endAt)}
            </Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>Booked</Text>
            <Text style={s.rowValue}>{formatDate(booking.createdAt)}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={s.bottomBar}>
        <TouchableOpacity
          style={s.primaryBtn}
          onPress={() => router.replace("/(player)/bookings")}
          activeOpacity={0.8}
        >
          <Text style={s.primaryBtnText}>View All Bookings</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.secondaryBtn}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Text style={s.secondaryBtnText}>Back to Venue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
