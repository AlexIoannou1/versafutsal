import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Platform,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
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

function formatPickerDate(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type Booking = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  venue?: unknown;
  pitch?: unknown;
};

export default function PlayerBookingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useListPlayerBookings();
  const bookings = (data?.bookings ?? []) as Booking[];

  const areas = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = ["All Areas"];
    for (const b of bookings) {
      const venue = b.venue as { district?: string } | undefined;
      if (venue?.district && !seen.has(venue.district)) {
        seen.add(venue.district);
        result.push(venue.district);
      }
    }
    return result;
  }, [bookings]);

  const [selectedArea, setSelectedArea] = useState("All Areas");
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [pastExpanded, setPastExpanded] = useState(false);

  // iOS picker visibility — Android auto-dismisses
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const effectiveArea = areas.includes(selectedArea) ? selectedArea : "All Areas";

  const filtered = useMemo(() => {
    return bookings.filter((b) => {
      const venue = b.venue as { district?: string } | undefined;
      const start = new Date(b.startAt);

      if (effectiveArea !== "All Areas" && venue?.district !== effectiveArea) return false;
      if (dateFrom) {
        const from = new Date(dateFrom);
        from.setHours(0, 0, 0, 0);
        if (start < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (start > to) return false;
      }
      return true;
    });
  }, [bookings, effectiveArea, dateFrom, dateTo]);

  // ── Split into upcoming (asc) and past (desc most-recent first) ──────────
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const upcomingBookings = useMemo(() =>
    filtered
      .filter((b) => new Date(b.startAt) >= today)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [filtered, today]);

  const pastBookings = useMemo(() =>
    filtered
      .filter((b) => new Date(b.startAt) < today)
      .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime()),
    [filtered, today]);

  const hasUpcoming = upcomingBookings.length > 0;
  const hasPast = pastBookings.length > 0;

  const hasActiveFilters = effectiveArea !== "All Areas" || dateFrom !== null || dateTo !== null;
  const activeFilterCount =
    (effectiveArea !== "All Areas" ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);

  function handleFromChange(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setShowFromPicker(false);
    if (event.type === "set" && date) setDateFrom(date);
  }

  function handleToChange(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") setShowToPicker(false);
    if (event.type === "set" && date) setDateTo(date);
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    filterBar: { borderBottomWidth: 1, borderBottomColor: colors.border },
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
    filterPanel: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
    filterLabel: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      marginBottom: 4,
    },
    areaScroll: { flexDirection: "row", gap: 6 },
    areaChip: {
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    areaChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    areaChipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    areaChipTextActive: { color: "#fff" },
    dateRow: { flexDirection: "row", gap: 8 },
    dateField: { flex: 1 },
    dateBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    dateBtnText: {
      flex: 1,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    dateBtnPlaceholder: { color: colors.mutedForeground },
    iosDoneRow: { alignItems: "flex-end", paddingTop: 4 },
    iosDoneBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.primary,
      borderRadius: 8,
    },
    iosDoneBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
    clearBtn: { alignSelf: "flex-end", paddingVertical: 4 },
    clearBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.destructive },
    sectionHeader: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 6,
      backgroundColor: colors.background,
    },
    sectionHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    sectionHeaderText: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    sectionHeaderCount: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    sectionHeaderChevron: {
      marginLeft: "auto" as never,
    },
    list: { paddingBottom: insets.bottom + 100 },
    cardWrap: { paddingHorizontal: 16, paddingBottom: 10 },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 14,
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
    emptyIcon: {
      width: 64, height: 64, borderRadius: 32,
      backgroundColor: colors.muted,
      alignItems: "center", justifyContent: "center",
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: 18, fontFamily: "Inter_600SemiBold",
      color: colors.foreground, marginBottom: 8,
    },
    emptySub: {
      fontSize: 14, fontFamily: "Inter_400Regular",
      color: colors.mutedForeground, textAlign: "center", lineHeight: 20,
    },
  });

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const totalCount = filtered.length;

  return (
    <View style={s.container}>
      {/* Filter Bar */}
      <View style={s.filterBar}>
        <View style={s.filterRow}>
          <TouchableOpacity
            style={s.filterToggleBtn}
            onPress={() => setFiltersExpanded((v) => !v)}
          >
            <FeatherIcons name="filter" size={14} color={hasActiveFilters ? colors.primary : colors.foreground} />
            <Text style={s.filterToggleText}>Filters</Text>
            {activeFilterCount > 0 && (
              <Text style={s.filterCount}>{activeFilterCount}</Text>
            )}
          </TouchableOpacity>
          <Text style={s.resultCount}>
            {totalCount} booking{totalCount !== 1 ? "s" : ""}
          </Text>
        </View>

        {filtersExpanded && (
          <View style={s.filterPanel}>
            {/* Area filter */}
            {areas.length > 1 && (
              <View>
                <Text style={s.filterLabel}>AREA</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={s.areaScroll}>
                    {areas.map((area) => (
                      <TouchableOpacity
                        key={area}
                        style={[s.areaChip, effectiveArea === area && s.areaChipActive]}
                        onPress={() => setSelectedArea(area)}
                      >
                        <Text style={[s.areaChipText, effectiveArea === area && s.areaChipTextActive]}>
                          {area}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {/* Date range filter */}
            <View>
              <Text style={s.filterLabel}>DATE RANGE</Text>
              <View style={s.dateRow}>
                {/* From */}
                <View style={s.dateField}>
                  <TouchableOpacity
                    style={s.dateBtn}
                    onPress={() => {
                      setShowToPicker(false);
                      setShowFromPicker((v) => !v);
                    }}
                  >
                    <FeatherIcons name="calendar" size={14} color={colors.mutedForeground} />
                    <Text style={[s.dateBtnText, !dateFrom && s.dateBtnPlaceholder]}>
                      {dateFrom ? formatPickerDate(dateFrom) : "From"}
                    </Text>
                    {dateFrom && (
                      <TouchableOpacity onPress={() => { setDateFrom(null); setShowFromPicker(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <FeatherIcons name="x" size={13} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                </View>

                {/* To */}
                <View style={s.dateField}>
                  <TouchableOpacity
                    style={s.dateBtn}
                    onPress={() => {
                      setShowFromPicker(false);
                      setShowToPicker((v) => !v);
                    }}
                  >
                    <FeatherIcons name="calendar" size={14} color={colors.mutedForeground} />
                    <Text style={[s.dateBtnText, !dateTo && s.dateBtnPlaceholder]}>
                      {dateTo ? formatPickerDate(dateTo) : "To"}
                    </Text>
                    {dateTo && (
                      <TouchableOpacity onPress={() => { setDateTo(null); setShowToPicker(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <FeatherIcons name="x" size={13} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Date picker — always rendered on iOS (inline), shown as dialog on Android */}
              {showFromPicker && (
                <View>
                  <DateTimePicker
                    value={dateFrom ?? new Date()}
                    mode="date"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    maximumDate={dateTo ?? undefined}
                    onChange={handleFromChange}
                    themeVariant="light"
                  />
                  {Platform.OS === "ios" && (
                    <View style={s.iosDoneRow}>
                      <TouchableOpacity style={s.iosDoneBtn} onPress={() => setShowFromPicker(false)}>
                        <Text style={s.iosDoneBtnText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
              {showToPicker && (
                <View>
                  <DateTimePicker
                    value={dateTo ?? new Date()}
                    mode="date"
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    minimumDate={dateFrom ?? undefined}
                    onChange={handleToChange}
                    themeVariant="light"
                  />
                  {Platform.OS === "ios" && (
                    <View style={s.iosDoneRow}>
                      <TouchableOpacity style={s.iosDoneBtn} onPress={() => setShowToPicker(false)}>
                        <Text style={s.iosDoneBtnText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            </View>

            {hasActiveFilters && (
              <TouchableOpacity
                style={s.clearBtn}
                onPress={() => {
                  setSelectedArea("All Areas");
                  setDateFrom(null);
                  setDateTo(null);
                  setShowFromPicker(false);
                  setShowToPicker(false);
                }}
              >
                <Text style={s.clearBtnText}>Clear all filters</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* List */}
      {!hasUpcoming && !hasPast ? (
        <View style={s.center}>
          <View style={s.emptyIcon}>
            <FeatherIcons name="calendar" size={28} color={colors.mutedForeground} />
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
        <ScrollView
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
        >
          {/* Upcoming section */}
          {hasUpcoming && (
            <>
              <View style={s.sectionHeader}>
                <Text style={s.sectionHeaderText}>Upcoming</Text>
              </View>
              {upcomingBookings.map((item) => {
                const statusColor = STATUS_COLORS[item.status] ?? colors.mutedForeground;
                const venue = item.venue as { name: string; district: string } | undefined;
                const pitch = item.pitch as { name: string } | undefined;
                return (
                  <View key={item.id} style={s.cardWrap}>
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
                        <FeatherIcons name="grid" size={13} color={colors.mutedForeground} />
                        <Text style={s.pitchText}>{pitch?.name ?? "Pitch"}</Text>
                      </View>
                      <View style={s.timeRow}>
                        <FeatherIcons name="calendar" size={13} color={colors.mutedForeground} />
                        <Text style={s.timeText}>
                          {formatDateShort(item.startAt)} · {formatTimeRange(item.startAt, item.endAt)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </>
          )}

          {/* Past section */}
          {hasPast && (
            <>
              <TouchableOpacity
                style={s.sectionHeader}
                onPress={() => setPastExpanded((v) => !v)}
                activeOpacity={0.7}
              >
                <View style={s.sectionHeaderRow}>
                  <Text style={s.sectionHeaderText}>Past</Text>
                  <Text style={s.sectionHeaderCount}>({pastBookings.length})</Text>
                  <View style={s.sectionHeaderChevron}>
                    <FeatherIcons
                      name={pastExpanded ? "chevron-up" : "chevron-down"}
                      size={15}
                      color={colors.mutedForeground}
                    />
                  </View>
                </View>
              </TouchableOpacity>
              {pastExpanded && pastBookings.map((item) => {
                const statusColor = STATUS_COLORS[item.status] ?? colors.mutedForeground;
                const venue = item.venue as { name: string; district: string } | undefined;
                const pitch = item.pitch as { name: string } | undefined;
                return (
                  <View key={item.id} style={s.cardWrap}>
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
                        <FeatherIcons name="grid" size={13} color={colors.mutedForeground} />
                        <Text style={s.pitchText}>{pitch?.name ?? "Pitch"}</Text>
                      </View>
                      <View style={s.timeRow}>
                        <FeatherIcons name="calendar" size={13} color={colors.mutedForeground} />
                        <Text style={s.timeText}>
                          {formatDateShort(item.startAt)} · {formatTimeRange(item.startAt, item.endAt)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
