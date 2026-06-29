import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  TextInput,
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

const AREAS = ["All Areas", "Nicosia", "Limassol", "Larnaca", "Paphos", "Famagusta"];

function formatDateShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatTimeRange(startIso: string, endIso: string) {
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fmt(new Date(startIso))} – ${fmt(new Date(endIso))}`;
}

function toDateOnlyStr(iso: string) {
  return iso.slice(0, 10);
}

export default function PlayerBookingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useListPlayerBookings();
  const bookings = data?.bookings ?? [];

  // Filter state
  const [selectedArea, setSelectedArea] = useState("All Areas");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      const venue = b.venue as { name: string; district: string } | undefined;
      const bDate = toDateOnlyStr(b.startAt);

      if (selectedArea !== "All Areas" && venue?.district !== selectedArea) return false;
      if (dateFrom && bDate < dateFrom) return false;
      if (dateTo && bDate > dateTo) return false;
      return true;
    });
  }, [bookings, selectedArea, dateFrom, dateTo]);

  const hasActiveFilters =
    selectedArea !== "All Areas" || dateFrom !== "" || dateTo !== "";

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    filterBar: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    filterRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 8,
    },
    filterToggleBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: hasActiveFilters ? colors.primary + "15" : colors.card,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderWidth: 1,
      borderColor: hasActiveFilters ? colors.primary : colors.border,
    },
    filterToggleText: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: hasActiveFilters ? colors.primary : colors.foreground,
    },
    filterCount: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    resultCount: {
      flex: 1,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "right",
    },
    filterPanel: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      gap: 12,
    },
    filterLabel: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      marginBottom: 4,
    },
    areaScroll: {
      flexDirection: "row",
      gap: 6,
    },
    areaChip: {
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    areaChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    areaChipText: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    areaChipTextActive: { color: "#fff" },
    dateRow: {
      flexDirection: "row",
      gap: 8,
    },
    dateField: { flex: 1 },
    dateInput: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    clearBtn: {
      alignSelf: "flex-end",
      paddingVertical: 4,
    },
    clearBtnText: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.destructive,
    },
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
    statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
    pitchRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
    pitchText: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    timeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    timeText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
  });

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      {/* Filter Bar */}
      <View style={s.filterBar}>
        <View style={s.filterRow}>
          <TouchableOpacity
            style={s.filterToggleBtn}
            onPress={() => setFiltersExpanded((v) => !v)}
          >
            <Feather name="filter" size={14} color={hasActiveFilters ? colors.primary : colors.foreground} />
            <Text style={s.filterToggleText}>Filters</Text>
            {hasActiveFilters && (
              <Text style={s.filterCount}>
                {(selectedArea !== "All Areas" ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)}
              </Text>
            )}
          </TouchableOpacity>
          <Text style={s.resultCount}>
            {filtered.length} booking{filtered.length !== 1 ? "s" : ""}
          </Text>
        </View>

        {filtersExpanded && (
          <View style={s.filterPanel}>
            {/* Area filter */}
            <View>
              <Text style={s.filterLabel}>AREA</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.areaScroll}>
                  {AREAS.map((area) => (
                    <TouchableOpacity
                      key={area}
                      style={[s.areaChip, selectedArea === area && s.areaChipActive]}
                      onPress={() => setSelectedArea(area)}
                    >
                      <Text style={[s.areaChipText, selectedArea === area && s.areaChipTextActive]}>
                        {area}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* Date range filter */}
            <View>
              <Text style={s.filterLabel}>DATE RANGE (YYYY-MM-DD)</Text>
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
                  setSelectedArea("All Areas");
                  setDateFrom("");
                  setDateTo("");
                }}
              >
                <Text style={s.clearBtnText}>Clear all filters</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {filtered.length === 0 ? (
        <View style={s.center}>
          <View style={s.emptyIcon}>
            <Feather name="calendar" size={28} color={colors.mutedForeground} />
          </View>
          <Text style={s.emptyTitle}>
            {hasActiveFilters ? "No matches" : "No bookings yet"}
          </Text>
          <Text style={s.emptySub}>
            {hasActiveFilters
              ? "Try adjusting your filters."
              : "Browse venues and book a pitch to see your bookings here."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
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
            const venue = item.venue as { name: string; district: string } | undefined;
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
                    {venue?.district ? ` · ${venue.district}` : ""}
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
      )}
    </View>
  );
}
