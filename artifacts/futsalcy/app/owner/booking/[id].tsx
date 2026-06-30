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
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import {
  useGetOwnerBooking,
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
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
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

export default function OwnerBookingDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const { data, isLoading, error } = useGetOwnerBooking(id!);
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
    banner: {
      alignItems: "center",
      padding: 28,
      paddingBottom: 16,
    },
    bannerIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 12,
    },
    bannerTitle: {
      fontSize: 20,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 4,
    },
    bookingId: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    statusRow: {
      alignItems: "center",
      marginBottom: 20,
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
    backBtn: {
      borderRadius: 12,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    backBtnText: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
    dangerBtn: {
      borderRadius: 12,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "#EF4444",
    },
    dangerBtnText: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: "#EF4444",
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
    modalKeepBtn: {
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
  const player = booking.player as { name: string; email: string } | undefined;
  const venue = booking.venue as { name: string; district: string; address: string } | undefined;
  const pitch = booking.pitch as { name: string; type: string; size: string } | undefined;
  const isManual = !!(booking as { guestName?: string | null }).guestName;
  const guestName = (booking as { guestName?: string | null }).guestName ?? null;
  const guestPhone = (booking as { guestPhone?: string | null }).guestPhone ?? null;

  const windowHours =
    (booking.policySnapshot as { cancellationWindowHours?: number } | undefined)
      ?.cancellationWindowHours ?? 24;
  const hoursUntilStart =
    (new Date(booking.startAt).getTime() - Date.now()) / (1000 * 60 * 60);
  const withinWindow = hoursUntilStart >= windowHours;
  // Manual bookings have no payment — owners can cancel them at any time.
  const canCancel = isManual
    ? booking.status === "CONFIRMED" || booking.status === "PENDING"
    : (booking.status === "CONFIRMED" || booking.status === "PENDING") && withinWindow;

  async function handleConfirmCancel() {
    if (!id) return;
    try {
      await cancelMutation.mutateAsync({
        id,
        data: { reason: cancelReason || undefined },
      });
      setShowCancelModal(false);
      await queryClient.invalidateQueries({ queryKey: ["getOwnerBooking", id] });
      await queryClient.invalidateQueries({ queryKey: ["listOwnerBookings"] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Failed to cancel booking.";
      Alert.alert("Cancellation Failed", msg);
    }
  }

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: "Booking Detail", headerBackTitle: "Back" }} />

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.banner}>
          <View style={[s.bannerIcon, { backgroundColor: statusColor + "20" }]}>
            <Feather name="calendar" size={30} color={statusColor} />
          </View>
          <Text style={s.bannerTitle}>Booking #{booking.id.slice(0, 8).toUpperCase()}</Text>
          <Text style={s.bookingId}>
            {formatDate(booking.startAt)} · {formatTime(booking.startAt)} – {formatTime(booking.endAt)}
          </Text>
        </View>

        <View style={s.statusRow}>
          <View style={[s.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <Feather name="circle" size={8} color={statusColor} />
            <Text style={[s.statusText, { color: statusColor }]}>
              {STATUS_LABELS[booking.status] ?? booking.status}
            </Text>
          </View>
        </View>

        {booking.cancellationReason && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Cancellation Reason</Text>
            <View style={[s.row, s.rowFirst]}>
              <Text style={[s.rowValue, { color: "#EF4444" }]}>{booking.cancellationReason}</Text>
            </View>
          </View>
        )}

        {isManual ? (
          <View style={s.card}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
              <Text style={[s.cardTitle, { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 }]}>Walk-in / Phone Booking</Text>
              <View style={{ backgroundColor: colors.primary + "18", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.primary }}>MANUAL</Text>
              </View>
            </View>
            <View style={[s.row, s.rowFirst]}>
              <Text style={s.rowLabel}>Name</Text>
              <Text style={s.rowValue}>{guestName ?? "—"}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>Phone</Text>
              <Text style={s.rowValue}>{guestPhone ?? "—"}</Text>
            </View>
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.cardTitle}>Player</Text>
            <View style={[s.row, s.rowFirst]}>
              <Text style={s.rowLabel}>Name</Text>
              <Text style={s.rowValue}>{player?.name ?? "—"}</Text>
            </View>
            <View style={s.row}>
              <Text style={s.rowLabel}>Email</Text>
              <Text style={s.rowValue}>{player?.email ?? "—"}</Text>
            </View>
          </View>
        )}

        <View style={s.card}>
          <Text style={s.cardTitle}>Venue & Pitch</Text>
          <View style={[s.row, s.rowFirst]}>
            <Text style={s.rowLabel}>Venue</Text>
            <Text style={s.rowValue}>{venue?.name ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>Pitch</Text>
            <Text style={s.rowValue}>{pitch?.name ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>Type</Text>
            <Text style={s.rowValue}>{pitch?.type ?? "—"} · {pitch?.size ?? "—"}</Text>
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
            <Text style={s.rowLabel}>Created</Text>
            <Text style={s.rowValue}>{formatDate(booking.createdAt)}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={s.bottomBar}>
        {canCancel && (
          <TouchableOpacity
            style={s.dangerBtn}
            onPress={() => setShowCancelModal(true)}
            activeOpacity={0.8}
          >
            <Text style={s.dangerBtnText}>Cancel Booking</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showCancelModal} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Cancel Booking</Text>
            <Text style={s.modalSubtitle}>
              {isManual
                ? "This is a walk-in booking with no payment on file. Cancelling it will free the slot immediately."
                : "Cancelling as venue owner. A refund will be issued automatically if payment was collected."}
            </Text>

            <TextInput
              style={s.reasonInput}
              placeholder={isManual ? "Reason for cancellation (optional)" : "Reason for cancellation (required)"}
              placeholderTextColor={colors.mutedForeground}
              value={cancelReason}
              onChangeText={setCancelReason}
              multiline
            />

            <View style={s.modalBtnRow}>
              <TouchableOpacity
                style={s.modalKeepBtn}
                onPress={() => setShowCancelModal(false)}
                activeOpacity={0.8}
              >
                <Text style={[s.modalBtnText, { color: colors.foreground }]}>Keep</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.modalConfirmBtn}
                onPress={handleConfirmCancel}
                disabled={cancelMutation.isPending || (!isManual && !cancelReason.trim())}
                activeOpacity={0.8}
              >
                {cancelMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[s.modalBtnText, { color: "#fff" }]}>Confirm Cancel</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
