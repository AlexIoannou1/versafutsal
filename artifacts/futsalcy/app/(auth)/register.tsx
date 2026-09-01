import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import FeatherIcons from "@/components/FeatherIcons";
import PhoneNumberField from "@/components/PhoneNumberField";
import PasswordStrengthMeter from "@/components/PasswordStrengthMeter";
import * as Haptics from "expo-haptics";
import { registerUser, validateRequestBody, validationMessage } from "@workspace/api-client-react";
import type { AppMode } from "@/context/AuthContext";

const MODE_LABELS: Record<string, string> = {
  PLAYER: "Player",
  VENUE_OWNER: "Venue Owner",
  ADMIN: "Admin",
};

const VALID_ROLES: AppMode[] = ["PLAYER", "VENUE_OWNER", "ADMIN"];
function toAppMode(role: string): AppMode {
  return VALID_ROLES.includes(role as AppMode) ? (role as AppMode) : "PLAYER";
}

export default function RegisterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { selectedMode, login } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = selectedMode === "VENUE_OWNER";

  const clearError = () => { if (error) setError(null); };

  // Admin accounts cannot be self-registered.
  if (selectedMode === "ADMIN") {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <Text
          style={{
            fontFamily: "PlusJakartaSans_700Bold",
            fontSize: 18,
            color: colors.foreground,
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          Admin accounts cannot be created here
        </Text>
        <Text
          style={{
            fontFamily: "PlusJakartaSans_400Regular",
            fontSize: 14,
            color: colors.mutedForeground,
            textAlign: "center",
            marginBottom: 32,
            lineHeight: 20,
          }}
        >
          Admin accounts are provisioned separately. Please sign in with your existing credentials.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{
            backgroundColor: colors.primary,
            borderRadius: 12,
            paddingHorizontal: 24,
            paddingVertical: 14,
          }}
        >
          <Text
            style={{
              fontFamily: "PlusJakartaSans_600SemiBold",
              fontSize: 15,
              color: colors.primaryForeground,
            }}
          >
            Back to Sign In
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleRegister = async () => {
    setError(null);

    const payload = {
      email: email.trim().toLowerCase(),
      password,
      name: name.trim(),
      role: selectedMode || "PLAYER",
      phoneNumber: phoneNumber.trim(),
    };
    const validation = validateRequestBody<typeof payload>("POST", "/api/auth/register", payload);
    if (!validation.success) {
      setError(validationMessage(validation.issues[0]!));
      return;
    }
    setLoading(true);
    try {
      const data = await registerUser(validation.data);

      await login(
        {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: toAppMode(data.user.role),
          phoneNumber: (data.user as { phoneNumber?: string | null }).phoneNumber,
        },
        data.token,
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    } catch (err: unknown) {
      const e = err as Record<string, unknown> | null;
      const message =
        (e?.data as Record<string, unknown>)?.error as string ||
        (e?.message as string) ||
        "Registration failed. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    inner: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20),
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24),
    },
    backBtn: { marginBottom: 32 },
    mode: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.primary,
      marginBottom: 4,
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    title: {
      fontSize: 28,
      fontFamily: "PlusJakartaSans_700Bold",
      color: colors.foreground,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 15,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      marginBottom: 32,
    },
    errorBanner: {
      backgroundColor: colors.destructive + "18",
      borderWidth: 1,
      borderColor: colors.destructive + "40",
      borderRadius: 10,
      padding: 12,
      marginBottom: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    errorText: {
      flex: 1,
      fontSize: 13,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.destructive,
      lineHeight: 18,
    },
    field: { marginBottom: 16 },
    label: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.foreground,
      marginBottom: 6,
    },
    required: {
      color: colors.destructive,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
    },
    input: {
      flex: 1,
      height: 48,
      fontSize: 15,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.foreground,
    },
    eyeBtn: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    hint: {
      fontSize: 12,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
      marginTop: 4,
    },
    submitBtn: {
      backgroundColor: loading ? colors.muted : colors.primary,
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
      marginBottom: 24,
    },
    submitText: {
      fontSize: 16,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primaryForeground,
    },
    loginLink: { alignItems: "center" },
    loginText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
    loginBold: {
      color: colors.primary,
      fontFamily: "PlusJakartaSans_600SemiBold",
    },
  });

  return (
    <View style={s.container}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.inner}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <FeatherIcons name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>

        <Text style={s.mode}>{MODE_LABELS[selectedMode || "PLAYER"] || "Player"} Mode</Text>
        <Text style={s.title}>Create account</Text>
        <Text style={s.subtitle}>Join Versa and start booking</Text>

        {error && (
          <View style={s.errorBanner}>
            <FeatherIcons name="alert-circle" size={16} color={colors.destructive} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <View style={s.field}>
          <Text style={s.label}>Full name <Text style={s.required}>*</Text></Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={(v) => { setName(v); clearError(); }}
              placeholder="Your name"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              maxLength={120}
              testID="register-name"
            />
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Email <Text style={s.required}>*</Text></Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={(v) => { setEmail(v); clearError(); }}
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              maxLength={254}
              testID="register-email"
            />
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Phone number <Text style={s.required}>*</Text></Text>
          <PhoneNumberField
            value={phoneNumber}
            onChangeText={(v) => { setPhoneNumber(v); clearError(); }}
            accessibilityLabel="Phone number"
            testID="register-phone"
          />
        </View>

        <View style={s.field}>
          <Text style={s.label}>Password <Text style={s.required}>*</Text></Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={(v) => { setPassword(v); clearError(); }}
              placeholder="At least 8 characters"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showPassword}
              autoComplete="new-password"
              textContentType="newPassword"
              maxLength={256}
              accessibilityLabel="New password"
              testID="register-password"
            />
            <TouchableOpacity
              style={s.eyeBtn}
              onPress={() => setShowPassword((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              accessibilityHint="Toggles whether the password is visible"
              testID="register-password-visibility"
            >
              <FeatherIcons
                name={showPassword ? "eye-off" : "eye"}
                size={18}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>
          </View>
          <PasswordStrengthMeter password={password} />
        </View>

        <TouchableOpacity
          style={s.submitBtn}
          onPress={handleRegister}
          disabled={loading}
          testID="register-submit"
        >
          <Text style={s.submitText}>{loading ? "Creating account…" : "Create Account"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.loginLink} onPress={() => router.back()}>
          <Text style={s.loginText}>
            Already have an account? <Text style={s.loginBold}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
