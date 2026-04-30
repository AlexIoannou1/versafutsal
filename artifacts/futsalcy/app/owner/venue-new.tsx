import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import {
  createVenue,
  createPitch,
  setPricingRules,
  setOpeningHours,
  submitVenueForApproval,
  getListOwnerVenuesQueryKey,
  type PitchType,
  type OpeningHoursInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const DISTRICTS = ["Nicosia", "Limassol", "Larnaca", "Paphos", "Famagusta", "Kyrenia"];

const AMENITIES_OPTIONS = [
  "Parking",
  "Changing Rooms",
  "Showers",
  "Floodlights",
  "Café",
  "Toilets",
  "WiFi",
  "First Aid",
  "Equipment Rental",
];

const PITCH_TYPES: { key: PitchType; label: string; icon: "home" | "sun" | "layers" }[] = [
  { key: "INDOOR", label: "Indoor", icon: "home" },
  { key: "OUTDOOR", label: "Outdoor", icon: "sun" },
  { key: "HYBRID", label: "Hybrid (covered/open)", icon: "layers" },
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type DaySchedule = {
  isClosed: boolean;
  openTime: string;
  closeTime: string;
};

const DEFAULT_HOURS: DaySchedule[] = [
  { isClosed: true, openTime: "09:00", closeTime: "22:00" },   // Sun
  { isClosed: false, openTime: "08:00", closeTime: "22:00" },  // Mon
  { isClosed: false, openTime: "08:00", closeTime: "22:00" },  // Tue
  { isClosed: false, openTime: "08:00", closeTime: "22:00" },  // Wed
  { isClosed: false, openTime: "08:00", closeTime: "22:00" },  // Thu
  { isClosed: false, openTime: "08:00", closeTime: "22:00" },  // Fri
  { isClosed: false, openTime: "09:00", closeTime: "22:00" },  // Sat
];

const STEP_LABELS = ["Details", "Pitches", "Hours", "Review"];

export default function VenueNewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [stepLoading, setStepLoading] = useState(false);

  // Step 0 — Venue details
  const [name, setName] = useState("");
  const [district, setDistrict] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);

  // Created venue ID after step 0 succeeds
  const [venueId, setVenueId] = useState<string | null>(null);

  // Step 1 — First pitch
  const [pitchName, setPitchName] = useState("");
  const [pitchType, setPitchType] = useState<PitchType>("INDOOR");
  const [pitchSize, setPitchSize] = useState("5v5");
  const [pitchPrice, setPitchPrice] = useState("");
  const [pitchSaved, setPitchSaved] = useState(false);
  const [pitchNameError, setPitchNameError] = useState("");

  // Step 2 — Opening hours
  const [schedule, setSchedule] = useState<DaySchedule[]>(DEFAULT_HOURS.map((d) => ({ ...d })));

  const toggleAmenity = (a: string) =>
    setSelectedAmenities((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a],
    );

  const updateDay = (i: number, patch: Partial<DaySchedule>) =>
    setSchedule((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  // ─── Step transitions ────────────────────────────────────────────────────────

  const handleNext = async () => {
    if (stepLoading) return;

    if (step === 0) {
      if (!name.trim()) { Alert.alert("Required", "Venue name is required."); return; }
      if (!district) { Alert.alert("Required", "Please select a district."); return; }
      if (!address.trim()) { Alert.alert("Required", "Address is required."); return; }

      setStepLoading(true);
      try {
        const result = await createVenue({
          name: name.trim(),
          district,
          address: address.trim(),
          description: description.trim() || undefined,
          amenities: selectedAmenities,
        });
        const id = result?.venue?.id;
        if (!id) throw new Error("No venue ID returned");
        setVenueId(id);
        setStep(1);
      } catch {
        Alert.alert("Error", "Could not create venue. Please try again.");
      } finally {
        setStepLoading(false);
      }
      return;
    }

    if (step === 1) {
      if (!venueId) return;
      if (!pitchName.trim()) {
        setPitchNameError("Pitch name is required.");
        return;
      }
      setPitchNameError("");

      setStepLoading(true);
      try {
        if (!pitchSaved) {
          const pitchResult = await createPitch(venueId, {
            name: pitchName.trim(),
            type: pitchType,
            size: pitchSize.trim() || "5v5",
            slotDurationMinutes: 60,
          });
          const pid = pitchResult?.pitch?.id;
          if (pid && pitchPrice.trim()) {
            await setPricingRules(venueId, pid, {
              rules: [
                {
                  dayType: "ALL",
                  pricePerHour: pitchPrice.trim(),
                  depositType: "NONE",
                },
              ],
            });
          }
          setPitchSaved(true);
        }
        setStep(2);
      } catch {
        Alert.alert("Error", "Could not save pitch. Please try again.");
      } finally {
        setStepLoading(false);
      }
      return;
    }

    if (step === 2) {
      if (!venueId) return;
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
        Alert.alert("Error", "Could not save opening hours. Please try again.");
      } finally {
        setStepLoading(false);
      }
      return;
    }

    if (step === 3) {
      if (!venueId) return;
      setStepLoading(true);
      try {
        await submitVenueForApproval(venueId);
        await queryClient.invalidateQueries({ queryKey: getListOwnerVenuesQueryKey() });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace(`/owner/venue/${venueId}`);
      } catch {
        Alert.alert("Error", "Could not submit venue. You can submit later from the venue screen.");
        router.replace(`/owner/venue/${venueId}`);
      } finally {
        setStepLoading(false);
      }
    }
  };

  const handleBack = () => {
    if (step === 0) {
      router.back();
    } else if (step === 1 && venueId) {
      // Venue is already created — skip back to details would be confusing.
      // Go to venue management screen instead.
      router.replace(`/owner/venue/${venueId}`);
    } else {
      setStep((s) => s - 1);
    }
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    inner: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: insets.bottom + 40 },
    stepBar: { flexDirection: "row", gap: 6, marginBottom: 8 },
    stepDot: { height: 4, flex: 1, borderRadius: 2 },
    stepMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginBottom: 4 },
    stepTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 24 },
    field: { marginBottom: 18 },
    label: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground, marginBottom: 6 },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      height: 48,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    textArea: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      minHeight: 80,
      textAlignVertical: "top",
    },
    chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
    chipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
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
    typeChipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
    dayRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 10,
    },
    dayLabel: { width: 36, fontSize: 14, fontFamily: "Inter_500Medium", color: colors.foreground },
    timeInput: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      height: 38,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      textAlign: "center",
    },
    timeSep: { fontSize: 14, color: colors.mutedForeground },
    closedText: { flex: 2, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
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
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    reviewValue: { fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground },
    reviewSectionTitle: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 10,
    },
    note: {
      backgroundColor: colors.primary + "15",
      borderRadius: 10,
      padding: 14,
      marginBottom: 24,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
    },
    noteText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: colors.primary, lineHeight: 18 },
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
    backBtnText: { fontSize: 15, fontFamily: "Inter_500Medium", color: colors.foreground },
    nextBtn: {
      flex: 1,
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    nextBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.primaryForeground },
  });

  const STEP_TITLES = ["Venue Details", "First Pitch", "Opening Hours", "Review & Submit"];
  const isLastStep = step === STEP_LABELS.length - 1;
  const nextBtnLabel = isLastStep
    ? "Submit for Approval"
    : step === 0
    ? "Create & Continue"
    : "Save & Continue";
  const nextBtnColor = isLastStep ? colors.primary : colors.primary;

  return (
    <View style={s.container}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.inner}
        keyboardShouldPersistTaps="handled"
      >
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
              <Text style={s.label}>Venue Name *</Text>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Champions Arena"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
              />
            </View>

            <View style={s.field}>
              <Text style={s.label}>District *</Text>
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
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setDistrict(d)}
                    >
                      <Text
                        style={[
                          s.chipText,
                          { color: active ? colors.primaryForeground : colors.foreground },
                        ]}
                      >
                        {d}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={s.field}>
              <Text style={s.label}>Full Address *</Text>
              <TextInput
                style={s.input}
                value={address}
                onChangeText={setAddress}
                placeholder="Street, city"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>

            <View style={s.field}>
              <Text style={s.label}>Description (optional)</Text>
              <TextInput
                style={s.textArea}
                value={description}
                onChangeText={setDescription}
                placeholder="Tell players about your venue…"
                placeholderTextColor={colors.mutedForeground}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={s.field}>
              <Text style={s.label}>Amenities</Text>
              <View style={s.chipGrid}>
                {AMENITIES_OPTIONS.map((a) => {
                  const active = selectedAmenities.includes(a);
                  return (
                    <TouchableOpacity
                      key={a}
                      style={[
                        s.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => toggleAmenity(a)}
                    >
                      <Text
                        style={[
                          s.chipText,
                          { color: active ? colors.primaryForeground : colors.foreground },
                        ]}
                      >
                        {a}
                      </Text>
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
              <Feather name="info" size={16} color={colors.primary} />
              <Text style={s.noteText}>
                Add at least one pitch — required before your venue can be submitted for approval. You can add more pitches later from the venue management screen.
              </Text>
            </View>

            <View style={s.field}>
              <Text style={s.label}>Pitch Name *</Text>
              <TextInput
                style={[s.input, pitchNameError ? { borderColor: colors.destructive } : undefined]}
                value={pitchName}
                onChangeText={(v) => { setPitchName(v); if (v.trim()) setPitchNameError(""); }}
                placeholder="e.g. Pitch A"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
              />
              {!!pitchNameError && (
                <Text style={{ fontSize: 12, color: colors.destructive, marginTop: 4, fontFamily: "Inter_400Regular" }}>
                  {pitchNameError}
                </Text>
              )}
            </View>

            <View style={s.field}>
              <Text style={s.label}>Pitch Type *</Text>
              {PITCH_TYPES.map((t) => {
                const active = pitchType === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    style={[
                      s.typeChip,
                      {
                        backgroundColor: active ? colors.primary + "15" : colors.card,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setPitchType(t.key)}
                  >
                    <Feather
                      name={t.icon}
                      size={18}
                      color={active ? colors.primary : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        s.typeChipText,
                        { color: active ? colors.primary : colors.foreground },
                      ]}
                    >
                      {t.label}
                    </Text>
                    {active && (
                      <Feather
                        name="check-circle"
                        size={16}
                        color={colors.primary}
                        style={{ marginLeft: "auto" }}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={s.field}>
              <Text style={s.label}>Format / Size</Text>
              <TextInput
                style={s.input}
                value={pitchSize}
                onChangeText={setPitchSize}
                placeholder="e.g. 5v5, 6v6, 7v7"
                placeholderTextColor={colors.mutedForeground}
              />
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
              <Feather name="clock" size={16} color={colors.primary} />
              <Text style={s.noteText}>
                Set your weekly opening hours. Toggle each day open or closed.
              </Text>
            </View>

            {DAY_LABELS.map((day, i) => {
              const d = schedule[i];
              return (
                <View key={day} style={s.dayRow}>
                  <Text style={s.dayLabel}>{day}</Text>
                  <Switch
                    value={!d.isClosed}
                    onValueChange={(v) => updateDay(i, { isClosed: !v })}
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
              <Feather name="check-circle" size={16} color={colors.primary} />
              <Text style={s.noteText}>
                Review your venue details before submitting for admin approval. Approved venues become visible to players.
              </Text>
            </View>

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
              {description ? (
                <View style={s.reviewRow}>
                  <Text style={s.reviewLabel}>Description</Text>
                  <Text style={s.reviewValue}>{description}</Text>
                </View>
              ) : null}
              {selectedAmenities.length > 0 && (
                <View style={s.reviewRow}>
                  <Text style={s.reviewLabel}>Amenities</Text>
                  <Text style={s.reviewValue}>{selectedAmenities.join(", ")}</Text>
                </View>
              )}
            </View>

            {pitchSaved && (
              <View style={s.reviewCard}>
                <Text style={s.reviewSectionTitle}>First Pitch</Text>
                <View style={s.reviewRow}>
                  <Text style={s.reviewLabel}>Name</Text>
                  <Text style={s.reviewValue}>{pitchName}</Text>
                </View>
                <View style={s.reviewRow}>
                  <Text style={s.reviewLabel}>Type</Text>
                  <Text style={s.reviewValue}>
                    {PITCH_TYPES.find((t) => t.key === pitchType)?.label ?? pitchType}
                  </Text>
                </View>
                <View style={s.reviewRow}>
                  <Text style={s.reviewLabel}>Size</Text>
                  <Text style={s.reviewValue}>{pitchSize}</Text>
                </View>
                {pitchPrice ? (
                  <View style={s.reviewRow}>
                    <Text style={s.reviewLabel}>Price</Text>
                    <Text style={s.reviewValue}>€{pitchPrice}/hr</Text>
                  </View>
                ) : null}
              </View>
            )}

            <View style={s.reviewCard}>
              <Text style={s.reviewSectionTitle}>Opening Hours</Text>
              {DAY_LABELS.map((day, i) => {
                const d = schedule[i];
                return (
                  <View key={day} style={s.reviewRow}>
                    <Text style={s.reviewLabel}>{day}</Text>
                    <Text style={s.reviewValue}>
                      {d.isClosed ? "Closed" : `${d.openTime} – ${d.closeTime}`}
                    </Text>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity style={s.backBtn} onPress={handleBack} disabled={stepLoading}>
          <Text style={s.backBtnText}>{step === 0 ? "Cancel" : "Back"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.nextBtn, { backgroundColor: stepLoading ? colors.muted : nextBtnColor }]}
          onPress={handleNext}
          disabled={stepLoading}
        >
          {stepLoading ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Text style={s.nextBtnText}>{nextBtnLabel}</Text>
              {!isLastStep && <Feather name="arrow-right" size={18} color={colors.primaryForeground} />}
              {isLastStep && <Feather name="send" size={16} color={colors.primaryForeground} />}
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
