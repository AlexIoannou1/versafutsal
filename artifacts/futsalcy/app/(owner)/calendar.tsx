import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useListOwnerBookings } from "@workspace/api-client-react";

type ViewMode = "day" | "week";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#F59E0B",
  CONFIRMED: "#00C851",
  CANCELLED: "#EF4444",
  REFUNDED: "#6366F1",
  NO_SHOW: "#6B7280",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatMonthYear(date: Date) {
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function formatDateShort(date: Date) {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function OwnerCalendarScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(today);
  const [selectedPitchId, setSelectedPitchId] = useState<string | "ALL">("ALL");

  const weekStart = useMemo(() => startOfWeek(currentDate), [currentDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const fromDate = viewMode === "week" ? weekStart : currentDate;
  const toDate = useMemo(() => {
    if (viewMode === "week") {
      const d = addDays(weekStart, 6);
      d.setHours(23, 59, 59, 999);
      return d;
    } else {
      const d = new Date(currentDate);
      d.setHours(23, 59, 59, 999);
      return d;
    }
  }, [viewMode, weekStart, currentDate]);

  const { data, isLoading, refetch, isRefetching } = useListOwnerBookings({
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  });

  const allBookings = data?.bookings ?? [];

  const pitches = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    for (const b of allBookings) {
      const pitch = b.pitch as { id: string; name: string } | undefined;
      if (pitch && !seen.has(pitch.id)) {
        seen.add(pitch.id);
        result.push({ id: pitch.id, name: pitch.name });
      }
    }
    return result;
  }, [allBookings]);

  const bookings = selectedPitchId === "ALL"
    ? allBookings
    : allBookings.filter((b) => (b.pitch as { id: string } | undefined)?.id === selectedPitchId);

  function getBookingsForDay(day: Date) {
    return bookings.filter((b) => isSameDay(new Date(b.startAt), day));
  }

  function isInactiveBooking(status: string) {
    return status === "CANCELLED" || status === "REFUNDED";
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    controls: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    navBtn: {
      width: 36,
      height: 36,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    dateLabel: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    viewToggle: {
      flexDirection: "row",
      backgroundColor: colors.card,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
      marginBottom: 10,
    },
    toggleBtn: {
      flex: 1,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
    },
    toggleBtnActive: {
      backgroundColor: colors.primary,
    },
    toggleText: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    toggleTextActive: {
      color: "#fff",
    },
    pitchFilter: {
      flexDirection: "row",
      gap: 6,
      marginBottom: 8,
    },
    pitchChip: {
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    pitchChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    pitchChipText: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    pitchChipTextActive: {
      color: "#fff",
    },
    weekGrid: {
      flex: 1,
    },
    weekDaysRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingHorizontal: 8,
    },
    weekDayCol: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 8,
      gap: 2,
    },
    weekDayName: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    weekDayNum: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    weekDayNumToday: {
      color: colors.primary,
    },
    weekBookingsList: {
      paddingHorizontal: 8,
      paddingTop: 6,
    },
    weekDayCell: {
      flex: 1,
      paddingHorizontal: 2,
    },
    dayBookingBlock: {
      borderRadius: 6,
      padding: 4,
      marginBottom: 3,
    },
    dayBlockTime: {
      fontSize: 10,
      fontFamily: "Inter_600SemiBold",
    },
    dayBlockName: {
      fontSize: 10,
      fontFamily: "Inter_400Regular",
    },
    dayBlockStatus: {
      fontSize: 9,
      fontFamily: "Inter_600SemiBold",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      marginTop: 1,
      opacity: 0.85,
    },
    emptyCell: {
      height: 30,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyCellText: {
      fontSize: 11,
      color: colors.mutedForeground,
    },
    dayViewContainer: {
      flex: 1,
    },
    dayDateHeader: {
      padding: 16,
      paddingBottom: 8,
    },
    dayDateTitle: {
      fontSize: 18,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    bookingCard: {
      marginHorizontal: 16,
      marginBottom: 10,
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
    },
    bookingCardHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    bookingCardTime: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    bookingStatusBadge: {
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    bookingStatusText: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
    },
    bookingCardMeta: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    emptyDay: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 48,
    },
    emptyDayText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 8,
    },
    loadingWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
  });

  function navigate(direction: -1 | 1) {
    if (viewMode === "week") {
      setCurrentDate((d) => addDays(d, direction * 7));
    } else {
      setCurrentDate((d) => addDays(d, direction));
    }
  }

  const navigationLabel =
    viewMode === "week"
      ? `${formatDateShort(weekDays[0]!)} – ${formatDateShort(weekDays[6]!)}, ${weekDays[0]!.getFullYear()}`
      : `${DAY_NAMES_FULL[currentDate.getDay()]}, ${formatDateShort(currentDate)}`;

  return (
    <View style={[s.container, { paddingBottom: insets.bottom }]}>
      <View style={s.header}>
        {/* View mode toggle */}
        <View style={s.viewToggle}>
          <TouchableOpacity
            style={[s.toggleBtn, viewMode === "week" && s.toggleBtnActive]}
            onPress={() => setViewMode("week")}
          >
            <Text style={[s.toggleText, viewMode === "week" && s.toggleTextActive]}>Week</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.toggleBtn, viewMode === "day" && s.toggleBtnActive]}
            onPress={() => setViewMode("day")}
          >
            <Text style={[s.toggleText, viewMode === "day" && s.toggleTextActive]}>Day</Text>
          </TouchableOpacity>
        </View>

        {/* Date navigation */}
        <View style={s.controls}>
          <TouchableOpacity style={s.navBtn} onPress={() => navigate(-1)}>
            <Feather name="chevron-left" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.dateLabel}>{navigationLabel}</Text>
          <TouchableOpacity style={s.navBtn} onPress={() => navigate(1)}>
            <Feather name="chevron-right" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* Pitch filter */}
        {pitches.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pitchFilter}>
            <TouchableOpacity
              style={[s.pitchChip, selectedPitchId === "ALL" && s.pitchChipActive]}
              onPress={() => setSelectedPitchId("ALL")}
            >
              <Text
                style={[s.pitchChipText, selectedPitchId === "ALL" && s.pitchChipTextActive]}
              >
                All Pitches
              </Text>
            </TouchableOpacity>
            {pitches.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[
                  s.pitchChip,
                  { marginLeft: 6 },
                  selectedPitchId === p.id && s.pitchChipActive,
                ]}
                onPress={() => setSelectedPitchId(p.id)}
              >
                <Text
                  style={[s.pitchChipText, selectedPitchId === p.id && s.pitchChipTextActive]}
                >
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {isLoading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : viewMode === "week" ? (
        /* ── Week View ── */
        <ScrollView
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
        >
          {/* Day headers */}
          <View style={s.weekDaysRow}>
            {weekDays.map((day, i) => {
              const isToday = isSameDay(day, today);
              return (
                <TouchableOpacity
                  key={i}
                  style={s.weekDayCol}
                  onPress={() => {
                    setCurrentDate(day);
                    setViewMode("day");
                  }}
                >
                  <Text style={s.weekDayName}>{DAY_NAMES[day.getDay()]}</Text>
                  <Text style={[s.weekDayNum, isToday && s.weekDayNumToday]}>
                    {day.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Booking blocks per day */}
          <View style={[s.weekBookingsList, { flexDirection: "row" }]}>
            {weekDays.map((day, i) => {
              const dayBookings = getBookingsForDay(day);
              return (
                <View key={i} style={s.weekDayCell}>
                  {dayBookings.length === 0 ? (
                    <View style={s.emptyCell}>
                      <Text style={s.emptyCellText}>—</Text>
                    </View>
                  ) : (
                    dayBookings.map((b) => {
                      const color = STATUS_COLORS[b.status] ?? colors.primary;
                      const inactive = isInactiveBooking(b.status);
                      const player = b.player as { name: string } | undefined;
                      return (
                        <TouchableOpacity
                          key={b.id}
                          style={[s.dayBookingBlock, { backgroundColor: color + "25" }, inactive && { opacity: 0.4 }]}
                          onPress={() => router.push(`/owner/booking/${b.id}`)}
                          activeOpacity={0.7}
                        >
                          <Text style={[s.dayBlockTime, { color }]} numberOfLines={1}>
                            {formatTime(b.startAt)}
                          </Text>
                          <Text style={[s.dayBlockName, { color }]} numberOfLines={1}>
                            {player?.name ?? "Player"}
                          </Text>
                          <Text style={[s.dayBlockStatus, { color }]} numberOfLines={1}>
                            {b.status}
                          </Text>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        /* ── Day View ── */
        <ScrollView
          style={s.dayViewContainer}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
        >
          <View style={s.dayDateHeader}>
            <Text style={s.dayDateTitle}>
              {DAY_NAMES_FULL[currentDate.getDay()]}, {formatDateShort(currentDate)}
            </Text>
          </View>

          {bookings.length === 0 ? (
            <View style={s.emptyDay}>
              <Feather name="calendar" size={32} color={colors.mutedForeground} />
              <Text style={s.emptyDayText}>No bookings for this day</Text>
            </View>
          ) : (
            bookings.map((b) => {
              const color = STATUS_COLORS[b.status] ?? colors.primary;
              const inactive = isInactiveBooking(b.status);
              const player = b.player as { name: string; email: string } | undefined;
              const pitch = b.pitch as { name: string } | undefined;
              const venue = b.venue as { name: string } | undefined;
              return (
                <TouchableOpacity
                  key={b.id}
                  style={[s.bookingCard, inactive && { opacity: 0.45 }]}
                  onPress={() => router.push(`/owner/booking/${b.id}`)}
                  activeOpacity={0.7}
                >
                  <View style={s.bookingCardHeader}>
                    <Text style={[s.bookingCardTime, inactive && { textDecorationLine: "line-through" }]}>
                      {formatTime(b.startAt)} – {formatTime(b.endAt)}
                    </Text>
                    <View style={[s.bookingStatusBadge, { backgroundColor: color + "20" }]}>
                      <Text style={[s.bookingStatusText, { color }]}>{b.status}</Text>
                    </View>
                  </View>
                  <Text style={s.bookingCardMeta} numberOfLines={1}>
                    {player?.name ?? player?.email ?? "Player"}
                  </Text>
                  <Text style={s.bookingCardMeta} numberOfLines={1}>
                    {venue?.name ?? ""} · {pitch?.name ?? ""}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}
