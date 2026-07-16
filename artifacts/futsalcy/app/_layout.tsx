import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
// FeatherIcons font loaded under a unique name to bypass Expo Go's pre-registered
// 'feather' font (which causes boxed-X glyphs on Android). See components/FeatherIcons.tsx.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FeatherFont = require("../assets/fonts/Feather.ttf") as number;
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { Platform } from "react-native";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { setBaseUrl } from "@workspace/api-client-react";

// Set API base URL so the client knows where to send requests.
//
// On web (Replit): the Expo app runs on *.expo.<host> but the API server is
// at /api on *.<host>. Strip the ".expo." segment from the hostname so
// relative /api/... paths resolve correctly — no env var needed, no stale URLs.
//
// On native: use EXPO_PUBLIC_DOMAIN which is set in .env.local for dev builds.
if (Platform.OS === "web" && typeof window !== "undefined") {
  const hostname = window.location.hostname;
  const apiHostname = hostname.replace(/\.expo\./, ".");
  const base = `${window.location.protocol}//${apiHostname !== hostname ? apiHostname : hostname}`;
  setBaseUrl(base);
} else if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const colors = useColors();
  usePushNotifications();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerTitleStyle: { fontFamily: "PlusJakartaSans_600SemiBold" },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(player)" />
      <Stack.Screen name="(owner)" />
      <Stack.Screen name="(admin)" />
      <Stack.Screen
        name="owner/booking-new"
        options={{ headerShown: true, title: "New Booking" }}
      />
      <Stack.Screen
        name="owner/booking-edit"
        options={{ headerShown: true, title: "Edit Booking" }}
      />
      <Stack.Screen
        name="owner/venue-new"
        options={{ headerShown: true, title: "New Venue", presentation: "modal" }}
      />
      <Stack.Screen
        name="owner/venue/[id]"
        options={{ headerShown: true, title: "Manage Venue" }}
      />
      <Stack.Screen
        name="player/venue/[id]"
        options={{ headerShown: true, title: "Venue Details" }}
      />
      <Stack.Screen
        name="player/venue/[id]/book"
        options={{ headerShown: true }}
      />
      <Stack.Screen
        name="player/venue/[id]/book-summary"
        options={{ headerShown: true, title: "Checkout" }}
      />
      <Stack.Screen
        name="player/booking/[id]"
        options={{ headerShown: true, title: "Booking" }}
      />
      <Stack.Screen
        name="owner/booking/[id]"
        options={{ headerShown: true, title: "Booking Detail" }}
      />
      <Stack.Screen
        name="admin/booking/[id]"
        options={{ headerShown: true, title: "Booking (Admin)" }}
      />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    FeatherIcons: FeatherFont,
  });

  // Safety net: if fonts don't resolve within 15 s (e.g. slow tunnel),
  // proceed anyway so the app doesn't hang on a blank screen forever.
  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimeout(true), 15000);
    return () => clearTimeout(t);
  }, []);

  const ready = fontsLoaded || fontError || fontTimeout;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <GestureHandlerRootView>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </AuthProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
