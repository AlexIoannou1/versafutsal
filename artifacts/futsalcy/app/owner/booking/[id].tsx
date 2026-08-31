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
  useGetOwnerBooking,
  useCancelBooking,
  useGetOwnerBookingAudit,
} from "@workspace/api-client-react";
import type { AuditLogEntry } from "@workspace/api-client-react";
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

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const ROLE_LABELS: Record<string, string> = {
  PLAYER: "Player",
  VENUE_OWNER: "Owner",
  ADMIN: "Admin",
};

function getAuditActionMeta(action: string, previousValue: Record<string, unknown> | null, newValue: Record<string, unknown> | null) {
  switch (action) {
    case "MANUAL_BOOKING_CREATED":
      return { icon: "plus-circle" as const, color: "#00C851", label: "Walk-in booking created" };
    case "BOOKING_CREATED":
      return { icon: "check-circle" as const, color: "#6366F1", label: "Booking created" };
    case "BOOKING_EDITED": {
      const parts: string[] = [];
      const prev = previousValue ?? {};
      if (prev.startAt) parts.push("time");
      if (prev.pitchId) parts.push("pitch");
      if (prev.guestName || prev.guestPhone) parts.push("guest details");
      const detail = parts.length > 0 ? ` — ${parts.join(", ")} changed` : "";
      return { icon: "edit-2" as const, color: "#F59E0B", label: `Booking edited${detail}` };
    }
    case "BOOKING_CANCELLED":
      return { icon: "x-circle" as const, color: "#EF4444", label: "Booking cancelled" };
    case "BOOKING_CONFIRMED":
      return { icon: "check-circle" as const, color: "#00C851", label: "Booking confirmed" };
    case "BOOKING_REFUNDED":
      return { icon: "rotate-ccw" as const, color: "#6366F1", label: "Booking refunded" };
    case "REFUND_ISSUED":
      return { icon: "rotate-ccw" as const, color: "#6366F1", label: "Refund issued" };
    case "BOOKING_STATUS_CHANGED": {
      const from = String(previousValue?.status ?? "");
      const to = String(newValue?.status ?? "");
      return { icon: "refresh-cw" as const, color: "#F59E0B", label: `Status changed${from && to ? `: ${from} → ${to}` : ""}` };
    }
    case "PAYMENT_STATUS_CHANGED": {
      const from = String(previousValue?.paymentStatus ?? previousValue?.status ?? "");
      const to = String(newValue?.paymentStatus ?? newValue?.status ?? "");
      return { icon: "credit-card" as const, color: "#6366F1", label: `Payment status changed${from && to ? `: ${from} → ${to}` : ""}` };
    }
    case "ADMIN_MODIFIED_BOOKING":
      return { icon: "shield" as const, color: "#9333EA", label: "Admin modified booking" };
    case "ADMIN_REFUND_ISSUED":
      return { icon: "shield" as const, color: "#9333EA", label: "Admin refund issued" };
    case "NOTIFICATION_SENT":
      return { icon: "bell" as const, color: "#6B7280", label: "Notification sent" };
    default:
      return {
        icon: "clock" as const,
        color: "#6B7280",
        label: action.toLowerCase().replace(/_/g, " "),
      };
  }
}

function renderValueDiff(
  previousValue: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null,
  muted: string,
  foreground: string,
): React.ReactNode {
  if (!previousValue && !newValue) return null;
  const keys = new Set([
    ...Object.keys(previousValue ?? {}),
    ...Object.keys(newValue ?? {}),
  ]);
  if (keys.size === 0) return null;
  const rows: React.ReactNode[] = [];
  for (const key of keys) {
    const from = previousValue?.[key];
    const to = newValue?.[key];
    if (from === to) continue;
    const label = key.replace(/([A-Z])/g, " $1").toLowerCase();
    rows.push(
      <Text key={key} style={{ fontSize: 11, fontFamily: "PlusJakartaSans_400Regular", color: muted, marginTop: 2 }}>
        <Text style={{ color: foreground, fontFamily: "PlusJakartaSans_500Medium" }}>{label}: </Text>
        {from !== undefined ? (
          <Text style={{ color: "#EF4444" }}>{String(from)}</Text>
        ) : null}
        {from !== undefined && to !== undefined ? " → " : ""}
        {to !== undefined ? (
          <Text style={{ color: "#00C851" }}>{String(to)}</Text>
        ) : null}
      </Text>
    );
  }
  return rows.length > 0 ? <>{rows}</> : null;
}

type AuditEntryRowProps = {
  entry: AuditLogEntry;
  isFirst: boolean;
  borderColor: string;
  foreground: string;
  muted: string;
};

function AuditEntryRow({ entry, isFirst, borderColor, foreground, muted }: AuditEntryRowProps) {
  const { icon, color, label } = getAuditActionMeta(entry.action, entry.previousValue ?? null, entry.newValue ?? null);
  const roleLabel = entry.actorRole ? (ROLE_LABELS[entry.actorRole] ?? entry.actorRole) : null;
  const actorDisplay = entry.actorName
    ? `${entry.actorName}${roleLabel ? ` · ${roleLabel}` : ""}`
    : roleLabel ?? null;
  const diffNode = renderValueDiff(entry.previousValue ?? null, entry.newValue ?? null, muted, foreground);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: borderColor,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          backgroundColor: color + "20",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 1,
        }}
      >
        <FeatherIcons name={icon} size={13} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontFamily: "PlusJakartaSans_500Medium", color: foreground }}>
          {label}
        </Text>
        {actorDisplay && (
          <Text style={{ fontSize: 11, fontFamily: "PlusJakartaSans_400Regular", color: muted, marginTop: 1 }}>
            {actorDisplay}
          </Text>
        )}
        {diffNode}
        {entry.notes && (
          <Text style={{ fontSize: 11, fontFamily: "PlusJakartaSans_400Regular", color: muted, marginTop: 2, fontStyle: "italic" }}>
            "{entry.notes}"
          </Text>
        )}
        <Text style={{ fontSize: 11, fontFamily: "PlusJakartaSans_400Regular", color: muted, marginTop: 2 }}>
          {timeAgo(entry.createdAt)}
        </Text>
      </View>
    </View>
  );
}

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

  const { data: auditData, isLoading: auditLoading } = useGetOwnerBookingAudit(id ?? "");
  const auditEntries = auditData?.entries ?? [];

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    scroll: { flex: 1 },
    errorText: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      marginBottom: 4,
    },
    bookingId: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_600SemiBold",
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
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    rowFirst: { borderTopWidth: 0 },
    rowLabel: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      width: 70,
    },
    rowValue: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_500Medium",
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
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.foreground,
    },
    editBtn: {
      borderRadius: 12,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
    },
    editBtnText: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primaryForeground,
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
      fontFamily: "PlusJakartaSans_600SemiBold",
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
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
    },
    modalSubtitle: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_600SemiBold",
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
  const payment = (booking as {
    payment?: {
      amount: string;
      feeAmount: string;
      feePercent: string;
      feeWaived: boolean;
      status: string;
    } | null;
  }).payment ?? null;
  const parseFiniteAmount = (value: string): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const paymentTotal = payment ? parseFiniteAmount(payment.amount) : null;
  const paymentFee = payment ? parseFiniteAmount(payment.feeAmount) : null;
  const paymentFeePercent = payment ? parseFiniteAmount(payment.feePercent) : null;
  const ownerPayout =
    paymentTotal != null && paymentFee != null ? paymentTotal - paymentFee : null;
  const guestName = (booking as { guestName?: string | null }).guestName ?? null;
  const guestPhone = (booking as { guestPhone?: string | null }).guestPhone ?? null;

  const windowHours =
    (booking.policySnapshot as { cancellationWindowHours?: number } | undefined)
      ?.cancellationWindowHours ?? 24;
  const hoursUntilStart =
    (new Date(booking.startAt).getTime() - Date.now()) / (1000 * 60 * 60);
  const withinWindow = hoursUntilStart >= windowHours;
  const isUpcoming = new Date(booking.startAt) > new Date();
  // Manual bookings have no payment — owners can cancel them at any time.
  const canCancel = isManual
    ? booking.status === "CONFIRMED" || booking.status === "PENDING"
    : (booking.status === "CONFIRMED" || booking.status === "PENDING") && withinWindow;
  const canEdit = isUpcoming && (booking.status === "CONFIRMED" || booking.status === "PENDING");

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
            <FeatherIcons name="calendar" size={30} color={statusColor} />
          </View>
          <Text style={s.bannerTitle}>Booking #{booking.id.slice(0, 8).toUpperCase()}</Text>
          <Text style={s.bookingId}>
            {formatDate(booking.startAt)} · {formatTime(booking.startAt)} – {formatTime(booking.endAt)}
          </Text>
        </View>

        <View style={s.statusRow}>
          <View style={[s.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <FeatherIcons name="circle" size={8} color={statusColor} />
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
                <Text style={{ fontSize: 10, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primary }}>MANUAL</Text>
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

        {payment && paymentTotal != null && paymentFee != null && ownerPayout != null && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Price Summary</Text>
            <View style={[s.row, s.rowFirst]}>
              <Text style={[s.rowLabel, { width: 130 }]}>Booking price</Text>
              <Text style={[s.rowValue, { textAlign: "right" }]}>€{paymentTotal.toFixed(2)}</Text>
            </View>
            <View style={s.row}>
              <Text style={[s.rowLabel, { width: 130 }]}>
                Platform fee{payment.feeWaived || paymentFeePercent == null ? " (waived)" : ` (${paymentFeePercent.toFixed(2).replace(/\.00$/, "")}%)`}
              </Text>
              <Text style={[s.rowValue, { textAlign: "right" }]}>−€{paymentFee.toFixed(2)}</Text>
            </View>
            <View style={s.row}>
              <Text style={[s.rowLabel, { width: 130, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground }]}>
                Your payout
              </Text>
              <Text style={[s.rowValue, { textAlign: "right", fontFamily: "PlusJakartaSans_700Bold", color: colors.primary }]}>
                €{ownerPayout.toFixed(2)}
              </Text>
            </View>
          </View>
        )}

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

        {/* Activity / Audit Trail */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Activity</Text>
          {auditLoading ? (
            <View style={[s.row, s.rowFirst, { justifyContent: "center" }]}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : auditEntries.length === 0 ? (
            <View style={[s.row, s.rowFirst]}>
              <Text style={[s.rowValue, { color: colors.mutedForeground, fontFamily: "PlusJakartaSans_400Regular" }]}>
                No activity recorded yet
              </Text>
            </View>
          ) : (
            auditEntries.map((entry, i) => (
              <AuditEntryRow
                key={entry.id}
                entry={entry}
                isFirst={i === 0}
                borderColor={colors.border}
                foreground={colors.foreground}
                muted={colors.mutedForeground}
              />
            ))
          )}
        </View>
      </ScrollView>

      <View style={s.bottomBar}>
        {canEdit && (
          <TouchableOpacity
            style={s.editBtn}
            onPress={() => router.push({ pathname: "/owner/booking-edit", params: { bookingId: id } })}
            activeOpacity={0.8}
          >
            <Text style={s.editBtnText}>Edit Booking</Text>
          </TouchableOpacity>
        )}
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
            maxLength={500}
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
