import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import FeatherIcons from "@/components/FeatherIcons";
import { deleteAccount, clearPushToken } from "@workspace/api-client-react";
import { NOTIFICATIONS_PREF_KEY } from "@/hooks/usePushNotifications";

const TERMS_URL = "https://futsalcy.com/terms";
const PRIVACY_URL = "https://futsalcy.com/privacy";

export default function PlayerSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [loadingNotif, setLoadingNotif] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Load saved notifications preference
  useEffect(() => {
    AsyncStorage.getItem(NOTIFICATIONS_PREF_KEY).then((val) => {
      if (val === "false") setNotificationsEnabled(false);
    });
  }, []);

  const handleToggleNotifications = useCallback(
    async (value: boolean) => {
      if (loadingNotif) return;
      setLoadingNotif(true);
      try {
        await AsyncStorage.setItem(NOTIFICATIONS_PREF_KEY, value ? "true" : "false");
        if (!value) {
          await clearPushToken();
        }
        setNotificationsEnabled(value);
      } catch {
        Alert.alert("Error", "Could not update notification preference.");
      } finally {
        setLoadingNotif(false);
      }
    },
    [loadingNotif],
  );

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => {
      Alert.alert("Error", "Could not open link.");
    });
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account and all your data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete My Account",
          style: "destructive",
          onPress: confirmDeleteAccount,
        },
      ],
    );
  };

  const confirmDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      await deleteAccount();
      await logout();
      router.replace("/(auth)/mode-select");
    } catch {
      Alert.alert("Error", "Could not delete account. Please try again.");
    } finally {
      setDeletingAccount(false);
    }
  };

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
    backBtn: {
      padding: 4,
    },
    headerTitle: {
      fontSize: 18,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    scroll: { flex: 1 },
    section: {
      marginTop: 28,
      marginHorizontal: 16,
    },
    sectionLabel: {
      fontSize: 12,
      fontFamily: "Inter_600SemiBold",
      color: colors.mutedForeground,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      marginBottom: 8,
      marginLeft: 4,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 14,
    },
    rowDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: 46,
    },
    rowIcon: {
      width: 32,
      alignItems: "center",
    },
    rowLabel: {
      flex: 1,
      fontSize: 15,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
    },
    rowChevron: {
      opacity: 0.4,
    },
    deleteCard: {
      backgroundColor: colors.destructive + "10",
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.destructive + "30",
      overflow: "hidden",
    },
    deleteRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 14,
      gap: 10,
    },
    deleteText: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.destructive,
    },
  });

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <FeatherIcons name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Settings</Text>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>

        {/* Notifications */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Notifications</Text>
          <View style={s.card}>
            <View style={s.row}>
              <View style={s.rowIcon}>
                <FeatherIcons name="bell" size={18} color={colors.primary} />
              </View>
              <Text style={s.rowLabel}>Push Notifications</Text>
              {loadingNotif ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Switch
                  value={notificationsEnabled}
                  onValueChange={handleToggleNotifications}
                  trackColor={{ false: colors.muted, true: colors.primary }}
                  thumbColor={colors.primaryForeground}
                />
              )}
            </View>
          </View>
        </View>

        {/* Privacy */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Privacy</Text>
          <View style={s.card}>
            <TouchableOpacity style={s.row} onPress={() => openUrl(TERMS_URL)}>
              <View style={s.rowIcon}>
                <FeatherIcons name="file-text" size={18} color={colors.primary} />
              </View>
              <Text style={s.rowLabel}>Terms &amp; Conditions</Text>
              <FeatherIcons name="external-link" size={16} color={colors.mutedForeground} style={s.rowChevron} />
            </TouchableOpacity>
            <View style={s.rowDivider} />
            <TouchableOpacity style={s.row} onPress={() => openUrl(PRIVACY_URL)}>
              <View style={s.rowIcon}>
                <FeatherIcons name="shield" size={18} color={colors.primary} />
              </View>
              <Text style={s.rowLabel}>Privacy Policy</Text>
              <FeatherIcons name="external-link" size={16} color={colors.mutedForeground} style={s.rowChevron} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Payments */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Payments</Text>
          <View style={s.card}>
            <TouchableOpacity
              style={s.row}
              onPress={() => router.push("/player/settings-payments")}
            >
              <View style={s.rowIcon}>
                <FeatherIcons name="credit-card" size={18} color={colors.primary} />
              </View>
              <Text style={s.rowLabel}>Payment Methods</Text>
              <FeatherIcons name="chevron-right" size={18} color={colors.mutedForeground} style={s.rowChevron} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Delete Account */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Account</Text>
          <TouchableOpacity
            style={s.deleteCard}
            onPress={handleDeleteAccount}
            disabled={deletingAccount}
          >
            <View style={s.deleteRow}>
              {deletingAccount ? (
                <ActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <>
                  <FeatherIcons name="trash-2" size={18} color={colors.destructive} />
                  <Text style={s.deleteText}>Delete Account</Text>
                </>
              )}
            </View>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}
