import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOwnerVenue,
  getGetOwnerVenueQueryKey,
  getListOwnerVenuesQueryKey,
  updateVenue,
} from "@workspace/api-client-react";

const DISTRICTS = ["Nicosia", "Limassol", "Larnaca", "Paphos", "Ayia Napa", "Protaras", "Kyrenia"];

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

type VenueDetail = {
  id: string;
  name: string;
  district: string;
  address: string;
  description?: string | null;
  amenities: string[];
  cancellationWindowHours: number;
  contactPhone?: string | null;
};

export default function EditVenueScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetOwnerVenue(id!);
  const venue = (data as { venue?: VenueDetail })?.venue;

  const [name, setName] = useState("");
  const [district, setDistrict] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [cancellationWindowHours, setCancellationWindowHours] = useState("24");
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);

  const [nameError, setNameError] = useState("");
  const [addressError, setAddressError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [windowError, setWindowError] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (venue) {
      setName(venue.name ?? "");
      setDistrict(venue.district ?? "");
      setAddress(venue.address ?? "");
      setDescription(venue.description ?? "");
      setContactPhone(venue.contactPhone ?? "");
      setCancellationWindowHours(String(venue.cancellationWindowHours ?? 24));
      setSelectedAmenities(venue.amenities ?? []);
    }
  }, [venue?.id]);

  const toggleAmenity = (a: string) =>
    setSelectedAmenities((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a],
    );

  const validate = (): boolean => {
    let valid = true;
    setNameError("");
    setAddressError("");
    setPhoneError("");
    setWindowError("");

    if (!name.trim()) {
      setNameError("Venue name is required.");
      valid = false;
    }
    if (!address.trim()) {
      setAddressError("Address is required.");
      valid = false;
    }
    if (!contactPhone.trim()) {
      setPhoneError("Contact phone number is required.");
      valid = false;
    }
    const windowVal = parseInt(cancellationWindowHours, 10);
    if (isNaN(windowVal) || windowVal < 0 || windowVal > 168) {
      setWindowError("Must be between 0 and 168 hours.");
      valid = false;
    }
    return valid;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await updateVenue(id!, {
        name: name.trim(),
        district: district || undefined,
        address: address.trim(),
        description: description.trim() || undefined,
        contactPhone: contactPhone.trim(),
        cancellationWindowHours: parseInt(cancellationWindowHours, 10),
        amenities: selectedAmenities,
      });
      queryClient.invalidateQueries({ queryKey: getGetOwnerVenueQueryKey(id!) });
      queryClient.invalidateQueries({ queryKey: getListOwnerVenuesQueryKey() });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err: unknown) {
      const e = err as { data?: { error?: string } } | null;
      const msg = e?.data?.error ?? "Failed to save changes. Please try again.";
      Alert.alert("Error", msg);
    } finally {
      setSaving(false);
    }
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    scroll: { flex: 1 },
    inner: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: insets.bottom + 40 },
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
    errorText: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: colors.destructive, marginTop: 4 },
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
    hintText: { fontSize: 11, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground, marginTop: 4 },
    footer: {
      flexDirection: "row",
      gap: 12,
      paddingHorizontal: 20,
      paddingBottom: insets.bottom + (Platform.OS === "ios" ? 24 : 16),
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    cancelBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      height: 52,
      paddingHorizontal: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    cancelBtnText: { fontSize: 15, fontFamily: "PlusJakartaSans_500Medium", color: colors.foreground },
    saveBtn: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    saveBtnText: { fontSize: 16, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primaryForeground },
  });

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!venue) {
    return (
      <View style={s.center}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "PlusJakartaSans_400Regular" }}>
          Venue not found.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        <View style={s.field}>
          <Text style={s.label}>
            Venue Name <Text style={s.required}>*</Text>
          </Text>
          <TextInput
            style={[s.input, nameError ? s.inputError : null]}
            value={name}
            onChangeText={(v) => { setName(v); setNameError(""); }}
            placeholder="e.g. Champions Arena"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
          />
          {nameError ? <Text style={s.errorText}>{nameError}</Text> : null}
        </View>

        <View style={s.field}>
          <Text style={s.label}>District</Text>
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
                  <Text style={[s.chipText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                    {d}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>
            Full Address <Text style={s.required}>*</Text>
          </Text>
          <TextInput
            style={[s.input, addressError ? s.inputError : null]}
            value={address}
            onChangeText={(v) => { setAddress(v); setAddressError(""); }}
            placeholder="Street, city"
            placeholderTextColor={colors.mutedForeground}
          />
          {addressError ? <Text style={s.errorText}>{addressError}</Text> : null}
        </View>

        <View style={s.field}>
          <Text style={s.label}>
            Contact Phone <Text style={s.required}>*</Text>
          </Text>
          <TextInput
            style={[s.input, phoneError ? s.inputError : null]}
            value={contactPhone}
            onChangeText={(v) => { setContactPhone(v); setPhoneError(""); }}
            placeholder="e.g. +357 99 123456"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          {phoneError ? <Text style={s.errorText}>{phoneError}</Text> : null}
          <Text style={s.hintText}>Use the number listed on Google Maps or social media.</Text>
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
                  <Text style={[s.chipText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                    {a}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Cancellation Window (hours)</Text>
          <TextInput
            style={[s.input, windowError ? s.inputError : null]}
            value={cancellationWindowHours}
            onChangeText={(v) => { setCancellationWindowHours(v); setWindowError(""); }}
            keyboardType="numeric"
            placeholder="24"
            placeholderTextColor={colors.mutedForeground}
          />
          {windowError ? <Text style={s.errorText}>{windowError}</Text> : null}
          <Text style={s.hintText}>Players can cancel up to this many hours before the booking starts.</Text>
        </View>
      </ScrollView>

      <View style={s.footer}>
        <TouchableOpacity style={s.cancelBtn} onPress={() => router.back()} disabled={saving}>
          <Text style={s.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.5 }]} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <>
              <FeatherIcons name="check" size={18} color={colors.primaryForeground} />
              <Text style={s.saveBtnText}>Save Changes</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
