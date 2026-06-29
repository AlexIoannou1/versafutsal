import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useListOwnerBookings } from "@workspace/api-client-react";

type ViewMode = "day" | "grid" | "month" | "list";

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

// Grid constants
const HOUR_ROW_HEIGHT = 56;
const PITCH_COL_WIDTH = 100;
const TIME_GUTTER_WIDTH = 44;
const GRID_START_HOUR = 7;
const GRID_END_HOUR = 23;

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

function formatTimeHH(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
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

/** Returns minutes from midnight for an ISO timestamp */
function toMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

type Booking = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  pitch?: { id?: string; name?: string } | null;
  venue?: { name: string } | null;
  player?: { name: string; email: string } | null;
};

function BookingRow({
  booking,
  onPress,
  colors,
}: {
  booking: Booking;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const statusColor = STATUS_COLORS[booking.status] ?? colors.mutedForeground;
  const pitch = booking.pitch as { name: string } | undefined;
  const venue = booking.venue as { name: string } | undefined;
  const player = booking.player as { name: string; email: string } | undefined;

  const bs = StyleSheet.create({
    card: {
      flexDirection: "row",
      backgroundColor: colors.card,
      borderRadius: 10,
      marginBottom: 8,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.border,
    },
    bar: { width: 4 },
    content: { flex: 1, padding: 10 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
    time: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
    badgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
    pitchText: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    playerText: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 },
  });

  return (
    <TouchableOpacity style={bs.card} onPress={onPress} activeOpacity={0.7}>
      <View style={[bs.bar, { backgroundColor: statusColor }]} />
      <View style={bs.content}>
        <View style={bs.header}>
          <Text style={bs.time}>
            {formatTime(booking.startAt)} – {formatTime(booking.endAt)}
          </Text>
          <View style={[bs.badge, { backgroundColor: statusColor + "20" }]}>
            <Text style={[bs.badgeText, { color: statusColor }]}>
              {STATUS_LABELS[booking.status] ?? booking.status}
            </Text>
          </View>
        </View>
        <Text style={bs.pitchText} numberOfLines={1}>
          {venue?.name ? `${venue.name} · ` : ""}{pitch?.name ?? "Pitch"}
        </Text>
        {player?.name && (
          <Text style={bs.playerText} numberOfLines={1}>
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
  const screenWidth = Dimensions.get("window").width;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [currentDate, setCurrentDate] = useState(today);

  const { data, isLoading, refetch, isRefetching } = useListOwnerBookings();
  const bookings: Booking[] = (data?.bookings ?? []) as Booking[];

  // ─── Month grid helpers ───────────────────────────────────────────────────
  const monthGrid = useMemo(
    () => buildMonthGrid(currentDate.getFullYear(), currentDate.getMonth()),
    [currentDate],
  );
  const monthRows = useMemo(() => {
    const rows: Array<Array<Date | null>> = [];
    for (let i = 0; i < monthGrid.length; i += 7) rows.push(monthGrid.slice(i, i + 7));
    return rows;
  }, [monthGrid]);

  // ─── Booking lookup by date ───────────────────────────────────────────────
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

  // ─── List helpers ─────────────────────────────────────────────────────────
  const sortedBookings = useMemo(
    () => [...bookings].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [bookings],
  );

  // ─── Navigation ──────────────────────────────────────────────────────────
  function navigate(dir: 1 | -1) {
    const d = new Date(currentDate);
    if (viewMode === "day" || viewMode === "grid") {
      d.setDate(d.getDate() + dir);
    } else if (viewMode === "month") {
      d.setMonth(d.getMonth() + dir);
      d.setDate(1);
    } else {
      return;
    }
    setCurrentDate(d);
  }

  function goToday() { setCurrentDate(today); }

  function navLabel() {
    if (viewMode === "day" || viewMode === "grid") return formatDateLong(currentDate);
    if (viewMode === "month") return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    return "All Bookings";
  }

  // ─── Styles ───────────────────────────────────────────────────────────────
  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    toolbar: { borderBottomWidth: 1, borderBottomColor: colors.border },
    viewModeRow: {
      flexDirection: "row",
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 6,
      gap: 6,
    },
    modeBtn: { flex: 1, paddingVertical: 7, alignItems: "center", borderRadius: 8 },
    modeBtnActive: { backgroundColor: colors.primary + "20" },
    modeBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    modeBtnTextActive: { color: colors.primary, fontFamily: "Inter_600SemiBold" },
    navRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 14,
      paddingBottom: 10,
      gap: 8,
    },
    navBtn: {
      width: 32, height: 32, borderRadius: 8,
      borderWidth: 1, borderColor: colors.border,
      alignItems: "center", justifyContent: "center",
    },
    navLabel: {
      flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold",
      color: colors.foreground, textAlign: "center",
    },
    todayBtn: {
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
      borderWidth: 1, borderColor: colors.primary + "60",
      backgroundColor: colors.primary + "10",
    },
    todayBtnText: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.primary },

    // Day view
    dayScroll: { flex: 1 },
    dayContent: { padding: 16, paddingBottom: insets.bottom + 80 },
    dayDate: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 12 },
    noBookings: {
      textAlign: "center", paddingVertical: 40,
      fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground,
    },

    // Shared booking card
    bookingCard: {
      flexDirection: "row", backgroundColor: colors.card, borderRadius: 10,
      marginBottom: 8, overflow: "hidden", borderWidth: 1, borderColor: colors.border,
    },
    statusBar: { width: 4 },
    bookingContent: { flex: 1, padding: 10 },
    bookingHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
    bookingTime: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    statusBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
    statusBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
    bookingPitch: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    bookingPlayer: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 2 },

    // Grid view
    gridWrapper: { flex: 1 },
    gridHeader: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.card,
    },
    gridTimeGutter: { width: TIME_GUTTER_WIDTH },
    gridPitchHead: {
      width: PITCH_COL_WIDTH,
      paddingVertical: 8,
      paddingHorizontal: 4,
      borderLeftWidth: 1,
      borderLeftColor: colors.border,
      alignItems: "center",
    },
    gridPitchHeadText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.foreground, textAlign: "center" },
    gridScrollContainer: { flex: 1 },
    gridBody: { flexDirection: "row" },
    gridTimeCol: { width: TIME_GUTTER_WIDTH },
    gridTimeCell: { height: HOUR_ROW_HEIGHT, justifyContent: "flex-start", alignItems: "flex-end", paddingRight: 6, paddingTop: 2 },
    gridTimeLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    gridPitchCol: { width: PITCH_COL_WIDTH, borderLeftWidth: 1, borderLeftColor: colors.border },
    gridHourCell: { height: HOUR_ROW_HEIGHT, borderBottomWidth: 1, borderBottomColor: colors.border + "40" },
    gridBookingBlock: {
      position: "absolute",
      left: 2,
      right: 2,
      borderRadius: 4,
      paddingHorizontal: 4,
      paddingTop: 2,
      overflow: "hidden",
    },
    gridBlockText: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#fff" },
    gridBlockSub: { fontSize: 8, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)" },
    gridNoPitches: {
      flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 8,
    },
    gridNoPitchesText: { fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center" },

    // Month view
    monthDayNamesRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border },
    monthDayName: {
      flex: 1, textAlign: "center", fontSize: 10, fontFamily: "Inter_500Medium",
      color: colors.mutedForeground, paddingVertical: 6,
    },
    monthGridScroll: { flex: 1 },
    monthRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border + "60" },
    monthCell: { flex: 1, minHeight: 64, borderRightWidth: 1, borderRightColor: colors.border + "60", padding: 3 },
    monthCellLastCol: { borderRightWidth: 0 },
    monthCellNum: { fontSize: 11, fontFamily: "Inter_400Regular", color: colors.foreground, marginBottom: 2 },
    monthCellNumTodayWrap: {
      width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary,
      alignItems: "center", justifyContent: "center", marginBottom: 2, overflow: "hidden",
    },
    monthCellNumToday: {
      fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.primaryForeground,
    },
    monthCellNumOther: { color: colors.mutedForeground },
    monthDot: { width: "100%", borderRadius: 3, paddingVertical: 1, paddingHorizontal: 2, marginBottom: 1 },
    monthDotText: { fontSize: 8, fontFamily: "Inter_500Medium", color: "#fff" },
    moreText: { fontSize: 8, fontFamily: "Inter_400Regular", color: colors.mutedForeground },

    // List view
    listScroll: { flex: 1 },
    listContent: { padding: 16, paddingBottom: insets.bottom + 80 },
    listDateHeader: {
      fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground,
      marginTop: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5,
    },
  });

  const VIEW_MODES: { key: ViewMode; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "grid", label: "Grid" },
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

  // ─── Day View ─────────────────────────────────────────────────────────────
  const DayView = () => {
    const dayBookings = getBookingsForDay(currentDate)
      .slice().sort((a, b) => a.startAt.localeCompare(b.startAt));

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
            <BookingRow key={b.id} booking={b} colors={colors}
              onPress={() => router.push(`/owner/booking/${b.id}`)} />
          ))
        )}
      </ScrollView>
    );
  };

  // ─── Pitch × Time Grid View ───────────────────────────────────────────────
  const GridView = () => {
    const dayBookings = getBookingsForDay(currentDate)
      .filter((b) => b.status !== "CANCELLED");

    // Derive unique pitches from all bookings (not just today) so columns are stable
    const allPitches = useMemo(() => {
      const seen = new Map<string, string>(); // id → name
      for (const b of bookings) {
        const p = b.pitch as { id?: string; name?: string } | undefined;
        if (p?.id && !seen.has(p.id)) seen.set(p.id, p.name ?? p.id);
      }
      return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
    }, [bookings]);

    const hours = Array.from(
      { length: GRID_END_HOUR - GRID_START_HOUR },
      (_, i) => GRID_START_HOUR + i,
    );

    const gridTotalWidth = allPitches.length * PITCH_COL_WIDTH + TIME_GUTTER_WIDTH;
    const needsHScroll = gridTotalWidth > screenWidth;

    if (allPitches.length === 0) {
      return (
        <View style={s.gridNoPitches}>
          <Feather name="grid" size={32} color={colors.mutedForeground} />
          <Text style={s.gridNoPitchesText}>
            No pitches found. Bookings will appear here once you have pitches configured.
          </Text>
        </View>
      );
    }

    return (
      <View style={s.gridWrapper}>
        {/* Pitch column headers */}
        <ScrollView horizontal scrollEnabled={needsHScroll} showsHorizontalScrollIndicator={false}>
          <View>
            {/* Header row */}
            <View style={s.gridHeader}>
              <View style={s.gridTimeGutter} />
              {allPitches.map((p) => (
                <View key={p.id} style={s.gridPitchHead}>
                  <Text style={s.gridPitchHeadText} numberOfLines={2}>{p.name}</Text>
                </View>
              ))}
            </View>

            {/* Scrollable body */}
            <ScrollView
              style={s.gridScrollContainer}
              showsVerticalScrollIndicator
              contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
            >
              <View style={s.gridBody}>
                {/* Time gutter */}
                <View style={s.gridTimeCol}>
                  {hours.map((h) => (
                    <View key={h} style={s.gridTimeCell}>
                      <Text style={s.gridTimeLabel}>{formatTimeHH(h)}</Text>
                    </View>
                  ))}
                </View>

                {/* Pitch columns */}
                {allPitches.map((pitch) => {
                  const pitchBookings = dayBookings.filter(
                    (b) => (b.pitch as { id?: string } | undefined)?.id === pitch.id,
                  );

                  return (
                    <View key={pitch.id} style={[s.gridPitchCol, { height: hours.length * HOUR_ROW_HEIGHT }]}>
                      {/* Hour grid lines */}
                      {hours.map((h) => (
                        <View key={h} style={s.gridHourCell} />
                      ))}

                      {/* Booking blocks overlaid */}
                      {pitchBookings.map((b) => {
                        const startMin = toMinutes(b.startAt);
                        const endMin = toMinutes(b.endAt);
                        const offsetMin = startMin - GRID_START_HOUR * 60;
                        const durationMin = endMin - startMin;

                        if (offsetMin < 0 || durationMin <= 0) return null;

                        const top = (offsetMin / 60) * HOUR_ROW_HEIGHT;
                        const height = Math.max((durationMin / 60) * HOUR_ROW_HEIGHT, 20);
                        const sc = STATUS_COLORS[b.status] ?? colors.primary;
                        const player = b.player as { name: string } | undefined;

                        return (
                          <TouchableOpacity
                            key={b.id}
                            style={[
                              s.gridBookingBlock,
                              { top, height, backgroundColor: sc },
                            ]}
                            onPress={() => router.push(`/owner/booking/${b.id}`)}
                            activeOpacity={0.8}
                          >
                            <Text style={s.gridBlockText} numberOfLines={1}>
                              {formatTime(b.startAt)}
                            </Text>
                            {height >= 36 && player?.name && (
                              <Text style={s.gridBlockSub} numberOfLines={1}>
                                {player.name}
                              </Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    );
  };

  // ─── Month View ───────────────────────────────────────────────────────────
  const MonthView = () => {
    const [selectedDay, setSelectedDay] = useState<Date | null>(null);
    const selectedBookings = selectedDay
      ? getBookingsForDay(selectedDay).slice().sort((a, b) => a.startAt.localeCompare(b.startAt))
      : [];

    return (
      <View style={{ flex: 1 }}>
        <View style={s.monthDayNamesRow}>
          {DAY_NAMES.map((d) => <Text key={d} style={s.monthDayName}>{d}</Text>)}
        </View>
        <ScrollView
          style={s.monthGridScroll}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
        >
          {monthRows.map((row, ri) => (
            <View key={ri} style={s.monthRow}>
              {row.map((day, ci) => {
                if (!day) return <View key={ci} style={[s.monthCell, ci === 6 && s.monthCellLastCol]} />;
                const dayIsToday = isSameDay(day, today);
                const dayIsSelected = selectedDay ? isSameDay(day, selectedDay) : false;
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                const dayBookings = getBookingsForDay(day);
                return (
                  <TouchableOpacity
                    key={ci}
                    style={[s.monthCell, ci === 6 && s.monthCellLastCol, dayIsSelected && { backgroundColor: colors.primary + "10" }]}
                    onPress={() => setSelectedDay(dayIsSelected ? null : day)}
                  >
                    {dayIsToday ? (
                      <View style={s.monthCellNumTodayWrap}>
                        <Text style={s.monthCellNumToday}>{day.getDate()}</Text>
                      </View>
                    ) : (
                      <Text style={[s.monthCellNum, !isCurrentMonth && s.monthCellNumOther]}>
                        {day.getDate()}
                      </Text>
                    )}
                    {dayBookings.slice(0, 2).map((b) => {
                      const sc = STATUS_COLORS[b.status] ?? colors.primary;
                      return (
                        <View key={b.id} style={[s.monthDot, { backgroundColor: sc }]}>
                          <Text style={s.monthDotText} numberOfLines={1}>{formatTime(b.startAt)}</Text>
                        </View>
                      );
                    })}
                    {dayBookings.length > 2 && <Text style={s.moreText}>+{dayBookings.length - 2}</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
          {selectedDay && (
            <View style={{ padding: 14, paddingBottom: insets.bottom + 80 }}>
              <Text style={[s.dayDate, { marginBottom: 8 }]}>{formatDateLong(selectedDay)}</Text>
              {selectedBookings.length === 0 ? (
                <Text style={s.noBookings}>No bookings this day.</Text>
              ) : (
                selectedBookings.map((b) => (
                  <BookingRow key={b.id} booking={b} colors={colors}
                    onPress={() => router.push(`/owner/booking/${b.id}`)} />
                ))
              )}
            </View>
          )}
        </ScrollView>
      </View>
    );
  };

  // ─── List View ────────────────────────────────────────────────────────────
  const ListView = () => {
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
                  <BookingRow key={b.id} booking={b} colors={colors}
                    onPress={() => router.push(`/owner/booking/${b.id}`)} />
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

      {viewMode === "day" && <DayView />}
      {viewMode === "grid" && <GridView />}
      {viewMode === "month" && <MonthView />}
      {viewMode === "list" && <ListView />}
    </View>
  );
}
