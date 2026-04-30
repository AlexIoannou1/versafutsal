import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

export default function OwnerDashboardScreen() {
  const colors = useColors();
  const { user } = useAuth();

  const s = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    badge: {
      backgroundColor: colors.primary + "20",
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 6,
      marginBottom: 24,
    },
    badgeText: { color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 },
    greeting: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      marginBottom: 8,
      textAlign: "center",
    },
    sub: {
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 22,
    },
  });

  return (
    <View style={s.container}>
      <View style={s.badge}>
        <Text style={s.badgeText}>Venue Owner</Text>
      </View>
      <Text style={s.greeting}>Hi, {user?.name}</Text>
      <Text style={s.sub}>
        Your venue dashboard, booking calendar, and analytics will appear here in the next milestone.
      </Text>
    </View>
  );
}
