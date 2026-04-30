import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useListOwnerBookings } from "@workspace/api-client-react";

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
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatTimeRange(startIso: string, endIso: string) {
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fmt(new Date(startIso))} – ${fmt(new Date(endIso))}`;
}

export default function OwnerDashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const { data, isLoading, refetch, isRefetching } = useListOwnerBookings();
  const bookings = data?.bookings ?? [];

  const upcoming = bookings.filter(
    (b) => new Date(b.startAt) >= new Date() && (b.status === "PENDING" || b.status === "CONFIRMED"),
  );
  const past = bookings.filter(
    (b) => new Date(b.startAt) < new Date() || (b.status !== "PENDING" && b.status !== "CONFIRMED"),
  );

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    greeting: {
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 12,
    },
    greetingText: {
      fontSize: 20,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    greetingSub: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    statsRow: {
      flexDirection: "row",
      gap: 10,
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    statCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 10,
      padding: 12,
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    statNum: {
      fontSize: 24,
      fontFamily: "Inter_700Bold",
      color: colors.primary,
    },
    statLabel: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
      textAlign: "center",
    },
    sectionHeader: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 8,
    },
    sectionTitle: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    list: { paddingHorizontal: 16, paddingBottom: insets.bottom + 100 },
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
      marginBottom: 4,
    },
    playerName: {
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
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 3,
    },
    metaText: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    emptyWrap: {
      alignItems: "center",
      paddingVertical: 32,
      gap: 8,
    },
    emptyText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginHorizontal: 16,
      marginVertical: 8,
    },
  });

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const BookingCard = ({
    item,
  }: {
    item: (typeof bookings)[0];
  }) => {
    const statusColor = STATUS_COLORS[item.status] ?? colors.mutedForeground;
    const player = item.player as { name: string; email: string } | undefined;
    const pitch = item.pitch as { name: string } | undefined;
    const venue = item.venue as { name: string } | undefined;
    return (
      <TouchableOpacity
        style={s.card}
        onPress={() => router.push(`/owner/booking/${item.id}`)}
        activeOpacity={0.7}
      >
        <View style={s.cardHeader}>
          <Text style={s.playerName} numberOfLines={1}>
            {player?.name ?? player?.email ?? "Player"}
          </Text>
          <View style={[s.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <Text style={[s.statusText, { color: statusColor }]}>
              {STATUS_LABELS[item.status] ?? item.status}
            </Text>
          </View>
        </View>
        <View style={s.metaRow}>
          <Feather name="grid" size={12} color={colors.mutedForeground} />
          <Text style={s.metaText}>
            {venue?.name ?? ""} · {pitch?.name ?? ""}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Feather name="calendar" size={12} color={colors.mutedForeground} />
          <Text style={s.metaText}>
            {formatDateShort(item.startAt)} · {formatTimeRange(item.startAt, item.endAt)}
          </Text>
        </View>
        <View style={[s.metaRow, { justifyContent: "flex-end", marginTop: 4 }]}>
          <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
        </View>
      </TouchableOpacity>
    );
  };

  const allSections = [
    {
      key: "greeting",
      render: () => (
        <View style={s.greeting}>
          <Text style={s.greetingText}>Hi, {user?.name ?? "Owner"}</Text>
          <Text style={s.greetingSub}>Your venue bookings at a glance.</Text>
        </View>
      ),
    },
    {
      key: "stats",
      render: () => (
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statNum}>{upcoming.length}</Text>
            <Text style={s.statLabel}>Upcoming</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNum}>{bookings.filter((b) => b.status === "CONFIRMED").length}</Text>
            <Text style={s.statLabel}>Confirmed</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNum}>{bookings.length}</Text>
            <Text style={s.statLabel}>Total</Text>
          </View>
        </View>
      ),
    },
    {
      key: "upcomingHeader",
      render: () => (
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Upcoming</Text>
        </View>
      ),
    },
    ...upcoming.map((b) => ({ key: `upcoming-${b.id}`, render: () => <BookingCard item={b} /> })),
    ...(upcoming.length === 0
      ? [
          {
            key: "noUpcoming",
            render: () => (
              <View style={s.emptyWrap}>
                <Feather name="calendar" size={28} color={colors.mutedForeground} />
                <Text style={s.emptyText}>No upcoming bookings</Text>
              </View>
            ),
          },
        ]
      : []),
    { key: "divider", render: () => <View style={s.divider} /> },
    {
      key: "pastHeader",
      render: () => (
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Past</Text>
        </View>
      ),
    },
    ...past.slice(0, 20).map((b) => ({ key: `past-${b.id}`, render: () => <BookingCard item={b} /> })),
    ...(past.length === 0
      ? [
          {
            key: "noPast",
            render: () => (
              <View style={s.emptyWrap}>
                <Text style={s.emptyText}>No past bookings yet</Text>
              </View>
            ),
          },
        ]
      : []),
  ];

  return (
    <View style={s.container}>
      <FlatList
        data={allSections}
        keyExtractor={(item) => item.key}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => item.render()}
      />
    </View>
  );
}
