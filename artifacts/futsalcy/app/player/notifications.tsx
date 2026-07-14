import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import FeatherIcons from "@/components/FeatherIcons";
import { usePlayerNotifications, useMarkPlayerNotificationsRead } from "@workspace/api-client-react";
import type { PlayerNotification } from "@workspace/api-client-react";

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function notifIcon(type: string): "calendar" | "clock" | "flag" | "x-circle" | "bell" {
  if (type === "BOOKING_CONFIRMED") return "calendar";
  if (type === "BOOKING_REMINDER") return "clock";
  if (type === "MATCH_FINISHED") return "flag";
  if (type === "BOOKING_CANCELLED") return "x-circle";
  return "bell";
}

function NotificationItem({
  item,
  onMarkRead,
  colors,
}: {
  item: PlayerNotification;
  onMarkRead: (id: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const icon = notifIcon(item.type);

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => {
        if (!item.read) onMarkRead(item.id);
      }}
      style={[
        styles.item,
        {
          backgroundColor: item.read ? colors.card : colors.primary + "12",
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: colors.primary + "18" },
        ]}
      >
        <FeatherIcons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.itemContent}>
        <View style={styles.itemHeader}>
          <Text
            style={[
              styles.itemTitle,
              {
                color: colors.foreground,
                fontFamily: item.read
                  ? "PlusJakartaSans_500Medium"
                  : "PlusJakartaSans_700Bold",
              },
            ]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          {!item.read && (
            <View
              style={[styles.unreadDot, { backgroundColor: colors.primary }]}
            />
          )}
        </View>
        <Text
          style={[styles.itemBody, { color: colors.mutedForeground }]}
          numberOfLines={2}
        >
          {item.body}
        </Text>
        <Text style={[styles.itemTime, { color: colors.mutedForeground }]}>
          {formatRelativeTime(item.createdAt)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function PlayerNotificationsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data, isLoading, refetch, isFetching } = usePlayerNotifications();
  const { mutate: markRead } = useMarkPlayerNotificationsRead();

  const notifications = data?.notifications ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;

  useFocusEffect(
    useCallback(() => {
      markRead(undefined);
    }, [markRead]),
  );

  const handleMarkAllRead = useCallback(() => {
    markRead(undefined);
  }, [markRead]);

  const handleMarkOneRead = useCallback(
    (id: string) => {
      markRead(id);
    },
    [markRead],
  );

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingTop: insets.top + (Platform.OS === "android" ? 8 : 4),
      paddingBottom: 12,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    backBtn: { padding: 4 },
    headerTitle: {
      flex: 1,
      fontSize: 18,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
    },
    markAllBtn: { padding: 4 },
    markAllText: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primary,
    },
    empty: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      paddingBottom: 60,
    },
    emptyText: {
      fontSize: 16,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.mutedForeground,
    },
    emptySubtext: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      paddingHorizontal: 40,
    },
  });

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <FeatherIcons name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Notifications</Text>
        {unreadCount > 0 && (
          <TouchableOpacity style={s.markAllBtn} onPress={handleMarkAllRead}>
            <Text style={s.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={s.empty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <NotificationItem
              item={item}
              onMarkRead={handleMarkOneRead}
              colors={colors}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={
            notifications.length === 0
              ? { flex: 1 }
              : { paddingBottom: insets.bottom + 24 }
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <FeatherIcons name="bell" size={40} color={colors.mutedForeground} />
              <Text style={s.emptyText}>No notifications yet</Text>
              <Text style={s.emptySubtext}>
                You'll be notified here when your bookings are confirmed or your session is about to start.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  itemContent: { flex: 1, gap: 3 },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  itemTitle: {
    flex: 1,
    fontSize: 14,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  itemBody: {
    fontSize: 13,
    fontFamily: "PlusJakartaSans_400Regular",
    lineHeight: 18,
  },
  itemTime: {
    fontSize: 11,
    fontFamily: "PlusJakartaSans_400Regular",
    marginTop: 2,
  },
});
