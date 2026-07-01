import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import FeatherIcons from "@/components/FeatherIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { updateProfile, changePassword } from "@workspace/api-client-react";
import type { AuthUser } from "@/context/AuthContext";

const CYPRUS_CITIES = [
  "Nicosia",
  "Limassol",
  "Larnaca",
  "Paphos",
  "Ayia Napa",
  "Protaras",
];

interface Props {
  visible: boolean;
  user: AuthUser | null;
  onClose: () => void;
  onSaved: (updated: {
    name: string;
    email: string;
    phoneNumber?: string | null;
    avatarUrl?: string | null;
    city?: string | null;
  }) => void;
}

type Tab = "profile" | "password";

export default function EditProfileSheet({ visible, user, onClose, onSaved }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>("profile");

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber ?? "");
  const [city, setCity] = useState(user?.city ?? "");

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(user?.name ?? "");
      setEmail(user?.email ?? "");
      setPhoneNumber(user?.phoneNumber ?? "");
      setCity(user?.city ?? "");
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
      setTab("profile");
    }
  }, [visible, user]);

  const handleSaveProfile = async () => {
    if (!name.trim()) {
      Alert.alert("Validation", "Name cannot be empty.");
      return;
    }
    if (!email.trim()) {
      Alert.alert("Validation", "Email cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const res = await updateProfile({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phoneNumber: phoneNumber.trim() || undefined,
        city: city.trim() || null,
      });
      onSaved({
        name: res.user.name,
        email: res.user.email,
        phoneNumber: res.user.phoneNumber,
        avatarUrl: res.user.avatarUrl,
        city: res.user.city,
      });
      Alert.alert("Saved", "Your profile has been updated.");
      onClose();
    } catch (err: unknown) {
      const e = err as { data?: { error?: string }; message?: string } | null;
      const msg = e?.data?.error ?? e?.message ?? "Failed to update profile.";
      Alert.alert("Error", msg);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPwd || !newPwd || !confirmPwd) {
      Alert.alert("Validation", "All password fields are required.");
      return;
    }
    if (newPwd.length < 6) {
      Alert.alert("Validation", "New password must be at least 6 characters.");
      return;
    }
    if (newPwd !== confirmPwd) {
      Alert.alert("Validation", "New passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await changePassword({ currentPassword: currentPwd, newPassword: newPwd });
      Alert.alert("Success", "Password changed successfully.");
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
      onClose();
    } catch (err: unknown) {
      const e = err as { data?: { error?: string }; message?: string } | null;
      const msg = e?.data?.error ?? e?.message ?? "Failed to change password.";
      Alert.alert("Error", msg);
    } finally {
      setSaving(false);
    }
  };

  const s = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: insets.bottom + 24,
      maxHeight: "92%",
    },
    handle: {
      width: 36,
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      alignSelf: "center",
      marginTop: 12,
      marginBottom: 16,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      marginBottom: 16,
    },
    title: {
      fontSize: 18,
      fontFamily: "Inter_700Bold",
      color: colors.foreground,
    },
    tabRow: {
      flexDirection: "row",
      marginHorizontal: 20,
      marginBottom: 20,
      backgroundColor: colors.muted,
      borderRadius: 10,
      padding: 3,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 8,
      alignItems: "center",
    },
    tabBtnActive: {
      backgroundColor: colors.card,
    },
    tabText: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.mutedForeground,
    },
    tabTextActive: {
      color: colors.foreground,
      fontFamily: "Inter_600SemiBold",
    },
    body: {
      paddingHorizontal: 20,
    },
    field: {
      marginBottom: 16,
    },
    label: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
      color: colors.foreground,
      marginBottom: 6,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
    },
    input: {
      flex: 1,
      height: 48,
      fontSize: 15,
      fontFamily: "Inter_400Regular",
      color: colors.foreground,
    },
    eyeBtn: { padding: 4 },
    chipsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 10,
    },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 20,
      borderWidth: 1,
    },
    chipText: {
      fontSize: 13,
      fontFamily: "Inter_500Medium",
    },
    saveBtn: {
      marginHorizontal: 20,
      marginTop: 8,
      backgroundColor: colors.primary,
      borderRadius: 12,
      height: 50,
      alignItems: "center",
      justifyContent: "center",
    },
    saveBtnDisabled: { opacity: 0.6 },
    saveBtnText: {
      fontSize: 15,
      fontFamily: "Inter_600SemiBold",
      color: colors.primaryForeground,
    },
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.title}>Edit Profile</Text>
            <TouchableOpacity onPress={onClose}>
              <FeatherIcons name="x" size={22} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <View style={s.tabRow}>
            <TouchableOpacity
              style={[s.tabBtn, tab === "profile" && s.tabBtnActive]}
              onPress={() => setTab("profile")}
            >
              <Text style={[s.tabText, tab === "profile" && s.tabTextActive]}>Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.tabBtn, tab === "password" && s.tabBtnActive]}
              onPress={() => setTab("password")}
            >
              <Text style={[s.tabText, tab === "password" && s.tabTextActive]}>Password</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={s.body} keyboardShouldPersistTaps="handled">
            {tab === "profile" ? (
              <>
                <View style={s.field}>
                  <Text style={s.label}>Username / Full Name</Text>
                  <View style={s.inputRow}>
                    <TextInput
                      style={s.input}
                      value={name}
                      onChangeText={setName}
                      placeholder="Your name"
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="words"
                    />
                  </View>
                </View>

                <View style={s.field}>
                  <Text style={s.label}>Email</Text>
                  <View style={s.inputRow}>
                    <TextInput
                      style={s.input}
                      value={email}
                      onChangeText={setEmail}
                      placeholder="you@example.com"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <View style={s.field}>
                  <Text style={s.label}>Phone Number</Text>
                  <View style={s.inputRow}>
                    <TextInput
                      style={s.input}
                      value={phoneNumber}
                      onChangeText={setPhoneNumber}
                      placeholder="+357 99 000000"
                      placeholderTextColor={colors.mutedForeground}
                      keyboardType="phone-pad"
                    />
                  </View>
                </View>

                <View style={s.field}>
                  <Text style={s.label}>City</Text>
                  <View style={s.chipsRow}>
                    {CYPRUS_CITIES.map((c) => {
                      const active = city === c;
                      return (
                        <TouchableOpacity
                          key={c}
                          style={[
                            s.chip,
                            {
                              backgroundColor: active ? colors.primary : "transparent",
                              borderColor: active ? colors.primary : colors.border,
                            },
                          ]}
                          onPress={() => setCity(active ? "" : c)}
                        >
                          <Text
                            style={[
                              s.chipText,
                              { color: active ? colors.primaryForeground : colors.mutedForeground },
                            ]}
                          >
                            {c}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={{ height: 16 }} />
              </>
            ) : (
              <>
                <View style={s.field}>
                  <Text style={s.label}>Current Password</Text>
                  <View style={s.inputRow}>
                    <TextInput
                      style={s.input}
                      value={currentPwd}
                      onChangeText={setCurrentPwd}
                      placeholder="Enter current password"
                      placeholderTextColor={colors.mutedForeground}
                      secureTextEntry={!showCurrent}
                    />
                    <TouchableOpacity
                      style={s.eyeBtn}
                      onPress={() => setShowCurrent((v) => !v)}
                    >
                      <FeatherIcons
                        name={showCurrent ? "eye-off" : "eye"}
                        size={18}
                        color={colors.mutedForeground}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={s.field}>
                  <Text style={s.label}>New Password</Text>
                  <View style={s.inputRow}>
                    <TextInput
                      style={s.input}
                      value={newPwd}
                      onChangeText={setNewPwd}
                      placeholder="Min. 6 characters"
                      placeholderTextColor={colors.mutedForeground}
                      secureTextEntry={!showNew}
                    />
                    <TouchableOpacity style={s.eyeBtn} onPress={() => setShowNew((v) => !v)}>
                      <FeatherIcons
                        name={showNew ? "eye-off" : "eye"}
                        size={18}
                        color={colors.mutedForeground}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={s.field}>
                  <Text style={s.label}>Confirm New Password</Text>
                  <View style={s.inputRow}>
                    <TextInput
                      style={s.input}
                      value={confirmPwd}
                      onChangeText={setConfirmPwd}
                      placeholder="Repeat new password"
                      placeholderTextColor={colors.mutedForeground}
                      secureTextEntry
                    />
                  </View>
                </View>

                <View style={{ height: 16 }} />
              </>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[s.saveBtn, saving && s.saveBtnDisabled]}
            onPress={tab === "profile" ? handleSaveProfile : handleChangePassword}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={s.saveBtnText}>
                {tab === "profile" ? "Save Changes" : "Change Password"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
