import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import { MotionPressable, SkeletonBlock } from "@/components/Motion";
import { useListOwnerBookings } from "@workspace/api-client-react";
import type { BookingStatus } from "@workspace/api-client-react";

// ─── Constants ────────────────────────────────────────────────────────────────

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

const PERIOD_OPTIONS = ["All", "Upcoming", "Today", "Past"] as const;
type Period = (typeof PERIOD_OPTIONS)[number];

const STATUS_OPTIONS = ["All", "CONFIRMED", "PENDING", "CANCELLED", "NO_SHOW", "REFUNDED"] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Skeleton Loader ──────────────────────────────────────────────────────────

function SkeletonCard({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 12,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: colors.border,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <SkeletonBlock style={{ height: 14, width: "45%", borderRadius: 6 }} />
        <SkeletonBlock style={{ height: 20, width: 70, borderRadius: 6 }} />
      </View>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <SkeletonBlock style={{ height: 12, width: 12, borderRadius: 4 }} />
        <SkeletonBlock style={{ height: 12, width: "55%", borderRadius: 6 }} />
      </View>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <SkeletonBlock style={{ height: 12, width: 12, borderRadius: 4 }} />
        <SkeletonBlock style={{ height: 12, width: "65%", borderRadius: 6 }} />
      </View>
    </View>
  );
}

// ─── Booking Card ─────────────────────────────────────────────────────────────

type Booking = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  source: "ONLINE" | "MANUAL";
  player?: { name: string; email: string; phoneNumber?: string | null };
  venue?: { id: string; name: string };
  pitch?: { name: string };
  guestName?: string | null;
  guestPhone?: string | null;
  [key: string]: unknown;
};

function normalizePhone(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

type CardStyles = Record<string, any>;

function BookingCard({
  item,
  onPress,
  colors,
  s,
}: {
  item: Booking;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  s: CardStyles;
}) {
  const statusColor = STATUS_COLORS[item.status] ?? colors.mutedForeground;
  const player = item.player as { name: string; email: string } | undefined;
  const pitch = item.pitch as { name: string } | undefined;
  const venue = item.venue as { name: string } | undefined;
  const guestName = item.guestName ?? null;
  const isManual = item.source === "MANUAL";
  const displayName = isManual ? guestName : (player?.name ?? player?.email ?? "Player");

  return (
    <MotionPressable style={s.card} onPress={onPress} accessibilityRole="button" accessibilityLabel={`View booking for ${displayName}`}>
      <View style={s.cardHeader}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, marginRight: 8, minWidth: 0 }}>
          <Text style={s.playerName} numberOfLines={1}>{displayName}</Text>
          <View style={[s.manualBadge, { backgroundColor: colors.primary + "18" }]}>
            <Text style={[s.manualBadgeText, { color: colors.primary }]}>{isManual ? "MANUAL" : "ONLINE"}</Text>
          </View>
        </View>
        <View style={[s.statusBadge, { backgroundColor: statusColor + "20" }]}>
          <Text style={[s.statusText, { color: statusColor }]}>
            {STATUS_LABELS[item.status] ?? item.status}
          </Text>
        </View>
      </View>
      <View style={s.metaRow}>
        <FeatherIcons name="grid" size={12} color={colors.mutedForeground} />
        <Text style={s.metaText} numberOfLines={1}>
          {venue?.name ?? ""}{pitch?.name ? ` · ${pitch.name}` : ""}
        </Text>
      </View>
      <View style={s.metaRow}>
        <FeatherIcons name="calendar" size={12} color={colors.mutedForeground} />
        <Text style={s.metaText}>
          {formatDateShort(item.startAt)} · {formatTimeRange(item.startAt, item.endAt)}
        </Text>
      </View>
    </MotionPressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function OwnerBookingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<Period>("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [venueId, setVenueId] = useState<string | "ALL">("ALL");

  // Map period → from/to API params
  const { fromParam, toParam } = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    if (period === "Upcoming") {
      return { fromParam: todayStart.toISOString(), toParam: undefined };
    }
    if (period === "Today") {
      return { fromParam: todayStart.toISOString(), toParam: todayEnd.toISOString() };
    }
    if (period === "Past") {
      const yesterday = new Date(todayStart.getTime() - 1);
      return { fromParam: undefined, toParam: yesterday.toISOString() };
    }
    return { fromParam: undefined, toParam: undefined };
  }, [period]);

  // Build server-side query params
  const apiParams = useMemo(() => {
    const p: { status?: BookingStatus; from?: string; to?: string } = {};
    if (statusFilter !== "All") p.status = statusFilter as BookingStatus;
    if (fromParam) p.from = fromParam;
    if (toParam) p.to = toParam;
    return p;
  }, [statusFilter, fromParam, toParam]);

  const { data, isLoading, refetch, isRefetching } = useListOwnerBookings(apiParams);
  const serverBookings = (data?.bookings ?? []) as unknown as Booking[];

  // Derive unique venues for client-side venue filter
  const venues = useMemo(() => {
    // Use all bookings response to get full venue list when possible
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    for (const b of serverBookings) {
      const v = b.venue as { id: string; name: string } | undefined;
      if (v && !seen.has(v.id)) {
        seen.add(v.id);
        result.push({ id: v.id, name: v.name });
      }
    }
    return result;
  }, [serverBookings]);

  // Client-side filters: search + venue (not supported by API)
  const filtered = useMemo(() => {
    return serverBookings.filter((b) => {
      // Venue filter (client-side — API has no venueId param)
      if (venueId !== "ALL") {
        const v = b.venue as { id: string } | undefined;
        if (v?.id !== venueId) return false;
      }

      // Search: guest name, player name/email, phone numbers, booking ID prefix
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const qDigits = normalizePhone(search.trim());
        const player = b.player as { name: string; email: string; phoneNumber?: string | null } | undefined;
        const matchGuest = b.guestName?.toLowerCase().includes(q);
        const matchPlayer =
          player?.name?.toLowerCase().includes(q) ||
          player?.email?.toLowerCase().includes(q);
        const matchId = b.id.slice(0, 8).toLowerCase().includes(q);
        const matchPhone =
          qDigits.length > 0 &&
          (normalizePhone(player?.phoneNumber).includes(qDigits) ||
            normalizePhone(b.guestPhone as string | null | undefined).includes(qDigits));
        if (!matchGuest && !matchPlayer && !matchId && !matchPhone) return false;
      }

      return true;
    });
  }, [serverBookings, venueId, search]);

  const hasActiveFilters =
    search !== "" || period !== "All" || statusFilter !== "All" || venueId !== "ALL";

  const clearFilters = () => {
    setSearch("");
    setPeriod("All");
    setStatusFilter("All");
    setVenueId("ALL");
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },

    // Search
    searchWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
    searchBox: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 10,
      gap: 8,
      height: 40,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
    },

    // Filters
    filterSection: { paddingBottom: 8 },
    filterLabel: {
      fontSize: 10,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      paddingLeft: 16,
      marginBottom: 5,
    },
    filterRow: { paddingLeft: 16 },
    pillRow: { flexDirection: "row", gap: 6, paddingRight: 16 },
    pill: {
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    pillText: { fontSize: 12, fontFamily: "PlusJakartaSans_500Medium", color: colors.mutedForeground },
    pillTextActive: { color: "#fff" },

    divider: { height: 1, backgroundColor: colors.border, marginBottom: 6 },

    // Result count
    countRow: {
      paddingHorizontal: 16,
      paddingBottom: 6,
      paddingTop: 2,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    countText: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground },
    clearText: { fontSize: 12, fontFamily: "PlusJakartaSans_500Medium", color: colors.primary },

    // List
    listContent: { paddingHorizontal: 16, paddingBottom: insets.bottom + 100 },

    // Card
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
      marginBottom: 5,
    },
    playerName: {
      flex: 1,
      fontSize: 15,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
      minWidth: 0,
    },
    manualBadge: {
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 3,
      flexShrink: 0,
    },
    manualBadgeText: { fontSize: 10, fontFamily: "PlusJakartaSans_600SemiBold" },
    statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    statusText: { fontSize: 11, fontFamily: "PlusJakartaSans_600SemiBold" },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
    metaText: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      flex: 1,
    },

    // Empty
    emptyWrap: { alignItems: "center", paddingTop: 60, gap: 10 },
    emptyTitle: { fontSize: 16, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground },
    emptySubtitle: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      paddingHorizontal: 24,
    },
  });

  // ── Header (search + filters) ───────────────────────────────────────────────

  const ListHeader = (
    <View>
      {/* Search */}
      <View style={s.searchWrap}>
        <View style={s.searchBox}>
          <FeatherIcons name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, email, phone or ID…"
            placeholderTextColor={colors.mutedForeground}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {search !== "" && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <FeatherIcons name="x" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Period filter */}
      <View style={s.filterSection}>
        <Text style={s.filterLabel}>Period</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
          <View style={s.pillRow}>
            {PERIOD_OPTIONS.map((p) => (
              <TouchableOpacity
                key={p}
                style={[s.pill, period === p && s.pillActive]}
                onPress={() => setPeriod(p)}
                activeOpacity={0.7}
              >
                <Text style={[s.pillText, period === p && s.pillTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Status filter */}
        <Text style={[s.filterLabel, { marginTop: 8 }]}>Status</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
          <View style={s.pillRow}>
            {STATUS_OPTIONS.map((st) => (
              <TouchableOpacity
                key={st}
                style={[s.pill, statusFilter === st && s.pillActive]}
                onPress={() => setStatusFilter(st)}
                activeOpacity={0.7}
              >
                <Text style={[s.pillText, statusFilter === st && s.pillTextActive]}>
                  {st === "All" ? "All Statuses" : (STATUS_LABELS[st] ?? st)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Venue filter — only shown when owner has more than one venue */}
        {venues.length > 1 && (
          <>
            <Text style={[s.filterLabel, { marginTop: 8 }]}>Venue</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
              <View style={s.pillRow}>
                <TouchableOpacity
                  style={[s.pill, venueId === "ALL" && s.pillActive]}
                  onPress={() => setVenueId("ALL")}
                  activeOpacity={0.7}
                >
                  <Text style={[s.pillText, venueId === "ALL" && s.pillTextActive]}>
                    All Venues
                  </Text>
                </TouchableOpacity>
                {venues.map((v) => (
                  <TouchableOpacity
                    key={v.id}
                    style={[s.pill, venueId === v.id && s.pillActive]}
                    onPress={() => setVenueId(v.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.pillText, venueId === v.id && s.pillTextActive]}>
                      {v.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </>
        )}
      </View>

      {/* Count + clear */}
      <View style={s.divider} />
      <View style={s.countRow}>
        <Text style={s.countText}>
          {isLoading
            ? "Loading…"
            : `${filtered.length} booking${filtered.length !== 1 ? "s" : ""}`}
        </Text>
        {hasActiveFilters && (
          <TouchableOpacity onPress={clearFilters}>
            <Text style={s.clearText}>Clear filters</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  // ── Skeleton list ───────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={s.container}>
        <View>{ListHeader}</View>
        <View style={[s.listContent, { flex: 1 }]}>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} colors={colors} />
          ))}
        </View>
      </View>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────────

  if (filtered.length === 0) {
    return (
      <View style={s.container}>
        <FlatList
          data={[]}
          keyExtractor={() => ""}
          renderItem={() => null}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <FeatherIcons name="search" size={40} color={colors.mutedForeground} style={{ opacity: 0.4 }} />
              <Text style={s.emptyTitle}>No bookings found</Text>
              <Text style={s.emptySubtitle}>
                {hasActiveFilters
                  ? "Try adjusting your search or filters"
                  : "No bookings have been made yet"}
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={s.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      </View>
    );
  }

  // ── Booking list (newest-first from server) ─────────────────────────────────

  return (
    <View style={s.container}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
        renderItem={({ item }) => (
          <BookingCard
            item={item}
            onPress={() => router.push(`/owner/booking/${item.id}`)}
            colors={colors}
            s={s}
          />
        )}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={s.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      />
    </View>
  );
}
