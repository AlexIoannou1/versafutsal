import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

export default function OwnerProfileScreen() {
  const colors = useColors();
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await logout();
    router.replace("/(auth)/mode-select");
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background, padding: 24 },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.primary + "20",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
      alignSelf: "center",
    },
    name: {
      fontSize: 22,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
      textAlign: "center",
      marginBottom: 4,
    },
    email: {
      fontSize: 14,
      fontFamily: "Inter_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      marginBottom: 4,
    },
    roleBadge: {
      alignSelf: "center",
      backgroundColor: colors.primary + "20",
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 4,
      marginBottom: 40,
    },
    roleText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.primary },
    logoutBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.destructive + "15",
      borderRadius: 12,
      paddingVertical: 14,
    },
    logoutText: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.destructive,
    },
  });

  return (
    <View style={s.container}>
      <View style={s.avatar}>
        <Feather name="briefcase" size={32} color={colors.primary} />
      </View>
      <Text style={s.name}>{user?.name}</Text>
      <Text style={s.email}>{user?.email}</Text>
      <View style={s.roleBadge}>
        <Text style={s.roleText}>Venue Owner</Text>
      </View>
      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
        <Feather name="log-out" size={18} color={colors.destructive} />
        <Text style={s.logoutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}
