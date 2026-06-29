import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useGetPitchAvailability } from "@workspace/api-client-react";

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatSlotTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildMonthGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = [];

  // Leading nulls for days before the 1st
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }
  // Pad to complete the last row
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function BookPitchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id: venueId, pitchId, pitchName, slotMins } = useLocalSearchParams<{
    id: string;
    pitchId: string;
    pitchName: string;
    slotMins: string;
  }>();

  const decodedPitchName = pitchName ? decodeURIComponent(String(pitchName)) : "Pitch";

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [displayYear, setDisplayYear] = useState(today.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ startAt: string; endAt: string } | null>(null);

  const selectedDateStr = selectedDate ? toDateStr(selectedDate) : "";

  const { data: availData, isLoading: slotsLoading } = useGetPitchAvailability(
    venueId!,
    pitchId!,
    { date: selectedDateStr },
    { query: { enabled: !!selectedDate && !!venueId && !!pitchId } },
  );
  const slots = availData?.slots ?? [];

  const monthGrid = useMemo(
    () => buildMonthGrid(displayYear, displayMonth),
    [displayYear, displayMonth],
  );

  function prevMonth() {
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear((y) => y - 1);
    } else {
      setDisplayMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear((y) => y + 1);
    } else {
      setDisplayMonth((m) => m + 1);
    }
  }

  function handleDayPress(day: Date) {
    // Disallow past dates
    if (day < today) return;
    setSelectedDate(day);
    setSelectedSlot(null);
  }

  function handleContinue() {
    if (!selectedSlot) return;
    router.push(
      `/player/venue/${venueId}/book-summary?pitchId=${pitchId}&pitchName=${encodeURIComponent(decodedPitchName)}&slotMins=${slotMins}&startAt=${encodeURIComponent(selectedSlot.startAt)}&endAt=${encodeURIComponent(selectedSlot.endAt)}`,
    );
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    calendarSection: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingBottom: 8,
    },
    monthNav: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 8,
    },
    navBtn: {
      width: 34,
      height: 34,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    monthLabel: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    dayNamesRow: {
      flexDirection: "row",
      paddingHorizontal: 8,
      marginBottom: 4,
    },
    dayNameCell: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 4,
    },
    dayNameText: {
      fontSize: 11,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    gridRow: {
      flexDirection: "row",
      paddingHorizontal: 8,
    },
    dayCell: {
      flex: 1,
      aspectRatio: 1,
      alignItems: "center",
      justifyContent: "center",
      margin: 1,
      borderRadius: 8,
    },
    dayCellPast: {
      opacity: 0.3,
    },
    dayCellToday: {
      borderWidth: 1,
      borderColor: colors.primary,
    },
    dayCellSelected: {
      backgroundColor: colors.primary,
    },
    dayText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    dayTextToday: {
      color: colors.primary,
      fontFamily: "Inter_600SemiBold",
    },
    dayTextSelected: {
      color: colors.primaryForeground,
      fontFamily: "Inter_600SemiBold",
    },
    dayTextPast: {
      color: colors.mutedForeground,
    },
    slotsSection: { flex: 1 },
    slotsHeader: {
      padding: 16,
      paddingBottom: 8,
    },
    slotsTitle: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
    },
    slotsSub: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    slotsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      padding: 12,
      gap: 10,
    },
    slot: {
      width: "30%",
      minWidth: 88,
      paddingVertical: 12,
      paddingHorizontal: 8,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    slotAvailable: { borderColor: colors.primary + "60" },
    slotSelected: { borderColor: colors.primary, backgroundColor: colors.primary + "20" },
    slotUnavailable: { opacity: 0.4 },
    slotTime: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
    },
    slotTimeAvailable: { color: colors.foreground },
    slotTimeSelected: { color: colors.primary },
    slotReason: {
      fontSize: 10,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    noDateWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 32,
      gap: 8,
    },
    noDateText: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    noSlots: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 40,
      gap: 8,
    },
    noSlotsText: {
      fontSize: 15,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    bottomBar: {
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      padding: 16,
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 8 : 12),
    },
    selectedInfo: { marginBottom: 10 },
    selectedInfoText: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      textAlign: "center",
    },
    confirmBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    confirmBtnDisabled: { backgroundColor: colors.muted },
    confirmBtnText: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
    confirmBtnTextDisabled: { color: colors.mutedForeground },
    loaderWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  });

  // Group grid cells into rows of 7
  const rows: Array<Array<Date | null>> = [];
  for (let i = 0; i < monthGrid.length; i += 7) {
    rows.push(monthGrid.slice(i, i + 7));
  }

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: decodedPitchName, headerBackTitle: "Back" }} />

      {/* Month Calendar */}
      <View style={s.calendarSection}>
        <View style={s.monthNav}>
          <TouchableOpacity style={s.navBtn} onPress={prevMonth}>
            <Feather name="chevron-left" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.monthLabel}>
            {MONTH_NAMES[displayMonth]} {displayYear}
          </Text>
          <TouchableOpacity style={s.navBtn} onPress={nextMonth}>
            <Feather name="chevron-right" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* Day names header */}
        <View style={s.dayNamesRow}>
          {DAY_NAMES.map((d) => (
            <View key={d} style={s.dayNameCell}>
              <Text style={s.dayNameText}>{d}</Text>
            </View>
          ))}
        </View>

        {/* Calendar grid */}
        {rows.map((row, ri) => (
          <View key={ri} style={s.gridRow}>
            {row.map((day, ci) => {
              if (!day) {
                return <View key={ci} style={s.dayCell} />;
              }
              const isToday = isSameDay(day, today);
              const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
              const isPast = day < today;
              return (
                <TouchableOpacity
                  key={ci}
                  style={[
                    s.dayCell,
                    isPast && s.dayCellPast,
                    isToday && !isSelected && s.dayCellToday,
                    isSelected && s.dayCellSelected,
                  ]}
                  onPress={() => handleDayPress(day)}
                  disabled={isPast}
                  activeOpacity={isPast ? 1 : 0.7}
                >
                  <Text
                    style={[
                      s.dayText,
                      isPast && s.dayTextPast,
                      isToday && !isSelected && s.dayTextToday,
                      isSelected && s.dayTextSelected,
                    ]}
                  >
                    {day.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* Slot Grid */}
      <View style={s.slotsSection}>
        {!selectedDate ? (
          <View style={s.noDateWrap}>
            <Feather name="calendar" size={28} color={colors.mutedForeground} />
            <Text style={s.noDateText}>Pick a date above to see available slots</Text>
          </View>
        ) : (
          <>
            <View style={s.slotsHeader}>
              <Text style={s.slotsTitle}>Available Slots</Text>
              {slotMins && (
                <Text style={s.slotsSub}>{slotMins} minute slots · tap to select</Text>
              )}
            </View>

            {slotsLoading ? (
              <View style={s.loaderWrap}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : slots.length === 0 ? (
              <View style={s.noSlots}>
                <Feather name="moon" size={32} color={colors.mutedForeground} />
                <Text style={s.noSlotsText}>No slots available</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={s.slotsGrid} showsVerticalScrollIndicator={false}>
                {slots.map((slot) => {
                  const isSelected = selectedSlot?.startAt === slot.startAt;
                  const isAvailable = slot.available;
                  return (
                    <TouchableOpacity
                      key={slot.startAt}
                      style={[
                        s.slot,
                        isAvailable && s.slotAvailable,
                        isSelected && s.slotSelected,
                        !isAvailable && s.slotUnavailable,
                      ]}
                      onPress={() => {
                        if (!isAvailable) return;
                        setSelectedSlot(isSelected ? null : { startAt: slot.startAt, endAt: slot.endAt });
                      }}
                      disabled={!isAvailable}
                      activeOpacity={isAvailable ? 0.7 : 1}
                    >
                      <Text
                        style={[
                          s.slotTime,
                          isAvailable && s.slotTimeAvailable,
                          isSelected && s.slotTimeSelected,
                        ]}
                      >
                        {formatSlotTime(slot.startAt)}
                      </Text>
                      {!isAvailable && slot.reason && (
                        <Text style={s.slotReason}>{slot.reason}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </>
        )}
      </View>

      {/* Bottom Bar */}
      <View style={s.bottomBar}>
        {selectedSlot && (
          <View style={s.selectedInfo}>
            <Text style={s.selectedInfoText}>
              {formatSlotTime(selectedSlot.startAt)} – {formatSlotTime(selectedSlot.endAt)}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[s.confirmBtn, !selectedSlot && s.confirmBtnDisabled]}
          onPress={handleContinue}
          disabled={!selectedSlot}
          activeOpacity={0.8}
        >
          <Feather
            name="arrow-right"
            size={20}
            color={selectedSlot ? colors.primaryForeground : colors.mutedForeground}
          />
          <Text style={[s.confirmBtnText, !selectedSlot && s.confirmBtnTextDisabled]}>
            {selectedSlot ? "Review Booking" : "Select a Date & Slot"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
