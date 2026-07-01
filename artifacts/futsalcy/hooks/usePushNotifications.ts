import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { useAuth } from "@/context/AuthContext";
import { registerPushToken } from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const NOTIFICATIONS_PREF_KEY = "@futsalcy/notificationsEnabled";

// expo-notifications Android push support was removed from Expo Go in SDK 53.
// The module throws during initialization on Android Expo Go — static imports
// cannot be try-caught, so we use require() at runtime instead.
const isExpoGoAndroid =
  Constants.executionEnvironment === "storeClient" && Platform.OS === "android";

export function usePushNotifications() {
  const { user, token } = useAuth();

  useEffect(() => {
    if (!user || !token) return;
    if (Platform.OS === "web") return;
    if (isExpoGoAndroid) return;

    (async () => {
      try {
        // Respect the user's notification opt-out preference
        const pref = await AsyncStorage.getItem(NOTIFICATIONS_PREF_KEY);
        if (pref === "false") return;

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Notifications = require("expo-notifications");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Device = require("expo-device");

        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
          }),
        });

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
        // Non-fatal — push is best-effort
      }
    })();
  }, [user?.id, token]);
}
