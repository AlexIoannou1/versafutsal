import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { registerPushToken } from "@workspace/api-client-react";

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function usePushNotifications() {
  const { user, token } = useAuth();

  useEffect(() => {
    if (!user || !token) return;
    if (Platform.OS === "web") return; // Push not supported on web

    (async () => {
      try {
        // Only physical devices support push tokens
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

        // Register with server (non-fatal)
        await registerPushToken({ pushToken: expoPushToken.data });
      } catch {
        // Non-fatal — push is best-effort
      }
    })();
  }, [user?.id, token]);
}
