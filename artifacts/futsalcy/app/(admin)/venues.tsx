import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminListVenues,
  getAdminListVenuesQueryKey,
  approveVenue,
  rejectVenue,
} from "@workspace/api-client-react";

type TabKey = "PENDING" | "APPROVED" | "REJECTED";

const TABS: { key: TabKey; label: string }[] = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
];

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#FF9500",
  APPROVED: "#00C851",
  REJECTED: "#FF3B30",
};

type VenueItem = {
  id: string;
  name: string;
  district: string;
  address: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason?: string | null;
  owner?: { name: string; email: string } | null;
  createdAt: string;
};

export default function AdminVenuesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>("PENDING");
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveModalVisible, setApproveModalVisible] = useState(false);
  const [approveTarget, setApproveTarget] = useState<{ id: string; name: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const { data, isLoading, refetch, isRefetching } = useAdminListVenues({
    status: activeTab,
  });
  const venues: VenueItem[] = (data?.venues as VenueItem[] | undefined) ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getAdminListVenuesQueryKey() });
  };

  const handleApprove = (id: string, name: string) => {
    setApproveTarget({ id, name });
    setApproveModalVisible(true);
  };

  const confirmApprove = async () => {
    if (!approveTarget) return;
    const { id } = approveTarget;
    setApproveModalVisible(false);
    setActionLoading(id);
    try {
      await approveVenue(id);
      invalidate();
    } catch {
      Alert.alert("Error", "Failed to approve venue. Please try again.");
    } finally {
      setActionLoading(null);
      setApproveTarget(null);
    }
  };

  const openRejectModal = (id: string) => {
    setRejectTargetId(id);
    setRejectReason("");
    setRejectModalVisible(true);
  };

  const handleReject = async () => {
    if (!rejectTargetId) return;
    setActionLoading(rejectTargetId);
    setRejectModalVisible(false);
    try {
      await rejectVenue(rejectTargetId, { reason: rejectReason.trim() || undefined });
      invalidate();
    } catch {
      Alert.alert("Error", "Failed to reject venue. Please try again.");
    } finally {
      setActionLoading(null);
    }
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 20,
      paddingTop: insets.top + 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 20,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 12,
    },
    tabs: { flexDirection: "row", gap: 8 },
    tabBtn: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 20,
      borderWidth: 1,
    },
    tabText: { fontSize: 13, fontFamily: "Inter_500Medium" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    emptyIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: 18,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 8,
    },
    emptySub: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
    },
    list: { padding: 16 },
    card: {
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 8,
    },
    venueName: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      flex: 1,
      marginRight: 8,
    },
    badge: {
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
    metaText: { fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground },
    ownerBox: {
      backgroundColor: colors.muted,
      borderRadius: 8,
      padding: 10,
      marginTop: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    ownerText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    ownerName: { fontFamily: "Inter_500Medium", color: colors.foreground },
    rejBox: {
      backgroundColor: colors.destructive + "15",
      borderRadius: 8,
      padding: 10,
      marginTop: 8,
    },
    rejLabel: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
      color: colors.destructive,
      marginBottom: 2,
    },
    rejText: { fontSize: 12, fontFamily: "Inter_400Regular", color: colors.destructive },
    actions: { flexDirection: "row", gap: 8, marginTop: 12 },
    approveBtn: {
      flex: 1,
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 6,
    },
    approveBtnText: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
    rejectBtn: {
      flex: 1,
      backgroundColor: colors.destructive + "15",
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: colors.destructive + "40",
    },
    rejectBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.destructive },
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
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 8,
    },
    modalSub: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      marginBottom: 16,
    },
    reasonInput: {
      backgroundColor: colors.muted,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
      minHeight: 80,
      textAlignVertical: "top",
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
    cancelBtnText: { fontSize: 15, fontFamily: "Inter_500Medium", color: colors.foreground },
    confirmRejectBtn: {
      flex: 1,
      backgroundColor: colors.destructive,
      borderRadius: 10,
      paddingVertical: 13,
      alignItems: "center",
    },
    confirmRejectText: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: "#FFFFFF",
    },
  });

  const emptyMessages: Record<TabKey, string> = {
    PENDING: "No pending venues to review.",
    APPROVED: "No approved venues yet.",
    REJECTED: "No rejected venues.",
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Venue Approvals</Text>
        <View style={s.tabs}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[
                  s.tabBtn,
                  {
                    backgroundColor: active ? colors.primary : "transparent",
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => setActiveTab(tab.key)}
              >
                <Text
                  style={[
                    s.tabText,
                    { color: active ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : venues.length === 0 ? (
        <View style={s.center}>
          <View style={s.emptyIcon}>
            <Feather name="check-square" size={28} color={colors.mutedForeground} />
          </View>
          <Text style={s.emptyTitle}>
            {activeTab === "PENDING" ? "All clear!" : "Nothing here"}
          </Text>
          <Text style={s.emptySub}>{emptyMessages[activeTab]}</Text>
        </View>
      ) : (
        <FlatList
          data={venues}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => {
            const statusColor = STATUS_COLORS[item.status] ?? colors.mutedForeground;
            const isActioning = actionLoading === item.id;

            return (
              <View style={s.card}>
                <View style={s.cardHeader}>
                  <Text style={s.venueName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={[s.badge, { backgroundColor: statusColor + "20" }]}>
                    <Text style={[s.badgeText, { color: statusColor }]}>
                      {item.status}
                    </Text>
                  </View>
                </View>

                <View style={s.metaRow}>
                  <Feather name="map-pin" size={13} color={colors.mutedForeground} />
                  <Text style={s.metaText}>{item.district} · {item.address}</Text>
                </View>

                {item.owner && (
                  <View style={s.ownerBox}>
                    <Feather name="user" size={14} color={colors.mutedForeground} />
                    <Text style={s.ownerText}>
                      <Text style={s.ownerName}>{item.owner.name}</Text>
                      {" "}· {item.owner.email}
                    </Text>
                  </View>
                )}

                {item.status === "REJECTED" && item.rejectionReason && (
                  <View style={s.rejBox}>
                    <Text style={s.rejLabel}>Rejection reason</Text>
                    <Text style={s.rejText}>{item.rejectionReason}</Text>
                  </View>
                )}

                {item.status === "PENDING" && (
                  <View style={s.actions}>
                    <TouchableOpacity
                      style={[s.approveBtn, isActioning && { opacity: 0.5 }]}
                      onPress={() => handleApprove(item.id, item.name)}
                      disabled={isActioning}
                    >
                      {isActioning ? (
                        <ActivityIndicator size="small" color={colors.primaryForeground} />
                      ) : (
                        <>
                          <Feather name="check" size={16} color={colors.primaryForeground} />
                          <Text style={s.approveBtnText}>Approve</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.rejectBtn, isActioning && { opacity: 0.5 }]}
                      onPress={() => openRejectModal(item.id)}
                      disabled={isActioning}
                    >
                      <Feather name="x" size={16} color={colors.destructive} />
                      <Text style={s.rejectBtnText}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

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
              Approve &quot;{approveTarget?.name}&quot;? The venue will become visible to players.
            </Text>
            <View style={s.modalActions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setApproveModalVisible(false)}
              >
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.approveBtn, { flex: 1 }]}
                onPress={confirmApprove}
              >
                <Feather name="check" size={16} color={colors.primaryForeground} />
                <Text style={s.approveBtnText}>Approve</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
    </View>
  );
}
