import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import { useListOwnerVenues } from "@workspace/api-client-react";

const DISTRICT_LABELS: Record<string, string> = {
  nicosia: "Nicosia",
  limassol: "Limassol",
  larnaca: "Larnaca",
  paphos: "Paphos",
  famagusta: "Famagusta",
  kyrenia: "Kyrenia",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#FF9500",
  APPROVED: "#00C851",
  REJECTED: "#FF3B30",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

type VenueItem = {
  id: string;
  name: string;
  district: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  pitchCount?: number;
  rejectionReason?: string | null;
};

export default function OwnerVenuesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useListOwnerVenues();
  const venues: VenueItem[] = (data?.venues as VenueItem[] | undefined) ?? [];

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: insets.top + 16,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 20,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    addBtn: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    addBtnText: {
      fontSize: 14,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
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
      textAlign: "center",
    },
    emptySub: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
      marginBottom: 24,
    },
    emptyBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingHorizontal: 24,
      paddingVertical: 14,
    },
    emptyBtnText: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
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
    cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    venueName: {
      fontSize: 16,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      flex: 1,
      marginRight: 8,
    },
    statusBadge: {
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    statusText: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
    },
    districtRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
    districtText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    pitchText: {
      fontSize: 13,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
    },
    rejectionBox: {
      marginTop: 8,
      backgroundColor: colors.destructive + "15",
      borderRadius: 8,
      padding: 10,
    },
    rejectionLabel: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
      color: colors.destructive,
      marginBottom: 2,
    },
    rejectionText: {
      fontSize: 12,
      fontFamily: "Inter_400Regular",
      color: colors.destructive,
    },
    manageRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      marginTop: 10,
      gap: 8,
    },
    manageBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    manageBtnText: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
  });

  if (isLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>My Venues</Text>
        <TouchableOpacity style={s.addBtn} onPress={() => router.push("/owner/venue-new")}>
          <FeatherIcons name="plus" size={16} color={colors.primaryForeground} />
          <Text style={s.addBtnText}>New Venue</Text>
        </TouchableOpacity>
      </View>

      {venues.length === 0 ? (
        <View style={s.center}>
          <View style={s.emptyIcon}>
            <FeatherIcons name="map-pin" size={28} color={colors.mutedForeground} />
          </View>
          <Text style={s.emptyTitle}>No venues yet</Text>
          <Text style={s.emptySub}>
            Create your first venue to get started. Once approved, players can discover and book your pitches.
          </Text>
          <TouchableOpacity style={s.emptyBtn} onPress={() => router.push("/owner/venue-new")}>
            <Text style={s.emptyBtnText}>Create Your First Venue</Text>
          </TouchableOpacity>
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
            return (
              <View style={s.card}>
                <View style={s.cardRow}>
                  <Text style={s.venueName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View
                    style={[
                      s.statusBadge,
                      { backgroundColor: statusColor + "20" },
                    ]}
                  >
                    <Text style={[s.statusText, { color: statusColor }]}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </Text>
                  </View>
                </View>

                <View style={s.districtRow}>
                  <FeatherIcons name="map-pin" size={13} color={colors.mutedForeground} />
                  <Text style={s.districtText}>
                    {DISTRICT_LABELS[item.district.toLowerCase()] ?? item.district}
                  </Text>
                </View>

                <Text style={s.pitchText}>
                  {item.pitchCount ?? 0} {item.pitchCount === 1 ? "pitch" : "pitches"}
                </Text>

                {item.status === "REJECTED" && item.rejectionReason && (
                  <View style={s.rejectionBox}>
                    <Text style={s.rejectionLabel}>Rejection reason</Text>
                    <Text style={s.rejectionText}>{item.rejectionReason}</Text>
                  </View>
                )}

                <View style={s.manageRow}>
                  <TouchableOpacity
                    style={s.manageBtn}
                    onPress={() => router.push(`/owner/venue/${item.id}`)}
                  >
                    <FeatherIcons name="settings" size={14} color={colors.foreground} />
                    <Text style={s.manageBtnText}>Manage</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
