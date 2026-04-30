import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { createVenue } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListOwnerVenuesQueryKey } from "@workspace/api-client-react";

const DISTRICTS = [
  "Nicosia",
  "Limassol",
  "Larnaca",
  "Paphos",
  "Famagusta",
  "Kyrenia",
];

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

const STEPS = ["Details", "Amenities", "Review"];

export default function VenueNewScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [district, setDistrict] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [cancellationWindow, setCancellationWindow] = useState("24");

  const toggleAmenity = (amenity: string) => {
    setSelectedAmenities((prev) =>
      prev.includes(amenity) ? prev.filter((a) => a !== amenity) : [...prev, amenity],
    );
  };

  const validateStep1 = () => {
    if (!name.trim()) return "Venue name is required.";
    if (!district) return "Please select a district.";
    if (!address.trim()) return "Address is required.";
    return null;
  };

  const handleNext = () => {
    if (step === 0) {
      const err = validateStep1();
      if (err) {
        Alert.alert("Missing info", err);
        return;
      }
    }
    setStep((s) => s + 1);
  };

  const handleBack = () => {
    if (step === 0) {
      router.back();
    } else {
      setStep((s) => s - 1);
    }
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      const result = await createVenue({
        name: name.trim(),
        district,
        address: address.trim(),
        description: description.trim() || undefined,
        amenities: selectedAmenities,
        cancellationWindowHours: parseInt(cancellationWindow, 10) || 24,
      });

      await queryClient.invalidateQueries({ queryKey: getListOwnerVenuesQueryKey() });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const venueId = (result as { venue?: { id?: string } })?.venue?.id;
      if (venueId) {
        router.replace(`/owner/venue/${venueId}`);
      } else {
        router.back();
      }
    } catch (err: unknown) {
      const e = err as Record<string, unknown> | null;
      const message =
        ((e?.data as Record<string, unknown>)?.error as string) ||
        (e?.message as string) ||
        "Failed to create venue. Please try again.";
      Alert.alert("Error", message);
    } finally {
      setLoading(false);
    }
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    inner: {
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: insets.bottom + 40,
    },
    stepBar: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 28,
      gap: 8,
    },
    stepDot: {
      height: 4,
      flex: 1,
      borderRadius: 2,
    },
    stepLabel: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      marginBottom: 4,
      textAlign: "center",
    },
    stepTitle: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 24,
    },
    field: { marginBottom: 18 },
    label: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      marginBottom: 6,
    },
    inputBox: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      height: 48,
      justifyContent: "center",
    },
    input: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      height: 48,
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
    districtGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    districtChip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
    },
    districtChipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
    amenityGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    amenityChip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
    },
    amenityChipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
    reviewSection: { marginBottom: 16 },
    reviewLabel: {
      fontSize: 12,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 4,
    },
    reviewValue: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    reviewCard: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 20,
    },
    note: {
      backgroundColor: colors.primary + "15",
      borderRadius: 10,
      padding: 14,
      marginBottom: 24,
    },
    noteText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.primary,
      lineHeight: 18,
    },
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
      backgroundColor: loading ? colors.muted : colors.primary,
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
    },
    nextBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.primaryForeground },
  });

  const STEP_TITLES = ["Venue Details", "Amenities & Settings", "Review & Create"];

  return (
    <View style={s.container}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.inner}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.stepBar}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={[
                s.stepDot,
                { backgroundColor: i <= step ? colors.primary : colors.border },
              ]}
            />
          ))}
        </View>

        <Text style={s.stepLabel}>Step {step + 1} of {STEPS.length}</Text>
        <Text style={s.stepTitle}>{STEP_TITLES[step]}</Text>

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
              <View style={s.districtGrid}>
                {DISTRICTS.map((d) => {
                  const active = district === d;
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[
                        s.districtChip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setDistrict(d)}
                    >
                      <Text
                        style={[
                          s.districtChipText,
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
                style={[s.input, s.inputBox]}
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
          </>
        )}

        {step === 1 && (
          <>
            <View style={s.field}>
              <Text style={s.label}>Amenities</Text>
              <View style={s.amenityGrid}>
                {AMENITIES_OPTIONS.map((amenity) => {
                  const active = selectedAmenities.includes(amenity);
                  return (
                    <TouchableOpacity
                      key={amenity}
                      style={[
                        s.amenityChip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => toggleAmenity(amenity)}
                    >
                      <Text
                        style={[
                          s.amenityChipText,
                          { color: active ? colors.primaryForeground : colors.foreground },
                        ]}
                      >
                        {amenity}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={s.field}>
              <Text style={s.label}>Cancellation Window (hours)</Text>
              <TextInput
                style={[s.input, s.inputBox]}
                value={cancellationWindow}
                onChangeText={setCancellationWindow}
                keyboardType="numeric"
                placeholder="24"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <View style={s.reviewCard}>
              <View style={s.reviewSection}>
                <Text style={s.reviewLabel}>Venue Name</Text>
                <Text style={s.reviewValue}>{name}</Text>
              </View>
              <View style={s.reviewSection}>
                <Text style={s.reviewLabel}>District</Text>
                <Text style={s.reviewValue}>{district}</Text>
              </View>
              <View style={s.reviewSection}>
                <Text style={s.reviewLabel}>Address</Text>
                <Text style={s.reviewValue}>{address}</Text>
              </View>
              {description ? (
                <View style={s.reviewSection}>
                  <Text style={s.reviewLabel}>Description</Text>
                  <Text style={s.reviewValue}>{description}</Text>
                </View>
              ) : null}
              {selectedAmenities.length > 0 && (
                <View style={s.reviewSection}>
                  <Text style={s.reviewLabel}>Amenities</Text>
                  <Text style={s.reviewValue}>{selectedAmenities.join(", ")}</Text>
                </View>
              )}
              <View style={[s.reviewSection, { marginBottom: 0 }]}>
                <Text style={s.reviewLabel}>Cancellation Window</Text>
                <Text style={s.reviewValue}>{cancellationWindow || "24"} hours</Text>
              </View>
            </View>

            <View style={s.note}>
              <Text style={s.noteText}>
                After creating the venue, add pitches, set opening hours and pricing, then submit for admin review.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity style={s.backBtn} onPress={handleBack}>
          <Text style={s.backBtnText}>{step === 0 ? "Cancel" : "Back"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.nextBtn}
          onPress={step === STEPS.length - 1 ? handleCreate : handleNext}
          disabled={loading}
        >
          <Text style={s.nextBtnText}>
            {loading ? "Creating…" : step === STEPS.length - 1 ? "Create Venue" : "Next"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
