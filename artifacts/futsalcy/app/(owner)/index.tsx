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
  Modal,
  Platform,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
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
    timeZone: "UTC",
  });
}

function formatTimeRange(startIso: string, endIso: string) {
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${fmt(new Date(startIso))} – ${fmt(new Date(endIso))}`;
}

function formatPickerDate(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ─── Standalone picker button (no inline component definition) ───────────────
type PickerFieldProps = {
  label: string;
  value: Date | null;
  onClear: () => void;
  onOpen: () => void;
  primaryColor: string;
  mutedColor: string;
  foregroundColor: string;
  borderColor: string;
  cardColor: string;
};

function PickerButton({
  label, value, onClear, onOpen,
  primaryColor, mutedColor, foregroundColor, borderColor, cardColor,
}: PickerFieldProps) {
  const active = value !== null;
  return (
    <TouchableOpacity
      onPress={onOpen}
      activeOpacity={0.7}
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: active ? primaryColor + "10" : cardColor,
        borderWidth: 1,
        borderColor: active ? primaryColor : borderColor,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
      }}
    >
      <FeatherIcons name="calendar" size={12} color={active ? primaryColor : mutedColor} />
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          fontSize: 12,
          fontFamily: active ? "PlusJakartaSans_500Medium" : "PlusJakartaSans_400Regular",
          color: active ? foregroundColor : mutedColor,
        }}
      >
        {value ? formatPickerDate(value) : label}
      </Text>
      {active && (
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation(); onClear(); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <FeatherIcons name="x" size={12} color={primaryColor} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

export default function OwnerDashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const { data, isLoading, refetch, isRefetching } = useListOwnerBookings();
  const bookings = data?.bookings ?? [];

  const todayStart = useMemo(() => startOfDay(new Date()), []);

  // Filter / search state
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [activePicker, setActivePicker] = useState<"from" | "to" | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [selectedVenueId, setSelectedVenueId] = useState<string | "ALL">("ALL");

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

  // Base: today + upcoming only (no past)
  const currentAndUpcoming = useMemo(
    () => bookings.filter((b) => new Date(b.startAt) >= todayStart),
    [bookings, todayStart],
  );

  const filtered = useMemo(() => {
    return currentAndUpcoming.filter((b) => {
      const player = b.player as { name: string; email: string } | undefined;
      const venue = b.venue as { id: string; name: string } | undefined;
      const bDay = startOfDay(new Date(b.startAt));

      if (selectedStatus !== "All" && b.status !== selectedStatus) return false;
      if (selectedVenueId !== "ALL" && venue?.id !== selectedVenueId) return false;
      if (dateFrom && bDay < startOfDay(dateFrom)) return false;
      if (dateTo && bDay > startOfDay(dateTo)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const mp = player?.name?.toLowerCase().includes(q) || player?.email?.toLowerCase().includes(q);
        const mv = venue?.name?.toLowerCase().includes(q);
        if (!mp && !mv) return false;
      }
      return true;
    });
  }, [currentAndUpcoming, selectedStatus, selectedVenueId, dateFrom, dateTo, search]);

  // Split filtered into today vs upcoming (future)
  const todayBookings = useMemo(
    () => filtered.filter((b) => isSameDay(new Date(b.startAt), todayStart))
      .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [filtered, todayStart],
  );

  const upcomingBookings = useMemo(
    () => filtered.filter((b) => !isSameDay(new Date(b.startAt), todayStart))
      .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [filtered, todayStart],
  );

  const hasActiveFilters =
    selectedStatus !== "All" ||
    selectedVenueId !== "ALL" ||
    dateFrom !== null ||
    dateTo !== null ||
    search !== "";

  const upcoming = bookings.filter(
    (b) => new Date(b.startAt) >= new Date() && (b.status === "PENDING" || b.status === "CONFIRMED"),
  );

  const clearAllFilters = () => {
    setSelectedStatus("All");
    setSelectedVenueId("ALL");
    setDateFrom(null);
    setDateTo(null);
    setSearch("");
  };

  const handlePickerChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") {
      setActivePicker(null);
    }
    if (!selected) return;
    if (activePicker === "from") {
      setDateFrom(selected);
      if (dateTo && selected > dateTo) setDateTo(null);
    } else if (activePicker === "to") {
      setDateTo(selected);
    }
  };

  const pickerValue =
    activePicker === "from" ? (dateFrom ?? todayStart) :
    activePicker === "to" ? (dateTo ?? dateFrom ?? todayStart) :
    todayStart;

  const pickerMinDate =
    activePicker === "to" ? (dateFrom ?? todayStart) : todayStart;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    greeting: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12 },
    greetingText: { fontSize: 20, fontFamily: "PlusJakartaSans_700Bold", color: colors.foreground },
    greetingSub: { fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground, marginTop: 2 },
    statsRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 16 },
    statCard: {
      flex: 1, backgroundColor: colors.card, borderRadius: 10, padding: 12,
      alignItems: "center", borderWidth: 1, borderColor: colors.border,
    },
    statNum: { fontSize: 24, fontFamily: "PlusJakartaSans_700Bold", color: colors.primary },
    statLabel: { fontSize: 11, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground, marginTop: 2, textAlign: "center" },
    sectionHeader: {
      paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6,
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    },
    sectionTitle: {
      fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground,
      textTransform: "uppercase", letterSpacing: 0.6,
    },
    searchRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
    searchInput: {
      flex: 1, flexDirection: "row", alignItems: "center",
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
      borderRadius: 10, paddingHorizontal: 10, gap: 6,
    },
    searchText: { flex: 1, height: 38, fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: colors.foreground },
    filterBtn: {
      padding: 8, borderRadius: 8, borderWidth: 1,
      borderColor: hasActiveFilters ? colors.primary : colors.border,
      backgroundColor: hasActiveFilters ? colors.primary + "15" : colors.card,
    },
    filterPanel: { paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
    filterLabel: {
      fontSize: 11, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.mutedForeground,
      textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5,
    },
    chipRow: { flexDirection: "row", gap: 6 },
    chip: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontSize: 11, fontFamily: "PlusJakartaSans_500Medium", color: colors.mutedForeground },
    chipTextActive: { color: "#fff" },
    dateRow: { flexDirection: "row", gap: 8 },
    clearBtn: { alignSelf: "flex-end" },
    clearBtnText: { fontSize: 12, fontFamily: "PlusJakartaSans_500Medium", color: colors.destructive },
    divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 16, marginVertical: 8 },
    sectionDivider: {
      flexDirection: "row", alignItems: "center", gap: 10,
      marginHorizontal: 16, marginTop: 4, marginBottom: 12,
    },
    sectionDividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
    sectionDividerText: { fontSize: 11, fontFamily: "PlusJakartaSans_500Medium", color: colors.mutedForeground },
    subHeader: {
      paddingHorizontal: 16, paddingBottom: 6, paddingTop: 4,
      fontSize: 11, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.mutedForeground,
      textTransform: "uppercase", letterSpacing: 0.6,
    },
    list: { paddingHorizontal: 16, paddingBottom: insets.bottom + 100 },
    card: {
      backgroundColor: colors.card, borderRadius: 12, padding: 14,
      marginBottom: 10, borderWidth: 1, borderColor: colors.border,
    },
    cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 },
    playerName: { fontSize: 15, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground, flex: 1, marginRight: 8 },
    statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    statusText: { fontSize: 11, fontFamily: "PlusJakartaSans_600SemiBold" },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
    metaText: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground },
    emptyWrap: { alignItems: "center", paddingVertical: 24, gap: 8 },
    emptyText: { fontSize: 14, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground },
    resultCount: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground },
    // iOS picker modal
    pickerOverlay: {
      flex: 1, backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "flex-end",
    },
    pickerSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
      paddingBottom: insets.bottom + 8,
    },
    pickerSheetHeader: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    pickerSheetLabel: { fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground },
    pickerDoneBtn: { fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primary },
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
    const guestName = (item as { guestName?: string | null }).guestName ?? null;
    const isManual = !!guestName;
    return (
      <TouchableOpacity
        style={s.card}
        onPress={() => router.push(`/owner/booking/${item.id}`)}
        activeOpacity={0.7}
      >
        <View style={s.cardHeader}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, marginRight: 8, minWidth: 0 }}>
            <Text style={[s.playerName, { flex: 1, marginRight: 0, minWidth: 0 }]} numberOfLines={1}>
              {isManual ? guestName : (player?.name ?? player?.email ?? "Player")}
            </Text>
            {isManual && (
              <View style={{ backgroundColor: colors.primary + "18", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 }}>
                <Text style={{ fontSize: 10, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primary }}>MANUAL</Text>
              </View>
            )}
          </View>
          <View style={[s.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <Text style={[s.statusText, { color: statusColor }]}>
              {STATUS_LABELS[item.status] ?? item.status}
            </Text>
          </View>
        </View>
        <View style={s.metaRow}>
          <FeatherIcons name="grid" size={12} color={colors.mutedForeground} />
          <Text style={s.metaText}>{venue?.name ?? ""} · {pitch?.name ?? ""}</Text>
        </View>
        <View style={s.metaRow}>
          <FeatherIcons name="calendar" size={12} color={colors.mutedForeground} />
          <Text style={s.metaText}>{formatDateShort(item.startAt)} · {formatTimeRange(item.startAt, item.endAt)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // Build section list items
  const allSections: { key: string; render: () => React.ReactElement | null }[] = [
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
          {hasActiveFilters && <Text style={s.resultCount}>{filtered.length} shown</Text>}
        </View>
      ),
    },
    {
      key: "searchRow",
      render: () => (
        <View style={s.searchRow}>
          <View style={s.searchInput}>
            <FeatherIcons name="search" size={14} color={colors.mutedForeground} />
            <TextInput
              style={s.searchText}
              value={search}
              onChangeText={setSearch}
              placeholder="Player name, venue…"
              placeholderTextColor={colors.mutedForeground}
            />
            {search !== "" && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <FeatherIcons name="x" size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={s.filterBtn}
            onPress={() => setFiltersExpanded((v) => !v)}
          >
            <FeatherIcons name="sliders" size={16} color={hasActiveFilters ? colors.primary : colors.foreground} />
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
                {/* Status chips */}
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

                {/* Venue chips */}
                {venues.length > 0 && (
                  <View>
                    <Text style={s.filterLabel}>Venue</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={s.chipRow}>
                        <TouchableOpacity
                          style={[s.chip, selectedVenueId === "ALL" && s.chipActive]}
                          onPress={() => setSelectedVenueId("ALL")}
                        >
                          <Text style={[s.chipText, selectedVenueId === "ALL" && s.chipTextActive]}>All Venues</Text>
                        </TouchableOpacity>
                        {venues.map((v) => (
                          <TouchableOpacity
                            key={v.id}
                            style={[s.chip, selectedVenueId === v.id && s.chipActive]}
                            onPress={() => setSelectedVenueId(v.id)}
                          >
                            <Text style={[s.chipText, selectedVenueId === v.id && s.chipTextActive]}>{v.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}

                {/* Date range */}
                <View>
                  <Text style={s.filterLabel}>Date Range</Text>
                  <View style={s.dateRow}>
                    <PickerButton
                      label="From"
                      value={dateFrom}
                      onClear={() => setDateFrom(null)}
                      onOpen={() => setActivePicker("from")}
                      primaryColor={colors.primary}
                      mutedColor={colors.mutedForeground}
                      foregroundColor={colors.foreground}
                      borderColor={colors.border}
                      cardColor={colors.card}
                    />
                    <PickerButton
                      label="To"
                      value={dateTo}
                      onClear={() => setDateTo(null)}
                      onOpen={() => setActivePicker("to")}
                      primaryColor={colors.primary}
                      mutedColor={colors.mutedForeground}
                      foregroundColor={colors.foreground}
                      borderColor={colors.border}
                      cardColor={colors.card}
                    />
                  </View>
                </View>

                {hasActiveFilters && (
                  <TouchableOpacity style={s.clearBtn} onPress={clearAllFilters}>
                    <Text style={s.clearBtnText}>Clear all filters</Text>
                  </TouchableOpacity>
                )}
              </View>
            ),
          },
        ]
      : []),
  ];

  // ── Booking rows: today first, then upcoming ──────────────────────────────
  if (filtered.length === 0) {
    allSections.push({
      key: "empty",
      render: () => (
        <View style={s.emptyWrap}>
          <FeatherIcons name="calendar" size={28} color={colors.mutedForeground} />
          <Text style={s.emptyText}>
            {hasActiveFilters ? "No bookings match your filters" : "No upcoming bookings"}
          </Text>
        </View>
      ),
    });
  } else {
    // Today section
    allSections.push({
      key: "todayHeader",
      render: () => <Text style={s.subHeader}>Today</Text>,
    });
    if (todayBookings.length === 0) {
      allSections.push({
        key: "todayEmpty",
        render: () => (
          <View style={[s.emptyWrap, { paddingVertical: 12 }]}>
            <Text style={s.emptyText}>No bookings today</Text>
          </View>
        ),
      });
    } else {
      todayBookings.forEach((b) =>
        allSections.push({ key: `booking-today-${b.id}`, render: () => <BookingCard item={b} /> }),
      );
    }

    // Divider
    allSections.push({
      key: "sectionDivider",
      render: () => (
        <View style={s.sectionDivider}>
          <View style={s.sectionDividerLine} />
          <Text style={s.sectionDividerText}>Upcoming</Text>
          <View style={s.sectionDividerLine} />
        </View>
      ),
    });

    // Upcoming section
    if (upcomingBookings.length === 0) {
      allSections.push({
        key: "upcomingEmpty",
        render: () => (
          <View style={[s.emptyWrap, { paddingVertical: 12 }]}>
            <Text style={s.emptyText}>No upcoming bookings</Text>
          </View>
        ),
      });
    } else {
      upcomingBookings.forEach((b) =>
        allSections.push({ key: `booking-upcoming-${b.id}`, render: () => <BookingCard item={b} /> }),
      );
    }
  }

  return (
    <View style={s.container}>
      <FlatList
        data={allSections}
        keyExtractor={(item) => item.key}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        renderItem={({ item }) => item.render()}
      />

      {/* Floating Action Button: New Booking */}
      <TouchableOpacity
        onPress={() => router.push("/owner/booking-new")}
        activeOpacity={0.85}
        style={{
          position: "absolute",
          bottom: insets.bottom + 90,
          right: 20,
          backgroundColor: colors.primary,
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 6,
          elevation: 6,
        }}
      >
        <FeatherIcons name="plus" size={26} color={colors.primaryForeground} />
      </TouchableOpacity>

      {/* Android: DateTimePicker renders as a native dialog when visible */}
      {Platform.OS === "android" && activePicker !== null && (
        <DateTimePicker
          value={pickerValue}
          mode="date"
          display="default"
          minimumDate={pickerMinDate}
          onChange={handlePickerChange}
        />
      )}

      {/* iOS: bottom sheet modal */}
      {Platform.OS === "ios" && (
        <Modal
          visible={activePicker !== null}
          transparent
          animationType="slide"
          onRequestClose={() => setActivePicker(null)}
        >
          <TouchableOpacity
            style={s.pickerOverlay}
            activeOpacity={1}
            onPress={() => setActivePicker(null)}
          >
            <View style={s.pickerSheet}>
              <View style={s.pickerSheetHeader}>
                <Text style={s.pickerSheetLabel}>
                  {activePicker === "from" ? "From date" : "To date"}
                </Text>
                <TouchableOpacity onPress={() => setActivePicker(null)}>
                  <Text style={s.pickerDoneBtn}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={pickerValue}
                mode="date"
                display="spinner"
                minimumDate={pickerMinDate}
                onChange={handlePickerChange}
                style={{ width: "100%" }}
              />
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}
