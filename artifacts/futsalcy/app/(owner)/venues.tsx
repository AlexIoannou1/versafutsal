import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";

export default function OwnerVenuesScreen() {
  const colors = useColors();
  const s = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    iconWrap: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    title: {
      fontSize: 18,
      fontFamily: "Inter_600SemiBold",
      color: colors.foreground,
      marginBottom: 8,
    },
    sub: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
    },
  });

  return (
    <View style={s.container}>
      <View style={s.iconWrap}>
        <Feather name="grid" size={28} color={colors.mutedForeground} />
      </View>
      <Text style={s.title}>No venues yet</Text>
      <Text style={s.sub}>Venue management and onboarding will be here in the next milestone.</Text>
    </View>
  );
}
