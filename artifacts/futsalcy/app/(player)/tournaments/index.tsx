import React, { useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import FeatherIcons from "@/components/FeatherIcons";
import { useListTournaments, useListPlayerTournamentRegistrations, getListPlayerTournamentRegistrationsQueryKey } from "@workspace/api-client-react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function PlayerTournamentsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<"explore" | "mine">("explore");

  const { data: exploreData, isLoading: exploreLoading, refetch: exploreRefetch, isRefetching: exploreRefetching } = useListTournaments();
  const { data: mineData, isLoading: mineLoading, refetch: mineRefetch, isRefetching: mineRefetching } = useListPlayerTournamentRegistrations({ query: { enabled: activeTab === "mine", queryKey: getListPlayerTournamentRegistrationsQueryKey() } });

  const renderItem = ({ item }: { item: any }) => {
    if (activeTab === "mine") {
      const name = item.tournamentName || (item.teamName ? `Team: ${item.teamName}` : `Registration ${item.id.substring(0,8)}`);
      const paymentStatus = item.paymentStatus || item.status;
      return (
        <TouchableOpacity
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push(`/player/tournaments/${item.tournamentId}` as any)}
        >
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>{name}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
            Status: {item.status} • Payment: {paymentStatus}
          </Text>
        </TouchableOpacity>
      );
    }
    
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push(`/player/tournaments/${item.id}` as any)}
      >
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
          {item.status} • {item.entryFeeAmount} {item.currency}
        </Text>
      </TouchableOpacity>
    );
  };

  const isLoading = activeTab === "explore" ? exploreLoading : mineLoading;
  const isRefetching = activeTab === "explore" ? exploreRefetching : mineRefetching;
  const data = activeTab === "explore" ? exploreData?.tournaments : mineData?.registrations;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flexDirection: "row", padding: 16, gap: 12 }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Explore tournaments"
          style={[styles.segBtn, { backgroundColor: activeTab === "explore" ? colors.primary : colors.card, borderColor: activeTab === "explore" ? colors.primary : colors.border }]}
          onPress={() => setActiveTab("explore")}
        >
          <Text style={[styles.segText, { color: activeTab === "explore" ? colors.primaryForeground : colors.foreground }]}>Explore</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="My tournaments"
          style={[styles.segBtn, { backgroundColor: activeTab === "mine" ? colors.primary : colors.card, borderColor: activeTab === "mine" ? colors.primary : colors.border }]}
          onPress={() => setActiveTab("mine")}
        >
          <Text style={[styles.segText, { color: activeTab === "mine" ? colors.primaryForeground : colors.foreground }]}>My Tournaments</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data || []}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={activeTab === "explore" ? exploreRefetch : mineRefetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: colors.mutedForeground }}>No tournaments found.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, minHeight: 200 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  segText: { fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold" },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  title: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" },
});
