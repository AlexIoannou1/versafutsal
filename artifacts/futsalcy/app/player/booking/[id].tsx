import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import {
  useGetPlayerBooking,
  useCancelBooking,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

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
    timeZone: "UTC",
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

function canCancelBooking(booking: {
  status: string;
  startAt: string;
  policySnapshot?: unknown;
}): { allowed: boolean; reason?: string } {
  // Players may only cancel CONFIRMED bookings (backend enforces the same rule)
  if (booking.status !== "CONFIRMED") {
    return {
      allowed: false,
      reason:
        booking.status === "PENDING"
          ? "Your booking is still pending confirmation. Only confirmed bookings can be cancelled — contact support if needed."
          : "Booking is already " + booking.status.toLowerCase(),
    };
  }
  const snapshot = (booking.policySnapshot ?? {}) as { cancellationWindowHours?: number };
  const windowHours = snapshot.cancellationWindowHours ?? 24;
  const hoursUntilStart = (new Date(booking.startAt).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntilStart < windowHours) {
    return {
      allowed: false,
      reason: `Cancellation is only allowed up to ${windowHours}h before the booking (${hoursUntilStart.toFixed(1)}h remaining).`,
    };
  }
  return { allowed: true };
}

export default function PlayerBookingDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const { data, isLoading, error } = useGetPlayerBooking(id!);
  const booking = data?.booking;

  const cancelMutation = useCancelBooking();

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
    dangerBtn: {
      borderRadius: 12,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "#EF4444",
    },
    dangerBtnText: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: "#EF4444",
    },
    policyNote: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      marginTop: -4,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    modalSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 24,
      paddingBottom: insets.bottom + 24,
      gap: 16,
    },
    modalTitle: {
      fontSize: 18,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    modalSubtitle: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      lineHeight: 20,
      marginTop: -8,
    },
    reasonInput: {
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      minHeight: 80,
      textAlignVertical: "top",
    },
    modalBtnRow: {
      flexDirection: "row",
      gap: 10,
    },
    modalCancelBtn: {
      flex: 1,
      height: 48,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalConfirmBtn: {
      flex: 1,
      height: 48,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#EF4444",
    },
    modalBtnText: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
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
  const pitch = booking.pitch as {
    name: string;
    type: string;
    size: string;
    slotDurationMinutes: number;
  } | undefined;

  const cancelCheck = canCancelBooking(booking);

  const snapshot = (booking.policySnapshot ?? {}) as {
    pricePerHour?: string | null;
    cancellationWindowHours?: number;
  };

  async function handleConfirmCancel() {
    if (!id) return;
    try {
      await cancelMutation.mutateAsync({
        id,
        data: { reason: cancelReason || undefined },
      });
      setShowCancelModal(false);
      await queryClient.invalidateQueries({ queryKey: ["getPlayerBooking", id] });
      await queryClient.invalidateQueries({ queryKey: ["listPlayerBookings"] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Failed to cancel booking.";
      Alert.alert("Cancellation Failed", msg);
    }
  }

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: "Booking", headerBackTitle: "Back" }} />

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.successBanner}>
          <View style={[s.successIcon, { backgroundColor: statusColor + "20" }]}>
            <FeatherIcons
              name={
                booking.status === "CANCELLED" || booking.status === "REFUNDED"
                  ? "x-circle"
                  : "check-circle"
              }
              size={36}
              color={statusColor}
            />
          </View>
          <Text style={s.successTitle}>{STATUS_TITLES[booking.status] ?? "Booking"}</Text>
          <Text style={s.bookingId}>#{booking.id.slice(0, 8).toUpperCase()}</Text>
        </View>

        <View style={s.statusWrap}>
          <View style={[s.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <FeatherIcons name="circle" size={8} color={statusColor} />
            <Text style={[s.statusText, { color: statusColor }]}>
              {STATUS_LABELS[booking.status] ?? booking.status}
            </Text>
          </View>
        </View>

        {booking.cancellationReason && (
          <View style={[s.card, { marginBottom: 12 }]}>
            <Text style={s.cardTitle}>Cancellation Reason</Text>
            <View style={[s.row, s.rowFirst]}>
              <Text style={[s.rowValue, { color: "#EF4444" }]}>{booking.cancellationReason}</Text>
            </View>
          </View>
        )}

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
          {snapshot.cancellationWindowHours != null && (
            <View style={s.row}>
              <Text style={s.rowLabel}>Cancel by</Text>
              <Text style={s.rowValue}>
                Up to {snapshot.cancellationWindowHours}h before start
              </Text>
            </View>
          )}
        </View>

        <View style={{
          marginHorizontal: 16,
          marginBottom: 12,
          backgroundColor: colors.primary + "12",
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.primary + "30",
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 10,
          padding: 12,
        }}>
          <FeatherIcons name="info" size={16} color={colors.primary} style={{ marginTop: 1 }} />
          <Text style={{
            flex: 1,
            fontSize: 13,
            fontFamily: "Inter_400Regular",
            color: colors.foreground,
            lineHeight: 19,
          }}>
            Need to make changes to this booking? Please contact the venue owner directly.
          </Text>
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

        {cancelCheck.allowed && (
          <TouchableOpacity
            style={s.dangerBtn}
            onPress={() => setShowCancelModal(true)}
            activeOpacity={0.8}
          >
            <Text style={s.dangerBtnText}>Cancel Booking</Text>
          </TouchableOpacity>
        )}

        {!cancelCheck.allowed &&
          (booking.status === "CONFIRMED" || booking.status === "PENDING") &&
          cancelCheck.reason && (
            <Text style={s.policyNote}>{cancelCheck.reason}</Text>
          )}

        <TouchableOpacity
          style={s.secondaryBtn}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Text style={s.secondaryBtnText}>Back</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showCancelModal} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Cancel Booking</Text>
            <Text style={s.modalSubtitle}>
              Are you sure? This cannot be undone.
              {snapshot.pricePerHour
                ? " A full refund will be processed to your original payment method."
                : ""}
            </Text>

            <TextInput
              style={s.reasonInput}
              placeholder="Reason for cancellation (optional)"
              placeholderTextColor={colors.mutedForeground}
              value={cancelReason}
              onChangeText={setCancelReason}
              multiline
            />

            <View style={s.modalBtnRow}>
              <TouchableOpacity
                style={s.modalCancelBtn}
                onPress={() => setShowCancelModal(false)}
                activeOpacity={0.8}
              >
                <Text style={[s.modalBtnText, { color: colors.foreground }]}>Keep</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.modalConfirmBtn}
                onPress={handleConfirmCancel}
                disabled={cancelMutation.isPending}
                activeOpacity={0.8}
              >
                {cancelMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[s.modalBtnText, { color: "#fff" }]}>Cancel Booking</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
