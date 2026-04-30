import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useListPlayerBookings } from "@workspace/api-client-react";

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

function formatDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatTimeRange(startIso: string, endIso: string) {
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fmt(new Date(startIso))} – ${fmt(new Date(endIso))}`;
}

export default function PlayerBookingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useListPlayerBookings();
  const bookings = data?.bookings ?? [];

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    emptyIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: 18,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 8,
    },
    emptySub: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
    },
    list: { padding: 16, paddingBottom: insets.bottom + 24 },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    venueName: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      flex: 1,
      marginRight: 8,
    },
    statusBadge: {
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    statusText: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
    },
    pitchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: 4,
    },
    pitchText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    timeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    timeText: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    chevron: {
      position: "absolute",
      right: 14,
      top: "50%",
    },
  });

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (bookings.length === 0) {
    return (
      <View style={s.center}>
        <View style={s.emptyIcon}>
          <Feather name="calendar" size={28} color={colors.mutedForeground} />
        </View>
        <Text style={s.emptyTitle}>No bookings yet</Text>
        <Text style={s.emptySub}>
          Browse venues and book a pitch to see your bookings here.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => {
          const statusColor = STATUS_COLORS[item.status] ?? colors.mutedForeground;
          const venue = item.venue as { name: string } | undefined;
          const pitch = item.pitch as { name: string } | undefined;
          return (
            <TouchableOpacity
              style={s.card}
              onPress={() => router.push(`/player/booking/${item.id}`)}
              activeOpacity={0.7}
            >
              <View style={s.cardHeader}>
                <Text style={s.venueName} numberOfLines={1}>
                  {venue?.name ?? "Venue"}
                </Text>
                <View style={[s.statusBadge, { backgroundColor: statusColor + "20" }]}>
                  <Text style={[s.statusText, { color: statusColor }]}>
                    {STATUS_LABELS[item.status] ?? item.status}
                  </Text>
                </View>
              </View>
              <View style={s.pitchRow}>
                <Feather name="grid" size={13} color={colors.mutedForeground} />
                <Text style={s.pitchText}>{pitch?.name ?? "Pitch"}</Text>
              </View>
              <View style={s.timeRow}>
                <Feather name="calendar" size={13} color={colors.mutedForeground} />
                <Text style={s.timeText}>
                  {formatDateShort(item.startAt)} · {formatTimeRange(item.startAt, item.endAt)}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}
