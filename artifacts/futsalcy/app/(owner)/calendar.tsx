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
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import { useListOwnerBookings } from "@workspace/api-client-react";

type ViewMode = "day" | "month";

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
    timeZone: "UTC",
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

type Booking = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  createdAt?: string;
  guestName?: string | null;
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
  const guestName = booking.guestName ?? null;
  const isManual = !!guestName;

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
    manualBadge: { backgroundColor: colors.primary + "18", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
    manualBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.primary },
  });

  return (
    <TouchableOpacity style={bs.card} onPress={onPress} activeOpacity={0.7}>
      <View style={[bs.bar, { backgroundColor: statusColor }]} />
      <View style={bs.content}>
        <View style={bs.header}>
          <Text style={bs.time}>
            {formatTime(booking.startAt)} – {formatTime(booking.endAt)}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {isManual && (
              <View style={bs.manualBadge}>
                <Text style={bs.manualBadgeText}>MANUAL</Text>
              </View>
            )}
            <View style={[bs.badge, { backgroundColor: statusColor + "20" }]}>
              <Text style={[bs.badgeText, { color: statusColor }]}>
                {STATUS_LABELS[booking.status] ?? booking.status}
              </Text>
            </View>
          </View>
        </View>
        <Text style={bs.pitchText} numberOfLines={1}>
          {venue?.name ? `${venue.name} · ` : ""}{pitch?.name ?? "Pitch"}
        </Text>
        {(isManual ? guestName : player?.name) && (
          <Text style={bs.playerText} numberOfLines={1}>
            {isManual ? guestName : player?.name}
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

  // ─── Navigation ──────────────────────────────────────────────────────────
  function navigate(dir: 1 | -1) {
    const d = new Date(currentDate);
    if (viewMode === "day") {
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
    if (viewMode === "day") return formatDateLong(currentDate);
    return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
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

  });

  const VIEW_MODES: { key: ViewMode; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "month", label: "Month" },
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

  return (
    <View style={s.container}>
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
          zIndex: 10,
        }}
      >
        <FeatherIcons name="plus" size={26} color="#fff" />
      </TouchableOpacity>

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

        <View style={s.navRow}>
          <TouchableOpacity style={s.navBtn} onPress={() => navigate(-1)}>
            <FeatherIcons name="chevron-left" size={16} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.navLabel} numberOfLines={1}>{navLabel()}</Text>
          <TouchableOpacity style={s.navBtn} onPress={() => navigate(1)}>
            <FeatherIcons name="chevron-right" size={16} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity style={s.todayBtn} onPress={goToday}>
            <Text style={s.todayBtnText}>Today</Text>
          </TouchableOpacity>
        </View>
      </View>

      {viewMode === "day" && <DayView />}
      {viewMode === "month" && <MonthView />}
    </View>
  );
}
