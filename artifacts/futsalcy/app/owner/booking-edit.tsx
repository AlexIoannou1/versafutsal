import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import {
  useGetOwnerBooking,
  useListOwnerVenues,
  useGetOwnerVenue,
  useGetPitchAvailability,
  useUpdateOwnerBooking,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatSlotTime(iso: string) {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(min).padStart(2, "0")} ${ampm}`;
}

type CalendarCell = { date: Date; isCurrentMonth: boolean };

function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: CalendarCell[] = [];
  const prevDays = new Date(year, month, 0).getDate();
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, prevDays - i), isCurrentMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), isCurrentMonth: true });
  }
  let next = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ date: new Date(year, month + 1, next++), isCurrentMonth: false });
  }
  return cells;
}

type SelectedVenue = { id: string; name: string };
type SelectedPitch = { id: string; name: string; slotDurationMinutes: number };
type SelectedSlot = { startAt: string; endAt: string };

export default function OwnerBookingEditScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [initialized, setInitialized] = useState(false);
  const [step, setStep] = useState(0);

  const [selectedVenue, setSelectedVenue] = useState<SelectedVenue | null>(null);
  const [selectedPitch, setSelectedPitch] = useState<SelectedPitch | null>(null);

  const [displayYear, setDisplayYear] = useState(today.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);

  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  // Track the original slot so we can show it as selectable even though it's "taken"
  const [originalSlot, setOriginalSlot] = useState<{ pitchId: string; startAt: string; endAt: string } | null>(null);

  const { data: bookingData, isLoading: bookingLoading } = useGetOwnerBooking(bookingId ?? "");
  const booking = bookingData?.booking;

  const isManual = !!(booking as { guestName?: string | null } | undefined)?.guestName;
  const STEPS = isManual
    ? ["Venue & Pitch", "Date & Time", "Guest Details"]
    : ["Venue & Pitch", "Date & Time", "Review"];

  useEffect(() => {
    if (!booking || initialized) return;

    const venueData = booking.venue as { id: string; name: string } | undefined;
    const pitchData = booking.pitch as { id: string; name: string; slotDurationMinutes: number } | undefined;

    if (venueData && pitchData) {
      setSelectedVenue({ id: venueData.id, name: venueData.name });
      setSelectedPitch({
        id: pitchData.id,
        name: pitchData.name,
        slotDurationMinutes: pitchData.slotDurationMinutes,
      });
    }

    const startDate = new Date(booking.startAt);
    const yr = startDate.getUTCFullYear();
    const mo = startDate.getUTCMonth();
    const dy = startDate.getUTCDate();
    setDisplayYear(yr);
    setDisplayMonth(mo);
    setSelectedDate(new Date(yr, mo, dy));
    setSelectedSlot({ startAt: booking.startAt, endAt: booking.endAt });
    setOriginalSlot({ pitchId: booking.pitchId, startAt: booking.startAt, endAt: booking.endAt });

    const bk = booking as { guestName?: string | null; guestPhone?: string | null };
    if (bk.guestName) {
      setGuestName(bk.guestName);
      setGuestPhone(bk.guestPhone ?? "");
    }

    setInitialized(true);
  }, [booking, initialized]);

  const { data: venuesData, isLoading: venuesLoading } = useListOwnerVenues();
  const venues = venuesData?.venues ?? [];

  const { data: venueDetailData, isLoading: venueDetailLoading } = useGetOwnerVenue(
    selectedVenue?.id ?? "",
    { query: { enabled: !!selectedVenue } },
  );
  const venuePitches = venueDetailData?.venue?.pitches ?? [];

  const selectedDateStr = selectedDate ? toDateStr(selectedDate) : "";
  const { data: availData, isLoading: slotsLoading } = useGetPitchAvailability(
    selectedVenue?.id ?? "",
    selectedPitch?.id ?? "",
    { date: selectedDateStr },
    { query: { enabled: !!selectedDate && !!selectedVenue && !!selectedPitch } },
  );
  const slots = availData?.slots ?? [];

  const updateBooking = useUpdateOwnerBooking();

  const monthGrid = useMemo(
    () => buildMonthGrid(displayYear, displayMonth),
    [displayYear, displayMonth],
  );

  const gridRows = useMemo(() => {
    const rows: CalendarCell[][] = [];
    for (let i = 0; i < monthGrid.length; i += 7) rows.push(monthGrid.slice(i, i + 7));
    return rows;
  }, [monthGrid]);

  function prevMonth() {
    if (displayMonth === 0) { setDisplayMonth(11); setDisplayYear(y => y - 1); }
    else setDisplayMonth(m => m - 1);
  }
  function nextMonth() {
    if (displayMonth === 11) { setDisplayMonth(0); setDisplayYear(y => y + 1); }
    else setDisplayMonth(m => m + 1);
  }

  function canGoNext() {
    if (step === 0) return !!selectedVenue && !!selectedPitch;
    if (step === 1) return !!selectedDate && !!selectedSlot;
    if (step === 2) return isManual ? guestName.trim().length > 0 && guestPhone.trim().length > 0 : true;
    return false;
  }

  function goNext() {
    if (step < STEPS.length - 1) setStep(s => s + 1);
  }

  function goBack() {
    if (step > 0) setStep(s => s - 1);
    else router.back();
  }

  async function handleSave() {
    if (!selectedPitch || !selectedSlot || !bookingId) return;
    try {
      await updateBooking.mutateAsync({
        id: bookingId,
        pitchId: selectedPitch.id,
        startAt: selectedSlot.startAt,
        ...(isManual
          ? { guestName: guestName.trim(), guestPhone: guestPhone.trim() }
          : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["getOwnerBooking", bookingId] });
      await queryClient.invalidateQueries({ queryKey: ["listOwnerBookings"] });
      router.back();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Failed to save changes. Please try again.";
      Alert.alert("Update Failed", msg);
    }
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    progressWrap: {
      flexDirection: "row",
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 16,
      gap: 6,
    },
    progressStep: { flex: 1, alignItems: "center", gap: 4 },
    progressBar: { height: 3, width: "100%", borderRadius: 2 },
    progressLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    progressLabelActive: { fontFamily: "Inter_600SemiBold", color: colors.primary },
    sectionTitle: {
      fontSize: 16,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    listItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginHorizontal: 16,
      marginBottom: 8,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.card,
      gap: 12,
    },
    listItemSelected: { borderColor: colors.primary, backgroundColor: colors.primary + "10" },
    listItemTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    listItemSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginTop: 1 },
    calSection: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 },
    monthNav: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    navBtn: {
      width: 34, height: 34, borderRadius: 8,
      borderWidth: 1, borderColor: colors.border,
      alignItems: "center", justifyContent: "center",
    },
    monthLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground },
    dayNamesRow: { flexDirection: "row", paddingHorizontal: 8, marginBottom: 4 },
    dayNameCell: { flex: 1, alignItems: "center", paddingVertical: 4 },
    dayNameText: { fontSize: 11, fontFamily: "Inter_500Medium", color: colors.mutedForeground },
    gridRow: { flexDirection: "row", paddingHorizontal: 8 },
    dayCell: {
      flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "center",
      margin: 1, borderRadius: 8,
    },
    dayCellToday: { borderWidth: 1, borderColor: colors.primary },
    dayCellSelected: { backgroundColor: colors.primary },
    dayText: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground },
    dayTextAdjacent: { opacity: 0.3 },
    dayTextPast: { color: colors.mutedForeground, opacity: 0.4 },
    dayTextToday: { color: colors.primary, fontFamily: "Inter_600SemiBold" },
    dayTextSelected: { color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" },
    slotsSection: { flex: 1 },
    slotsGrid: { flexDirection: "row", flexWrap: "wrap", padding: 12, gap: 10 },
    slot: {
      width: "30%", minWidth: 88, paddingVertical: 12, paddingHorizontal: 8,
      borderRadius: 10, alignItems: "center", justifyContent: "center",
      borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card,
    },
    slotAvailable: { borderColor: colors.primary + "60" },
    slotSelected: { borderColor: colors.primary, backgroundColor: colors.primary + "20" },
    slotUnavailable: { opacity: 0.4 },
    slotTime: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground },
    slotTimeAvailable: { color: colors.foreground },
    slotTimeSelected: { color: colors.primary },
    noDateWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 32, gap: 8 },
    noDateText: { fontSize: 14, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center" },
    formSection: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
    fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.mutedForeground, marginBottom: 6 },
    textInput: {
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    reviewCard: {
      marginHorizontal: 16,
      marginTop: 16,
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    reviewCardTitle: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
      color: colors.primary,
      letterSpacing: 0.8,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 8,
      textTransform: "uppercase",
    },
    reviewRow: {
      flexDirection: "row",
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      gap: 10,
    },
    reviewRowFirst: { borderTopWidth: 0 },
    reviewLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, width: 70 },
    reviewValue: { fontSize: 14, fontFamily: "Inter_500Medium", color: colors.foreground, flex: 1 },
    bottomBar: {
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      padding: 16,
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 8 : 12),
      gap: 10,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.primaryForeground },
    secondaryBtn: {
      borderRadius: 12,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: colors.foreground },
    noVenues: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
    noVenuesText: { fontSize: 15, fontFamily: "Inter_400Regular", color: colors.mutedForeground, textAlign: "center" },
  });

  if (bookingLoading || !initialized) {
    return (
      <View style={s.container}>
        <Stack.Screen options={{ title: "Edit Booking", headerBackTitle: "Back" }} />
        <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
      </View>
    );
  }

  if (!booking) {
    return (
      <View style={s.container}>
        <Stack.Screen options={{ title: "Edit Booking", headerBackTitle: "Back" }} />
        <View style={s.center}>
          <Text style={{ color: colors.mutedForeground }}>Booking not found.</Text>
        </View>
      </View>
    );
  }

  const approvedVenues = venues.filter(v => v.status === "APPROVED");

  const renderStep0 = () => {
    if (venuesLoading) {
      return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;
    }
    if (approvedVenues.length === 0) {
      return (
        <View style={s.noVenues}>
          <FeatherIcons name="home" size={32} color={colors.mutedForeground} />
          <Text style={s.noVenuesText}>You have no approved venues.</Text>
        </View>
      );
    }

    return (
      <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}>
        <Text style={s.sectionTitle}>Venue</Text>
        {approvedVenues.map(venue => (
          <TouchableOpacity
            key={venue.id}
            style={[s.listItem, selectedVenue?.id === venue.id && s.listItemSelected]}
            onPress={() => {
              setSelectedVenue({ id: venue.id, name: venue.name });
              if (selectedPitch && booking.venueId !== venue.id) setSelectedPitch(null);
            }}
            activeOpacity={0.7}
          >
            <Feather
              name="home"
              size={18}
              color={selectedVenue?.id === venue.id ? colors.primary : colors.mutedForeground}
            />
            <View style={{ flex: 1 }}>
              <Text style={s.listItemTitle}>{venue.name}</Text>
              <Text style={s.listItemSub}>{venue.district}</Text>
            </View>
            {selectedVenue?.id === venue.id && (
              <FeatherIcons name="check-circle" size={18} color={colors.primary} />
            )}
          </TouchableOpacity>
        ))}

        {selectedVenue && (
          venueDetailLoading ? (
            <View style={{ paddingVertical: 20, alignItems: "center" }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : venuePitches.length === 0 ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
              <Text style={s.noVenuesText}>This venue has no pitches configured yet.</Text>
            </View>
          ) : (
            <>
              <Text style={[s.sectionTitle, { paddingTop: 20 }]}>Pitch</Text>
              {venuePitches.map((pitch) => (
                <TouchableOpacity
                  key={pitch.id}
                  style={[s.listItem, selectedPitch?.id === pitch.id && s.listItemSelected]}
                  onPress={() => setSelectedPitch({ id: pitch.id, name: pitch.name, slotDurationMinutes: pitch.slotDurationMinutes })}
                  activeOpacity={0.7}
                >
                  <Feather
                    name="grid"
                    size={18}
                    color={selectedPitch?.id === pitch.id ? colors.primary : colors.mutedForeground}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={s.listItemTitle}>{pitch.name}</Text>
                    <Text style={s.listItemSub}>{pitch.type} · {pitch.size} · {pitch.slotDurationMinutes}min slots</Text>
                  </View>
                  {selectedPitch?.id === pitch.id && (
                    <FeatherIcons name="check-circle" size={18} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </>
          )
        )}
      </ScrollView>
    );
  };

  const renderStep1 = () => (
    <View style={{ flex: 1 }}>
      <View style={s.calSection}>
        <View style={s.monthNav}>
          <TouchableOpacity style={s.navBtn} onPress={prevMonth}>
            <FeatherIcons name="chevron-left" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.monthLabel}>{MONTH_NAMES[displayMonth]} {displayYear}</Text>
          <TouchableOpacity style={s.navBtn} onPress={nextMonth}>
            <FeatherIcons name="chevron-right" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <View style={s.dayNamesRow}>
          {DAY_NAMES.map(d => (
            <View key={d} style={s.dayNameCell}>
              <Text style={s.dayNameText}>{d}</Text>
            </View>
          ))}
        </View>

        {gridRows.map((row, ri) => (
          <View key={ri} style={s.gridRow}>
            {row.map(({ date, isCurrentMonth }, ci) => {
              const isPast = date < today;
              const isToday = isSameDay(date, today);
              const isSelected = selectedDate ? isSameDay(date, selectedDate) : false;
              const isAdj = !isCurrentMonth;
              return (
                <TouchableOpacity
                  key={ci}
                  style={[
                    s.dayCell,
                    isToday && !isSelected && s.dayCellToday,
                    isSelected && s.dayCellSelected,
                  ]}
                  onPress={() => {
                    if (isAdj || isPast) return;
                    setSelectedDate(date);
                    setSelectedSlot(null);
                  }}
                  disabled={isAdj || isPast}
                  activeOpacity={isAdj || isPast ? 1 : 0.7}
                >
                  <Text style={[
                    s.dayText,
                    isAdj && s.dayTextAdjacent,
                    isPast && s.dayTextPast,
                    isToday && !isSelected && s.dayTextToday,
                    isSelected && s.dayTextSelected,
                  ]}>
                    {date.getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      <View style={s.slotsSection}>
        {!selectedDate ? (
          <View style={s.noDateWrap}>
            <FeatherIcons name="calendar" size={28} color={colors.mutedForeground} />
            <Text style={s.noDateText}>Pick a date to see available slots</Text>
          </View>
        ) : slotsLoading ? (
          <View style={s.noDateWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : slots.length === 0 ? (
          <View style={s.noDateWrap}>
            <FeatherIcons name="moon" size={28} color={colors.mutedForeground} />
            <Text style={s.noDateText}>No slots available on this date</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.slotsGrid}>
            {slots.map(slot => {
              const isCurrentBookingSlot =
                originalSlot &&
                selectedPitch?.id === originalSlot.pitchId &&
                slot.startAt === originalSlot.startAt;
              const avail = isCurrentBookingSlot ? true : slot.available;
              const isSelected = selectedSlot?.startAt === slot.startAt;
              return (
                <TouchableOpacity
                  key={slot.startAt}
                  style={[s.slot, avail && s.slotAvailable, isSelected && s.slotSelected, !avail && s.slotUnavailable]}
                  onPress={() => {
                    if (!avail) return;
                    setSelectedSlot(isSelected ? null : { startAt: slot.startAt, endAt: slot.endAt });
                  }}
                  disabled={!avail}
                  activeOpacity={avail ? 0.7 : 1}
                >
                  <Text style={[s.slotTime, avail && s.slotTimeAvailable, isSelected && s.slotTimeSelected]}>
                    {formatSlotTime(slot.startAt)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>
    </View>
  );

  const renderStep2 = () => (
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={s.formSection}>
        <View>
          <Text style={s.fieldLabel}>GUEST NAME *</Text>
          <TextInput
            style={s.textInput}
            value={guestName}
            onChangeText={setGuestName}
            placeholder="Full name of the player"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
          />
        </View>
        <View>
          <Text style={s.fieldLabel}>GUEST PHONE *</Text>
          <TextInput
            style={s.textInput}
            value={guestPhone}
            onChangeText={setGuestPhone}
            placeholder="+357 99 123456"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="phone-pad"
          />
        </View>
      </View>

      <View style={s.reviewCard}>
        <Text style={s.reviewCardTitle}>Updated Summary</Text>
        <View style={[s.reviewRow, s.reviewRowFirst]}>
          <Text style={s.reviewLabel}>Venue</Text>
          <Text style={s.reviewValue}>{selectedVenue?.name}</Text>
        </View>
        <View style={s.reviewRow}>
          <Text style={s.reviewLabel}>Pitch</Text>
          <Text style={s.reviewValue}>{selectedPitch?.name}</Text>
        </View>
        {selectedDate && (
          <View style={s.reviewRow}>
            <Text style={s.reviewLabel}>Date</Text>
            <Text style={s.reviewValue}>
              {selectedDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </Text>
          </View>
        )}
        {selectedSlot && (
          <View style={s.reviewRow}>
            <Text style={s.reviewLabel}>Time</Text>
            <Text style={s.reviewValue}>{formatSlotTime(selectedSlot.startAt)} – {formatSlotTime(selectedSlot.endAt)}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );

  const renderNonManualReview = () => (
    <ScrollView contentContainerStyle={{ paddingBottom: 24, paddingTop: 8 }}>
      <View style={s.reviewCard}>
        <Text style={s.reviewCardTitle}>Updated Summary</Text>
        <View style={[s.reviewRow, s.reviewRowFirst]}>
          <Text style={s.reviewLabel}>Venue</Text>
          <Text style={s.reviewValue}>{selectedVenue?.name}</Text>
        </View>
        <View style={s.reviewRow}>
          <Text style={s.reviewLabel}>Pitch</Text>
          <Text style={s.reviewValue}>{selectedPitch?.name}</Text>
        </View>
        {selectedDate && (
          <View style={s.reviewRow}>
            <Text style={s.reviewLabel}>Date</Text>
            <Text style={s.reviewValue}>
              {selectedDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </Text>
          </View>
        )}
        {selectedSlot && (
          <View style={s.reviewRow}>
            <Text style={s.reviewLabel}>Time</Text>
            <Text style={s.reviewValue}>{formatSlotTime(selectedSlot.startAt)} – {formatSlotTime(selectedSlot.endAt)}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );

  const isLastStep = step === STEPS.length - 1;

  return (
    <View style={s.container}>
      <Stack.Screen options={{ title: "Edit Booking", headerBackTitle: "Back" }} />

      <View style={s.progressWrap}>
        {STEPS.map((label, i) => (
          <View key={i} style={s.progressStep}>
            <View style={[s.progressBar, { backgroundColor: i <= step ? colors.primary : colors.border }]} />
            <Text style={[s.progressLabel, i === step && s.progressLabelActive]}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={{ flex: 1 }}>
        {step === 0 && renderStep0()}
        {step === 1 && renderStep1()}
        {step === 2 && (isManual ? renderStep2() : renderNonManualReview())}
      </View>

      <View style={s.bottomBar}>
        {isLastStep ? (
          <TouchableOpacity
            style={[s.primaryBtn, (!canGoNext() || updateBooking.isPending) && s.primaryBtnDisabled]}
            onPress={handleSave}
            disabled={!canGoNext() || updateBooking.isPending}
            activeOpacity={0.8}
          >
            {updateBooking.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={s.primaryBtnText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.primaryBtn, !canGoNext() && s.primaryBtnDisabled]}
            onPress={goNext}
            disabled={!canGoNext()}
            activeOpacity={0.8}
          >
            <Text style={s.primaryBtnText}>Continue</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.secondaryBtn} onPress={goBack} activeOpacity={0.8}>
          <Text style={s.secondaryBtnText}>{step === 0 ? "Cancel" : "Back"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
