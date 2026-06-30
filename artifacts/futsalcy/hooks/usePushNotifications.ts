import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { useAuth } from "@/context/AuthContext";
import { registerPushToken } from "@workspace/api-client-react";

// expo-notifications Android push support was removed from Expo Go in SDK 53.
// Calling any Notifications API on Android Expo Go throws an error at module
// level — guard everything to avoid crashing the root layout.
const isExpoGoAndroid =
  Constants.executionEnvironment === "storeClient" && Platform.OS === "android";

export function usePushNotifications() {
  const { user, token } = useAuth();

  useEffect(() => {
    if (!user || !token) return;
    if (Platform.OS === "web") return;
    if (isExpoGoAndroid) return;

    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });
    } catch {
      return;
    }

    (async () => {
      try {
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
