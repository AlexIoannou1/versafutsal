import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import { useAdminListBookings } from "@workspace/api-client-react";

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

const STATUSES = ["All", "PENDING", "CONFIRMED", "CANCELLED", "REFUNDED", "NO_SHOW"];

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTimeRange(startIso: string, endIso: string) {
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${fmt(new Date(startIso))} – ${fmt(new Date(endIso))}`;
}

export default function AdminBookingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Only treat input as a valid date when it matches YYYY-MM-DD exactly, preventing
  // RangeError crashes from intermediate typing states like "2026-0" or "2026-06-".
  function safeIso(value: string, endOfDay = false): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    if (endOfDay) d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (selectedStatus !== "All") p.status = selectedStatus;
    const fromIso = safeIso(dateFrom);
    if (fromIso) p.from = fromIso;
    const toIso = safeIso(dateTo, true);
    if (toIso) p.to = toIso;
    return p;
  }, [selectedStatus, dateFrom, dateTo]);

  const { data, isLoading, refetch, isRefetching } = useAdminListBookings(params);
  const bookings = data?.bookings ?? [];

  // Derive unique venues and players for explicit filter dropdowns
  const venues = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    for (const b of bookings) {
      const v = b.venue as { id?: string; name?: string } | undefined;
      if (v?.id && !seen.has(v.id)) {
        seen.add(v.id);
        result.push({ id: v.id, name: v.name ?? v.id });
      }
    }
    return result;
  }, [bookings]);

  const [selectedVenueId, setSelectedVenueId] = useState<string | "ALL">("ALL");
  const [selectedPlayerSearch, setSelectedPlayerSearch] = useState("");

  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      const venue = b.venue as { id?: string; name?: string; district?: string } | undefined;
      const player = b.player as { name?: string; email?: string } | undefined;

      // Venue chip filter
      if (selectedVenueId !== "ALL" && venue?.id !== selectedVenueId) return false;

      // Venue text search — evaluated independently from player search (AND semantics)
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchVenue =
          venue?.name?.toLowerCase().includes(q) ||
          (venue?.district as string | undefined)?.toLowerCase().includes(q);
        if (!matchVenue) return false;
      }

      // Player search — evaluated independently (AND semantics)
      if (selectedPlayerSearch.trim()) {
        const q = selectedPlayerSearch.toLowerCase();
        const matchPlayer =
          player?.name?.toLowerCase().includes(q) ||
          player?.email?.toLowerCase().includes(q);
        if (!matchPlayer) return false;
      }

      return true;
    });
  }, [bookings, selectedVenueId, search, selectedPlayerSearch]);

  const hasActiveFilters =
    selectedStatus !== "All" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    selectedVenueId !== "ALL" ||
    search !== "" ||
    selectedPlayerSearch !== "";

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    searchInput: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      gap: 8,
    },
    searchText: {
      flex: 1,
      height: 42,
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    filterToggleBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: hasActiveFilters ? colors.primary + "15" : colors.card,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: hasActiveFilters ? colors.primary : colors.border,
    },
    filterPanel: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      paddingTop: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    filterLabel: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    chipRow: { flexDirection: "row", gap: 6 },
    chip: {
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    chipTextActive: { color: "#fff" },
    dateRow: { flexDirection: "row", gap: 8 },
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
    playerSearchRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      gap: 6,
    },
    playerSearchText: {
      flex: 1,
      height: 36,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    clearBtn: {
      alignSelf: "flex-end",
    },
    clearBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.destructive },
    resultRow: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    resultText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
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
    cardTitle: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      flex: 1,
      marginRight: 8,
    },
    statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
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
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
      gap: 8,
    },
    emptyText: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
    emptySub: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
  });

  return (
    <View style={s.container}>
      {/* Search row + filter toggle */}
      <View style={s.searchRow}>
        <View style={s.searchInput}>
          <FeatherIcons name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={s.searchText}
            value={search}
            onChangeText={setSearch}
            placeholder="Venue, district…"
            placeholderTextColor={colors.mutedForeground}
          />
          {search !== "" && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <FeatherIcons name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={s.filterToggleBtn}
          onPress={() => setFiltersExpanded((v) => !v)}
        >
          <FeatherIcons name="sliders" size={16} color={hasActiveFilters ? colors.primary : colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* Filter Panel */}
      {filtersExpanded && (
        <View style={s.filterPanel}>
          {/* Status filter */}
          <View>
            <Text style={s.filterLabel}>Status</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={s.chipRow}>
                {STATUSES.map((st) => (
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

          {/* Venue filter — derived from actual data */}
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
                      <Text style={[s.chipText, selectedVenueId === v.id && s.chipTextActive]}>
                        {v.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Player search filter */}
          <View>
            <Text style={s.filterLabel}>Player Name / Email</Text>
            <View style={s.playerSearchRow}>
              <FeatherIcons name="user" size={14} color={colors.mutedForeground} />
              <TextInput
                style={s.playerSearchText}
                value={selectedPlayerSearch}
                onChangeText={setSelectedPlayerSearch}
                placeholder="Search player…"
                placeholderTextColor={colors.mutedForeground}
              />
              {selectedPlayerSearch !== "" && (
                <TouchableOpacity onPress={() => setSelectedPlayerSearch("")}>
                  <FeatherIcons name="x" size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Date range */}
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
                setSelectedPlayerSearch("");
              }}
            >
              <Text style={s.clearBtnText}>Clear all filters</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Result count */}
      <View style={s.resultRow}>
        <Text style={s.resultText}>
          {isLoading ? "Loading…" : `${filtered.length} booking${filtered.length !== 1 ? "s" : ""}`}
        </Text>
      </View>

      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.emptyWrap}>
          <FeatherIcons name="calendar" size={32} color={colors.mutedForeground} />
          <Text style={s.emptyText}>No bookings found</Text>
          <Text style={s.emptySub}>
            {hasActiveFilters ? "Try adjusting your filters." : "No bookings have been made yet."}
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
            const player = item.player as { name: string; email: string } | undefined;
            const pitch = item.pitch as { name: string } | undefined;
            return (
              <TouchableOpacity
                style={s.card}
                onPress={() => router.push(`/admin/booking/${item.id}`)}
                activeOpacity={0.7}
              >
                <View style={s.cardHeader}>
                  <Text style={s.cardTitle} numberOfLines={1}>
                    {venue?.name ?? "Venue"}{venue?.district ? ` · ${venue.district}` : ""}
                  </Text>
                  <View style={[s.statusBadge, { backgroundColor: statusColor + "20" }]}>
                    <Text style={[s.statusText, { color: statusColor }]}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </Text>
                  </View>
                </View>
                <View style={s.metaRow}>
                  <FeatherIcons name="user" size={12} color={colors.mutedForeground} />
                  <Text style={s.metaText}>
                    {player?.name ?? player?.email ?? "Player"}
                  </Text>
                </View>
                <View style={s.metaRow}>
                  <FeatherIcons name="grid" size={12} color={colors.mutedForeground} />
                  <Text style={s.metaText}>{pitch?.name ?? "Pitch"}</Text>
                </View>
                <View style={s.metaRow}>
                  <FeatherIcons name="calendar" size={12} color={colors.mutedForeground} />
                  <Text style={s.metaText}>
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
