import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
  Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import {
  createVenue,
  createPitch,
  setPricingRules,
  setOpeningHours,
  submitVenueForApproval,
  getListOwnerVenuesQueryKey,
  validateRequestBody,
  type PitchType,
  type OpeningHoursInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DRAFT_KEY = "@futsalcy/onboarding_draft";
export const ONBOARDING_STATUS_KEY = "@futsalcy/onboarding_status";
export type OnboardingStatus = "in_progress" | "completed";

// ─── Time helpers ─────────────────────────────────────────────────────────────
function isValidHHMM(time: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  const [h, m] = time.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

const DISTRICTS = [
  "Nicosia", "Limassol", "Larnaca", "Paphos",
  "Ayia Napa", "Protaras", "Kyrenia",
];

const AMENITIES_OPTIONS = [
  "Parking", "Changing Rooms", "Showers", "Floodlights",
  "Café", "Toilets", "WiFi", "First Aid", "Equipment Rental",
];

const PITCH_TYPES: { key: PitchType; label: string; icon: "home" | "sun" | "layers" }[] = [
  { key: "OUTDOOR", label: "Outdoor", icon: "sun" },
  { key: "INDOOR", label: "Indoor", icon: "home" },
  { key: "HYBRID", label: "Hybrid (covered/open)", icon: "layers" },
];

const SLOT_DURATIONS = [
  { value: "30", label: "30 min" },
  { value: "60", label: "60 min" },
  { value: "90", label: "90 min" },
  { value: "120", label: "120 min" },
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type DaySchedule = { isClosed: boolean; openTime: string; closeTime: string };

const DEFAULT_HOURS: DaySchedule[] = [
  { isClosed: true, openTime: "09:00", closeTime: "22:00" },
  { isClosed: false, openTime: "08:00", closeTime: "22:00" },
  { isClosed: false, openTime: "08:00", closeTime: "22:00" },
  { isClosed: false, openTime: "08:00", closeTime: "22:00" },
  { isClosed: false, openTime: "08:00", closeTime: "22:00" },
  { isClosed: false, openTime: "08:00", closeTime: "22:00" },
  { isClosed: false, openTime: "09:00", closeTime: "22:00" },
];

type DraftState = {
  step: number;
  venueId: string | null;
  name: string;
  district: string;
  address: string;
  description: string;
  contactPhone: string;
  cancellationWindowHours: string;
  selectedAmenities: string[];
  pitchName: string;
  pitchType: PitchType;
  pitchSize: string;
  pitchPrice: string;
  pitchSlotDuration: string;
  pitchSaved: boolean;
  schedule: DaySchedule[];
};

const DEFAULT_DRAFT: DraftState = {
  step: 0,
  venueId: null,
  name: "",
  district: "",
  address: "",
  description: "",
  contactPhone: "",
  cancellationWindowHours: "24",
  selectedAmenities: [],
  pitchName: "",
  pitchType: "OUTDOOR",
  pitchSize: "5v5",
  pitchPrice: "",
  pitchSlotDuration: "60",
  pitchSaved: false,
  schedule: DEFAULT_HOURS.map((d) => ({ ...d })),
};

const STEP_LABELS = ["Details", "Pitches", "Hours", "Review"];
const STEP_TITLES = ["Venue Details", "First Pitch", "Opening Hours", "Review & Submit"];

export async function clearOnboardingDraft() {
  await AsyncStorage.removeItem(DRAFT_KEY);
}

export default function OwnerOnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [draftLoaded, setDraftLoaded] = useState(false);
  const [stepLoading, setStepLoading] = useState(false);

  const [step, setStep] = useState(0);
  const [venueId, setVenueId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [district, setDistrict] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [cancellationWindowHours, setCancellationWindowHours] = useState("24");
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);

  const [pitchName, setPitchName] = useState("");
  const [pitchType, setPitchType] = useState<PitchType>("OUTDOOR");
  const [pitchSize, setPitchSize] = useState("5v5");
  const [pitchPrice, setPitchPrice] = useState("");
  const [pitchSlotDuration, setPitchSlotDuration] = useState("60");
  const [pitchSaved, setPitchSaved] = useState(false);

  const [schedule, setSchedule] = useState<DaySchedule[]>(
    DEFAULT_HOURS.map((d) => ({ ...d })),
  );

  const [nameError, setNameError] = useState("");
  const [districtError, setDistrictError] = useState("");
  const [addressError, setAddressError] = useState("");
  const [contactPhoneError, setContactPhoneError] = useState("");
  const [pitchNameError, setPitchNameError] = useState("");
  const [pitchSizeError, setPitchSizeError] = useState("");
  const [hoursError, setHoursError] = useState("");
  const [submitError, setSubmitError] = useState("");

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Load draft on mount ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        if (raw) {
          const draft: DraftState = JSON.parse(raw);
          setStep(draft.step ?? 0);
          setVenueId(draft.venueId ?? null);
          setName(draft.name ?? "");
          setDistrict(draft.district ?? "");
          setAddress(draft.address ?? "");
          setDescription(draft.description ?? "");
          setContactPhone(draft.contactPhone ?? "");
          setCancellationWindowHours(draft.cancellationWindowHours ?? "24");
          setSelectedAmenities(draft.selectedAmenities ?? []);
          setPitchName(draft.pitchName ?? "");
          setPitchType(draft.pitchType ?? "OUTDOOR");
          setPitchSize(draft.pitchSize ?? "5v5");
          setPitchPrice(draft.pitchPrice ?? "");
          setPitchSlotDuration(draft.pitchSlotDuration ?? "60");
          setPitchSaved(draft.pitchSaved ?? false);
          if (draft.schedule?.length === 7) setSchedule(draft.schedule);
        }
      } catch {
        // ignore
      } finally {
        setDraftLoaded(true);
      }
    })();
  }, []);

  // ─── Persist draft on state change ──────────────────────────────────────
  const persistDraft = () => {
    const draft: DraftState = {
      step, venueId, name, district, address, description,
      contactPhone, cancellationWindowHours, selectedAmenities,
      pitchName, pitchType, pitchSize, pitchPrice, pitchSlotDuration,
      pitchSaved, schedule,
    };
    AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft)).catch(() => {});
  };

  const schedulePersist = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(persistDraft, 600);
  };

  useEffect(() => {
    if (!draftLoaded) return;
    schedulePersist();
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [
    draftLoaded, step, venueId, name, district, address, description,
    contactPhone, cancellationWindowHours, selectedAmenities,
    pitchName, pitchType, pitchSize, pitchPrice, pitchSlotDuration,
    pitchSaved, schedule,
  ]);

  const toggleAmenity = (a: string) =>
    setSelectedAmenities((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a],
    );

  const updateDay = (i: number, patch: Partial<DaySchedule>) =>
    setSchedule((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  // ─── Skip handler ────────────────────────────────────────────────────────
  const handleSkip = async () => {
    persistDraft();
    await AsyncStorage.setItem(ONBOARDING_STATUS_KEY, "in_progress");
    router.replace("/(owner)");
  };

  // ─── Step transitions ────────────────────────────────────────────────────
  const handleNext = async () => {
    if (stepLoading) return;

    if (step === 0) {
      let hasError = false;
      if (!name.trim()) { setNameError("Venue name is required."); hasError = true; }
      if (!district) { setDistrictError("Please select a district."); hasError = true; }
      if (!address.trim()) { setAddressError("Address is required."); hasError = true; }
      if (!contactPhone.trim()) { setContactPhoneError("Contact phone number is required."); hasError = true; }
      if (hasError) return;
      const cancellationValue = cancellationWindowHours.trim();
      if (!/^\d+$/.test(cancellationValue)) {
        setNameError("Cancellation window must be a whole number.");
        return;
      }
      const cancellationHours = Number(cancellationValue);
      if (!Number.isSafeInteger(cancellationHours) || cancellationHours < 0 || cancellationHours > 168) {
        setNameError("Cancellation window must be between 0 and 168 hours.");
        return;
      }
      const venuePayload = {
        name: name.trim(),
        district,
        address: address.trim(),
        description: description.trim() || undefined,
        amenities: selectedAmenities,
        cancellationWindowHours: cancellationHours,
        contactPhone: contactPhone.trim(),
      };
      if (!validateRequestBody("POST", "/owner/venues", venuePayload).success) {
        setNameError("Please review the venue details and try again.");
        return;
      }

      setStepLoading(true);
      try {
        const result = await createVenue(venuePayload);
        const id = result?.venue?.id;
        if (!id) throw new Error("No venue ID returned");
        setVenueId(id);
        setStep(1);
      } catch {
        setNameError("Could not create venue. Please check your details and try again.");
      } finally {
        setStepLoading(false);
      }
      return;
    }

    if (step === 1) {
      if (!venueId) return;
      let hasError = false;
      if (!pitchName.trim()) { setPitchNameError("Pitch name is required."); hasError = true; }
      if (!pitchSize.trim()) { setPitchSizeError("Pitch size / format is required."); hasError = true; }
      if (hasError) return;
      const durationValue = pitchSlotDuration.trim();
      if (!/^\d+$/.test(durationValue)) {
        setPitchSizeError("Slot duration must be a whole number.");
        return;
      }
      const slotDurationMinutes = Number(durationValue);
      if (!Number.isSafeInteger(slotDurationMinutes) || slotDurationMinutes < 15 || slotDurationMinutes > 240) {
        setPitchSizeError("Slot duration must be between 15 and 240 minutes.");
        return;
      }
      if (pitchPrice.trim() && !/^(?:0|[1-9]\d{0,7})(?:[.,]\d{1,2})?$/.test(pitchPrice.trim())) {
        setPitchSizeError("Please enter a valid hourly price.");
        return;
      }

      setStepLoading(true);
      try {
        if (!pitchSaved) {
          const pitchPayload = {
            name: pitchName.trim(),
            type: pitchType,
            size: pitchSize.trim(),
            slotDurationMinutes,
          };
          if (!validateRequestBody("POST", "/owner/venues/:id/pitches", pitchPayload).success) {
            setPitchSizeError("Please review the pitch details and try again.");
            return;
          }
          const pitchResult = await createPitch(venueId, pitchPayload);
          const pid = pitchResult?.pitch?.id;
          if (pid && pitchPrice.trim()) {
            await setPricingRules(venueId, pid, {
              rules: [{ dayType: "ALL", pricePerHour: pitchPrice.trim(), depositType: "NONE" }],
            });
          }
          setPitchSaved(true);
        }
        setStep(2);
      } catch {
        setPitchNameError("Could not save pitch. Please try again.");
      } finally {
        setStepLoading(false);
      }
      return;
    }

    if (step === 2) {
      if (!venueId) return;
      const dayErrors: string[] = [];
      let hasOpenDay = false;

      schedule.forEach((d, i) => {
        if (d.isClosed) return;
        hasOpenDay = true;
        if (!isValidHHMM(d.openTime)) {
          dayErrors.push(`${DAY_LABELS[i]}: opening time must be HH:MM (e.g. 08:00).`);
        } else if (!isValidHHMM(d.closeTime)) {
          dayErrors.push(`${DAY_LABELS[i]}: closing time must be HH:MM (e.g. 22:00).`);
        } else if (timeToMinutes(d.openTime) >= timeToMinutes(d.closeTime)) {
          dayErrors.push(`${DAY_LABELS[i]}: closing time must be after opening time.`);
        }
      });

      if (!hasOpenDay) {
        setHoursError("Please set at least one open day.");
        return;
      }
      if (dayErrors.length > 0) {
        setHoursError(dayErrors.join("\n"));
        return;
      }
      setHoursError("");
      setStepLoading(true);
      try {
        const hours: OpeningHoursInput[] = schedule.map((d, i) => ({
          dayOfWeek: i,
          openTime: d.openTime,
          closeTime: d.closeTime,
          isClosed: d.isClosed,
        }));
        await setOpeningHours(venueId, { hours });
        setStep(3);
      } catch {
        setHoursError("Could not save opening hours. Please try again.");
      } finally {
        setStepLoading(false);
      }
      return;
    }

    if (step === 3) {
      if (!venueId) return;
      setSubmitError("");
      setStepLoading(true);
      try {
        await submitVenueForApproval(venueId);
        await queryClient.invalidateQueries({ queryKey: getListOwnerVenuesQueryKey() });
        await AsyncStorage.removeItem(DRAFT_KEY);
        await AsyncStorage.setItem(ONBOARDING_STATUS_KEY, "completed");
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace("/(owner)");
      } catch {
        setSubmitError(
          "Could not submit your venue. Please check your connection and try again.",
        );
      } finally {
        setStepLoading(false);
      }
    }
  };

  const handleBack = () => {
    if (step === 0) {
      handleSkip();
    } else if (step === 1 && venueId) {
      setStep(0);
    } else {
      setStep((s) => s - 1);
    }
  };

  if (!draftLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 24,
      paddingTop: insets.top + (Platform.OS === "web" ? 16 : 12),
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    headerTitle: {
      fontSize: 16,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
    },
    skipBtn: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    skipText: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.mutedForeground,
    },
    scroll: { flex: 1 },
    inner: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: insets.bottom + 40 },
    stepBar: { flexDirection: "row", gap: 6, marginBottom: 8 },
    stepDot: { height: 4, flex: 1, borderRadius: 2 },
    stepMeta: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground, marginBottom: 4 },
    stepTitle: { fontSize: 22, fontFamily: "PlusJakartaSans_700Bold", color: colors.foreground, marginBottom: 24 },
    field: { marginBottom: 18 },
    label: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium", color: colors.foreground, marginBottom: 6 },
    required: { color: colors.destructive },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      height: 48,
      fontSize: 15,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
    },
    inputError: { borderColor: colors.destructive },
    errorText: {
      fontSize: 12,
      color: colors.destructive,
      fontFamily: "PlusJakartaSans_400Regular",
      marginTop: 4,
    },
    textArea: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
      minHeight: 80,
      textAlignVertical: "top",
    },
    chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
    chipText: { fontSize: 14, fontFamily: "PlusJakartaSans_500Medium" },
    typeChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 2,
      marginBottom: 8,
    },
    typeChipText: { fontSize: 14, fontFamily: "PlusJakartaSans_500Medium" },
    slotChipRow: { flexDirection: "row", gap: 8 },
    slotChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5 },
    slotChipText: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium" },
    dayRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 10,
    },
    dayLabel: { width: 36, fontSize: 14, fontFamily: "PlusJakartaSans_500Medium", color: colors.foreground },
    timeInput: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      height: 38,
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
      textAlign: "center",
    },
    timeSep: { fontSize: 14, color: colors.mutedForeground },
    closedText: { flex: 2, fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground },
    reviewCard: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 16,
    },
    reviewRow: { marginBottom: 10 },
    reviewLabel: {
      fontSize: 11,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    reviewValue: { fontSize: 14, fontFamily: "PlusJakartaSans_400Regular", color: colors.foreground },
    reviewSectionTitle: { fontSize: 15, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground, marginBottom: 10 },
    note: {
      backgroundColor: colors.primary + "15",
      borderRadius: 10,
      padding: 14,
      marginBottom: 24,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
    },
    noteText: { flex: 1, fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: colors.primary, lineHeight: 18 },
    hintText: { fontSize: 11, color: colors.mutedForeground, marginTop: 4, fontFamily: "PlusJakartaSans_400Regular" },
    footer: {
      flexDirection: "row",
      gap: 12,
      paddingHorizontal: 24,
      paddingBottom: insets.bottom + (Platform.OS === "ios" ? 24 : 16),
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    backBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      height: 52,
      paddingHorizontal: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    backBtnText: { fontSize: 15, fontFamily: "PlusJakartaSans_500Medium", color: colors.foreground },
    nextBtn: {
      flex: 1,
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    nextBtnText: { fontSize: 16, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primaryForeground },
  });

  const isLastStep = step === STEP_LABELS.length - 1;
  const nextBtnLabel = isLastStep ? "Submit for Approval" : step === 0 ? "Create & Continue" : "Save & Continue";

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Venue Setup</Text>
        <TouchableOpacity style={s.skipBtn} onPress={handleSkip} disabled={stepLoading}>
          <Text style={s.skipText}>Do this later</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        {/* Progress bar */}
        <View style={s.stepBar}>
          {STEP_LABELS.map((_, i) => (
            <View
              key={i}
              style={[s.stepDot, { backgroundColor: i <= step ? colors.primary : colors.border }]}
            />
          ))}
        </View>
        <Text style={s.stepMeta}>
          Step {step + 1} of {STEP_LABELS.length} — {STEP_LABELS[step]}
        </Text>
        <Text style={s.stepTitle}>{STEP_TITLES[step]}</Text>

        {/* ── Step 0: Venue details ─────────────────────────────────── */}
        {step === 0 && (
          <>
            <View style={s.field}>
              <Text style={s.label}>Venue Name <Text style={s.required}>*</Text></Text>
              <TextInput
                style={[s.input, nameError ? s.inputError : undefined]}
                value={name}
                onChangeText={(v) => { setName(v); if (v.trim()) setNameError(""); }}
                placeholder="e.g. Champions Arena"
                placeholderTextColor={colors.mutedForeground}
                maxLength={160}
                autoCapitalize="words"
              />
              {!!nameError && <Text style={s.errorText}>{nameError}</Text>}
            </View>

            <View style={s.field}>
              <Text style={s.label}>District <Text style={s.required}>*</Text></Text>
              <View style={s.chipGrid}>
                {DISTRICTS.map((d) => {
                  const active = district === d;
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[
                        s.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : districtError ? colors.destructive : colors.border,
                        },
                      ]}
                      onPress={() => { setDistrict(d); setDistrictError(""); }}
                    >
                      <Text style={[s.chipText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                        {d}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {!!districtError && <Text style={s.errorText}>{districtError}</Text>}
            </View>

            <View style={s.field}>
              <Text style={s.label}>Full Address <Text style={s.required}>*</Text></Text>
              <TextInput
                style={[s.input, addressError ? s.inputError : undefined]}
                value={address}
                onChangeText={(v) => { setAddress(v); if (v.trim()) setAddressError(""); }}
                placeholder="Street, city"
                placeholderTextColor={colors.mutedForeground}
                maxLength={300}
              />
              {!!addressError && <Text style={s.errorText}>{addressError}</Text>}
            </View>

            <View style={s.field}>
              <Text style={s.label}>Contact Phone Number <Text style={s.required}>*</Text></Text>
              <TextInput
                style={[s.input, contactPhoneError ? s.inputError : undefined]}
                value={contactPhone}
                onChangeText={(v) => { setContactPhone(v); if (v.trim()) setContactPhoneError(""); }}
                placeholder="e.g. +357 99 123456"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
                autoComplete="tel"
                maxLength={32}
              />
              {!!contactPhoneError
                ? <Text style={s.errorText}>{contactPhoneError}</Text>
                : <Text style={s.hintText}>Admins will call this to verify your venue.</Text>
              }
            </View>

            <View style={s.field}>
              <Text style={s.label}>Description (optional)</Text>
              <TextInput
                style={s.textArea}
                value={description}
                onChangeText={setDescription}
                placeholder="Tell players about your venue…"
                placeholderTextColor={colors.mutedForeground}
                maxLength={4000}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={s.field}>
              <Text style={s.label}>Cancellation Window (hours)</Text>
              <TextInput
                style={s.input}
                value={cancellationWindowHours}
                onChangeText={setCancellationWindowHours}
                keyboardType="numeric"
                inputMode="numeric"
                maxLength={3}
                placeholder="24"
                placeholderTextColor={colors.mutedForeground}
              />
              <Text style={s.hintText}>Players can cancel up to this many hours before their booking starts.</Text>
            </View>

            <View style={s.field}>
              <Text style={s.label}>Amenities</Text>
              <View style={s.chipGrid}>
                {AMENITIES_OPTIONS.map((a) => {
                  const active = selectedAmenities.includes(a);
                  return (
                    <TouchableOpacity
                      key={a}
                      style={[s.chip, { backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border }]}
                      onPress={() => toggleAmenity(a)}
                    >
                      <Text style={[s.chipText, { color: active ? colors.primaryForeground : colors.foreground }]}>{a}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </>
        )}

        {/* ── Step 1: First pitch ───────────────────────────────────── */}
        {step === 1 && (
          <>
            <View style={s.note}>
              <FeatherIcons name="info" size={16} color={colors.primary} />
              <Text style={s.noteText}>
                Add your first pitch — required before your venue can go live. You can add more pitches later.
              </Text>
            </View>

            <View style={s.field}>
              <Text style={s.label}>Pitch Name <Text style={s.required}>*</Text></Text>
              <TextInput
                style={[s.input, pitchNameError ? s.inputError : undefined]}
                value={pitchName}
                onChangeText={(v) => { setPitchName(v); if (v.trim()) setPitchNameError(""); }}
                placeholder="e.g. Pitch A"
                placeholderTextColor={colors.mutedForeground}
                maxLength={80}
                autoCapitalize="words"
              />
              {!!pitchNameError && <Text style={s.errorText}>{pitchNameError}</Text>}
            </View>

            <View style={s.field}>
              <Text style={s.label}>Pitch Type <Text style={s.required}>*</Text></Text>
              {PITCH_TYPES.map((t) => {
                const active = pitchType === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    style={[
                      s.typeChip,
                      { backgroundColor: active ? colors.primary + "15" : colors.card, borderColor: active ? colors.primary : colors.border },
                    ]}
                    onPress={() => setPitchType(t.key)}
                  >
                    <FeatherIcons name={t.icon} size={18} color={active ? colors.primary : colors.mutedForeground} />
                    <Text style={[s.typeChipText, { color: active ? colors.primary : colors.foreground }]}>{t.label}</Text>
                    {active && <FeatherIcons name="check-circle" size={16} color={colors.primary} style={{ marginLeft: "auto" }} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={s.field}>
              <Text style={s.label}>Format / Size <Text style={s.required}>*</Text></Text>
              <TextInput
                style={[s.input, pitchSizeError ? s.inputError : undefined]}
                value={pitchSize}
                onChangeText={(v) => { setPitchSize(v); if (v.trim()) setPitchSizeError(""); }}
                placeholder="e.g. 5v5, 6v6, 7v7"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                maxLength={80}
              />
              {!!pitchSizeError && <Text style={s.errorText}>{pitchSizeError}</Text>}
            </View>

            <View style={s.field}>
              <Text style={s.label}>Slot Duration <Text style={s.required}>*</Text></Text>
              <View style={s.slotChipRow}>
                {SLOT_DURATIONS.map((sd) => {
                  const active = pitchSlotDuration === sd.value;
                  return (
                    <TouchableOpacity
                      key={sd.value}
                      style={[
                        s.slotChip,
                        { backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border },
                      ]}
                      onPress={() => setPitchSlotDuration(sd.value)}
                    >
                      <Text style={[s.slotChipText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                        {sd.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={s.hintText}>How long each booking slot lasts.</Text>
            </View>

            <View style={s.field}>
              <Text style={s.label}>Price per hour (€)</Text>
              <TextInput
                style={s.input}
                value={pitchPrice}
                onChangeText={setPitchPrice}
                placeholder="e.g. 50"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="numeric"
              />
            </View>
          </>
        )}

        {/* ── Step 2: Opening hours ──────────────────────────────────── */}
        {step === 2 && (
          <>
            <View style={s.note}>
              <FeatherIcons name="clock" size={16} color={colors.primary} />
              <Text style={s.noteText}>Set your weekly opening hours. Toggle each day open or closed.</Text>
            </View>

            {!!hoursError && (
              <View style={{ backgroundColor: colors.destructive + "15", borderRadius: 10, padding: 12, marginBottom: 16, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <FeatherIcons name="alert-circle" size={14} color={colors.destructive} />
                <Text style={[s.errorText, { marginTop: 0 }]}>{hoursError}</Text>
              </View>
            )}

            {DAY_LABELS.map((day, i) => {
              const d = schedule[i];
              return (
                <View key={day} style={s.dayRow}>
                  <Text style={s.dayLabel}>{day}</Text>
                  <Switch
                    value={!d.isClosed}
                    onValueChange={(v) => { updateDay(i, { isClosed: !v }); setHoursError(""); }}
                    trackColor={{ false: colors.border, true: colors.primary + "60" }}
                    thumbColor={!d.isClosed ? colors.primary : colors.mutedForeground}
                  />
                  {d.isClosed ? (
                    <Text style={s.closedText}>Closed</Text>
                  ) : (
                    <>
                      <TextInput
                        style={s.timeInput}
                        value={d.openTime}
                        onChangeText={(v) => updateDay(i, { openTime: v })}
                        placeholder="08:00"
                        placeholderTextColor={colors.mutedForeground}
                      />
                      <Text style={s.timeSep}>–</Text>
                      <TextInput
                        style={s.timeInput}
                        value={d.closeTime}
                        onChangeText={(v) => updateDay(i, { closeTime: v })}
                        placeholder="22:00"
                        placeholderTextColor={colors.mutedForeground}
                      />
                    </>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* ── Step 3: Review & Submit ────────────────────────────────── */}
        {step === 3 && (
          <>
            <View style={s.note}>
              <FeatherIcons name="check-circle" size={16} color={colors.primary} />
              <Text style={s.noteText}>
                Review your venue details before submitting for admin approval. Approved venues become visible to players.
              </Text>
            </View>

            {!!submitError && (
              <View style={{ backgroundColor: colors.destructive + "15", borderRadius: 10, padding: 14, marginBottom: 16, flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <FeatherIcons name="alert-circle" size={16} color={colors.destructive} />
                <Text style={{ flex: 1, fontSize: 13, fontFamily: "PlusJakartaSans_500Medium", color: colors.destructive, lineHeight: 18 }}>
                  {submitError}
                </Text>
              </View>
            )}

            <View style={s.reviewCard}>
              <Text style={s.reviewSectionTitle}>Venue</Text>
              <View style={s.reviewRow}>
                <Text style={s.reviewLabel}>Name</Text>
                <Text style={s.reviewValue}>{name}</Text>
              </View>
              <View style={s.reviewRow}>
                <Text style={s.reviewLabel}>District</Text>
                <Text style={s.reviewValue}>{district}</Text>
              </View>
              <View style={s.reviewRow}>
                <Text style={s.reviewLabel}>Address</Text>
                <Text style={s.reviewValue}>{address}</Text>
              </View>
              {!!description && (
                <View style={s.reviewRow}>
                  <Text style={s.reviewLabel}>Description</Text>
                  <Text style={s.reviewValue}>{description}</Text>
                </View>
              )}
              {selectedAmenities.length > 0 && (
                <View style={s.reviewRow}>
                  <Text style={s.reviewLabel}>Amenities</Text>
                  <Text style={s.reviewValue}>{selectedAmenities.join(", ")}</Text>
                </View>
              )}
            </View>

            <View style={s.reviewCard}>
              <Text style={s.reviewSectionTitle}>First Pitch</Text>
              <View style={s.reviewRow}>
                <Text style={s.reviewLabel}>Name</Text>
                <Text style={s.reviewValue}>{pitchName}</Text>
              </View>
              <View style={s.reviewRow}>
                <Text style={s.reviewLabel}>Type</Text>
                <Text style={s.reviewValue}>{PITCH_TYPES.find((t) => t.key === pitchType)?.label ?? pitchType}</Text>
              </View>
              <View style={s.reviewRow}>
                <Text style={s.reviewLabel}>Size</Text>
                <Text style={s.reviewValue}>{pitchSize}</Text>
              </View>
              <View style={s.reviewRow}>
                <Text style={s.reviewLabel}>Slot Duration</Text>
                <Text style={s.reviewValue}>{pitchSlotDuration} min</Text>
              </View>
              {!!pitchPrice && (
                <View style={s.reviewRow}>
                  <Text style={s.reviewLabel}>Price</Text>
                  <Text style={s.reviewValue}>€{pitchPrice}/hr</Text>
                </View>
              )}
            </View>

            <View style={s.reviewCard}>
              <Text style={s.reviewSectionTitle}>Opening Hours</Text>
              {DAY_LABELS.map((day, i) => {
                const d = schedule[i];
                return (
                  <View key={day} style={s.reviewRow}>
                    <Text style={s.reviewLabel}>{day}</Text>
                    <Text style={s.reviewValue}>{d.isClosed ? "Closed" : `${d.openTime} – ${d.closeTime}`}</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity style={s.backBtn} onPress={handleBack} disabled={stepLoading}>
          <Text style={s.backBtnText}>{step === 0 ? "Skip" : "Back"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.nextBtn, { backgroundColor: stepLoading ? colors.muted : colors.primary }]}
          onPress={handleNext}
          disabled={stepLoading}
        >
          {stepLoading ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Text style={s.nextBtnText}>{nextBtnLabel}</Text>
              {!isLastStep
                ? <FeatherIcons name="arrow-right" size={18} color={colors.primaryForeground} />
                : <FeatherIcons name="send" size={16} color={colors.primaryForeground} />
              }
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
