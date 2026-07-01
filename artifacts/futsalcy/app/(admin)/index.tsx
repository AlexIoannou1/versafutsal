import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAdminSettings,
  getGetAdminSettingsQueryKey,
  useUpdateAdminSettings,
  useSetVenueFeeOverride,
  useAdminListVenues,
  useAdminListBookings,
} from "@workspace/api-client-react";

const BOOKING_STATUS_COLORS: Record<string, string> = {
  PENDING: "#F59E0B",
  CONFIRMED: "#00C851",
  CANCELLED: "#EF4444",
  REFUNDED: "#6366F1",
  NO_SHOW: "#6B7280",
};

function formatDateShortAdmin(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function formatTimeAdmin(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}

export default function AdminSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: settingsData, isLoading: settingsLoading, refetch: refetchSettings, isRefetching } =
    useGetAdminSettings();
  const settings = settingsData?.settings;

  const { data: venuesData, isLoading: venuesLoading } = useAdminListVenues({ status: "APPROVED" });
  const venues = venuesData?.venues ?? [];

  const { data: bookingsData, isLoading: bookingsLoading } = useAdminListBookings();
  const recentBookings = (bookingsData?.bookings ?? []).slice(0, 10);

  const updateSettings = useUpdateAdminSettings();
  const setVenueOverride = useSetVenueFeeOverride();

  const [editingFee, setEditingFee] = useState(false);
  const [feeAmountInput, setFeeAmountInput] = useState("");

  useEffect(() => {
    if (settings?.feeAmount) {
      setFeeAmountInput(String(settings.feeAmount));
    }
  }, [settings?.feeAmount]);

  function invalidateSettings() {
    queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
  }

  function handleToggleFeeEnabled(val: boolean) {
    updateSettings.mutate(
      { data: { feeEnabled: val } },
      { onSuccess: invalidateSettings, onError: () => Alert.alert("Error", "Failed to update fee setting.") },
    );
  }

  function handleSaveFeeAmount() {
    const parsed = parseFloat(feeAmountInput);
    if (isNaN(parsed) || parsed < 0) {
      Alert.alert("Invalid", "Please enter a valid fee amount (e.g. 1.00)");
      return;
    }
    updateSettings.mutate(
      { data: { feeAmount: parsed.toFixed(2) } },
      {
        onSuccess: () => {
          invalidateSettings();
          setEditingFee(false);
        },
        onError: () => Alert.alert("Error", "Failed to save fee amount."),
      },
    );
  }

  function handleVenueOverride(venueId: string, current: boolean | undefined) {
    const next = current === false ? null : current === true ? false : true;
    setVenueOverride.mutate(
      { venueId, data: { feeEnabled: next } },
      { onSuccess: invalidateSettings, onError: () => Alert.alert("Error", "Failed to update override.") },
    );
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    headerSub: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    section: {
      marginTop: 20,
      paddingHorizontal: 16,
    },
    sectionTitle: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 10,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    rowBorder: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowIcon: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.primary + "20",
      alignItems: "center",
      justifyContent: "center",
    },
    rowContent: { flex: 1 },
    rowLabel: {
      fontSize: 15,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
    rowSub: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginTop: 2,
    },
    feeRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    feeInput: {
      width: 90,
      fontSize: 15,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.background,
    },
    feeValue: {
      fontSize: 15,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
    editBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    editBtnText: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.primary,
    },
    saveBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.primary,
    },
    saveBtnText: {
      fontSize: 13,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
    venueRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 10,
    },
    venueName: {
      fontSize: 14,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      flex: 1,
    },
    overrideChip: {
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
      marginRight: 8,
    },
    overrideChipText: {
      fontSize: 11,
      fontFamily: "Inter_600SemiBold",
    },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    footer: { height: insets.bottom + (Platform.OS === "web" ? 16 : 80) },
  });

  if (settingsLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={s.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetchSettings}
          tintColor={colors.primary}
        />
      }
    >
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Admin Settings</Text>
        <Text style={s.headerSub}>Platform fee & venue overrides</Text>
      </View>

      {/* Global Fee Settings */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Platform Fee</Text>
        <View style={s.card}>
          {/* Fee Enabled Toggle */}
          <View style={[s.row, s.rowBorder]}>
            <View style={s.rowIcon}>
              <FeatherIcons name="toggle-right" size={18} color={colors.primary} />
            </View>
            <View style={s.rowContent}>
              <Text style={s.rowLabel}>Charge Convenience Fee</Text>
              <Text style={s.rowSub}>
                {settings?.feeEnabled ? "Fee is active on all bookings" : "No fee charged"}
              </Text>
            </View>
            <Switch
              value={settings?.feeEnabled ?? false}
              onValueChange={handleToggleFeeEnabled}
              thumbColor={settings?.feeEnabled ? colors.primary : colors.muted}
              trackColor={{ true: colors.primary + "60", false: colors.border }}
              disabled={updateSettings.isPending}
            />
          </View>

          {/* Fee Amount */}
          <View style={s.feeRow}>
            <View style={s.rowIcon}>
              <FeatherIcons name="euro" size={18} color={colors.primary} />
            </View>
            <View style={s.rowContent}>
              <Text style={s.rowLabel}>Fee Amount</Text>
              <Text style={s.rowSub}>Charged per booking (EUR)</Text>
            </View>
            {editingFee ? (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TextInput
                  style={s.feeInput}
                  value={feeAmountInput}
                  onChangeText={setFeeAmountInput}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  autoFocus
                />
                <TouchableOpacity style={s.saveBtn} onPress={handleSaveFeeAmount}>
                  <Text style={s.saveBtnText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setEditingFee(false);
                    setFeeAmountInput(String(settings?.feeAmount ?? "1.00"));
                  }}
                >
                  <FeatherIcons name="x" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Text style={s.feeValue}>€{settings?.feeAmount ?? "1.00"}</Text>
                <TouchableOpacity style={s.editBtn} onPress={() => setEditingFee(true)}>
                  <Text style={s.editBtnText}>Edit</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Per-Venue Overrides */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>
          Per-Venue Overrides ({venues.length} approved venue{venues.length !== 1 ? "s" : ""})
        </Text>
        <View style={s.card}>
          {venuesLoading ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : venues.length === 0 ? (
            <View style={[s.row]}>
              <Text style={s.rowSub}>No approved venues yet.</Text>
            </View>
          ) : (
            venues.map((venue, idx) => {
              const overrides = settings?.perVenueOverrides ?? {};
              const override = overrides[venue.id];
              const hasOverride = override !== undefined;
              const overrideLabel = !hasOverride
                ? "Default"
                : override
                  ? "Fee ON"
                  : "Fee OFF";
              const overrideColor = !hasOverride
                ? colors.mutedForeground
                : override
                  ? colors.primary
                  : colors.destructive;

              return (
                <TouchableOpacity
                  key={venue.id}
                  style={[
                    s.venueRow,
                    idx < venues.length - 1 && s.rowBorder,
                  ]}
                  onPress={() => handleVenueOverride(venue.id, override)}
                  activeOpacity={0.7}
                >
                  <FeatherIcons name="map-pin" size={14} color={colors.mutedForeground} />
                  <Text style={s.venueName} numberOfLines={1}>
                    {venue.name} · {venue.district}
                  </Text>
                  <View
                    style={[
                      s.overrideChip,
                      { backgroundColor: overrideColor + "20" },
                    ]}
                  >
                    <Text style={[s.overrideChipText, { color: overrideColor }]}>
                      {overrideLabel}
                    </Text>
                  </View>
                  <FeatherIcons name="chevron-right" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              );
            })
          )}
        </View>
        {venues.length > 0 && (
          <Text style={[s.rowSub, { paddingHorizontal: 4, marginTop: 8 }]}>
            Tap a venue to cycle: Default → Fee ON → Fee OFF → Default
          </Text>
        )}
      </View>

      {/* Recent Bookings */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Recent Bookings</Text>
        <View style={s.card}>
          {bookingsLoading ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : recentBookings.length === 0 ? (
            <View style={s.row}>
              <Text style={s.rowSub}>No bookings yet.</Text>
            </View>
          ) : (
            recentBookings.map((booking, idx) => {
              const statusColor = BOOKING_STATUS_COLORS[booking.status] ?? colors.mutedForeground;
              const player = booking.player as { name: string; email: string } | undefined;
              const venue = booking.venue as { name: string } | undefined;
              const pitch = booking.pitch as { name: string } | undefined;
              return (
                <TouchableOpacity
                  key={booking.id}
                  style={[s.venueRow, idx < recentBookings.length - 1 && s.rowBorder]}
                  onPress={() => router.push(`/admin/booking/${booking.id}`)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={s.rowLabel} numberOfLines={1}>
                        {player?.name ?? player?.email ?? "Player"}
                      </Text>
                      <View style={[s.overrideChip, { backgroundColor: statusColor + "20" }]}>
                        <Text style={[s.overrideChipText, { color: statusColor }]}>
                          {booking.status}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.rowSub} numberOfLines={1}>
                      {venue?.name ?? ""} · {pitch?.name ?? ""} · {formatDateShortAdmin(booking.startAt)} {formatTimeAdmin(booking.startAt)}
                    </Text>
                  </View>
                  <FeatherIcons name="chevron-right" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </View>

      <View style={s.footer} />
    </ScrollView>
  );
}
