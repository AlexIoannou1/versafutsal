import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ScrollView,
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

const FILTER_STATUSES = ["All", "PENDING", "CONFIRMED", "CANCELLED", "REFUNDED"];

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

function toDateOnlyStr(iso: string) {
  return iso.slice(0, 10);
}

export default function OwnerDashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const { data, isLoading, refetch, isRefetching } = useListOwnerBookings();
  const bookings = data?.bookings ?? [];

  // Filter/search state
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const venues = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    for (const b of bookings) {
      const v = b.venue as { id: string; name: string } | undefined;
      if (v && !seen.has(v.id)) {
        seen.add(v.id);
        result.push({ id: v.id, name: v.name });
      }
    }
    return result;
  }, [bookings]);

  const [selectedVenueId, setSelectedVenueId] = useState<string | "ALL">("ALL");

  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      const player = b.player as { name: string; email: string } | undefined;
      const venue = b.venue as { id: string; name: string } | undefined;
      const bDate = toDateOnlyStr(b.startAt);

      if (selectedStatus !== "All" && b.status !== selectedStatus) return false;
      if (selectedVenueId !== "ALL" && venue?.id !== selectedVenueId) return false;
      if (dateFrom && bDate < dateFrom) return false;
      if (dateTo && bDate > dateTo) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchPlayer = player?.name?.toLowerCase().includes(q) || player?.email?.toLowerCase().includes(q);
        const matchVenue = venue?.name?.toLowerCase().includes(q);
        if (!matchPlayer && !matchVenue) return false;
      }
      return true;
    });
  }, [bookings, selectedStatus, selectedVenueId, dateFrom, dateTo, search]);

  const hasActiveFilters =
    selectedStatus !== "All" ||
    selectedVenueId !== "ALL" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    search !== "";

  const upcoming = bookings.filter(
    (b) => new Date(b.startAt) >= new Date() && (b.status === "PENDING" || b.status === "CONFIRMED"),
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
      paddingBottom: 6,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sectionTitle: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    // Search & filter
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingBottom: 8,
      gap: 8,
    },
    searchInput: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 10,
      gap: 6,
    },
    searchText: {
      flex: 1,
      height: 38,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    filterBtn: {
      padding: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: hasActiveFilters ? colors.primary : colors.border,
      backgroundColor: hasActiveFilters ? colors.primary + "15" : colors.card,
    },
    filterPanel: {
      paddingHorizontal: 16,
      paddingBottom: 10,
      gap: 10,
    },
    filterLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 5,
    },
    chipRow: { flexDirection: "row", gap: 6 },
    chip: {
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    chipTextActive: { color: "#fff" },
    dateRow: { flexDirection: "row", gap: 8 },
    dateField: { flex: 1 },
    dateInput: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    clearBtn: { alignSelf: "flex-end" },
    clearBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.destructive },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginHorizontal: 16,
      marginVertical: 8,
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
    statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
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
    resultCount: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
  });

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const BookingCard = ({ item }: { item: (typeof bookings)[0] }) => {
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
    { key: "divider1", render: () => <View style={s.divider} /> },
    {
      key: "bookingsHeader",
      render: () => (
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Bookings</Text>
          {hasActiveFilters && (
            <Text style={s.resultCount}>{filtered.length} shown</Text>
          )}
        </View>
      ),
    },
    {
      key: "searchRow",
      render: () => (
        <View style={s.searchRow}>
          <View style={s.searchInput}>
            <Feather name="search" size={14} color={colors.mutedForeground} />
            <TextInput
              style={s.searchText}
              value={search}
              onChangeText={setSearch}
              placeholder="Player name, venue…"
              placeholderTextColor={colors.mutedForeground}
            />
            {search !== "" && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={s.filterBtn}
            onPress={() => setFiltersExpanded((v) => !v)}
          >
            <Feather
              name="sliders"
              size={16}
              color={hasActiveFilters ? colors.primary : colors.foreground}
            />
          </TouchableOpacity>
        </View>
      ),
    },
    ...(filtersExpanded
      ? [
          {
            key: "filterPanel",
            render: () => (
              <View style={s.filterPanel}>
                <View>
                  <Text style={s.filterLabel}>Status</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={s.chipRow}>
                      {FILTER_STATUSES.map((st) => (
                        <TouchableOpacity
                          key={st}
                          style={[s.chip, selectedStatus === st && s.chipActive]}
                          onPress={() => setSelectedStatus(st)}
                        >
                          <Text style={[s.chipText, selectedStatus === st && s.chipTextActive]}>
                            {st === "All" ? "All Statuses" : STATUS_LABELS[st] ?? st}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                {venues.length > 0 && (
                  <View>
                    <Text style={s.filterLabel}>Venue</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={s.chipRow}>
                        <TouchableOpacity
                          style={[s.chip, selectedVenueId === "ALL" && s.chipActive]}
                          onPress={() => setSelectedVenueId("ALL")}
                        >
                          <Text style={[s.chipText, selectedVenueId === "ALL" && s.chipTextActive]}>
                            All Venues
                          </Text>
                        </TouchableOpacity>
                        {venues.map((v) => (
                          <TouchableOpacity
                            key={v.id}
                            style={[s.chip, selectedVenueId === v.id && s.chipActive]}
                            onPress={() => setSelectedVenueId(v.id)}
                          >
                            <Text
                              style={[s.chipText, selectedVenueId === v.id && s.chipTextActive]}
                            >
                              {v.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}

                <View>
                  <Text style={s.filterLabel}>Date Range (YYYY-MM-DD)</Text>
                  <View style={s.dateRow}>
                    <View style={s.dateField}>
                      <TextInput
                        style={s.dateInput}
                        value={dateFrom}
                        onChangeText={setDateFrom}
                        placeholder="From"
                        placeholderTextColor={colors.mutedForeground}
                      />
                    </View>
                    <View style={s.dateField}>
                      <TextInput
                        style={s.dateInput}
                        value={dateTo}
                        onChangeText={setDateTo}
                        placeholder="To"
                        placeholderTextColor={colors.mutedForeground}
                      />
                    </View>
                  </View>
                </View>

                {hasActiveFilters && (
                  <TouchableOpacity
                    style={s.clearBtn}
                    onPress={() => {
                      setSelectedStatus("All");
                      setSelectedVenueId("ALL");
                      setDateFrom("");
                      setDateTo("");
                      setSearch("");
                    }}
                  >
                    <Text style={s.clearBtnText}>Clear all filters</Text>
                  </TouchableOpacity>
                )}
              </View>
            ),
          },
        ]
      : []),
    ...(filtered.length === 0
      ? [
          {
            key: "empty",
            render: () => (
              <View style={s.emptyWrap}>
                <Feather name="calendar" size={28} color={colors.mutedForeground} />
                <Text style={s.emptyText}>
                  {hasActiveFilters ? "No bookings match your filters" : "No bookings yet"}
                </Text>
              </View>
            ),
          },
        ]
      : filtered.map((b) => ({ key: `booking-${b.id}`, render: () => <BookingCard item={b} /> }))),
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
