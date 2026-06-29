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

type ViewMode = "day" | "week" | "month" | "list";

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

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

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

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDateLong(date: Date) {
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function buildMonthGrid(year: number, month: number): Array<Date | null> {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

type Booking = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  pitch?: { name: string } | null;
  venue?: { name: string } | null;
  player?: { name: string; email: string } | null;
};

function BookingRow({
  booking,
  onPress,
  colors,
  s,
}: {
  booking: Booking;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  s: ReturnType<typeof StyleSheet.create>;
}) {
  const statusColor = STATUS_COLORS[booking.status] ?? colors.mutedForeground;
  const pitch = booking.pitch as { name: string } | undefined;
  const venue = booking.venue as { name: string } | undefined;
  const player = booking.player as { name: string; email: string } | undefined;

  return (
    <TouchableOpacity style={s.bookingCard} onPress={onPress} activeOpacity={0.7}>
      <View style={[s.statusBar, { backgroundColor: statusColor }]} />
      <View style={s.bookingContent}>
        <View style={s.bookingHeader}>
          <Text style={s.bookingTime}>
            {formatTime(booking.startAt)} – {formatTime(booking.endAt)}
          </Text>
          <View style={[s.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <Text style={[s.statusBadgeText, { color: statusColor }]}>
              {STATUS_LABELS[booking.status] ?? booking.status}
            </Text>
          </View>
        </View>
        <Text style={s.bookingPitch} numberOfLines={1}>
          {venue?.name ? `${venue.name} · ` : ""}{pitch?.name ?? "Pitch"}
        </Text>
        {player?.name && (
          <Text style={s.bookingPlayer} numberOfLines={1}>
            {player.name}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
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

  const { data, isLoading, refetch, isRefetching } = useListOwnerBookings();
  const bookings: Booking[] = (data?.bookings ?? []) as Booking[];

  // ─── Week helpers ────────────────────────────────────────────────────────
  const weekStart = useMemo(() => startOfWeek(currentDate), [currentDate]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // ─── Month helpers ───────────────────────────────────────────────────────
  const monthGrid = useMemo(
    () => buildMonthGrid(currentDate.getFullYear(), currentDate.getMonth()),
    [currentDate],
  );
  const monthRows = useMemo(() => {
    const rows: Array<Array<Date | null>> = [];
    for (let i = 0; i < monthGrid.length; i += 7) rows.push(monthGrid.slice(i, i + 7));
    return rows;
  }, [monthGrid]);

  // ─── Booking lookups ──────────────────────────────────────────────────────
  const bookingsByDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      const key = b.startAt.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(b);
      map.set(key, list);
    }
    return map;
  }, [bookings]);

  function getBookingsForDay(day: Date): Booking[] {
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    return bookingsByDay.get(key) ?? [];
  }

  // ─── List mode: sorted upcoming and past ─────────────────────────────────
  const sortedBookings = useMemo(
    () => [...bookings].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [bookings],
  );

  // ─── Navigation ──────────────────────────────────────────────────────────
  function navigate(dir: 1 | -1) {
    const d = new Date(currentDate);
    if (viewMode === "day") {
      d.setDate(d.getDate() + dir);
    } else if (viewMode === "week") {
      d.setDate(d.getDate() + dir * 7);
    } else if (viewMode === "month") {
      d.setMonth(d.getMonth() + dir);
      d.setDate(1);
    } else {
      return;
    }
    setCurrentDate(d);
  }

  function goToday() {
    setCurrentDate(today);
  }

  function navLabel() {
    if (viewMode === "day") {
      return formatDateLong(currentDate);
    } else if (viewMode === "week") {
      const end = addDays(weekStart, 6);
      const startStr = weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      const endStr = end.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      return `${startStr} – ${endStr}`;
    } else if (viewMode === "month") {
      return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    }
    return "All Bookings";
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    toolbar: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    viewModeRow: {
      flexDirection: "row",
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 6,
      gap: 6,
    },
    modeBtn: {
      flex: 1,
      paddingVertical: 7,
      alignItems: "center",
      borderRadius: 8,
    },
    modeBtnActive: {
      backgroundColor: colors.primary + "20",
    },
    modeBtnText: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    modeBtnTextActive: {
      color: colors.primary,
      fontFamily: "Inter_600SemiBold",
    },
    navRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingBottom: 10,
      gap: 8,
    },
    navBtn: {
      width: 32,
      height: 32,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    navLabel: {
      flex: 1,
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      textAlign: "center",
    },
    todayBtn: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.primary + "60",
      backgroundColor: colors.primary + "10",
    },
    todayBtnText: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.primary },

    // Week view
    weekHeader: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    weekDayHead: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 8,
      gap: 2,
    },
    weekDayName: {
      fontSize: 10,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    weekDayNum: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    weekDayNumToday: {
      color: colors.primaryForeground,
      backgroundColor: colors.primary,
      borderRadius: 12,
      width: 24,
      height: 24,
      textAlign: "center",
      lineHeight: 24,
    },
    weekDayNumSelected: {
      color: colors.primary,
    },
    weekContent: { flex: 1 },
    weekCol: { flex: 1 },
    weekColSelected: {
      backgroundColor: colors.primary + "06",
    },
    miniBooking: {
      backgroundColor: colors.primary + "20",
      borderLeftWidth: 2,
      borderLeftColor: colors.primary,
      borderRadius: 3,
      paddingHorizontal: 3,
      paddingVertical: 2,
      marginBottom: 2,
      marginHorizontal: 2,
    },
    miniBookingText: {
      fontSize: 9,
      fontFamily: "Inter_500Medium",
      color: colors.primary,
    },

    // Day view
    dayScroll: { flex: 1 },
    dayContent: { padding: 16, paddingBottom: insets.bottom + 80 },
    dayDate: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 12,
    },
    noBookings: {
      textAlign: "center",
      paddingVertical: 40,
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },

    // Month view
    monthDayNamesRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    monthDayName: {
      flex: 1,
      textAlign: "center",
      fontSize: 10,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      paddingVertical: 6,
    },
    monthGridScroll: { flex: 1 },
    monthRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border + "60",
    },
    monthCell: {
      flex: 1,
      minHeight: 64,
      borderRightWidth: 1,
      borderRightColor: colors.border + "60",
      padding: 3,
    },
    monthCellLastCol: { borderRightWidth: 0 },
    monthCellNum: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      marginBottom: 2,
    },
    monthCellNumToday: {
      color: colors.primaryForeground,
      backgroundColor: colors.primary,
      borderRadius: 10,
      width: 18,
      height: 18,
      textAlign: "center",
      lineHeight: 18,
      fontFamily: "Inter_600SemiBold",
      overflow: "hidden",
    },
    monthCellNumOther: { color: colors.mutedForeground },
    monthDot: {
      width: "100%",
      borderRadius: 3,
      paddingVertical: 1,
      paddingHorizontal: 2,
      marginBottom: 1,
    },
    monthDotText: {
      fontSize: 8,
      fontFamily: "Inter_500Medium",
      color: "#fff",
    },
    moreText: { fontSize: 8, fontFamily: "Inter_400Regular", color: colors.mutedForeground },

    // Shared booking card
    bookingCard: {
      flexDirection: "row",
      backgroundColor: colors.card,
      borderRadius: 10,
      marginBottom: 8,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.border,
    },
    statusBar: { width: 4 },
    bookingContent: { flex: 1, padding: 10 },
    bookingHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 2,
    },
    bookingTime: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    statusBadge: {
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    statusBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
    bookingPitch: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    bookingPlayer: {
      fontSize: 11,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },

    // List view
    listScroll: { flex: 1 },
    listContent: { padding: 16, paddingBottom: insets.bottom + 80 },
    listDateHeader: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      marginTop: 12,
      marginBottom: 6,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
  });

  const VIEW_MODES: { key: ViewMode; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "list", label: "List" },
  ];

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // ─── Day view ─────────────────────────────────────────────────────────────
  const DayView = () => {
    const dayBookings = getBookingsForDay(currentDate)
      .slice()
      .sort((a, b) => a.startAt.localeCompare(b.startAt));

    return (
      <ScrollView
        style={s.dayScroll}
        contentContainerStyle={s.dayContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
      >
        <Text style={s.dayDate}>{formatDateLong(currentDate)}</Text>
        {dayBookings.length === 0 ? (
          <Text style={s.noBookings}>No bookings this day.</Text>
        ) : (
          dayBookings.map((b) => (
            <BookingRow
              key={b.id}
              booking={b}
              colors={colors}
              s={s}
              onPress={() => router.push(`/owner/booking/${b.id}`)}
            />
          ))
        )}
      </ScrollView>
    );
  };

  // ─── Week view ────────────────────────────────────────────────────────────
  const WeekView = () => {
    const [selectedDay, setSelectedDay] = useState(today);
    const selectedBookings = getBookingsForDay(selectedDay)
      .slice()
      .sort((a, b) => a.startAt.localeCompare(b.startAt));

    return (
      <View style={{ flex: 1 }}>
        {/* Week day headers */}
        <View style={s.weekHeader}>
          {weekDays.map((day, i) => {
            const dayIsToday = isSameDay(day, today);
            const dayIsSelected = isSameDay(day, selectedDay);
            return (
              <TouchableOpacity
                key={i}
                style={s.weekDayHead}
                onPress={() => setSelectedDay(day)}
              >
                <Text style={s.weekDayName}>{DAY_NAMES[day.getDay()]}</Text>
                <Text
                  style={[
                    s.weekDayNum,
                    dayIsToday && s.weekDayNumToday,
                    dayIsSelected && !dayIsToday && s.weekDayNumSelected,
                  ]}
                >
                  {day.getDate()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Mini booking dots in week grid */}
        <ScrollView horizontal={false}>
          <View style={{ flexDirection: "row", paddingTop: 4, minHeight: 120 }}>
            {weekDays.map((day, i) => {
              const dayIsSelected = isSameDay(day, selectedDay);
              const dayBookings = getBookingsForDay(day);
              return (
                <TouchableOpacity
                  key={i}
                  style={[s.weekCol, dayIsSelected && s.weekColSelected]}
                  onPress={() => setSelectedDay(day)}
                >
                  {dayBookings.slice(0, 3).map((b) => {
                    const sc = STATUS_COLORS[b.status] ?? colors.primary;
                    return (
                      <View
                        key={b.id}
                        style={[s.miniBooking, { borderLeftColor: sc, backgroundColor: sc + "20" }]}
                      >
                        <Text style={[s.miniBookingText, { color: sc }]}>
                          {formatTime(b.startAt)}
                        </Text>
                      </View>
                    );
                  })}
                  {dayBookings.length > 3 && (
                    <Text style={s.moreText}>+{dayBookings.length - 3} more</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        {/* Selected day bookings */}
        <ScrollView
          style={s.dayScroll}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 80 }}
        >
          <Text style={[s.dayDate, { fontSize: 13 }]}>{formatDateLong(selectedDay)}</Text>
          {selectedBookings.length === 0 ? (
            <Text style={s.noBookings}>No bookings this day.</Text>
          ) : (
            selectedBookings.map((b) => (
              <BookingRow
                key={b.id}
                booking={b}
                colors={colors}
                s={s}
                onPress={() => router.push(`/owner/booking/${b.id}`)}
              />
            ))
          )}
        </ScrollView>
      </View>
    );
  };

  // ─── Month view ───────────────────────────────────────────────────────────
  const MonthView = () => {
    const [selectedDay, setSelectedDay] = useState<Date | null>(null);
    const selectedBookings = selectedDay
      ? getBookingsForDay(selectedDay).slice().sort((a, b) => a.startAt.localeCompare(b.startAt))
      : [];

    return (
      <View style={{ flex: 1 }}>
        {/* Day names */}
        <View style={s.monthDayNamesRow}>
          {DAY_NAMES.map((d) => (
            <Text key={d} style={s.monthDayName}>{d}</Text>
          ))}
        </View>

        <ScrollView
          style={s.monthGridScroll}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
        >
          {/* Month grid */}
          {monthRows.map((row, ri) => (
            <View key={ri} style={s.monthRow}>
              {row.map((day, ci) => {
                if (!day) {
                  return <View key={ci} style={[s.monthCell, ci === 6 && s.monthCellLastCol]} />;
                }
                const dayIsToday = isSameDay(day, today);
                const dayIsSelected = selectedDay ? isSameDay(day, selectedDay) : false;
                const dayBookings = getBookingsForDay(day);
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                return (
                  <TouchableOpacity
                    key={ci}
                    style={[
                      s.monthCell,
                      ci === 6 && s.monthCellLastCol,
                      dayIsSelected && { backgroundColor: colors.primary + "10" },
                    ]}
                    onPress={() => setSelectedDay(dayIsSelected ? null : day)}
                  >
                    <Text
                      style={[
                        s.monthCellNum,
                        !isCurrentMonth && s.monthCellNumOther,
                        dayIsToday && s.monthCellNumToday,
                      ]}
                    >
                      {day.getDate()}
                    </Text>
                    {dayBookings.slice(0, 2).map((b) => {
                      const sc = STATUS_COLORS[b.status] ?? colors.primary;
                      return (
                        <View key={b.id} style={[s.monthDot, { backgroundColor: sc }]}>
                          <Text style={s.monthDotText} numberOfLines={1}>
                            {formatTime(b.startAt)}
                          </Text>
                        </View>
                      );
                    })}
                    {dayBookings.length > 2 && (
                      <Text style={s.moreText}>+{dayBookings.length - 2}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          {/* Selected day detail below grid */}
          {selectedDay && (
            <View style={{ padding: 14, paddingBottom: insets.bottom + 80 }}>
              <Text style={[s.dayDate, { marginBottom: 8 }]}>{formatDateLong(selectedDay)}</Text>
              {selectedBookings.length === 0 ? (
                <Text style={s.noBookings}>No bookings this day.</Text>
              ) : (
                selectedBookings.map((b) => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    colors={colors}
                    s={s}
                    onPress={() => router.push(`/owner/booking/${b.id}`)}
                  />
                ))
              )}
            </View>
          )}
        </ScrollView>
      </View>
    );
  };

  // ─── List view ────────────────────────────────────────────────────────────
  const ListView = () => {
    // Group by date
    const grouped: { date: string; bookings: Booking[] }[] = [];
    let lastDate = "";
    for (const b of sortedBookings) {
      const d = b.startAt.slice(0, 10);
      if (d !== lastDate) {
        lastDate = d;
        grouped.push({ date: d, bookings: [b] });
      } else {
        grouped[grouped.length - 1].bookings.push(b);
      }
    }

    return (
      <ScrollView
        style={s.listScroll}
        contentContainerStyle={s.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
      >
        {sortedBookings.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 48, gap: 8 }}>
            <Feather name="calendar" size={32} color={colors.mutedForeground} />
            <Text style={s.noBookings}>No bookings yet.</Text>
          </View>
        ) : (
          grouped.map(({ date, bookings: groupBookings }) => {
            const d = new Date(date + "T00:00:00");
            const label = isSameDay(d, today)
              ? "Today"
              : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" });
            return (
              <View key={date}>
                <Text style={s.listDateHeader}>{label}</Text>
                {groupBookings.map((b) => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    colors={colors}
                    s={s}
                    onPress={() => router.push(`/owner/booking/${b.id}`)}
                  />
                ))}
              </View>
            );
          })
        )}
      </ScrollView>
    );
  };

  return (
    <View style={s.container}>
      {/* Toolbar */}
      <View style={s.toolbar}>
        {/* View Mode Tabs */}
        <View style={s.viewModeRow}>
          {VIEW_MODES.map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[s.modeBtn, viewMode === m.key && s.modeBtnActive]}
              onPress={() => setViewMode(m.key)}
            >
              <Text style={[s.modeBtnText, viewMode === m.key && s.modeBtnTextActive]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Nav Row (hidden for list view) */}
        {viewMode !== "list" && (
          <View style={s.navRow}>
            <TouchableOpacity style={s.navBtn} onPress={() => navigate(-1)}>
              <Feather name="chevron-left" size={16} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={s.navLabel} numberOfLines={1}>{navLabel()}</Text>
            <TouchableOpacity style={s.navBtn} onPress={() => navigate(1)}>
              <Feather name="chevron-right" size={16} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity style={s.todayBtn} onPress={goToday}>
              <Text style={s.todayBtnText}>Today</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* View Content */}
      {viewMode === "day" && <DayView />}
      {viewMode === "week" && <WeekView />}
      {viewMode === "month" && <MonthView />}
      {viewMode === "list" && <ListView />}
    </View>
  );
}
