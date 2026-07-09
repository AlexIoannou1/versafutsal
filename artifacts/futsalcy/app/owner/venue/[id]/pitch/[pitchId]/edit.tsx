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
  updatePitch,
} from "@workspace/api-client-react";

const TYPE_LABELS: Record<string, string> = { INDOOR: "Indoor", OUTDOOR: "Outdoor", HYBRID: "Hybrid" };

type ConflictingBooking = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
};

type Pitch = {
  id: string;
  name: string;
  size: string;
  type: "INDOOR" | "OUTDOOR" | "HYBRID";
  slotDurationMinutes: number;
};

export default function EditPitchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id, pitchId } = useLocalSearchParams<{ id: string; pitchId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetOwnerVenue(id!);
  const venue = data as { venue?: { pitches?: Pitch[] } } | undefined;
  const pitch = venue?.venue?.pitches?.find((p) => p.id === pitchId);

  const [pitchName, setPitchName] = useState("");
  const [pitchSize, setPitchSize] = useState("");
  const [pitchType, setPitchType] = useState<"INDOOR" | "OUTDOOR" | "HYBRID">("INDOOR");
  const [slotDuration, setSlotDuration] = useState("60");

  const [nameError, setNameError] = useState("");
  const [sizeError, setSizeError] = useState("");
  const [durationError, setDurationError] = useState("");
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [conflictingBookings, setConflictingBookings] = useState<ConflictingBooking[]>([]);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (pitch) {
      setPitchName(pitch.name);
      setPitchSize(pitch.size);
      setPitchType(pitch.type);
      setSlotDuration(String(pitch.slotDurationMinutes));
    }
  }, [pitch?.id]);

  const validate = (): boolean => {
    let valid = true;
    setNameError("");
    setSizeError("");
    setDurationError("");
    setConflictError(null);
    setConflictingBookings([]);

    if (!pitchName.trim()) {
      setNameError("Pitch name is required.");
      valid = false;
    }
    if (!pitchSize.trim()) {
      setSizeError("Size is required (e.g. 5v5, 7v7).");
      valid = false;
    }
    const dur = parseInt(slotDuration, 10);
    if (isNaN(dur) || dur < 15 || dur > 240) {
      setDurationError("Slot duration must be between 15 and 240 minutes.");
      valid = false;
    }
    return valid;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await updatePitch(id!, pitchId!, {
        name: pitchName.trim(),
        size: pitchSize.trim(),
        type: pitchType,
        slotDurationMinutes: parseInt(slotDuration, 10),
      });
      queryClient.invalidateQueries({ queryKey: getGetOwnerVenueQueryKey(id!) });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err: unknown) {
      const e = err as { status?: number; data?: { error?: string; conflictingBookings?: ConflictingBooking[] } } | null;
      if (e?.status === 409 || (e?.data && e.data.conflictingBookings)) {
        const conflicts = e?.data?.conflictingBookings ?? [];
        setConflictingBookings(conflicts);
        setConflictError(
          e?.data?.error ?? "Cannot change slot duration: there are existing future bookings for this pitch.",
        );
      } else {
        Alert.alert("Error", e?.data?.error ?? "Failed to save changes. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
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
    hintText: { fontSize: 11, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground, marginTop: 4 },
    typeRow: { flexDirection: "row", gap: 8 },
    typeChip: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 2,
      alignItems: "center",
    },
    typeChipText: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold" },
    conflictBanner: {
      backgroundColor: colors.destructive + "15",
      borderRadius: 10,
      padding: 14,
      marginBottom: 18,
      borderWidth: 1,
      borderColor: colors.destructive + "40",
    },
    conflictTitle: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.destructive,
      marginBottom: 8,
      flexDirection: "row",
      alignItems: "center",
    },
    conflictMessage: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.destructive,
      marginBottom: 8,
      lineHeight: 18,
    },
    conflictBookingRow: {
      backgroundColor: colors.destructive + "10",
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginBottom: 4,
    },
    conflictBookingText: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.destructive,
    },
    conflictHint: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.destructive,
      marginTop: 6,
      fontStyle: "italic",
    },
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

  if (!pitch) {
    return (
      <View style={s.center}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "PlusJakartaSans_400Regular" }}>
          Pitch not found.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        {conflictError && (
          <View style={s.conflictBanner}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <FeatherIcons name="alert-circle" size={16} color={colors.destructive} />
              <Text style={[s.conflictMessage, { marginBottom: 0, fontFamily: "PlusJakartaSans_700Bold" }]}>
                Slot Duration Conflict
              </Text>
            </View>
            <Text style={s.conflictMessage}>{conflictError}</Text>
            {conflictingBookings.length > 0 && (
              <>
                <Text style={[s.conflictMessage, { marginBottom: 4, fontFamily: "PlusJakartaSans_600SemiBold" }]}>
                  Affected bookings ({conflictingBookings.length}):
                </Text>
                {conflictingBookings.map((b) => (
                  <View key={b.id} style={s.conflictBookingRow}>
                    <Text style={s.conflictBookingText}>
                      {formatDate(b.startAt)} — {formatDate(b.endAt)} · {b.status}
                    </Text>
                  </View>
                ))}
                <Text style={s.conflictHint}>
                  Cancel or complete these bookings before changing the slot duration.
                </Text>
              </>
            )}
          </View>
        )}

        <View style={s.field}>
          <Text style={s.label}>
            Pitch Name <Text style={s.required}>*</Text>
          </Text>
          <TextInput
            style={[s.input, nameError ? s.inputError : null]}
            value={pitchName}
            onChangeText={(v) => { setPitchName(v); setNameError(""); }}
            placeholder="e.g. Pitch A"
            placeholderTextColor={colors.mutedForeground}
          />
          {nameError ? <Text style={s.errorText}>{nameError}</Text> : null}
        </View>

        <View style={s.field}>
          <Text style={s.label}>
            Size <Text style={s.required}>*</Text>
          </Text>
          <TextInput
            style={[s.input, sizeError ? s.inputError : null]}
            value={pitchSize}
            onChangeText={(v) => { setPitchSize(v); setSizeError(""); }}
            placeholder="e.g. 5v5, 7v7, Futsal"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
          />
          {sizeError ? <Text style={s.errorText}>{sizeError}</Text> : null}
        </View>

        <View style={s.field}>
          <Text style={s.label}>Type</Text>
          <View style={s.typeRow}>
            {(["INDOOR", "OUTDOOR", "HYBRID"] as const).map((t) => {
              const active = pitchType === t;
              return (
                <TouchableOpacity
                  key={t}
                  style={[
                    s.typeChip,
                    {
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setPitchType(t)}
                >
                  <Text style={[s.typeChipText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                    {TYPE_LABELS[t]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Slot Duration (minutes)</Text>
          <TextInput
            style={[s.input, durationError || conflictError ? s.inputError : null]}
            value={slotDuration}
            onChangeText={(v) => { setSlotDuration(v); setDurationError(""); setConflictError(null); setConflictingBookings([]); }}
            keyboardType="numeric"
            placeholder="60"
            placeholderTextColor={colors.mutedForeground}
          />
          {durationError ? <Text style={s.errorText}>{durationError}</Text> : null}
          <Text style={s.hintText}>Between 15 and 240 minutes. Changing this is blocked if future bookings exist.</Text>
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
