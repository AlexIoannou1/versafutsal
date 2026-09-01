import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  Modal,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminGetVenue,
  getAdminGetVenueQueryKey,
  getAdminListVenuesQueryKey,
  approveVenue,
  rejectVenue,
  disableVenue,
} from "@workspace/api-client-react";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#FF9500",
  APPROVED: "#00C851",
  REJECTED: "#FF3B30",
  DISABLED: "#8E8E93",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type Props = {
  venueId: string;
  visible: boolean;
  onClose: () => void;
};

export default function AdminVenueDetailScreen({ venueId, visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [approveModalVisible, setApproveModalVisible] = useState(false);
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [disableModalVisible, setDisableModalVisible] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [disableReason, setDisableReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const { data, isLoading, isError } = useAdminGetVenue(venueId, {
    query: { enabled: visible && !!venueId },
  });
  const venue = data?.venue;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getAdminListVenuesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getAdminGetVenueQueryKey(venueId) });
  };

  const handleApprove = async () => {
    setApproveModalVisible(false);
    setActionLoading(true);
    try {
      await approveVenue(venueId);
      invalidate();
      onClose();
    } catch {
      Alert.alert("Error", "Failed to approve venue. Please try again.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!disableReason.trim()) {
      Alert.alert("Reason required", "Please enter a reason for disabling this venue.");
      return;
    }
    setDisableModalVisible(false);
    setActionLoading(true);
    try {
      await disableVenue(venueId, { reason: disableReason.trim() });
      invalidate();
      onClose();
    } catch {
      Alert.alert("Error", "Failed to disable venue. Please try again.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    setRejectModalVisible(false);
    setActionLoading(true);
    try {
      await rejectVenue(venueId, { reason: rejectReason.trim() || undefined });
      invalidate();
      onClose();
    } catch {
      Alert.alert("Error", "Failed to reject venue. Please try again.");
    } finally {
      setActionLoading(false);
      setRejectReason("");
    }
  };

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingTop: insets.top + 12,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    headerTitle: {
      flex: 1,
      fontSize: 17,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
    },
    scroll: { flex: 1 },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    errorText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
    section: {
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sectionTitle: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 12,
    },
    badge: {
      alignSelf: "flex-start",
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
      marginBottom: 6,
    },
    badgeText: { fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold" },
    venueName: {
      fontSize: 22,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      marginBottom: 4,
    },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
    metaText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      flex: 1,
    },
    descText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
      lineHeight: 20,
    },
    chip: {
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.muted,
      marginRight: 8,
      marginBottom: 8,
    },
    chipText: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
    },
    chipRow: { flexDirection: "row", flexWrap: "wrap" },
    infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
    infoLabel: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.mutedForeground,
    },
    infoValue: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
      textAlign: "right",
      flex: 1,
      marginLeft: 12,
    },
    stripeChip: {
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
      alignSelf: "flex-start",
      marginTop: 4,
    },
    stripeChipText: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_600SemiBold",
    },
    photoScroll: { marginTop: 4 },
    photoItem: {
      width: 200,
      height: 130,
      borderRadius: 10,
      marginRight: 10,
      backgroundColor: colors.muted,
    },
    noContent: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      fontStyle: "italic",
    },
    pitchCard: {
      backgroundColor: colors.muted,
      borderRadius: 10,
      padding: 12,
      marginBottom: 10,
    },
    pitchName: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
      marginBottom: 4,
    },
    pitchMeta: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      marginBottom: 8,
    },
    pricingTable: { gap: 4 },
    pricingRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    pricingLabel: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
    pricingValue: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.foreground,
    },
    hoursRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    hoursDay: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.foreground,
      width: 40,
    },
    hoursTimes: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
    },
    hoursClosed: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
    rejBox: {
      backgroundColor: colors.destructive + "15",
      borderRadius: 8,
      padding: 12,
    },
    rejLabel: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.destructive,
      marginBottom: 4,
    },
    rejText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.destructive,
    },
    footer: {
      flexDirection: "row",
      gap: 10,
      padding: 16,
      paddingBottom: insets.bottom + 16,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    approveBtn: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 13,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 6,
    },
    approveBtnText: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primaryForeground,
    },
    rejectBtn: {
      flex: 1,
      backgroundColor: colors.destructive + "15",
      borderRadius: 10,
      paddingVertical: 13,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: colors.destructive + "40",
    },
    rejectBtnText: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.destructive,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    modalSheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 24,
      paddingBottom: insets.bottom + 24,
    },
    modalTitle: {
      fontSize: 18,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      marginBottom: 8,
    },
    modalSub: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      marginBottom: 16,
    },
    modalActions: { flexDirection: "row", gap: 8 },
    cancelBtn: {
      flex: 1,
      paddingVertical: 13,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    cancelBtnText: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.foreground,
    },
    confirmRejectBtn: {
      flex: 1,
      backgroundColor: colors.destructive,
      borderRadius: 10,
      paddingVertical: 13,
      alignItems: "center",
    },
    confirmRejectText: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: "#FFFFFF",
    },
    reasonInput: {
      backgroundColor: colors.muted,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
      minHeight: 80,
      textAlignVertical: "top",
      marginBottom: 16,
    },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  });

  const renderBody = () => {
    if (isLoading) {
      return (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      );
    }
    if (isError || !venue) {
      return (
        <View style={s.center}>
          <FeatherIcons name="alert-circle" size={32} color={colors.mutedForeground} />
          <Text style={s.errorText}>Failed to load venue details.</Text>
        </View>
      );
    }

    const statusColor = STATUS_COLORS[venue.status] ?? colors.mutedForeground;
    const stripeConnected = venue.owner?.stripeConnected ?? false;

    return (
      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 8 }}>
        {/* Header section */}
        <View style={s.section}>
          <View style={[s.badge, { backgroundColor: statusColor + "20" }]}>
            <Text style={[s.badgeText, { color: statusColor }]}>{venue.status}</Text>
          </View>
          <Text style={s.venueName}>{venue.name}</Text>
          <View style={s.metaRow}>
            <FeatherIcons name="map-pin" size={14} color={colors.mutedForeground} />
            <Text style={s.metaText}>{venue.district} · {venue.address}</Text>
          </View>
          <View style={s.metaRow}>
            <FeatherIcons name="calendar" size={14} color={colors.mutedForeground} />
            <Text style={s.metaText}>
              Submitted {new Date(venue.createdAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </Text>
          </View>
          {venue.cancellationWindowHours !== undefined && (
            <View style={s.metaRow}>
              <FeatherIcons name="clock" size={14} color={colors.mutedForeground} />
              <Text style={s.metaText}>
                Cancellation window: {venue.cancellationWindowHours}h
              </Text>
            </View>
          )}
        </View>

        {/* Owner section */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Owner</Text>
          {venue.owner ? (
            <>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Name</Text>
                <Text style={s.infoValue}>{(venue.owner as { name: string }).name}</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Email</Text>
                <Text style={s.infoValue}>{(venue.owner as { email: string }).email}</Text>
              </View>
              {(venue.owner as { phoneNumber?: string | null }).phoneNumber ? (
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>Phone</Text>
                  <Text style={s.infoValue}>{(venue.owner as { phoneNumber: string }).phoneNumber}</Text>
                </View>
              ) : null}
              <View style={[s.stripeChip, {
                backgroundColor: stripeConnected ? "#00C85120" : colors.muted,
              }]}>
                <Text style={[s.stripeChipText, {
                  color: stripeConnected ? "#00C851" : colors.mutedForeground,
                }]}>
                  {stripeConnected ? "✓ Stripe Connected" : "Stripe not connected"}
                </Text>
              </View>
            </>
          ) : (
            <Text style={s.noContent}>Owner information not available.</Text>
          )}
        </View>

        {/* Description */}
        {venue.description ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Description</Text>
            <Text style={s.descText}>{venue.description}</Text>
          </View>
        ) : null}

        {/* Amenities */}
        {venue.amenities && venue.amenities.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Amenities</Text>
            <View style={s.chipRow}>
              {venue.amenities.map((a) => (
                <View key={a} style={s.chip}>
                  <Text style={s.chipText}>{a}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Photos */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Photos ({(venue.photos ?? []).length})</Text>
          {(venue.photos ?? []).length === 0 ? (
            <Text style={s.noContent}>No photos uploaded.</Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.photoScroll}
            >
              {(venue.photos ?? []).map((photo) => (
                <Image
                  key={photo.id}
                  source={{ uri: photo.url }}
                  style={s.photoItem}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          )}
        </View>

        {/* Pitches */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Pitches ({(venue.pitches ?? []).length})</Text>
          {(venue.pitches ?? []).length === 0 ? (
            <Text style={s.noContent}>No pitches added.</Text>
          ) : (
            (venue.pitches ?? []).map((pitch) => (
              <View key={pitch.id} style={s.pitchCard}>
                <Text style={s.pitchName}>{pitch.name}</Text>
                <Text style={s.pitchMeta}>
                  {pitch.size} · {pitch.type} · {pitch.slotDurationMinutes} min slots
                </Text>
                {(pitch.pricingRules ?? []).length > 0 ? (
                  <View style={s.pricingTable}>
                    <View style={s.divider} />
                    {(pitch.pricingRules ?? []).map((rule) => (
                      <View key={rule.id} style={s.pricingRow}>
                        <Text style={s.pricingLabel}>
                          {rule.dayType === "ALL"
                            ? "Any day"
                            : rule.dayType === "WEEKDAY"
                            ? "Weekdays"
                            : "Weekends"}
                        </Text>
                        <Text style={s.pricingValue}>
                          €{rule.pricePerHour}/hr
                          {rule.depositType !== "NONE" && rule.depositAmount
                            ? ` · Deposit: ${rule.depositType === "PERCENT" ? `${rule.depositAmount}%` : `€${rule.depositAmount}`}`
                            : ""}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[s.noContent, { marginTop: 4 }]}>No pricing rules set.</Text>
                )}
              </View>
            ))
          )}
        </View>

        {/* Opening Hours — always show all 7 days */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Opening Hours</Text>
          {[0, 1, 2, 3, 4, 5, 6].map((day) => {
            const h = (venue.openingHours ?? []).find((o) => o.dayOfWeek === day);
            const isClosed = !h || h.isClosed;
            return (
              <View key={day} style={s.hoursRow}>
                <Text style={s.hoursDay}>{DAY_NAMES[day]}</Text>
                {isClosed ? (
                  <Text style={s.hoursClosed}>Closed</Text>
                ) : (
                  <Text style={s.hoursTimes}>
                    {h!.openTime.slice(0, 5)} – {h!.closeTime.slice(0, 5)}
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        {/* Rejection reason */}
        {venue.status === "REJECTED" && venue.rejectionReason ? (
          <View style={s.section}>
            <View style={s.rejBox}>
              <Text style={s.rejLabel}>Rejection Reason</Text>
              <Text style={s.rejText}>{venue.rejectionReason}</Text>
            </View>
          </View>
        ) : null}

        {/* Disabled reason */}
        {venue.status === "DISABLED" && venue.disabledReason ? (
          <View style={s.section}>
            <View style={[s.rejBox, { backgroundColor: "#8E8E9320" }]}>
              <Text style={[s.rejLabel, { color: "#8E8E93" }]}>Disabled Reason</Text>
              <Text style={[s.rejText, { color: "#8E8E93" }]}>{venue.disabledReason}</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        {/* Top bar */}
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={onClose}>
            <FeatherIcons name="arrow-left" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle} numberOfLines={1}>
            {venue?.name ?? "Venue Detail"}
          </Text>
        </View>

        {renderBody()}

        {/* Sticky footer — PENDING: Approve + Reject; APPROVED: Disable */}
        {(venue?.status === "PENDING" || venue?.status === "APPROVED") && (
          <View style={s.footer}>
            {actionLoading ? (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : venue?.status === "PENDING" ? (
              <>
                <TouchableOpacity
                  style={s.approveBtn}
                  onPress={() => setApproveModalVisible(true)}
                >
                  <FeatherIcons name="check" size={16} color={colors.primaryForeground} />
                  <Text style={s.approveBtnText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.rejectBtn}
                  onPress={() => {
                    setRejectReason("");
                    setRejectModalVisible(true);
                  }}
                >
                  <FeatherIcons name="x" size={16} color={colors.destructive} />
                  <Text style={s.rejectBtnText}>Reject</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={s.rejectBtn}
                onPress={() => {
                  setDisableReason("");
                  setDisableModalVisible(true);
                }}
              >
                <FeatherIcons name="slash" size={16} color={colors.destructive} />
                <Text style={s.rejectBtnText}>Disable Venue</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Approve confirm modal */}
      <Modal
        visible={approveModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setApproveModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Approve Venue</Text>
            <Text style={s.modalSub}>
              Approve &quot;{venue?.name}&quot;? The venue will become visible to players.
            </Text>
            <View style={s.modalActions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setApproveModalVisible(false)}
              >
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.approveBtn, { flex: 1 }]} onPress={handleApprove}>
                <FeatherIcons name="check" size={16} color={colors.primaryForeground} />
                <Text style={s.approveBtnText}>Approve</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reject modal */}
      <Modal
        visible={rejectModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRejectModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Reject Venue</Text>
            <Text style={s.modalSub}>Provide an optional reason for the venue owner.</Text>
            <TextInput
              style={s.reasonInput}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="e.g. Incomplete information, address not verifiable…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
              maxLength={500}
            />
            <View style={s.modalActions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setRejectModalVisible(false)}
              >
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmRejectBtn} onPress={handleReject}>
                <Text style={s.confirmRejectText}>Confirm Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Disable modal */}
      <Modal
        visible={disableModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDisableModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Disable Venue</Text>
            <Text style={s.modalSub}>
              This venue will be hidden from players. The owner will be notified with your reason.
            </Text>
            <TextInput
              style={s.reasonInput}
              value={disableReason}
              onChangeText={setDisableReason}
              placeholder="e.g. Venue temporarily closed for renovations…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
              maxLength={500}
            />
            <View style={s.modalActions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setDisableModalVisible(false)}
              >
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmRejectBtn} onPress={handleDisable}>
                <Text style={s.confirmRejectText}>Confirm Disable</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Modal>
  );
}
