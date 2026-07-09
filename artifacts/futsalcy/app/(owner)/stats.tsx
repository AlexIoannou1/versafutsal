import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useGetOwnerStats } from "@workspace/api-client-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = "thisMonth" | "lastMonth" | "thisYear";

const PERIOD_LABELS: Record<Period, string> = {
  thisMonth: "This Month",
  lastMonth: "Last Month",
  thisYear: "This Year",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: "#00C851",
  PENDING: "#F59E0B",
  CANCELLED: "#EF4444",
  REFUNDED: "#6366F1",
  NO_SHOW: "#6B7280",
};

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: "Confirmed",
  PENDING: "Pending",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  NO_SHOW: "No Show",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPeriodDates(period: Period): { from: string; to: string; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  if (period === "thisMonth") {
    const from = new Date(y, m, 1);
    const to = new Date(y, m + 1, 0, 23, 59, 59);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      label: `${MONTH_NAMES[m]} ${y}`,
    };
  }
  if (period === "lastMonth") {
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 0, 23, 59, 59);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      label: `${MONTH_NAMES[(m - 1 + 12) % 12]} ${m === 0 ? y - 1 : y}`,
    };
  }
  // thisYear
  const from = new Date(y, 0, 1);
  const to = new Date(y, 11, 31, 23, 59, 59);
  return { from: from.toISOString(), to: to.toISOString(), label: `${y}` };
}

function formatEuro(amount: number) {
  return `€${amount.toFixed(2)}`;
}

function formatHour(hour: number) {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EmptySection({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ paddingVertical: 16, alignItems: "center" }}>
      <Text style={{ fontFamily: "PlusJakartaSans_400Regular", fontSize: 14, color }}>{label}</Text>
    </View>
  );
}

function MiniBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? value / max : 0;
  return (
    <View
      style={{
        height: 6,
        borderRadius: 3,
        backgroundColor: color + "28",
        marginTop: 4,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${Math.round(pct * 100)}%`,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function TrendBars({
  data,
  period,
  primaryColor,
  mutedColor,
  textColor,
}: {
  data: { date: string; count: number }[];
  period: Period;
  primaryColor: string;
  mutedColor: string;
  textColor: string;
}) {
  const bars = useMemo(() => {
    if (period === "thisYear" || period === "lastMonth" && data.length > 35) {
      // Aggregate by month
      const monthMap = new Map<number, number>();
      for (const d of data) {
        const month = new Date(d.date).getMonth();
        monthMap.set(month, (monthMap.get(month) ?? 0) + d.count);
      }
      return Array.from({ length: 12 }, (_, i) => ({
        label: MONTH_NAMES[i]!.substring(0, 1),
        count: monthMap.get(i) ?? 0,
      }));
    }
    // Daily
    return data.map((d) => ({
      label: String(new Date(d.date).getDate()),
      count: d.count,
    }));
  }, [data, period]);

  const maxVal = Math.max(...bars.map((b) => b.count), 1);
  const barW = period === "thisYear" ? 20 : period === "lastMonth" ? 8 : 10;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, paddingBottom: 4 }}>
        {bars.map((bar, i) => (
          <View key={i} style={{ alignItems: "center", gap: 2 }}>
            <View
              style={{
                width: barW,
                height: Math.max(4, Math.round((bar.count / maxVal) * 72)),
                backgroundColor: bar.count > 0 ? primaryColor : primaryColor + "22",
                borderRadius: 3,
              }}
            />
            {(period === "thisYear" || bars.length <= 31) && (
              <Text
                style={{
                  fontSize: 8,
                  fontFamily: "PlusJakartaSans_400Regular",
                  color: mutedColor,
                  width: barW,
                  textAlign: "center",
                }}
              >
                {bar.label}
              </Text>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function StatsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<Period>("thisMonth");

  const { from, to, label: periodLabel } = useMemo(() => getPeriodDates(period), [period]);

  const { data, isLoading } = useGetOwnerStats({ from, to });

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scrollContent: { paddingBottom: insets.bottom + 100 },
    header: {
      paddingTop: insets.top > 0 ? insets.top + 8 : 16,
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    headerTitle: {
      fontFamily: "PlusJakartaSans_700Bold",
      fontSize: 26,
      color: colors.foreground,
      marginBottom: 4,
    },
    headerSub: {
      fontFamily: "PlusJakartaSans_400Regular",
      fontSize: 13,
      color: colors.mutedForeground,
    },
    periodRow: {
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 20,
      paddingBottom: 16,
    },
    pill: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    pillText: {
      fontFamily: "PlusJakartaSans_500Medium",
      fontSize: 13,
      color: colors.mutedForeground,
    },
    pillTextActive: { color: "#fff" },
    card: {
      marginHorizontal: 20,
      marginBottom: 12,
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    cardTitle: {
      fontFamily: "PlusJakartaSans_600SemiBold",
      fontSize: 14,
      color: colors.foreground,
      marginBottom: 12,
    },
    overviewRow: { flexDirection: "row", gap: 10 },
    overviewCell: {
      flex: 1,
      backgroundColor: colors.background,
      borderRadius: 10,
      padding: 12,
      alignItems: "flex-start",
    },
    overviewLabel: {
      fontFamily: "PlusJakartaSans_400Regular",
      fontSize: 11,
      color: colors.mutedForeground,
      marginBottom: 4,
    },
    overviewValue: {
      fontFamily: "PlusJakartaSans_700Bold",
      fontSize: 18,
      color: colors.foreground,
    },
    listRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 9,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    listLabel: {
      fontFamily: "PlusJakartaSans_500Medium",
      fontSize: 13,
      color: colors.foreground,
      flex: 1,
    },
    listCount: {
      fontFamily: "PlusJakartaSans_600SemiBold",
      fontSize: 13,
      color: colors.foreground,
    },
    listSub: {
      fontFamily: "PlusJakartaSans_400Regular",
      fontSize: 11,
      color: colors.mutedForeground,
    },
    center: { alignItems: "center", justifyContent: "center", paddingVertical: 48 },
    loadingText: {
      fontFamily: "PlusJakartaSans_400Regular",
      fontSize: 14,
      color: colors.mutedForeground,
      marginTop: 10,
    },
    dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  });

  if (isLoading) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={s.loadingText}>Loading stats…</Text>
      </View>
    );
  }

  const stats = data ?? {
    totalBookings: 0,
    totalRevenue: 0,
    avgRevenue: 0,
    platformFees: 0,
    netRevenue: 0,
    byDay: [],
    byHour: [],
    byDayOfWeek: [],
    byPitch: [],
    byStatus: [],
  };

  const topHours = [...stats.byHour].sort((a, b) => b.count - a.count).slice(0, 6);
  const maxHour = Math.max(...topHours.map((h) => h.count), 1);

  const sortedDow = [...stats.byDayOfWeek].sort((a, b) => b.count - a.count);
  const maxDow = Math.max(...sortedDow.map((d) => d.count), 1);

  const maxPitch = Math.max(...stats.byPitch.map((p) => p.count), 1);

  return (
    <View style={s.container}>
      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>Stats</Text>
          <Text style={s.headerSub}>{periodLabel}</Text>
        </View>

        {/* Period Switcher */}
        <View style={s.periodRow}>
          {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[s.pill, p === period && s.pillActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[s.pillText, p === period && s.pillTextActive]}>
                {PERIOD_LABELS[p]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Overview */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Overview</Text>
          <View style={s.overviewRow}>
            <View style={s.overviewCell}>
              <Text style={s.overviewLabel}>Bookings</Text>
              <Text style={s.overviewValue}>{stats.totalBookings}</Text>
            </View>
            <View style={s.overviewCell}>
              <Text style={s.overviewLabel}>Revenue</Text>
              <Text style={s.overviewValue}>{formatEuro(stats.totalRevenue)}</Text>
            </View>
            <View style={s.overviewCell}>
              <Text style={s.overviewLabel}>Avg / booking</Text>
              <Text style={s.overviewValue}>{formatEuro(stats.avgRevenue)}</Text>
            </View>
          </View>
        </View>

        {/* Revenue Breakdown */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Revenue Breakdown</Text>
          <View style={s.overviewRow}>
            <View style={s.overviewCell}>
              <Text style={s.overviewLabel}>Gross revenue</Text>
              <Text style={s.overviewValue}>{formatEuro(stats.totalRevenue)}</Text>
            </View>
            <View style={s.overviewCell}>
              <Text style={s.overviewLabel}>Platform fees</Text>
              <Text style={[s.overviewValue, { color: "#EF4444" }]}>
                −{formatEuro(stats.platformFees)}
              </Text>
            </View>
            <View style={s.overviewCell}>
              <Text style={s.overviewLabel}>Net revenue</Text>
              <Text style={[s.overviewValue, { color: colors.primary }]}>
                {formatEuro(stats.netRevenue)}
              </Text>
            </View>
          </View>
        </View>

        {/* Status Breakdown */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Booking Status</Text>
          {stats.byStatus.length === 0 ? (
            <EmptySection label="No bookings in this period" color={colors.mutedForeground} />
          ) : (
            stats.byStatus.map((item, i) => (
              <View key={item.status} style={[s.listRow, i === 0 && { borderTopWidth: 0 }]}>
                <View
                  style={[s.dot, { backgroundColor: STATUS_COLORS[item.status] ?? "#6B7280" }]}
                />
                <Text style={s.listLabel}>{STATUS_LABELS[item.status] ?? item.status}</Text>
                <Text style={s.listCount}>{item.count}</Text>
              </View>
            ))
          )}
        </View>

        {/* Booking Trend */}
        <View style={s.card}>
          <Text style={s.cardTitle}>
            {period === "thisYear" ? "Monthly Trend" : "Daily Trend"}
          </Text>
          {stats.byDay.length === 0 ? (
            <EmptySection label="No bookings in this period" color={colors.mutedForeground} />
          ) : (
            <TrendBars
              data={stats.byDay}
              period={period}
              primaryColor={colors.primary}
              mutedColor={colors.mutedForeground}
              textColor={colors.foreground}
            />
          )}
        </View>

        {/* Peak Hours */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Peak Hours</Text>
          {topHours.length === 0 ? (
            <EmptySection label="No data for this period" color={colors.mutedForeground} />
          ) : (
            topHours.map((item, i) => (
              <View key={item.hour} style={{ paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                  <Text style={{ fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, color: colors.foreground }}>
                    {formatHour(item.hour)} – {formatHour(item.hour + 1)}
                  </Text>
                  <Text style={{ fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13, color: colors.foreground }}>
                    {item.count} bookings
                  </Text>
                </View>
                <MiniBar value={item.count} max={maxHour} color={colors.primary} />
              </View>
            ))
          )}
        </View>

        {/* Most Booked Days */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Most Booked Days</Text>
          {sortedDow.length === 0 ? (
            <EmptySection label="No data for this period" color={colors.mutedForeground} />
          ) : (
            sortedDow.map((item, i) => (
              <View key={item.day} style={{ paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                  <Text style={{ fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, color: colors.foreground }}>
                    {DAY_NAMES[item.day]}
                  </Text>
                  <Text style={{ fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13, color: colors.foreground }}>
                    {item.count}
                  </Text>
                </View>
                <MiniBar value={item.count} max={maxDow} color="#6366F1" />
              </View>
            ))
          )}
        </View>

        {/* Pitch Breakdown */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Pitch Breakdown</Text>
          {stats.byPitch.length === 0 ? (
            <EmptySection label="No data for this period" color={colors.mutedForeground} />
          ) : (
            stats.byPitch.map((item, i) => (
              <View key={item.pitchId} style={{ paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
                  <Text
                    style={{ fontFamily: "PlusJakartaSans_500Medium", fontSize: 13, color: colors.foreground, flex: 1, marginRight: 8 }}
                    numberOfLines={1}
                  >
                    {item.pitchName}
                  </Text>
                  <Text style={{ fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13, color: colors.foreground }}>
                    {item.count} · {formatEuro(item.revenue)}
                  </Text>
                </View>
                <MiniBar value={item.count} max={maxPitch} color="#F59E0B" />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
