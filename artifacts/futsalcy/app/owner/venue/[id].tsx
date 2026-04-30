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
  Modal,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOwnerVenue,
  getGetOwnerVenueQueryKey,
  getListOwnerVenuesQueryKey,
  updateVenue,
  submitVenueForApproval,
  addVenuePhoto,
  deleteVenuePhoto,
  createPitch,
  deletePitch,
  setOpeningHours,
  setPricingRules,
} from "@workspace/api-client-react";

const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TYPE_LABELS: Record<string, string> = { INDOOR: "Indoor", OUTDOOR: "Outdoor", HYBRID: "Hybrid" };
const DAY_TYPE_LABELS: Record<string, string> = { ALL: "All days", WEEKDAY: "Weekdays", WEEKEND: "Weekends" };

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#FF9500",
  APPROVED: "#00C851",
  REJECTED: "#FF3B30",
};

type Pitch = {
  id: string;
  name: string;
  size: string;
  type: "INDOOR" | "OUTDOOR" | "HYBRID";
  slotDurationMinutes: number;
  pricingRules: Array<{ id: string; dayType: string; pricePerHour: string }>;
};

type HourEntry = {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
};

type Photo = { id: string; url: string; sortOrder: number };

type VenueDetail = {
  id: string;
  name: string;
  district: string;
  address: string;
  description?: string | null;
  amenities: string[];
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason?: string | null;
  cancellationWindowHours: number;
  photos: Photo[];
  pitches: Pitch[];
  openingHours: HourEntry[];
};

function defaultHours(): HourEntry[] {
  return Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    openTime: "08:00",
    closeTime: "22:00",
    isClosed: i === 0,
  }));
}

export default function OwnerVenueDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useGetOwnerVenue(id!);
  const venue = (data as { venue?: VenueDetail })?.venue;

  const [submitting, setSubmitting] = useState(false);

  // ─── Edit details modal state ─────────────────────────────────────────────
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // ─── Photo state ──────────────────────────────────────────────────────────
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoAdding, setPhotoAdding] = useState(false);

  // ─── New pitch modal state ────────────────────────────────────────────────
  const [pitchModalVisible, setPitchModalVisible] = useState(false);
  const [pitchName, setPitchName] = useState("");
  const [pitchSize, setPitchSize] = useState("5v5");
  const [pitchType, setPitchType] = useState<"INDOOR" | "OUTDOOR" | "HYBRID">("INDOOR");
  const [pitchSlot, setPitchSlot] = useState("60");
  const [pitchAdding, setPitchAdding] = useState(false);

  // ─── Pricing modal state ──────────────────────────────────────────────────
  const [pricingModalVisible, setPricingModalVisible] = useState(false);
  const [pricingTargetPitch, setPricingTargetPitch] = useState<Pitch | null>(null);
  const [weekdayPrice, setWeekdayPrice] = useState("");
  const [weekendPrice, setWeekendPrice] = useState("");
  const [samePrice, setSamePrice] = useState(true);
  const [allDayPrice, setAllDayPrice] = useState("");
  const [pricingSaving, setPricingSaving] = useState(false);

  // ─── Opening hours state ──────────────────────────────────────────────────
  const [hours, setHours] = useState<HourEntry[]>(defaultHours());
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursEdited, setHoursEdited] = useState(false);

  useEffect(() => {
    if (venue?.name) {
      navigation.setOptions({ title: venue.name });
    }
  }, [venue?.name, navigation]);

  useEffect(() => {
    if (venue?.openingHours && venue.openingHours.length > 0) {
      const merged = defaultHours().map((def) => {
        const found = venue.openingHours.find((h) => h.dayOfWeek === def.dayOfWeek);
        return found ?? def;
      });
      setHours(merged);
    }
  }, [venue?.openingHours?.length]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetOwnerVenueQueryKey(id!) });
    queryClient.invalidateQueries({ queryKey: getListOwnerVenuesQueryKey() });
  };

  // ─── Submit for approval ──────────────────────────────────────────────────
  const handleSubmit = () => {
    Alert.alert(
      "Submit for Approval",
      "Your venue will be reviewed by an admin. Make sure all pitches, hours, and pricing are set.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          onPress: async () => {
            setSubmitting(true);
            try {
              await submitVenueForApproval(id!);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              invalidate();
            } catch (err: unknown) {
              const e = err as Record<string, unknown> | null;
              const msg =
                ((e?.data as Record<string, unknown>)?.error as string) || "Submission failed.";
              Alert.alert("Error", msg);
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  // ─── Edit venue details ───────────────────────────────────────────────────
  const openEditModal = () => {
    if (!venue) return;
    setEditName(venue.name);
    setEditAddress(venue.address);
    setEditDescription(venue.description ?? "");
    setEditModalVisible(true);
  };

  const handleSaveDetails = async () => {
    if (!editName.trim()) {
      Alert.alert("Error", "Venue name is required.");
      return;
    }
    setEditSaving(true);
    try {
      await updateVenue(id!, {
        name: editName.trim(),
        address: editAddress.trim(),
        description: editDescription.trim() || undefined,
      });
      setEditModalVisible(false);
      invalidate();
    } catch {
      Alert.alert("Error", "Failed to save changes.");
    } finally {
      setEditSaving(false);
    }
  };

  // ─── Photos ───────────────────────────────────────────────────────────────
  const handleAddPhoto = async () => {
    if (!photoUrl.trim()) return;
    setPhotoAdding(true);
    try {
      await addVenuePhoto(id!, { url: photoUrl.trim() });
      setPhotoUrl("");
      invalidate();
    } catch {
      Alert.alert("Error", "Failed to add photo.");
    } finally {
      setPhotoAdding(false);
    }
  };

  const handleDeletePhoto = (photoId: string) => {
    Alert.alert("Remove Photo", "Remove this photo?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteVenuePhoto(id!, photoId);
            invalidate();
          } catch {
            Alert.alert("Error", "Failed to remove photo.");
          }
        },
      },
    ]);
  };

  // ─── Pitches ──────────────────────────────────────────────────────────────
  const openPitchModal = () => {
    setPitchName("");
    setPitchSize("5v5");
    setPitchType("INDOOR");
    setPitchSlot("60");
    setPitchModalVisible(true);
  };

  const handleAddPitch = async () => {
    if (!pitchName.trim()) {
      Alert.alert("Error", "Pitch name is required.");
      return;
    }
    setPitchAdding(true);
    try {
      await createPitch(id!, {
        name: pitchName.trim(),
        size: pitchSize.trim() || "5v5",
        type: pitchType,
        slotDurationMinutes: parseInt(pitchSlot, 10) || 60,
      });
      setPitchModalVisible(false);
      invalidate();
    } catch {
      Alert.alert("Error", "Failed to add pitch.");
    } finally {
      setPitchAdding(false);
    }
  };

  const handleDeletePitch = (pitchId: string, pitchName: string) => {
    Alert.alert("Delete Pitch", `Delete "${pitchName}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deletePitch(id!, pitchId);
            invalidate();
          } catch {
            Alert.alert("Error", "Failed to delete pitch.");
          }
        },
      },
    ]);
  };

  // ─── Pricing ──────────────────────────────────────────────────────────────
  const openPricingModal = (pitch: Pitch) => {
    setPricingTargetPitch(pitch);
    const rules = pitch.pricingRules ?? [];
    const allRule = rules.find((r) => r.dayType === "ALL");
    const weekdayRule = rules.find((r) => r.dayType === "WEEKDAY");
    const weekendRule = rules.find((r) => r.dayType === "WEEKEND");
    if (allRule) {
      setSamePrice(true);
      setAllDayPrice(allRule.pricePerHour);
      setWeekdayPrice("");
      setWeekendPrice("");
    } else {
      setSamePrice(false);
      setWeekdayPrice(weekdayRule?.pricePerHour ?? "");
      setWeekendPrice(weekendRule?.pricePerHour ?? "");
      setAllDayPrice("");
    }
    setPricingModalVisible(true);
  };

  const handleSavePricing = async () => {
    if (!pricingTargetPitch) return;
    const rules = samePrice
      ? [{ dayType: "ALL" as const, pricePerHour: allDayPrice, depositType: "NONE" }]
      : [
          { dayType: "WEEKDAY" as const, pricePerHour: weekdayPrice, depositType: "NONE" },
          { dayType: "WEEKEND" as const, pricePerHour: weekendPrice, depositType: "NONE" },
        ];

    const hasEmpty = rules.some((r) => !r.pricePerHour.trim() || isNaN(parseFloat(r.pricePerHour)));
    if (hasEmpty) {
      Alert.alert("Error", "Please enter valid prices.");
      return;
    }

    setPricingSaving(true);
    try {
      await setPricingRules(id!, pricingTargetPitch.id, { rules });
      setPricingModalVisible(false);
      invalidate();
    } catch {
      Alert.alert("Error", "Failed to save pricing.");
    } finally {
      setPricingSaving(false);
    }
  };

  // ─── Opening Hours ────────────────────────────────────────────────────────
  const toggleDayClosed = (idx: number) => {
    setHours((prev) =>
      prev.map((h) => (h.dayOfWeek === idx ? { ...h, isClosed: !h.isClosed } : h)),
    );
    setHoursEdited(true);
  };

  const updateHourField = (idx: number, field: "openTime" | "closeTime", value: string) => {
    setHours((prev) =>
      prev.map((h) => (h.dayOfWeek === idx ? { ...h, [field]: value } : h)),
    );
    setHoursEdited(true);
  };

  const handleSaveHours = async () => {
    setHoursSaving(true);
    try {
      await setOpeningHours(id!, { hours });
      setHoursEdited(false);
      invalidate();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Error", "Failed to save hours.");
    } finally {
      setHoursSaving(false);
    }
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    scroll: { flex: 1 },
    scrollContent: { padding: 16, paddingBottom: insets.bottom + 40 },
    statusBanner: {
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    statusText: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
    rejectionNote: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      marginTop: 4,
    },
    submitBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    submitBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.primaryForeground },
    section: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground },
    editBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    editBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.primary },
    infoRow: { flexDirection: "row", gap: 6, marginBottom: 6 },
    infoLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.mutedForeground, width: 72 },
    infoValue: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.foreground, flex: 1 },
    photoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 8,
      backgroundColor: colors.muted,
      borderRadius: 8,
      padding: 10,
    },
    photoUrl: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      flex: 1,
    },
    addPhotoRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
    addPhotoInput: {
      flex: 1,
      backgroundColor: colors.muted,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      height: 40,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    addPhotoBtn: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 14,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    addPhotoBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.primaryForeground },
    pitchCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 12,
      marginBottom: 10,
    },
    pitchHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
    pitchName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground, flex: 1 },
    pitchMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, marginBottom: 6 },
    pitchActions: { flexDirection: "row", gap: 6 },
    pitchActionBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pitchActionText: { fontSize: 12, fontFamily: "Inter_500Medium", color: colors.foreground },
    pricingChips: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 6 },
    pricingChip: {
      backgroundColor: colors.primary + "15",
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    pricingChipText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.primary },
    noPricingText: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.mutedForeground, fontStyle: "italic" },
    addBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderWidth: 1.5,
      borderColor: colors.primary,
      borderStyle: "dashed",
      borderRadius: 10,
      paddingVertical: 12,
      marginTop: 4,
    },
    addBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.primary },
    dayRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 8,
    },
    dayLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground, width: 36 },
    closedToggle: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      borderWidth: 1,
    },
    closedToggleText: { fontSize: 12, fontFamily: "Inter_500Medium" },
    timeInput: {
      backgroundColor: colors.muted,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      width: 72,
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      textAlign: "center",
    },
    timeSep: { fontSize: 13, color: colors.mutedForeground },
    saveHoursBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
      marginTop: 12,
    },
    saveHoursBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.primaryForeground },
    // Modals
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    modalSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 24,
      paddingBottom: insets.bottom + 24,
    },
    modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 16 },
    mField: { marginBottom: 14 },
    mLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground, marginBottom: 6 },
    mInput: {
      backgroundColor: colors.muted,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      height: 44,
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    mTextArea: {
      backgroundColor: colors.muted,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      minHeight: 72,
      textAlignVertical: "top",
    },
    typeRow: { flexDirection: "row", gap: 8 },
    typeChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
    },
    typeChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
    toggleRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
    toggleBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: "center",
    },
    toggleBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
    mActions: { flexDirection: "row", gap: 8, marginTop: 6 },
    mCancelBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    mCancelText: { fontSize: 15, fontFamily: "Inter_500Medium", color: colors.foreground },
    mSaveBtn: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
    },
    mSaveText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.primaryForeground },
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
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
          Venue not found.
        </Text>
      </View>
    );
  }

  const statusColor = STATUS_COLORS[venue.status] ?? colors.mutedForeground;
  const canSubmit = venue.status !== "APPROVED";

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Status Banner */}
        <View style={[s.statusBanner, { backgroundColor: statusColor + "20" }]}>
          <Feather
            name={venue.status === "APPROVED" ? "check-circle" : venue.status === "REJECTED" ? "x-circle" : "clock"}
            size={20}
            color={statusColor}
          />
          <View style={{ flex: 1 }}>
            <Text style={[s.statusText, { color: statusColor }]}>
              {venue.status === "APPROVED"
                ? "Live — Accepting Bookings"
                : venue.status === "REJECTED"
                ? "Venue Rejected"
                : "Pending Admin Review"}
            </Text>
            {venue.status === "REJECTED" && venue.rejectionReason && (
              <Text style={[s.rejectionNote, { color: statusColor }]}>{venue.rejectionReason}</Text>
            )}
          </View>
          {canSubmit && venue.status !== "PENDING" && (
            <TouchableOpacity
              style={s.submitBtn}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Text style={s.submitBtnText}>
                {submitting ? "…" : "Submit"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {canSubmit && venue.status === "PENDING" && (
          <View style={{ marginBottom: 16 }}>
            <TouchableOpacity
              style={[s.submitBtn, { borderRadius: 12, paddingVertical: 14, alignItems: "center" }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Text style={s.submitBtnText}>
                {submitting ? "Submitting…" : "Re-submit for Approval"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Details Section */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Venue Details</Text>
            <TouchableOpacity style={s.editBtn} onPress={openEditModal}>
              <Feather name="edit-2" size={14} color={colors.primary} />
              <Text style={s.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Name</Text>
            <Text style={s.infoValue}>{venue.name}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>District</Text>
            <Text style={s.infoValue}>{venue.district}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Address</Text>
            <Text style={s.infoValue}>{venue.address}</Text>
          </View>
          {venue.description && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>About</Text>
              <Text style={s.infoValue}>{venue.description}</Text>
            </View>
          )}
          {venue.amenities.length > 0 && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Amenities</Text>
              <Text style={s.infoValue}>{venue.amenities.join(", ")}</Text>
            </View>
          )}
        </View>

        {/* Photos Section */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { marginBottom: 12 }]}>Photos ({venue.photos.length})</Text>
          {venue.photos.map((photo) => (
            <View key={photo.id} style={s.photoRow}>
              <Feather name="image" size={16} color={colors.mutedForeground} />
              <Text style={s.photoUrl} numberOfLines={1}>
                {photo.url}
              </Text>
              <TouchableOpacity onPress={() => handleDeletePhoto(photo.id)}>
                <Feather name="trash-2" size={16} color={colors.destructive} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={s.addPhotoRow}>
            <TextInput
              style={s.addPhotoInput}
              value={photoUrl}
              onChangeText={setPhotoUrl}
              placeholder="Paste photo URL…"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              keyboardType="url"
            />
            <TouchableOpacity
              style={[s.addPhotoBtn, photoAdding && { opacity: 0.5 }]}
              onPress={handleAddPhoto}
              disabled={photoAdding || !photoUrl.trim()}
            >
              {photoAdding ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={s.addPhotoBtnText}>Add</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Pitches Section */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Pitches ({venue.pitches.length})</Text>
          </View>
          {venue.pitches.map((pitch) => (
            <View key={pitch.id} style={s.pitchCard}>
              <View style={s.pitchHeader}>
                <Text style={s.pitchName}>{pitch.name}</Text>
              </View>
              <Text style={s.pitchMeta}>
                {TYPE_LABELS[pitch.type] ?? pitch.type} · {pitch.size} · {pitch.slotDurationMinutes} min slots
              </Text>
              {pitch.pricingRules.length > 0 ? (
                <View style={s.pricingChips}>
                  {pitch.pricingRules.map((r, i) => (
                    <View key={i} style={s.pricingChip}>
                      <Text style={s.pricingChipText}>
                        {DAY_TYPE_LABELS[r.dayType] ?? r.dayType}: €{r.pricePerHour}/hr
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={s.noPricingText}>No pricing set</Text>
              )}
              <View style={s.pitchActions}>
                <TouchableOpacity style={s.pitchActionBtn} onPress={() => openPricingModal(pitch)}>
                  <Feather name="dollar-sign" size={12} color={colors.foreground} />
                  <Text style={s.pitchActionText}>Set Pricing</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.pitchActionBtn, { borderColor: colors.destructive + "40" }]}
                  onPress={() => handleDeletePitch(pitch.id, pitch.name)}
                >
                  <Feather name="trash-2" size={12} color={colors.destructive} />
                  <Text style={[s.pitchActionText, { color: colors.destructive }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity style={s.addBtn} onPress={openPitchModal}>
            <Feather name="plus" size={16} color={colors.primary} />
            <Text style={s.addBtnText}>Add Pitch</Text>
          </TouchableOpacity>
        </View>

        {/* Opening Hours Section */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { marginBottom: 12 }]}>Opening Hours</Text>
          {hours.map((h) => (
            <View key={h.dayOfWeek} style={s.dayRow}>
              <Text style={s.dayLabel}>{DAYS_SHORT[h.dayOfWeek]}</Text>
              <TouchableOpacity
                style={[
                  s.closedToggle,
                  {
                    backgroundColor: h.isClosed ? colors.destructive + "15" : colors.muted,
                    borderColor: h.isClosed ? colors.destructive + "40" : colors.border,
                  },
                ]}
                onPress={() => toggleDayClosed(h.dayOfWeek)}
              >
                <Text
                  style={[
                    s.closedToggleText,
                    { color: h.isClosed ? colors.destructive : colors.mutedForeground },
                  ]}
                >
                  {h.isClosed ? "Closed" : "Open"}
                </Text>
              </TouchableOpacity>
              {!h.isClosed && (
                <>
                  <TextInput
                    style={s.timeInput}
                    value={h.openTime}
                    onChangeText={(v) => updateHourField(h.dayOfWeek, "openTime", v)}
                    placeholder="08:00"
                    placeholderTextColor={colors.mutedForeground}
                  />
                  <Text style={s.timeSep}>–</Text>
                  <TextInput
                    style={s.timeInput}
                    value={h.closeTime}
                    onChangeText={(v) => updateHourField(h.dayOfWeek, "closeTime", v)}
                    placeholder="22:00"
                    placeholderTextColor={colors.mutedForeground}
                  />
                </>
              )}
            </View>
          ))}
          {hoursEdited && (
            <TouchableOpacity
              style={[s.saveHoursBtn, hoursSaving && { opacity: 0.5 }]}
              onPress={handleSaveHours}
              disabled={hoursSaving}
            >
              <Text style={s.saveHoursBtnText}>
                {hoursSaving ? "Saving…" : "Save Hours"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Edit Details Modal */}
      <Modal visible={editModalVisible} transparent animationType="slide" onRequestClose={() => setEditModalVisible(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={s.modalSheet} keyboardShouldPersistTaps="handled">
            <Text style={s.modalTitle}>Edit Venue Details</Text>
            <View style={s.mField}>
              <Text style={s.mLabel}>Venue Name</Text>
              <TextInput style={s.mInput} value={editName} onChangeText={setEditName} />
            </View>
            <View style={s.mField}>
              <Text style={s.mLabel}>Address</Text>
              <TextInput style={s.mInput} value={editAddress} onChangeText={setEditAddress} />
            </View>
            <View style={s.mField}>
              <Text style={s.mLabel}>Description</Text>
              <TextInput
                style={s.mTextArea}
                value={editDescription}
                onChangeText={setEditDescription}
                multiline
                numberOfLines={3}
              />
            </View>
            <View style={s.mActions}>
              <TouchableOpacity style={s.mCancelBtn} onPress={() => setEditModalVisible(false)}>
                <Text style={s.mCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.mSaveBtn, editSaving && { opacity: 0.5 }]} onPress={handleSaveDetails} disabled={editSaving}>
                <Text style={s.mSaveText}>{editSaving ? "Saving…" : "Save"}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add Pitch Modal */}
      <Modal visible={pitchModalVisible} transparent animationType="slide" onRequestClose={() => setPitchModalVisible(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={s.modalSheet} keyboardShouldPersistTaps="handled">
            <Text style={s.modalTitle}>Add Pitch</Text>
            <View style={s.mField}>
              <Text style={s.mLabel}>Pitch Name</Text>
              <TextInput style={s.mInput} value={pitchName} onChangeText={setPitchName} placeholder="e.g. Pitch A" placeholderTextColor={colors.mutedForeground} />
            </View>
            <View style={s.mField}>
              <Text style={s.mLabel}>Size</Text>
              <TextInput style={s.mInput} value={pitchSize} onChangeText={setPitchSize} placeholder="5v5, 7v7, Futsal…" placeholderTextColor={colors.mutedForeground} />
            </View>
            <View style={s.mField}>
              <Text style={s.mLabel}>Type</Text>
              <View style={s.typeRow}>
                {(["INDOOR", "OUTDOOR", "HYBRID"] as const).map((t) => {
                  const active = pitchType === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[s.typeChip, { backgroundColor: active ? colors.primary : colors.muted, borderColor: active ? colors.primary : colors.border }]}
                      onPress={() => setPitchType(t)}
                    >
                      <Text style={[s.typeChipText, { color: active ? colors.primaryForeground : colors.foreground }]}>{TYPE_LABELS[t]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <View style={s.mField}>
              <Text style={s.mLabel}>Slot Duration (minutes)</Text>
              <TextInput style={s.mInput} value={pitchSlot} onChangeText={setPitchSlot} keyboardType="numeric" placeholder="60" placeholderTextColor={colors.mutedForeground} />
            </View>
            <View style={s.mActions}>
              <TouchableOpacity style={s.mCancelBtn} onPress={() => setPitchModalVisible(false)}>
                <Text style={s.mCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.mSaveBtn, pitchAdding && { opacity: 0.5 }]} onPress={handleAddPitch} disabled={pitchAdding}>
                <Text style={s.mSaveText}>{pitchAdding ? "Adding…" : "Add Pitch"}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Pricing Modal */}
      <Modal visible={pricingModalVisible} transparent animationType="slide" onRequestClose={() => setPricingModalVisible(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={s.modalSheet} keyboardShouldPersistTaps="handled">
            <Text style={s.modalTitle}>Pricing — {pricingTargetPitch?.name}</Text>
            <View style={[s.mField, { marginBottom: 16 }]}>
              <Text style={s.mLabel}>Pricing Mode</Text>
              <View style={s.toggleRow}>
                <TouchableOpacity
                  style={[s.toggleBtn, { backgroundColor: samePrice ? colors.primary : colors.muted, borderColor: samePrice ? colors.primary : colors.border }]}
                  onPress={() => setSamePrice(true)}
                >
                  <Text style={[s.toggleBtnText, { color: samePrice ? colors.primaryForeground : colors.foreground }]}>Same rate</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.toggleBtn, { backgroundColor: !samePrice ? colors.primary : colors.muted, borderColor: !samePrice ? colors.primary : colors.border }]}
                  onPress={() => setSamePrice(false)}
                >
                  <Text style={[s.toggleBtnText, { color: !samePrice ? colors.primaryForeground : colors.foreground }]}>Split rate</Text>
                </TouchableOpacity>
              </View>
            </View>
            {samePrice ? (
              <View style={s.mField}>
                <Text style={s.mLabel}>Price per Hour (€)</Text>
                <TextInput style={s.mInput} value={allDayPrice} onChangeText={setAllDayPrice} keyboardType="decimal-pad" placeholder="e.g. 25.00" placeholderTextColor={colors.mutedForeground} />
              </View>
            ) : (
              <>
                <View style={s.mField}>
                  <Text style={s.mLabel}>Weekday Price per Hour (€)</Text>
                  <TextInput style={s.mInput} value={weekdayPrice} onChangeText={setWeekdayPrice} keyboardType="decimal-pad" placeholder="e.g. 20.00" placeholderTextColor={colors.mutedForeground} />
                </View>
                <View style={s.mField}>
                  <Text style={s.mLabel}>Weekend Price per Hour (€)</Text>
                  <TextInput style={s.mInput} value={weekendPrice} onChangeText={setWeekendPrice} keyboardType="decimal-pad" placeholder="e.g. 30.00" placeholderTextColor={colors.mutedForeground} />
                </View>
              </>
            )}
            <View style={s.mActions}>
              <TouchableOpacity style={s.mCancelBtn} onPress={() => setPricingModalVisible(false)}>
                <Text style={s.mCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.mSaveBtn, pricingSaving && { opacity: 0.5 }]} onPress={handleSavePricing} disabled={pricingSaving}>
                <Text style={s.mSaveText}>{pricingSaving ? "Saving…" : "Save Pricing"}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
