import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import { useColors } from "@/hooks/useColors";
import { MotionPressable } from "@/components/Motion";
import { useGetOwnerSubscription, useListOwnerTournaments, getListOwnerTournamentsQueryKey } from "@workspace/api-client-react";

export default function OwnerTournamentsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: subData, isLoading: subLoading } = useGetOwnerSubscription();
  const isElite = subData?.subscription?.effectivePlan === "ELITE";

  const { data, isLoading, refetch, isRefetching } = useListOwnerTournaments({
    query: { enabled: isElite, queryKey: getListOwnerTournamentsQueryKey() },
  });

  const tournaments = data?.tournaments ?? [];

  if (subLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!isElite) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: colors.primary + "20",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
          }}
        >
          <FeatherIcons name="award" size={40} color={colors.primary} />
        </View>
        <Text
          style={{
            fontSize: 24,
            fontFamily: "PlusJakartaSans_700Bold",
            color: colors.foreground,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          Elite Tournaments
        </Text>
        <Text
          style={{
            fontSize: 16,
            fontFamily: "PlusJakartaSans_400Regular",
            color: colors.mutedForeground,
            textAlign: "center",
            marginBottom: 32,
            lineHeight: 24,
          }}
        >
          Host competitive tournaments, generate brackets, and track match results. Upgrade to the Elite plan to unlock these features.
        </Text>
        <TouchableOpacity
          style={{
            backgroundColor: colors.primary,
            paddingHorizontal: 24,
            paddingVertical: 16,
            borderRadius: 12,
            width: "100%",
            alignItems: "center",
          }}
          accessibilityRole="button"
          accessibilityLabel="View Elite plans"
          onPress={() => router.push("/(owner)/plans")}
        >
          <Text style={{ color: colors.primaryForeground, fontSize: 16, fontFamily: "PlusJakartaSans_700Bold" }}>
            View Plans
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const renderItem = ({ item }: { item: any }) => {
    return (
      <MotionPressable
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push(`/owner/tournaments/${item.id}` as any)}
      >
        <View style={styles.cardHeader}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {item.name}
          </Text>
          <View style={[styles.badge, { backgroundColor: colors.primary + "15" }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>{item.status}</Text>
          </View>
        </View>
        <View style={styles.cardRow}>
          <FeatherIcons name="users" size={14} color={colors.mutedForeground} />
          <Text style={[styles.cardText, { color: colors.mutedForeground }]}>
            {item.confirmedRegistrations} / {item.capacity} {item.entryType === "TEAM" ? "Teams" : "Players"}
          </Text>
        </View>
        <View style={styles.cardRow}>
          <FeatherIcons name="calendar" size={14} color={colors.mutedForeground} />
          <Text style={[styles.cardText, { color: colors.mutedForeground }]}>
            {new Date(item.startsAt).toLocaleDateString()}
          </Text>
        </View>
      </MotionPressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : tournaments.length === 0 ? (
        <View style={styles.center}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.card }]}>
            <FeatherIcons name="award" size={32} color={colors.mutedForeground} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No tournaments yet</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Create your first tournament to get started.
          </Text>
        </View>
      ) : (
        <FlatList
          data={tournaments}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
        />
      )}

      <TouchableOpacity
        style={[
          styles.fab,
          {
            backgroundColor: colors.primary,
            bottom: insets.bottom + (Platform.OS === "web" ? 100 : 80),
            shadowColor: colors.foreground,
          },
        ]}
        onPress={() => router.push("/owner/tournaments/new" as any)}
      >
        <FeatherIcons name="plus" size={24} color={colors.primaryForeground} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  title: { fontSize: 16, fontFamily: "PlusJakartaSans_700Bold", flex: 1, marginRight: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 10, fontFamily: "PlusJakartaSans_700Bold" },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  cardText: { fontSize: 13, fontFamily: "PlusJakartaSans_500Medium" },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontFamily: "PlusJakartaSans_700Bold", marginBottom: 8 },
  emptyText: { fontSize: 14, fontFamily: "PlusJakartaSans_400Regular", textAlign: "center" },
  fab: {
    position: "absolute",
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
});
