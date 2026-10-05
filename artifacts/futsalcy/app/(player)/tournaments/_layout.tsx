import React from "react";
import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { Platform } from "react-native";

export default function PlayerTournamentsLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerTitleStyle: { fontFamily: "PlusJakartaSans_600SemiBold" },
        headerShadowVisible: false,
        headerBackTitle: "Back",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Tournaments" }} />
      <Stack.Screen name="[id]" options={{ title: "Tournament Details" }} />
    </Stack>
  );
}
