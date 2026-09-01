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
import AvatarInitials from "@/components/AvatarInitials";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import EditProfileSheet from "@/components/EditProfileSheet";
import { uploadAvatar } from "@workspace/api-client-react";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // Must match the avatar API limit.

const SUPPORTED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

function getUploadErrorMessage(error: unknown): string {
  const apiMessage = (error as { data?: { error?: string } })?.data?.error;
  if (apiMessage) return apiMessage;

  const fallback =
    error instanceof Error ? error.message : "Could not upload the image. Please try again.";

  return fallback.replace(/^HTTP\s+\d{3}(?:\s+[^:]*)?\s*:\s*/i, "") || fallback;
}
export default function PlayerProfileScreen() {
  const colors = useColors();
  const { user, logout, updateUser } = useAuth();
  const router = useRouter();
  const [editVisible, setEditVisible] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploading = uploadState === "preparing" || uploadState === "uploading";

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
    setUploadError(null);
    setUploadState("preparing");

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setUploadState("error");
      setUploadError("Photo library permission is needed to choose a profile photo.");
      Alert.alert(
        "Permission required",
        "Please allow access to your photo library to update your profile picture.",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) {
      setUploadState("idle");
      return;
    }

    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? "image/jpeg";

    if (!SUPPORTED_AVATAR_TYPES.includes(mimeType)) {
      const message = "Please choose a JPEG, PNG, or WebP image.";
      setUploadState("error");
      setUploadError(message);
      Alert.alert("Unsupported format", message);
      return;
    }

    if (asset.fileSize != null && asset.fileSize > MAX_FILE_SIZE) {
      const message = "Please choose an image smaller than 8 MB.";
      setUploadState("error");
      setUploadError(message);
      Alert.alert(
        "File too large",
        message,
      );
      return;
    }

    setUploadState("uploading");
    try {
      const { avatarUrl } = await uploadAvatar(asset.uri, mimeType);
      await updateUser({ avatarUrl });
      setUploadState("success");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      const message = getUploadErrorMessage(err);
      setUploadState("error");
      setUploadError(message);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Upload failed", message);
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
    uploadingLabel: {
      color: "#fff",
      fontSize: 11,
      fontFamily: "PlusJakartaSans_600SemiBold",
      marginTop: 4,
    },
    avatarStatus: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.mutedForeground,
      textAlign: "center",
      marginBottom: 18,
      paddingHorizontal: 8,
    },
    avatarStatusSuccess: {
      color: colors.success,
    },
    avatarStatusError: {
      color: colors.destructive,
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
          accessibilityLabel="Choose and crop profile photo"
          accessibilityHint="Opens your photo library and lets you crop the image to a square"
          accessibilityRole="button"
          accessibilityState={{ disabled: uploading, busy: uploading }}
        >
          {user?.avatarUrl ? (
            <Image source={{ uri: user.avatarUrl }} style={s.avatarImage} contentFit="cover" />
          ) : (
            <AvatarInitials
              name={user?.name ?? ""}
              size={88}
              fontSize={32}
              backgroundColor={colors.primary + "20"}
              color={colors.primary}
            />
          )}
          {uploading && (
            <View style={[s.uploadOverlay, { borderRadius: 44 }]}>
              <ActivityIndicator color="#fff" />
              <Text style={s.uploadingLabel}>
                {uploadState === "preparing" ? "Preparing…" : "Uploading…"}
              </Text>
            </View>
          )}
          <View style={s.avatarBadge}>
            <FeatherIcons name="camera" size={13} color="#fff" />
          </View>
        </TouchableOpacity>
        <Text
          style={[
            s.avatarStatus,
            uploadState === "success" && s.avatarStatusSuccess,
            uploadState === "error" && s.avatarStatusError,
          ]}
          accessibilityLiveRegion="polite"
        >
          {uploadState === "preparing"
            ? "Opening photo library…"
            : uploadState === "uploading"
              ? "Uploading your cropped photo…"
              : uploadState === "success"
                ? "Profile photo updated."
                : uploadError ?? "Tap the photo to choose and crop a square profile picture."}
        </Text>

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
        onPasswordChanged={handleLogout}
      />
    </View>
  );
}

type UploadState = "idle" | "preparing" | "uploading" | "success" | "error";
