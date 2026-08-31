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
import * as Haptics from "expo-haptics";
import { loginUser, validateRequestBody, validationMessage } from "@workspace/api-client-react";
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

type WrongModeState = {
  actualLabel: string;
  onContinue: () => Promise<void>;
};

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { selectedMode, login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrongMode, setWrongMode] = useState<WrongModeState | null>(null);

  const clearError = () => {
    if (error) setError(null);
    if (wrongMode) setWrongMode(null);
  };

  const handleLogin = async () => {
    setError(null);
    setWrongMode(null);

    const payload = { email: email.trim().toLowerCase(), password };
    const validation = validateRequestBody<typeof payload>("POST", "/api/auth/login", payload);
    if (!validation.success) {
      setError(validationMessage(validation.issues[0]!));
      return;
    }

    setLoading(true);
    try {
      const data = await loginUser(validation.data);

      if (data.user.role !== selectedMode) {
        const actualLabel = MODE_LABELS[data.user.role] || data.user.role;
        const selectedLabel = MODE_LABELS[selectedMode || ""] || selectedMode;

        const onContinue = async () => {
          await login(
            {
              id: data.user.id,
              email: data.user.email,
              name: data.user.name,
              role: toAppMode(data.user.role),
              phoneNumber: data.user.phoneNumber,
              avatarUrl: data.user.avatarUrl,
              city: data.user.city,
            },
            data.token,
          );
          router.replace("/");
        };

        setWrongMode({
          actualLabel,
          onContinue,
        });
        setError(
          `This is a ${actualLabel} account, but you selected ${selectedLabel} mode.`,
        );
        setLoading(false);
        return;
      }

      await login(
        {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: toAppMode(data.user.role),
          phoneNumber: data.user.phoneNumber,
          avatarUrl: data.user.avatarUrl,
          city: data.user.city,
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
        "Login failed. Please check your credentials and try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const s = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flex: 1,
    },
    inner: {
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20),
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24),
    },
    backBtn: {
      marginBottom: 32,
    },
    heading: {
      marginBottom: 8,
    },
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
      alignItems: "flex-start",
      gap: 8,
    },
    errorText: {
      flex: 1,
      fontSize: 13,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.destructive,
      lineHeight: 18,
    },
    wrongModeActions: {
      flexDirection: "row",
      gap: 8,
      marginTop: 10,
    },
    wrongModeBtn: {
      flex: 1,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderRadius: 8,
      alignItems: "center",
    },
    wrongModeBtnText: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_600SemiBold",
    },
    field: {
      marginBottom: 16,
    },
    label: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_500Medium",
      color: colors.foreground,
      marginBottom: 6,
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
      padding: 4,
    },
    loginBtn: {
      backgroundColor: loading ? colors.muted : colors.primary,
      borderRadius: 12,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 8,
      marginBottom: 24,
    },
    loginText: {
      fontSize: 16,
      fontFamily: "PlusJakartaSans_600SemiBold",
      color: colors.primaryForeground,
    },
    divider: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 24,
    },
    divLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },
    divText: {
      fontSize: 13,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
    registerBtn: {
      alignItems: "center",
    },
    registerText: {
      fontSize: 14,
      fontFamily: "PlusJakartaSans_400Regular",
      color: colors.mutedForeground,
    },
    registerLink: {
      color: colors.primary,
      fontFamily: "PlusJakartaSans_600SemiBold",
    },
  });

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.inner} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <FeatherIcons name="arrow-left" size={24} color={colors.foreground} />
        </TouchableOpacity>

        <View style={s.heading}>
          <Text style={s.mode}>{MODE_LABELS[selectedMode || "PLAYER"] || "Player"} Mode</Text>
          <Text style={s.title}>Welcome back</Text>
          <Text style={s.subtitle}>Sign in to continue</Text>
        </View>

        {error && (
          <View style={s.errorBanner}>
            <FeatherIcons name="alert-circle" size={16} color={colors.destructive} />
            <View style={{ flex: 1 }}>
              <Text style={s.errorText}>{error}</Text>
              {wrongMode && (
                <View style={s.wrongModeActions}>
                  <TouchableOpacity
                    style={[s.wrongModeBtn, { backgroundColor: colors.muted }]}
                    onPress={() => router.back()}
                  >
                    <Text style={[s.wrongModeBtnText, { color: colors.foreground }]}>
                      Go back
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.wrongModeBtn, { backgroundColor: colors.primary }]}
                    onPress={wrongMode.onContinue}
                  >
                    <Text style={[s.wrongModeBtnText, { color: colors.primaryForeground }]}>
                      Continue as {wrongMode.actualLabel}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        )}

        <View style={s.field}>
          <Text style={s.label}>Email</Text>
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
              testID="login-email"
            />
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.label}>Password</Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={(v) => { setPassword(v); clearError(); }}
              placeholder="••••••••"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showPassword}
              autoComplete="password"
              textContentType="password"
              maxLength={256}
              testID="login-password"
            />
            <TouchableOpacity
              style={s.eyeBtn}
              onPress={() => setShowPassword((v) => !v)}
            >
              <FeatherIcons
                name={showPassword ? "eye-off" : "eye"}
                size={18}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={s.loginBtn}
          onPress={handleLogin}
          disabled={loading}
          testID="login-submit"
        >
          <Text style={s.loginText}>{loading ? "Signing in…" : "Sign In"}</Text>
        </TouchableOpacity>

        <View style={s.divider}>
          <View style={s.divLine} />
          <Text style={s.divText}>or</Text>
          <View style={s.divLine} />
        </View>

        <TouchableOpacity
          style={s.registerBtn}
          onPress={() => router.push("/(auth)/register")}
          testID="go-register"
        >
          <Text style={s.registerText}>
            Don't have an account?{" "}
            <Text style={s.registerLink}>Create one</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
