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
import { useGetPitchAvailability, useCreateBooking } from "@workspace/api-client-react";

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = [
  "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
];

function toDateStr(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildDateOptions(): Array<{ date: Date; label: string; dayStr: string }> {
  const result = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 1; i <= 30; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() + i);
    result.push({
      date: d,
      label: `${DAYS_SHORT[d.getUTCDay()]}\n${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`,
      dayStr: toDateStr(d),
    });
  }
  return result;
}

function formatSlotTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
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

  const dateOptions = useMemo(buildDateOptions, []);
  const [selectedDateIdx, setSelectedDateIdx] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<{ startAt: string; endAt: string } | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const selectedDateStr = dateOptions[selectedDateIdx]?.dayStr ?? "";

  const { data: availData, isLoading: slotsLoading } = useGetPitchAvailability(
    venueId!,
    pitchId!,
    { date: selectedDateStr },
  );
  const slots = availData?.slots ?? [];

  const { mutate: createBooking, isPending: isBooking } = useCreateBooking();

  function handleBookNow() {
    if (!selectedSlot) return;
    setBookingError(null);
    createBooking(
      { data: { pitchId: pitchId!, startAt: selectedSlot.startAt } },
      {
        onSuccess: (res) => {
          router.replace(`/player/booking/${res.booking.id}`);
        },
        onError: (err: unknown) => {
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            "Booking failed. Please try again.";
          setBookingError(msg);
        },
      },
    );
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    datePicker: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingVertical: 12,
    },
    dateScroll: { paddingHorizontal: 16, gap: 8 },
    dateCard: {
      width: 56,
      height: 68,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dateCardSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dateLabel: {
      fontSize: 11,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 16,
    },
    dateLabelSelected: { color: colors.primaryForeground },
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
    slotAvailable: {
      borderColor: colors.primary + "60",
    },
    slotSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + "20",
    },
    slotUnavailable: {
      opacity: 0.4,
    },
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
    noSlots: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 48,
      gap: 8,
    },
    noSlotsText: {
      fontSize: 15,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    noSlotsSub: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
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
    selectedInfo: {
      marginBottom: 10,
    },
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
    errorText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.destructive,
      textAlign: "center",
      marginBottom: 8,
    },
    loaderWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  });

  const decodedPitchName = pitchName ? decodeURIComponent(String(pitchName)) : "Pitch";

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: decodedPitchName, headerBackTitle: "Back" }} />

      {/* Date Strip */}
      <View style={s.datePicker}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.dateScroll}
        >
          {dateOptions.map((opt, idx) => (
            <TouchableOpacity
              key={opt.dayStr}
              style={[s.dateCard, idx === selectedDateIdx && s.dateCardSelected]}
              onPress={() => {
                setSelectedDateIdx(idx);
                setSelectedSlot(null);
              }}
            >
              <Text style={[s.dateLabel, idx === selectedDateIdx && s.dateLabelSelected]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Slot Grid */}
      <View style={s.slotsSection}>
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
            <Text style={s.noSlotsSub}>This venue is closed on this day or fully booked.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.slotsGrid} showsVerticalScrollIndicator={false}>
            {slots.map((slot) => {
              const isSelected =
                selectedSlot?.startAt === slot.startAt;
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
                    setBookingError(null);
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
      </View>

      {/* Bottom Bar */}
      <View style={s.bottomBar}>
        {bookingError && <Text style={s.errorText}>{bookingError}</Text>}
        {selectedSlot && (
          <View style={s.selectedInfo}>
            <Text style={s.selectedInfoText}>
              {formatSlotTime(selectedSlot.startAt)} – {formatSlotTime(selectedSlot.endAt)}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[s.confirmBtn, !selectedSlot && s.confirmBtnDisabled]}
          onPress={handleBookNow}
          disabled={!selectedSlot || isBooking}
          activeOpacity={0.8}
        >
          {isBooking ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather
                name="check-circle"
                size={20}
                color={selectedSlot ? colors.primaryForeground : colors.mutedForeground}
              />
              <Text
                style={[s.confirmBtnText, !selectedSlot && s.confirmBtnTextDisabled]}
              >
                {selectedSlot ? "Confirm Booking" : "Select a Slot"}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
