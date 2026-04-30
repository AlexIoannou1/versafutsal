import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

export default function AdminOverviewScreen() {
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
      backgroundColor: colors.warning + "20",
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 6,
      marginBottom: 24,
    },
    badgeText: {
      color: colors.warning,
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
    },
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
        <Text style={s.badgeText}>Admin Console</Text>
      </View>
      <Text style={s.greeting}>Welcome, {user?.name}</Text>
      <Text style={s.sub}>
        Venue approvals, bookings, payments, and user management will be here in the admin console.
      </Text>
    </View>
  );
}
