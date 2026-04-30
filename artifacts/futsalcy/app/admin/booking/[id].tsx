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
import { useAdminGetBooking, useAdminRefundBooking } from "@workspace/api-client-react";
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

export default function AdminBookingDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundReason, setRefundReason] = useState("");

  const { data, isLoading, error } = useAdminGetBooking(id!);
  const booking = data?.booking;

  const refundMutation = useAdminRefundBooking();

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
    adminBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: "#9333EA20",
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      marginTop: 8,
    },
    adminBadgeText: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: "#9333EA",
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
    refundBtn: {
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#9333EA",
    },
    refundBtnText: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: "#fff",
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
    alreadyNote: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
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
    modalTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
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
      backgroundColor: "#9333EA",
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

  // Admin can refund any booking with a refundable payment — including CANCELLED ones
  // (e.g. owner cancelled outside window, auto-refund not issued). Only block REFUNDED.
  const canRefund = booking.status !== "REFUNDED";

  async function handleConfirmRefund() {
    if (!id) return;
    try {
      await refundMutation.mutateAsync({
        id,
        data: { reason: refundReason || undefined },
      });
      setShowRefundModal(false);
      await queryClient.invalidateQueries({ queryKey: ["adminGetBooking", id] });
      await queryClient.invalidateQueries({ queryKey: ["adminListBookings"] });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Failed to process refund.";
      Alert.alert("Refund Failed", msg);
    }
  }

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: "Booking (Admin)", headerBackTitle: "Back" }} />

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.banner}>
          <View style={[s.bannerIcon, { backgroundColor: statusColor + "20" }]}>
            <Feather name="calendar" size={30} color={statusColor} />
          </View>
          <Text style={s.bannerTitle}>Booking #{booking.id.slice(0, 8).toUpperCase()}</Text>
          <Text style={s.bookingId}>
            {formatDate(booking.startAt)} · {formatTime(booking.startAt)} – {formatTime(booking.endAt)}
          </Text>
          <View style={s.adminBadge}>
            <Feather name="shield" size={10} color="#9333EA" />
            <Text style={s.adminBadgeText}>Admin View</Text>
          </View>
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

        <View style={s.card}>
          <Text style={s.cardTitle}>Venue & Pitch</Text>
          <View style={[s.row, s.rowFirst]}>
            <Text style={s.rowLabel}>Venue</Text>
            <Text style={s.rowValue}>{venue?.name ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>District</Text>
            <Text style={s.rowValue}>{venue?.district ?? "—"}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.rowLabel}>Pitch</Text>
            <Text style={s.rowValue}>{pitch?.name ?? "—"} · {pitch?.type ?? "—"}</Text>
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
          <View style={s.row}>
            <Text style={s.rowLabel}>Booking ID</Text>
            <Text style={s.rowValue}>{booking.id}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={s.bottomBar}>
        {canRefund && (
          <TouchableOpacity
            style={s.refundBtn}
            onPress={() => setShowRefundModal(true)}
            activeOpacity={0.8}
          >
            <Text style={s.refundBtnText}>Issue Manual Refund</Text>
          </TouchableOpacity>
        )}

        {!canRefund && (
          <Text style={s.alreadyNote}>
            This booking has already been refunded.
          </Text>
        )}

        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={s.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showRefundModal} animationType="slide" transparent>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <View style={s.modalTitleRow}>
              <Feather name="shield" size={18} color="#9333EA" />
              <Text style={s.modalTitle}>Issue Manual Refund</Text>
            </View>
            <Text style={s.modalSubtitle}>
              This will force-refund the booking regardless of cancellation policy. The booking will be
              marked as refunded and a record will be added to the admin audit log.
            </Text>

            <TextInput
              style={s.reasonInput}
              placeholder="Admin reason for refund (required)"
              placeholderTextColor={colors.mutedForeground}
              value={refundReason}
              onChangeText={setRefundReason}
              multiline
            />

            <View style={s.modalBtnRow}>
              <TouchableOpacity
                style={s.modalCancelBtn}
                onPress={() => setShowRefundModal(false)}
                activeOpacity={0.8}
              >
                <Text style={[s.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.modalConfirmBtn}
                onPress={handleConfirmRefund}
                disabled={refundMutation.isPending || !refundReason.trim()}
                activeOpacity={0.8}
              >
                {refundMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[s.modalBtnText, { color: "#fff" }]}>Confirm Refund</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
