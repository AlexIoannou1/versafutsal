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
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { setBaseUrl } from "@workspace/api-client-react";

// Set API base URL for Expo (mobile needs absolute URL)
if (process.env.EXPO_PUBLIC_DOMAIN) {
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

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

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
