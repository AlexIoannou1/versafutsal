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
  Platform,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import FeatherIcons from "@/components/FeatherIcons";
import { deleteAccount, clearPushToken, registerPushToken } from "@workspace/api-client-react";
import { NOTIFICATIONS_PREF_KEY } from "@/hooks/usePushNotifications";
import { useTheme, type ThemePreference } from "@/context/ThemeContext";

const TERMS_URL = "https://versafutsal.com/terms";
const PRIVACY_URL = "https://versafutsal.com/privacy";

const isExpoGoAndroid =
  Constants.executionEnvironment === "storeClient" && Platform.OS === "android";

async function attemptPushRegistration(): Promise<void> {
  if (Platform.OS === "web" || isExpoGoAndroid) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require("expo-notifications");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require("expo-device");
    if (!Device.isDevice) return;

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return;

    const expoPushToken = await Notifications.getExpoPushTokenAsync().catch(() => null);
    if (!expoPushToken?.data) return;

    await registerPushToken({ pushToken: expoPushToken.data });
  } catch {
    // Non-fatal
  }
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "smartphone" },
];

export default function PlayerSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const { preference: themePreference, setPreference: setThemePreference } = useTheme();

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [loadingNotif, setLoadingNotif] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

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
        } else {
          // Immediately re-register so the toggle takes effect without a restart
          await attemptPushRegistration();
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

  const openUrl = async (url: string) => {
    const result = await WebBrowser.openBrowserAsync(url).catch(() => null);
    if (result === null) {
      Alert.alert("Error", "Could not open link.");
    }
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
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
    },
    scroll: { flex: 1 },
    section: {
      marginTop: 28,
      marginHorizontal: 16,
    },
    sectionLabel: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_600SemiBold",
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
      fontFamily: "PlusJakartaSans_500Medium",
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
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.destructive,
    },
    themeSegment: {
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    themeChip: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 9,
      borderRadius: 10,
      borderWidth: 1.5,
    },
    themeChipText: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_600SemiBold",
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

        {/* Appearance */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Appearance</Text>
          <View style={s.card}>
            <View style={s.themeSegment}>
              {THEME_OPTIONS.map((opt) => {
                const active = themePreference === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      s.themeChip,
                      {
                        backgroundColor: active ? colors.primary : "transparent",
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setThemePreference(opt.value)}
                  >
                    <FeatherIcons
                      name={opt.icon as "sun" | "moon" | "smartphone"}
                      size={14}
                      color={active ? colors.primaryForeground : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        s.themeChipText,
                        { color: active ? colors.primaryForeground : colors.mutedForeground },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

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
              <FeatherIcons name="chevron-right" size={16} color={colors.mutedForeground} style={s.rowChevron} />
            </TouchableOpacity>
            <View style={s.rowDivider} />
            <TouchableOpacity style={s.row} onPress={() => openUrl(PRIVACY_URL)}>
              <View style={s.rowIcon}>
                <FeatherIcons name="shield" size={18} color={colors.primary} />
              </View>
              <Text style={s.rowLabel}>Privacy Policy</Text>
              <FeatherIcons name="chevron-right" size={16} color={colors.mutedForeground} style={s.rowChevron} />
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
