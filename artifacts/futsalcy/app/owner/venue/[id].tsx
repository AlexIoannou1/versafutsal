import React, { useState, useEffect } from "react";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
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
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOwnerVenue,
  getGetOwnerVenueQueryKey,
  getListOwnerVenuesQueryKey,
  submitVenueForApproval,
  addVenuePhoto,
  deleteVenuePhoto,
  createPitch,
  deletePitch,
  setOpeningHours,
  setPricingRules,
  useListBlocks,
  useCreateBlock,
  useDeleteBlock,
  type AvailabilityBlock,
  type BlockType,
} from "@workspace/api-client-react";

const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function fmtLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseLocalTime(str: string): Date {
  const [h, m] = (str || "08:00").split(":").map(Number);
  const dt = new Date();
  dt.setHours(h ?? 0, m ?? 0, 0, 0);
  return dt;
}
function fmtLocalTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
const TYPE_LABELS: Record<string, string> = { INDOOR: "Indoor", OUTDOOR: "Outdoor", HYBRID: "Hybrid" };
const DAY_TYPE_LABELS: Record<string, string> = { ALL: "All days", WEEKDAY: "Weekdays", WEEKEND: "Weekends" };

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#FF9500",
  APPROVED: "#00C851",
  REJECTED: "#FF3B30",
};

type MaintenanceBlock = {
  id: string;
  pitchId: string;
  startAt: string;
  endAt: string;
  reason?: string | null;
};

type Pitch = {
  id: string;
  name: string;
  size: string;
  type: "INDOOR" | "OUTDOOR" | "HYBRID";
  slotDurationMinutes: number;
  pricingRules: Array<{ id: string; dayType: string; pricePerHour: string }>;
  maintenanceBlocks?: MaintenanceBlock[];
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

  const router = useRouter();
  const { data, isLoading, refetch } = useGetOwnerVenue(id!);
  const venue = (data as { venue?: VenueDetail })?.venue;

  const [submitting, setSubmitting] = useState(false);

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

  // ─── Availability blocks state ────────────────────────────────────────────
  const { data: blocksData, refetch: refetchBlocks } = useListBlocks(id!);
  const availabilityBlocks: AvailabilityBlock[] = (blocksData?.blocks ?? []) as AvailabilityBlock[];

  const [avBlockModalVisible, setAvBlockModalVisible] = useState(false);
  const [avBlockPitchId, setAvBlockPitchId] = useState<string | "">("");
  const [avBlockType, setAvBlockType] = useState<BlockType>("OFF_DAY");
  const [avBlockLabel, setAvBlockLabel] = useState("");
  const [avBlockStartDate, setAvBlockStartDate] = useState("");
  const [avBlockEndDate, setAvBlockEndDate] = useState("");
  const [avBlockFullDay, setAvBlockFullDay] = useState(true);
  const [avBlockStartTime, setAvBlockStartTime] = useState("08:00");
  const [avBlockEndTime, setAvBlockEndTime] = useState("22:00");
  const [avBlockRecursWeekly, setAvBlockRecursWeekly] = useState(false);
  const [avBlockDayOfWeek, setAvBlockDayOfWeek] = useState(1);

  const [avBlockToDelete, setAvBlockToDelete] = useState<string | null>(null);
  const [showScopeDropdown, setShowScopeDropdown] = useState(false);
  const [showBlockTypeDropdown, setShowBlockTypeDropdown] = useState(false);
  const [avActivePicker, setAvActivePicker] = useState<"startDate" | "endDate" | "startTime" | "endTime" | null>(null);

  const { mutate: doCreateAvBlock, isPending: avBlockCreating } = useCreateBlock(id!);
  const { mutate: doDeleteAvBlock } = useDeleteBlock(id!);

  function openAvBlockModal() {
    const today = new Date().toISOString().slice(0, 10);
    setAvBlockPitchId("");
    setAvBlockType("OFF_DAY");
    setAvBlockLabel("");
    setAvBlockStartDate(today);
    setAvBlockEndDate(today);
    setAvBlockFullDay(true);
    setAvBlockStartTime("08:00");
    setAvBlockEndTime("22:00");
    setAvBlockRecursWeekly(false);
    setAvBlockDayOfWeek(1);
    setAvBlockModalVisible(true);
  }

  function handleCreateAvBlock() {
    if (!avBlockStartDate || !avBlockEndDate) {
      Alert.alert("Error", "Start date and end date are required.");
      return;
    }
    if (avBlockRecursWeekly && avBlockStartDate > avBlockEndDate) {
      Alert.alert("Error", "Start date must be on or before end date.");
      return;
    }
    doCreateAvBlock(
      {
        pitchId: avBlockPitchId || undefined,
        blockType: avBlockType,
        label: avBlockLabel.trim() || undefined,
        startDate: avBlockStartDate,
        endDate: avBlockEndDate,
        startTime: avBlockFullDay ? undefined : avBlockStartTime,
        endTime: avBlockFullDay ? undefined : avBlockEndTime,
        recursWeekly: avBlockRecursWeekly,
        dayOfWeek: avBlockRecursWeekly ? avBlockDayOfWeek : undefined,
      },
      {
        onSuccess: (result) => {
          setAvBlockModalVisible(false);
          void refetchBlocks();
          if (result.warning) {
            Alert.alert("Block Created", result.warning);
          }
        },
        onError: () => Alert.alert("Error", "Could not create block."),
      },
    );
  }

  function handleDeleteAvBlock(blockId: string) {
    setAvBlockToDelete(blockId);
  }

  function handleConfirmDeleteAvBlock() {
    if (!avBlockToDelete) return;
    const blockId = avBlockToDelete;
    setAvBlockToDelete(null);
    doDeleteAvBlock(blockId, {
      onSuccess: () => void refetchBlocks(),
      onError: () => Alert.alert("Error", "Could not delete block."),
    });
  }

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
  const openEditVenue = () => {
    if (!id) return;
    router.push(`/owner/venue/${id}/edit`);
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
    setPitchType("OUTDOOR");
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
    statusText: { fontSize: 15, fontFamily: "PlusJakartaSans_600SemiBold", flex: 1 },
    rejectionNote: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
      marginTop: 4,
    },
    submitBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    submitBtnText: { fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primaryForeground },
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
    sectionTitle: { fontSize: 15, fontFamily: "PlusJakartaSans_700Bold", color: colors.foreground },
    editBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    editBtnText: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium", color: colors.primary },
    infoRow: { flexDirection: "row", gap: 6, marginBottom: 6 },
    infoLabel: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium", color: colors.mutedForeground, width: 72 },
    infoValue: { fontSize: 13, fontFamily: "PlusJakartaSans_400Regular", color: colors.foreground, flex: 1 },
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
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_400Regular",
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
    addPhotoBtnText: { fontSize: 13, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primaryForeground },
    pitchCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 12,
      marginBottom: 10,
    },
    pitchHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
    pitchName: { fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground, flex: 1 },
    pitchMeta: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground, marginBottom: 6 },
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
    pitchActionText: { fontSize: 12, fontFamily: "PlusJakartaSans_500Medium", color: colors.foreground },
    pricingChips: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 6 },
    pricingChip: {
      backgroundColor: colors.primary + "15",
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    pricingChipText: { fontSize: 11, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primary },
    noPricingText: { fontSize: 12, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground, fontStyle: "italic" },
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
    addBtnText: { fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primary },
    dayRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 8,
    },
    dayLabel: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium", color: colors.foreground, width: 36 },
    closedToggle: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      borderWidth: 1,
    },
    closedToggleText: { fontSize: 12, fontFamily: "PlusJakartaSans_500Medium" },
    timeInput: {
      backgroundColor: colors.muted,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 4,
      width: 72,
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
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
    saveHoursBtnText: { fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primaryForeground },
    // Modals
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    modalSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 24,
      paddingBottom: insets.bottom + 24,
    },
    modalTitle: { fontSize: 18, fontFamily: "PlusJakartaSans_700Bold", color: colors.foreground, marginBottom: 16 },
    mField: { marginBottom: 14 },
    mLabel: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium", color: colors.foreground, marginBottom: 6 },
    mInput: {
      backgroundColor: colors.muted,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      height: 44,
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
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
      fontFamily: "PlusJakartaSans_400Regular",
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
    typeChipText: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium" },
    toggleRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
    toggleBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      alignItems: "center",
    },
    toggleBtnText: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium" },
    mActions: { flexDirection: "row", gap: 8, marginTop: 6 },
    mCancelBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    mCancelText: { fontSize: 15, fontFamily: "PlusJakartaSans_500Medium", color: colors.foreground },
    mSaveBtn: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
    },
    mSaveText: { fontSize: 15, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primaryForeground },
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

  const statusColor = STATUS_COLORS[venue.status] ?? colors.mutedForeground;
  const canSubmit = venue.status !== "APPROVED";

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Status Banner */}
        <View style={[s.statusBanner, { backgroundColor: statusColor + "20" }]}>
          <FeatherIcons
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
            <TouchableOpacity style={s.editBtn} onPress={openEditVenue}>
              <FeatherIcons name="edit-2" size={14} color={colors.primary} />
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
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Contact Phone</Text>
            <Text style={s.infoValue}>
              {(venue as VenueDetail & { contactPhone?: string | null }).contactPhone || "—"}
            </Text>
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
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Cancel by</Text>
            <Text style={s.infoValue}>
              {venue.cancellationWindowHours}h before start
            </Text>
          </View>
        </View>

        {/* Photos Section */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, { marginBottom: 12 }]}>Photos ({venue.photos.length})</Text>
          {venue.photos.map((photo) => (
            <View key={photo.id} style={s.photoRow}>
              <FeatherIcons name="image" size={16} color={colors.mutedForeground} />
              <Text style={s.photoUrl} numberOfLines={1}>
                {photo.url}
              </Text>
              <TouchableOpacity onPress={() => handleDeletePhoto(photo.id)}>
                <FeatherIcons name="trash-2" size={16} color={colors.destructive} />
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
                <TouchableOpacity
                  style={[s.pitchActionBtn, { borderColor: colors.primary + "60" }]}
                  onPress={() => router.push(`/owner/venue/${id}/pitch/${pitch.id}/edit`)}
                >
                  <FeatherIcons name="edit-2" size={12} color={colors.primary} />
                  <Text style={[s.pitchActionText, { color: colors.primary }]}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.pitchActionBtn} onPress={() => openPricingModal(pitch)}>
                  <FeatherIcons name="dollar-sign" size={12} color={colors.foreground} />
                  <Text style={s.pitchActionText}>Pricing</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.pitchActionBtn, { borderColor: colors.destructive + "40" }]}
                  onPress={() => handleDeletePitch(pitch.id, pitch.name)}
                >
                  <FeatherIcons name="trash-2" size={12} color={colors.destructive} />
                  <Text style={[s.pitchActionText, { color: colors.destructive }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity style={s.addBtn} onPress={openPitchModal}>
            <FeatherIcons name="plus" size={16} color={colors.primary} />
            <Text style={s.addBtnText}>Add Pitch</Text>
          </TouchableOpacity>
        </View>

        {/* Blocked Periods Section */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Blocked Periods ({availabilityBlocks.length})</Text>
            <TouchableOpacity style={s.editBtn} onPress={openAvBlockModal}>
              <FeatherIcons name="slash" size={14} color={colors.primary} />
              <Text style={s.editBtnText}>Block Time</Text>
            </TouchableOpacity>
          </View>
          {availabilityBlocks.length === 0 ? (
            <Text style={[s.noPricingText, { marginBottom: 4 }]}>No blocked periods set.</Text>
          ) : (
            availabilityBlocks.map((blk) => {
              const blockTypeColors: Record<string, string> = {
                OFF_DAY: "#6366F1",
                BANK_HOLIDAY: "#8B5CF6",
                TRAINING: "#F59E0B",
                MAINTENANCE: "#EF4444",
                PRIVATE: "#10B981",
              };
              const blockTypeLabels: Record<string, string> = {
                OFF_DAY: "Off Day",
                BANK_HOLIDAY: "Bank Holiday",
                TRAINING: "Training",
                MAINTENANCE: "Maintenance",
                PRIVATE: "Private",
              };
              const bc = blockTypeColors[blk.blockType] ?? colors.primary;
              const scopePitch = venue?.pitches.find((p) => p.id === blk.pitchId);
              return (
                <View
                  key={blk.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: bc + "12",
                    borderRadius: 8,
                    borderLeftWidth: 3,
                    borderLeftColor: bc,
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <View style={{ backgroundColor: bc + "25", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 10, fontFamily: "PlusJakartaSans_600SemiBold", color: bc }}>
                          {blockTypeLabels[blk.blockType] ?? blk.blockType}
                        </Text>
                      </View>
                      {blk.recursWeekly && (
                        <View style={{ backgroundColor: colors.muted, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 10, fontFamily: "PlusJakartaSans_500Medium", color: colors.mutedForeground }}>
                            Weekly · {DAYS_FULL[blk.dayOfWeek ?? 0]}
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontSize: 12, fontFamily: "PlusJakartaSans_500Medium", color: colors.foreground }}>
                      {blk.recursWeekly
                        ? `Repeats every ${DAYS_FULL[blk.dayOfWeek ?? 0]}`
                        : blk.startDate === blk.endDate
                        ? blk.startDate
                        : `${blk.startDate} – ${blk.endDate}`}
                    </Text>
                    {blk.startTime && blk.endTime && (
                      <Text style={{ fontSize: 11, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground }}>
                        {blk.startTime} – {blk.endTime} UTC
                      </Text>
                    )}
                    {!blk.startTime && (
                      <Text style={{ fontSize: 11, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground }}>
                        Full day
                      </Text>
                    )}
                    {blk.label && (
                      <Text style={{ fontSize: 11, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground, marginTop: 1 }}>
                        {blk.label}
                      </Text>
                    )}
                    <Text style={{ fontSize: 10, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground, marginTop: 1 }}>
                      Scope: {scopePitch ? scopePitch.name : "All pitches"}
                    </Text>
                  </View>
                  <View>
                    {avBlockToDelete === blk.id ? (
                      <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                        <TouchableOpacity
                          onPress={() => setAvBlockToDelete(null)}
                          style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}
                        >
                          <Text style={{ fontSize: 11, fontFamily: "PlusJakartaSans_400Regular", color: colors.mutedForeground }}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={handleConfirmDeleteAvBlock}
                          style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.destructive }}
                        >
                          <Text style={{ fontSize: 11, fontFamily: "PlusJakartaSans_600SemiBold", color: "#fff" }}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => handleDeleteAvBlock(blk.id)} style={{ padding: 8 }}>
                        <FeatherIcons name="trash-2" size={14} color={colors.destructive} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}
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
                {(["OUTDOOR", "INDOOR", "HYBRID"] as const).map((t) => {
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

      {/* Availability Block Modal */}
      <Modal visible={avBlockModalVisible} transparent animationType="slide" onRequestClose={() => setAvBlockModalVisible(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={s.modalSheet} keyboardShouldPersistTaps="handled">
            <Text style={s.modalTitle}>Block Time</Text>

            {/* Scope dropdown */}
            {(() => {
              const scopeOptions = [
                { id: "", label: "Whole Venue" },
                ...(venue?.pitches.map((p) => ({ id: p.id, label: p.name })) ?? []),
              ];
              const selectedScope = scopeOptions.find((o) => o.id === avBlockPitchId) ?? scopeOptions[0];
              return (
                <View style={[s.mField, { zIndex: 20 }]}>
                  <Text style={s.mLabel}>Scope</Text>
                  <TouchableOpacity
                    style={[s.mInput, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                    onPress={() => { setShowScopeDropdown(!showScopeDropdown); setShowBlockTypeDropdown(false); }}
                  >
                    <Text style={{ color: colors.foreground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 14 }}>{selectedScope.label}</Text>
                    <FeatherIcons name={showScopeDropdown ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                  {showScopeDropdown && (
                    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, marginTop: 4, overflow: "hidden", backgroundColor: colors.card }}>
                      {scopeOptions.map((opt, idx) => (
                        <TouchableOpacity
                          key={opt.id}
                          style={{
                            paddingHorizontal: 14, paddingVertical: 11,
                            backgroundColor: avBlockPitchId === opt.id ? colors.primary + "12" : colors.card,
                            borderBottomWidth: idx < scopeOptions.length - 1 ? 1 : 0,
                            borderBottomColor: colors.border,
                            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                          }}
                          onPress={() => { setAvBlockPitchId(opt.id); setShowScopeDropdown(false); }}
                        >
                          <Text style={{ fontFamily: avBlockPitchId === opt.id ? "PlusJakartaSans_600SemiBold" : "PlusJakartaSans_400Regular", color: avBlockPitchId === opt.id ? colors.primary : colors.foreground, fontSize: 14 }}>
                            {opt.label}
                          </Text>
                          {avBlockPitchId === opt.id && <FeatherIcons name="check" size={14} color={colors.primary} />}
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              );
            })()}

            {/* Block Type dropdown */}
            {(() => {
              const btOptions: { value: BlockType; label: string }[] = [
                { value: "OFF_DAY", label: "Off Day" },
                { value: "BANK_HOLIDAY", label: "Bank Holiday" },
                { value: "TRAINING", label: "Training" },
                { value: "MAINTENANCE", label: "Maintenance" },
                { value: "PRIVATE", label: "Private" },
              ];
              const selectedBt = btOptions.find((o) => o.value === avBlockType) ?? btOptions[0];
              return (
                <View style={[s.mField, { zIndex: 10 }]}>
                  <Text style={s.mLabel}>Block Type</Text>
                  <TouchableOpacity
                    style={[s.mInput, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
                    onPress={() => { setShowBlockTypeDropdown(!showBlockTypeDropdown); setShowScopeDropdown(false); }}
                  >
                    <Text style={{ color: colors.foreground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 14 }}>{selectedBt.label}</Text>
                    <FeatherIcons name={showBlockTypeDropdown ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                  {showBlockTypeDropdown && (
                    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, marginTop: 4, overflow: "hidden", backgroundColor: colors.card }}>
                      {btOptions.map((opt, idx) => (
                        <TouchableOpacity
                          key={opt.value}
                          style={{
                            paddingHorizontal: 14, paddingVertical: 11,
                            backgroundColor: avBlockType === opt.value ? colors.primary + "12" : colors.card,
                            borderBottomWidth: idx < btOptions.length - 1 ? 1 : 0,
                            borderBottomColor: colors.border,
                            flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                          }}
                          onPress={() => { setAvBlockType(opt.value); setShowBlockTypeDropdown(false); }}
                        >
                          <Text style={{ fontFamily: avBlockType === opt.value ? "PlusJakartaSans_600SemiBold" : "PlusJakartaSans_400Regular", color: avBlockType === opt.value ? colors.primary : colors.foreground, fontSize: 14 }}>
                            {opt.label}
                          </Text>
                          {avBlockType === opt.value && <FeatherIcons name="check" size={14} color={colors.primary} />}
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              );
            })()}

            {/* Dates */}
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.mLabel, { marginBottom: 4 }]}>Start Date</Text>
                {Platform.OS === "android" ? (
                  <TouchableOpacity style={s.mInput} onPress={() => setAvActivePicker("startDate")}>
                    <Text style={{ color: colors.foreground, fontFamily: "PlusJakartaSans_400Regular" }}>{avBlockStartDate}</Text>
                  </TouchableOpacity>
                ) : (
                  <DateTimePicker
                    value={parseLocalDate(avBlockStartDate)}
                    mode="date"
                    display={Platform.OS === "ios" ? "compact" : "default"}
                    onChange={(_: DateTimePickerEvent, d?: Date) => { if (d) setAvBlockStartDate(fmtLocalDate(d)); }}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.mLabel, { marginBottom: 4 }]}>End Date</Text>
                {Platform.OS === "android" ? (
                  <TouchableOpacity style={s.mInput} onPress={() => setAvActivePicker("endDate")}>
                    <Text style={{ color: colors.foreground, fontFamily: "PlusJakartaSans_400Regular" }}>{avBlockEndDate}</Text>
                  </TouchableOpacity>
                ) : (
                  <DateTimePicker
                    value={parseLocalDate(avBlockEndDate)}
                    mode="date"
                    display={Platform.OS === "ios" ? "compact" : "default"}
                    onChange={(_: DateTimePickerEvent, d?: Date) => { if (d) setAvBlockEndDate(fmtLocalDate(d)); }}
                  />
                )}
              </View>
            </View>

            {/* Full Day Toggle */}
            <View style={[s.mField, { marginBottom: 14 }]}>
              <Text style={s.mLabel}>Duration</Text>
              <View style={s.toggleRow}>
                <TouchableOpacity
                  style={[s.toggleBtn, { backgroundColor: avBlockFullDay ? colors.primary : colors.muted, borderColor: avBlockFullDay ? colors.primary : colors.border }]}
                  onPress={() => setAvBlockFullDay(true)}
                >
                  <Text style={[s.toggleBtnText, { color: avBlockFullDay ? colors.primaryForeground : colors.foreground }]}>Full Day</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.toggleBtn, { backgroundColor: !avBlockFullDay ? colors.primary : colors.muted, borderColor: !avBlockFullDay ? colors.primary : colors.border }]}
                  onPress={() => setAvBlockFullDay(false)}
                >
                  <Text style={[s.toggleBtnText, { color: !avBlockFullDay ? colors.primaryForeground : colors.foreground }]}>Time Range</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Time pickers when not full day */}
            {!avBlockFullDay && (
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.mLabel, { marginBottom: 4 }]}>Start Time</Text>
                  {Platform.OS === "android" ? (
                    <TouchableOpacity style={s.mInput} onPress={() => setAvActivePicker("startTime")}>
                      <Text style={{ color: colors.foreground, fontFamily: "PlusJakartaSans_400Regular" }}>{avBlockStartTime}</Text>
                    </TouchableOpacity>
                  ) : (
                    <DateTimePicker
                      value={parseLocalTime(avBlockStartTime)}
                      mode="time"
                      is24Hour
                      display={Platform.OS === "ios" ? "compact" : "default"}
                      onChange={(_: DateTimePickerEvent, d?: Date) => { if (d) setAvBlockStartTime(fmtLocalTime(d)); }}
                    />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.mLabel, { marginBottom: 4 }]}>End Time</Text>
                  {Platform.OS === "android" ? (
                    <TouchableOpacity style={s.mInput} onPress={() => setAvActivePicker("endTime")}>
                      <Text style={{ color: colors.foreground, fontFamily: "PlusJakartaSans_400Regular" }}>{avBlockEndTime}</Text>
                    </TouchableOpacity>
                  ) : (
                    <DateTimePicker
                      value={parseLocalTime(avBlockEndTime)}
                      mode="time"
                      is24Hour
                      display={Platform.OS === "ios" ? "compact" : "default"}
                      onChange={(_: DateTimePickerEvent, d?: Date) => { if (d) setAvBlockEndTime(fmtLocalTime(d)); }}
                    />
                  )}
                </View>
              </View>
            )}

            {/* Label */}
            <View style={s.mField}>
              <Text style={s.mLabel}>Label (optional)</Text>
              <TextInput style={s.mInput} value={avBlockLabel} onChangeText={setAvBlockLabel} placeholder="e.g. National Holiday, Team Training" placeholderTextColor={colors.mutedForeground} />
            </View>

            {/* Weekly Repeat Toggle */}
            <View style={[s.mField, { marginBottom: 6 }]}>
              <Text style={s.mLabel}>Repeat</Text>
              <View style={s.toggleRow}>
                <TouchableOpacity
                  style={[s.toggleBtn, { backgroundColor: !avBlockRecursWeekly ? colors.primary : colors.muted, borderColor: !avBlockRecursWeekly ? colors.primary : colors.border }]}
                  onPress={() => setAvBlockRecursWeekly(false)}
                >
                  <Text style={[s.toggleBtnText, { color: !avBlockRecursWeekly ? colors.primaryForeground : colors.foreground }]}>No repeat</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.toggleBtn, { backgroundColor: avBlockRecursWeekly ? colors.primary : colors.muted, borderColor: avBlockRecursWeekly ? colors.primary : colors.border }]}
                  onPress={() => setAvBlockRecursWeekly(true)}
                >
                  <Text style={[s.toggleBtnText, { color: avBlockRecursWeekly ? colors.primaryForeground : colors.foreground }]}>Every week</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Day of week selector for weekly repeat */}
            {avBlockRecursWeekly && (
              <View style={[s.mField, { marginBottom: 16 }]}>
                <Text style={s.mLabel}>Day of Week</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                  {DAYS_SHORT.map((d, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[s.typeChip, { backgroundColor: avBlockDayOfWeek === i ? colors.primary : colors.muted, borderColor: avBlockDayOfWeek === i ? colors.primary : colors.border }]}
                      onPress={() => setAvBlockDayOfWeek(i)}
                    >
                      <Text style={[s.typeChipText, { color: avBlockDayOfWeek === i ? colors.primaryForeground : colors.foreground }]}>{d}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <View style={s.mActions}>
              <TouchableOpacity style={s.mCancelBtn} onPress={() => setAvBlockModalVisible(false)}>
                <Text style={s.mCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.mSaveBtn, avBlockCreating && { opacity: 0.5 }]} onPress={handleCreateAvBlock} disabled={avBlockCreating}>
                <Text style={s.mSaveText}>{avBlockCreating ? "Saving…" : "Create Block"}</Text>
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
      {/* Android: availability block date/time picker dialog */}
      {Platform.OS === "android" && avActivePicker !== null && (
        <DateTimePicker
          value={
            avActivePicker === "startDate" ? parseLocalDate(avBlockStartDate) :
            avActivePicker === "endDate" ? parseLocalDate(avBlockEndDate) :
            avActivePicker === "startTime" ? parseLocalTime(avBlockStartTime) :
            parseLocalTime(avBlockEndTime)
          }
          mode={avActivePicker === "startDate" || avActivePicker === "endDate" ? "date" : "time"}
          is24Hour
          display="default"
          onChange={(_: DateTimePickerEvent, d?: Date) => {
            setAvActivePicker(null);
            if (!d) return;
            if (avActivePicker === "startDate") setAvBlockStartDate(fmtLocalDate(d));
            else if (avActivePicker === "endDate") setAvBlockEndDate(fmtLocalDate(d));
            else if (avActivePicker === "startTime") setAvBlockStartTime(fmtLocalTime(d));
            else setAvBlockEndTime(fmtLocalTime(d));
          }}
        />
      )}

      {/* iOS: availability block date/time picker bottom sheet */}
      {Platform.OS === "ios" && avActivePicker !== null && (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setAvActivePicker(null)}
        >
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }}
            activeOpacity={1}
            onPress={() => setAvActivePicker(null)}
          >
            <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32, paddingHorizontal: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.foreground }}>
                  {avActivePicker === "startDate" ? "Start Date" : avActivePicker === "endDate" ? "End Date" : avActivePicker === "startTime" ? "Start Time" : "End Time"}
                </Text>
                <TouchableOpacity onPress={() => setAvActivePicker(null)}>
                  <Text style={{ fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primary }}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={
                  avActivePicker === "startDate" ? parseLocalDate(avBlockStartDate) :
                  avActivePicker === "endDate" ? parseLocalDate(avBlockEndDate) :
                  avActivePicker === "startTime" ? parseLocalTime(avBlockStartTime) :
                  parseLocalTime(avBlockEndTime)
                }
                mode={avActivePicker === "startDate" || avActivePicker === "endDate" ? "date" : "time"}
                is24Hour
                display="spinner"
                onChange={(_: DateTimePickerEvent, d?: Date) => {
                  if (!d) return;
                  if (avActivePicker === "startDate") setAvBlockStartDate(fmtLocalDate(d));
                  else if (avActivePicker === "endDate") setAvBlockEndDate(fmtLocalDate(d));
                  else if (avActivePicker === "startTime") setAvBlockStartTime(fmtLocalTime(d));
                  else setAvBlockEndTime(fmtLocalTime(d));
                }}
                style={{ width: "100%" }}
              />
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </View>
  );
}
