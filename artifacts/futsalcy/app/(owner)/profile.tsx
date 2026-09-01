import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "expo-router";
import FeatherIcons from "@/components/FeatherIcons";
import * as Haptics from "expo-haptics";
import EditProfileSheet from "@/components/EditProfileSheet";

export default function OwnerProfileScreen() {
  const colors = useColors();
  const { user, logout, updateUser } = useAuth();
  const router = useRouter();
  const [editVisible, setEditVisible] = useState(false);

  const handleLogout = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await logout();
    router.replace("/(auth)/mode-select");
  };

  const handleSaved = (updated: { name: string; email: string; phoneNumber?: string | null }) => {
    updateUser(updated);
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1, padding: 24 },
    sectionTitle: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.mutedForeground,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    menuCard: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 20,
      overflow: "hidden",
    },
    menuRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    menuRowBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    menuRowText: {
      flex: 1,
      fontSize: 15,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.foreground,
    },
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
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      textAlign: "center",
      marginBottom: 4,
    },
    email: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      textAlign: "center",
      marginBottom: 4,
    },
    phone: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
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
      marginBottom: 32,
    },
    roleText: { fontSize: 12, fontFamily: "PlusJakartaSans_600SemiBold", color: colors.primary },
    editBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.card,
      borderRadius: 12,
      paddingVertical: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
    },
    editBtnText: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.foreground,
    },
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
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.destructive,
    },
  });

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.avatar}>
          <FeatherIcons name="briefcase" size={32} color={colors.primary} />
        </View>
        <Text style={s.name}>{user?.name}</Text>
        <Text style={s.email}>{user?.email}</Text>
        {user?.phoneNumber ? <Text style={s.phone}>{user.phoneNumber}</Text> : null}
        <View style={s.roleBadge}>
          <Text style={s.roleText}>Venue Owner</Text>
        </View>

        <TouchableOpacity style={s.editBtn} onPress={() => setEditVisible(true)}>
          <FeatherIcons name="edit-2" size={18} color={colors.foreground} />
          <Text style={s.editBtnText}>Edit Profile</Text>
        </TouchableOpacity>

        <Text style={s.sectionTitle}>Manage</Text>
        <View style={s.menuCard}>
          <TouchableOpacity
            style={s.menuRow}
            onPress={() => router.push("/(owner)/venues")}
          >
            <FeatherIcons name="grid" size={20} color={colors.primary} />
            <Text style={s.menuRowText}>My Venues</Text>
            <FeatherIcons name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.menuRow, s.menuRowBorder]}
            onPress={() => router.push("/owner/settings")}
          >
            <FeatherIcons name="settings" size={20} color={colors.primary} />
            <Text style={s.menuRowText}>Settings</Text>
            <FeatherIcons name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <FeatherIcons name="log-out" size={18} color={colors.destructive} />
          <Text style={s.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>

      <EditProfileSheet
        visible={editVisible}
        user={user}
        onClose={() => setEditVisible(false)}
        onSaved={handleSaved}
        onPasswordChanged={handleLogout}
      />
    </View>
  );
}
