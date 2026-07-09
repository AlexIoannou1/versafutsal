import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "expo-router";
import FeatherIcons from "@/components/FeatherIcons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import EditProfileSheet from "@/components/EditProfileSheet";
import { uploadAvatar } from "@workspace/api-client-react";

export default function PlayerProfileScreen() {
  const colors = useColors();
  const { user, logout, updateUser } = useAuth();
  const router = useRouter();
  const [editVisible, setEditVisible] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleLogout = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await logout();
    router.replace("/(auth)/mode-select");
  };

  const handleSaved = (updated: {
    name: string;
    email: string;
    phoneNumber?: string | null;
    avatarUrl?: string | null;
    city?: string | null;
  }) => {
    updateUser(updated);
  };

  const handleAvatarPress = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission required",
        "Please allow access to your photo library to update your profile picture.",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? "image/jpeg";

    if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
      Alert.alert("Unsupported format", "Please choose a JPG or PNG image.");
      return;
    }

    setUploading(true);
    try {
      const { avatarUrl } = await uploadAvatar(asset.uri, mimeType);
      await updateUser({ avatarUrl });
    } catch {
      Alert.alert("Upload failed", "Could not upload the image. Please try again.");
    } finally {
      setUploading(false);
    }
  }, [updateUser]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1, padding: 24 },
    avatarWrapper: {
      alignSelf: "center",
      marginBottom: 16,
    },
    avatar: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.primary + "20",
      alignItems: "center",
      justifyContent: "center",
    },
    avatarImage: {
      width: 88,
      height: 88,
      borderRadius: 44,
    },
    avatarBadge: {
      position: "absolute",
      bottom: 0,
      right: 0,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.background,
    },
    uploadOverlay: {
      position: "absolute",
      inset: 0,
      borderRadius: 44,
      backgroundColor: "rgba(0,0,0,0.4)",
      alignItems: "center",
      justifyContent: "center",
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
    city: {
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
    roleText: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primary,
    },
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
    settingsBtn: {
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
    settingsBtnText: {
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
        <TouchableOpacity
          style={s.avatarWrapper}
          onPress={handleAvatarPress}
          disabled={uploading}
          accessibilityLabel="Change profile photo"
        >
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={s.avatarImage} contentFit="cover" />
          ) : (
            <View style={s.avatar}>
              <FeatherIcons name="user" size={36} color={colors.primary} />
            </View>
          )}
          {uploading && (
            <View style={[s.uploadOverlay, { borderRadius: 44 }]}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
          <View style={s.avatarBadge}>
            <FeatherIcons name="camera" size={13} color="#fff" />
          </View>
        </TouchableOpacity>

        <Text style={s.name}>{user?.name}</Text>
        <Text style={s.email}>{user?.email}</Text>
        {user?.phoneNumber ? <Text style={s.phone}>{user.phoneNumber}</Text> : null}
        {user?.city ? (
          <Text style={s.city}>
            <FeatherIcons name="map-pin" size={12} color={colors.mutedForeground} /> {user.city}
          </Text>
        ) : null}
        <View style={s.roleBadge}>
          <Text style={s.roleText}>Player</Text>
        </View>

        <TouchableOpacity style={s.editBtn} onPress={() => setEditVisible(true)}>
          <FeatherIcons name="edit-2" size={18} color={colors.foreground} />
          <Text style={s.editBtnText}>Edit Profile</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.settingsBtn}
          onPress={() => router.push("/player/settings")}
        >
          <FeatherIcons name="settings" size={18} color={colors.foreground} />
          <Text style={s.settingsBtnText}>Settings</Text>
        </TouchableOpacity>

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
      />
    </View>
  );
}
